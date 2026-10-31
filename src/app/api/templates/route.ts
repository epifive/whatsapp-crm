import { NextResponse } from "next/server";
import { ApiError, clientIp, requireApiOrg, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { CAMPAIGN_MEDIA_TYPES } from "@/lib/campaigns/schema";
import { decrypt } from "@/lib/crypto";
import { publish } from "@/lib/realtime";
import { MAX_UPLOAD_BYTES } from "@/lib/storage";
import { orgDb } from "@/lib/tenancy";
import { createTemplate, GraphApiError, uploadTemplateSample } from "@/lib/whatsapp/official/client";
import { renderTemplatePreview, templateCreateSchema, templateSpec, templateVariables, toMetaComponents } from "@/lib/whatsapp/templates";
import type { Prisma, TemplateStatus } from "@/generated/prisma/client";

/**
 * GET ?accountId= : approved templates (composer / campaign pickers)
 * GET ?accountId=&all=1 : every template with its status and components (template manager)
 */
export const GET = route(async (req) => {
  const session = await requireApiOrg("AGENT");
  const params = req.nextUrl.searchParams;
  const accountId = params.get("accountId") ?? undefined;
  const all = params.get("all") === "1";
  const templates = await orgDb(session.org.id).template.findMany({
    where: { ...(all ? {} : { status: "APPROVED" }), ...(accountId ? { accountId } : {}) },
    orderBy: [{ name: "asc" }, { language: "asc" }],
  });
  return NextResponse.json({
    templates: templates.map((t) => {
      const vars = templateVariables(t.components);
      return {
        id: t.id,
        accountId: t.accountId,
        name: t.name,
        language: t.language,
        category: t.category,
        status: t.status,
        statusReason: t.statusReason,
        headerVariables: vars.header,
        bodyVariables: vars.body,
        mediaHeader: vars.mediaHeader,
        spec: templateSpec(t.components),
        components: t.components,
        preview: renderTemplatePreview(t.components, [], []),
        updatedAt: t.updatedAt,
      };
    }),
  });
});

const STATUS: Record<string, TemplateStatus> = { APPROVED: "APPROVED", PENDING: "PENDING", REJECTED: "REJECTED", PAUSED: "PAUSED", DISABLED: "DISABLED" };

/** Create a template and submit it to Meta for review. Multipart: `data` (JSON) + `file` for a media header sample. */
export const POST = route(async (req) => {
  const session = await requireApiOrg("ADMIN");
  const form = await req.formData().catch(() => {
    throw new ApiError(400, "Invalid request.");
  });
  let raw: unknown;
  try {
    raw = JSON.parse(String(form.get("data") ?? ""));
  } catch {
    throw new ApiError(400, "Invalid template.");
  }
  const input = templateCreateSchema.parse(raw);
  const tdb = orgDb(session.org.id);
  const account = await tdb.whatsAppAccount.findUnique({ where: { id: input.accountId } });
  if (!account) throw new ApiError(404, "Number not found.");
  if (account.channel !== "OFFICIAL" || !account.wabaId || !account.accessTokenEnc) throw new ApiError(400, "Templates are created on Cloud API numbers.");
  const token = decrypt(account.accessTokenEnc);

  let handle: string | undefined;
  if (input.header && input.header.format !== "TEXT") {
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) throw new ApiError(400, `Attach a sample ${input.header.format.toLowerCase()} for the header.`);
    if (CAMPAIGN_MEDIA_TYPES[file.type] !== input.header.format) throw new ApiError(400, `The header needs a ${input.header.format.toLowerCase()} file (JPG/PNG, MP4 or PDF).`);
    if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(400, "The sample file is larger than 16 MB.");
    try {
      handle = await uploadTemplateSample(token, { data: Buffer.from(await file.arrayBuffer()), mimeType: file.type, fileName: file.name.slice(0, 100) });
    } catch (err) {
      throw new ApiError(400, `Meta didn't accept the sample file: ${err instanceof GraphApiError ? err.message : "upload failed"}`);
    }
  }

  const components = toMetaComponents(input, handle);
  let created;
  try {
    created = await createTemplate(account.wabaId, token, { name: input.name, language: input.language, category: input.category, components });
  } catch (err) {
    throw new ApiError(400, `Meta rejected the template: ${err instanceof GraphApiError ? err.message : "Meta is unreachable."}`);
  }
  const template = await tdb.template.upsert({
    where: { accountId_externalId: { accountId: account.id, externalId: created.id } },
    create: {
      orgId: session.org.id,
      accountId: account.id,
      externalId: created.id,
      name: input.name,
      language: input.language,
      category: created.category ?? input.category,
      status: STATUS[created.status] ?? "PENDING",
      components: components as unknown as Prisma.InputJsonValue,
    },
    update: {},
  });
  await audit({ action: "whatsapp.template_created", orgId: session.org.id, userId: session.user.id, targetType: "template", targetId: template.id, meta: { name: input.name }, ip: clientIp(req) });
  await publish(`org:${session.org.id}`, "templates.changed", { accountId: account.id });
  return NextResponse.json({ template: { id: template.id, status: template.status } }, { status: 201 });
});
