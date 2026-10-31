import { assertFeature } from "@/lib/billing/entitlements";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, clientIp, parseBody, requireApiOrg, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { encrypt } from "@/lib/crypto";
import { orgDb } from "@/lib/tenancy";
import { generateWebhookSecret, WEBHOOK_EVENTS } from "@/lib/webhooks";

const webhookBody = z.object({
  url: z
    .string()
    .trim()
    .url("Enter the full URL, e.g. https://example.com/webhooks/whatsapp")
    .max(2000)
    .refine((u) => /^https?:\/\//.test(u), "Use an http:// or https:// URL."),
  description: z.string().trim().max(200).nullable().optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, "Choose at least one event."),
});

const MAX_ENDPOINTS = 10;

/** New webhook endpoint; the signing secret is returned only here */
export const POST = route(async (req) => {
  const session = await requireApiOrg("ADMIN");
  const input = await parseBody(req, webhookBody);
  await assertFeature(session.org.id, "webhooks");
  const tdb = orgDb(session.org.id);
  if ((await tdb.webhookEndpoint.count()) >= MAX_ENDPOINTS) throw new ApiError(400, `You can have up to ${MAX_ENDPOINTS} webhooks.`);
  const secret = generateWebhookSecret();
  const ep = await tdb.webhookEndpoint.create({ data: { orgId: session.org.id, url: input.url, description: input.description ?? null, events: input.events, secretEnc: encrypt(secret) } });
  await audit({ action: "webhook.created", orgId: session.org.id, userId: session.user.id, targetType: "webhook", targetId: ep.id, meta: { url: input.url }, ip: clientIp(req) });
  return NextResponse.json({ secret, webhook: { id: ep.id } }, { status: 201 });
});
