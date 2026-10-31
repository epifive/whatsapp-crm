import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/api";
import { apiV1, jsonBody } from "@/lib/api-v1";
import { apiPhone, chatFor, fetchMedia, pickAccount } from "@/lib/api-v1-helpers";
import { orgDb } from "@/lib/tenancy";
import { queueOutbound } from "@/lib/whatsapp/outbound";
import { buildTemplatePayload, renderTemplatePreview, templateSpec } from "@/lib/whatsapp/templates";
import { isWindowOpen } from "@/lib/whatsapp/window";

const body = z
  .object({
    to: z.string().min(1),
    account_id: z.string().min(1).optional(),
    text: z.string().max(4096).optional(),
    media_url: z.string().url().max(2000).optional(),
    template: z
      .object({
        name: z.string().min(1).max(512),
        language: z.string().max(10).optional(),
        header: z.array(z.string().min(1).max(1024)).max(5).default([]),
        body: z.array(z.string().min(1).max(1024)).max(30).default([]),
        header_media_url: z.string().url().max(2000).optional(),
        buttons: z.record(z.string().regex(/^\d$/), z.string().min(1).max(200)).default({}),
      })
      .optional(),
  })
  .refine((b) => b.text || b.media_url || b.template, "Send `text`, `media_url` or `template`.");

/**
 * POST /api/v1/messages — send a WhatsApp message.
 * Cloud API numbers: free text and media only within 24 h of the customer's last message,
 * otherwise send an approved `template`. QR numbers: any message, through the anti-ban engine.
 */
export const POST = apiV1(async (req, _ctx, auth) => {
  const input = body.parse(await jsonBody(req));
  const tdb = orgDb(auth.orgId);
  const account = await pickAccount(tdb, input.account_id);
  const phone = apiPhone(input.to);
  const { conversation } = await chatFor(tdb, auth.orgId, account.id, phone);
  const official = account.channel === "OFFICIAL";
  const base = { orgId: auth.orgId, conversationId: conversation.id, accountId: account.id, sentById: null, payload: { via: "api", apiKeyId: auth.keyId } };

  let message;
  if (input.template) {
    if (!official) throw new ApiError(400, "Templates are for Cloud API numbers; send `text` on QR numbers.", "invalid");
    const t = input.template;
    const template = await tdb.template.findFirst({ where: { accountId: account.id, name: t.name, status: "APPROVED", ...(t.language ? { language: t.language } : {}) } });
    if (!template) throw new ApiError(404, `No approved template "${t.name}"${t.language ? ` (${t.language})` : ""} on this number.`, "template_not_found");
    const spec = templateSpec(template.components);
    if (t.body.length !== spec.body.length || t.header.length !== (spec.header?.vars.length ?? 0)) {
      throw new ApiError(400, `Template "${t.name}" needs ${spec.body.length} body and ${spec.header?.vars.length ?? 0} header values.`, "invalid");
    }
    const mediaHeader = spec.header && spec.header.format !== "TEXT" && spec.header.format !== "LOCATION";
    if (mediaHeader && !t.header_media_url) throw new ApiError(400, "This template has a media header: send `template.header_media_url`.", "invalid");
    message = await queueOutbound({
      ...base,
      type: "TEMPLATE",
      body: renderTemplatePreview(template.components, t.header, t.body),
      payload: {
        ...base.payload,
        templateId: template.id,
        template: buildTemplatePayload(
          template.name,
          template.language,
          { header: t.header, body: t.body, buttons: Object.fromEntries(Object.entries(t.buttons).map(([k, v]) => [Number(k), v])), headerMedia: mediaHeader ? { link: t.header_media_url } : undefined },
          template.components,
        ),
      },
    });
  } else {
    if (official && !isWindowOpen(conversation.lastInboundAt)) {
      throw new ApiError(400, "The 24-hour reply window is closed for this contact. Send an approved `template` instead.", "window_closed");
    }
    const media = input.media_url ? await fetchMedia(auth.orgId, input.media_url) : null;
    message = await queueOutbound({ ...base, type: media?.type ?? "TEXT", body: input.text ?? null, media: media?.media ?? null });
  }
  return NextResponse.json({ data: { id: message.id, status: "queued", conversation_id: conversation.id, account_id: account.id } }, { status: 202 });
});
