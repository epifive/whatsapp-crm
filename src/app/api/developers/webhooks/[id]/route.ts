import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, clientIp, parseBody, requireApiOrg, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { decrypt, encrypt } from "@/lib/crypto";
import { orgDb } from "@/lib/tenancy";
import { generateWebhookSecret, postSigned, WEBHOOK_EVENTS } from "@/lib/webhooks";

type Ctx = RouteContext<"/api/developers/webhooks/[id]">;

/** Recent deliveries of this endpoint */
export const GET = route<Ctx>(async (_req, ctx) => {
  const session = await requireApiOrg("ADMIN");
  const { id } = await ctx.params;
  const tdb = orgDb(session.org.id);
  if (!(await tdb.webhookEndpoint.findUnique({ where: { id }, select: { id: true } }))) throw new ApiError(404, "Webhook not found.");
  const deliveries = await tdb.webhookDelivery.findMany({ where: { endpointId: id }, orderBy: { createdAt: "desc" }, take: 30 });
  return NextResponse.json({
    deliveries: deliveries.map((d) => ({ id: d.id, event: d.event, ok: d.ok, status: d.status, attempt: d.attempt, durationMs: d.durationMs, error: d.error, response: d.response, createdAt: d.createdAt })),
  });
});

const patchBody = z.object({
  url: z
    .string()
    .trim()
    .url()
    .max(2000)
    .refine((u) => /^https?:\/\//.test(u), "Use an http:// or https:// URL.")
    .optional(),
  description: z.string().trim().max(200).nullable().optional(),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(),
  isActive: z.boolean().optional(),
  rotateSecret: z.boolean().optional(),
  test: z.boolean().optional(),
});

/** Edit, pause/resume, rotate the secret (returned once), or send a test event */
export const PATCH = route<Ctx>(async (req, ctx) => {
  const session = await requireApiOrg("ADMIN");
  const { id } = await ctx.params;
  const input = await parseBody(req, patchBody);
  const tdb = orgDb(session.org.id);
  const ep = await tdb.webhookEndpoint.findUnique({ where: { id } });
  if (!ep) throw new ApiError(404, "Webhook not found.");

  if (input.test) {
    const res = await postSigned(ep.url, decrypt(ep.secretEnc), "webhook.test", { message: "Test event from CRM for WhatsApp", workspace: session.org.name });
    await tdb.webhookDelivery.create({
      data: { orgId: session.org.id, endpointId: id, event: "webhook.test", payload: {}, status: res.status, ok: res.ok, durationMs: res.durationMs, error: res.error ?? (res.ok ? null : `HTTP ${res.status}`), response: res.body.slice(0, 1000) || null },
    });
    return NextResponse.json({ ok: res.ok, status: res.status, error: res.error ?? null, durationMs: res.durationMs });
  }

  const secret = input.rotateSecret ? generateWebhookSecret() : null;
  await tdb.webhookEndpoint.update({
    where: { id },
    data: {
      url: input.url,
      description: input.description,
      events: input.events,
      isActive: input.isActive,
      ...(input.isActive ? { failureCount: 0 } : {}),
      ...(secret ? { secretEnc: encrypt(secret) } : {}),
    },
  });
  if (secret) await audit({ action: "webhook.secret_rotated", orgId: session.org.id, userId: session.user.id, targetType: "webhook", targetId: id, ip: clientIp(req) });
  return NextResponse.json({ ok: true, secret });
});

export const DELETE = route<Ctx>(async (req, ctx) => {
  const session = await requireApiOrg("ADMIN");
  const { id } = await ctx.params;
  const { count } = await orgDb(session.org.id).webhookEndpoint.deleteMany({ where: { id } });
  if (!count) throw new ApiError(404, "Webhook not found.");
  await audit({ action: "webhook.deleted", orgId: session.org.id, userId: session.user.id, targetType: "webhook", targetId: id, ip: clientIp(req) });
  return NextResponse.json({ ok: true });
});
