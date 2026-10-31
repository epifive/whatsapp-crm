import { assertFeature } from "@/lib/billing/entitlements";
import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, parseBody, requireApiOrg, route } from "@/lib/api";
import { newApiKey } from "@/lib/api-v1";
import { audit } from "@/lib/audit";
import { orgDb } from "@/lib/tenancy";
import { flowSigningSecret, WEBHOOK_EVENTS } from "@/lib/webhooks";

/** API keys, webhook endpoints and the flow signing secret for Settings › Developers */
export const GET = route(async () => {
  const session = await requireApiOrg("ADMIN");
  const tdb = orgDb(session.org.id);
  const [keys, endpoints] = await Promise.all([
    tdb.apiKey.findMany({ where: { revokedAt: null }, orderBy: { createdAt: "desc" }, include: { createdBy: { select: { name: true } } } }),
    tdb.webhookEndpoint.findMany({ orderBy: { createdAt: "asc" } }),
  ]);
  return NextResponse.json({
    keys: keys.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, lastUsedAt: k.lastUsedAt, createdAt: k.createdAt, createdBy: k.createdBy?.name ?? null })),
    webhooks: endpoints.map((e) => ({
      id: e.id,
      url: e.url,
      description: e.description,
      events: e.events,
      isActive: e.isActive,
      failureCount: e.failureCount,
      lastStatus: e.lastStatus,
      lastDeliveryAt: e.lastDeliveryAt,
    })),
    events: WEBHOOK_EVENTS,
    flowSigningSecret: flowSigningSecret(session.org.id),
  });
});

const MAX_KEYS = 20;

/** New API key; the full key is returned only in this response */
export const POST = route(async (req) => {
  const session = await requireApiOrg("ADMIN");
  const { name } = await parseBody(req, z.object({ name: z.string().trim().min(1, "Name the key, e.g. the app that uses it.").max(60) }));
  await assertFeature(session.org.id, "api");
  const tdb = orgDb(session.org.id);
  if ((await tdb.apiKey.count({ where: { revokedAt: null } })) >= MAX_KEYS) return NextResponse.json({ error: `You can have up to ${MAX_KEYS} API keys.` }, { status: 400 });
  const { key, prefix, keyHash } = newApiKey();
  const row = await tdb.apiKey.create({ data: { orgId: session.org.id, name, prefix, keyHash, createdById: session.user.id } });
  await audit({ action: "api_key.created", orgId: session.org.id, userId: session.user.id, targetType: "api_key", targetId: row.id, meta: { name }, ip: clientIp(req) });
  return NextResponse.json({ key, apiKey: { id: row.id, name, prefix } }, { status: 201 });
});
