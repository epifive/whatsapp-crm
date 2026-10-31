import { assertLimit } from "@/lib/billing/entitlements";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiV1, jsonBody } from "@/lib/api-v1";
import { apiPhone, contactApiInclude, contactJson } from "@/lib/api-v1-helpers";
import { logActivity } from "@/lib/crm/activity";
import { ensureTags, fieldDefs } from "@/lib/crm/contacts";
import { mergeFieldValues } from "@/lib/crm/fields";
import { db } from "@/lib/db";
import { orgDb } from "@/lib/tenancy";
import { emitEvent } from "@/lib/webhooks";

const PAGE = 100;

/** GET /api/v1/contacts?phone=&q=&cursor= */
export const GET = apiV1(async (req, _ctx, auth) => {
  const tdb = orgDb(auth.orgId);
  const p = req.nextUrl.searchParams;
  const phone = p.get("phone");
  const q = p.get("q")?.trim().slice(0, 100);
  const cursor = p.get("cursor");
  const rows = await tdb.contact.findMany({
    where: {
      ...(phone ? { phone: apiPhone(phone) } : {}),
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { phone: { contains: q.replace(/\D/g, "") || q } }] } : {}),
    },
    include: contactApiInclude,
    orderBy: { id: "asc" },
    take: PAGE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, PAGE);
  return NextResponse.json({ data: page.map(contactJson), next_cursor: rows.length > PAGE ? page[page.length - 1]!.id : null });
});

const upsertBody = z.object({
  phone: z.string().min(1),
  name: z.string().trim().max(100).optional(),
  email: z.email().max(254).optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(50).optional(),
  opted_in: z.boolean().optional(),
});

/** POST /api/v1/contacts — create or update by phone (201 when created) */
export const POST = apiV1(async (req, _ctx, auth) => {
  const input = upsertBody.parse(await jsonBody(req));
  const tdb = orgDb(auth.orgId);
  const phone = apiPhone(input.phone);
  const existing = await tdb.contact.findUnique({ where: { orgId_phone: { orgId: auth.orgId, phone } } });
  if (!existing) await assertLimit(auth.orgId, "contacts");
  const fields = input.fields ? mergeFieldValues(await fieldDefs(tdb), existing?.fields ?? {}, input.fields) : undefined;
  const data = {
    ...(input.name !== undefined ? { name: input.name || null } : {}),
    ...(input.email !== undefined ? { email: input.email.toLowerCase() } : {}),
    ...(fields ? { fields } : {}),
    ...(input.opted_in && !existing?.optedOut && !existing?.optedInAt ? { optedInAt: new Date(), optInSource: "api" } : {}),
  };
  const contact = existing
    ? await tdb.contact.update({ where: { id: existing.id }, data })
    : await tdb.contact.create({ data: { orgId: auth.orgId, phone, source: "api", ...data } });
  if (input.tags?.length) {
    const tags = await ensureTags(tdb, auth.orgId, input.tags);
    await db.contactTag.createMany({ data: tags.map((t) => ({ contactId: contact.id, tagId: t.id })), skipDuplicates: true });
  }
  if (!existing) {
    await logActivity({ orgId: auth.orgId, contactId: contact.id, type: "contact.created", data: { source: "api" } });
    await emitEvent(auth.orgId, "contact.created", { contact: { id: contact.id, phone: contact.phone, name: contact.name, source: "api" } });
  }
  const full = await tdb.contact.findUniqueOrThrow({ where: { id: contact.id }, include: contactApiInclude });
  return NextResponse.json({ data: contactJson(full) }, { status: existing ? 200 : 201 });
});
