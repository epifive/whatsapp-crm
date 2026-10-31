import { assertFeature } from "@/lib/billing/entitlements";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, clientIp, parseBody, requireApiOrg, route } from "@/lib/api";
import { AI_PROVIDERS } from "@/lib/ai/providers";
import { audit } from "@/lib/audit";
import { encrypt } from "@/lib/crypto";
import { db } from "@/lib/db";
import { orgDb } from "@/lib/tenancy";

/** The workspace's AI setup (never the key itself) and the last 30 days of usage */
export const GET = route(async () => {
  const session = await requireApiOrg("AGENT");
  const orgId = session.org.id;
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [cfg, usage] = await Promise.all([
    orgDb(orgId).aiConfig.findUnique({ where: { orgId } }),
    db.aiUsage.groupBy({ by: ["feature"], where: { orgId, createdAt: { gte: since }, ok: true }, _count: { _all: true } }),
  ]);
  return NextResponse.json({
    config: {
      provider: cfg?.provider ?? null,
      model: cfg?.model ?? null,
      hasKey: !!cfg?.apiKeyEnc,
      instructions: cfg?.instructions ?? "",
      autoReply: cfg?.autoReply ?? false,
      autoReplyWhen: cfg?.autoReplyWhen ?? "unassigned",
      handoffMessage: cfg?.handoffMessage ?? "",
    },
    usage: usage.map((u) => ({ feature: u.feature, requests: u._count._all })),
  });
});

const body = z.object({
  provider: z.enum(AI_PROVIDERS),
  model: z.string().trim().min(1, "Enter the model name.").max(100),
  // Empty = keep the stored key (the browser never receives it)
  apiKey: z.string().trim().max(500).optional(),
  instructions: z.string().max(4000).default(""),
  autoReply: z.boolean(),
  autoReplyWhen: z.enum(["unassigned", "always"]),
  handoffMessage: z.string().max(1000).default(""),
});

export const PUT = route(async (req) => {
  const session = await requireApiOrg("ADMIN");
  await assertFeature(session.org.id, "ai");
  const input = await parseBody(req, body);
  const orgId = session.org.id;
  const tdb = orgDb(orgId);
  const current = await tdb.aiConfig.findUnique({ where: { orgId } });
  if (!input.apiKey && !current?.apiKeyEnc) throw new ApiError(400, "Enter your API key.");
  const data = {
    provider: input.provider,
    model: input.model,
    ...(input.apiKey ? { apiKeyEnc: encrypt(input.apiKey) } : {}),
    instructions: input.instructions.trim() || null,
    autoReply: input.autoReply,
    autoReplyWhen: input.autoReplyWhen,
    handoffMessage: input.handoffMessage.trim() || null,
  };
  await tdb.aiConfig.upsert({ where: { orgId }, create: { orgId, ...data }, update: data });
  await audit({ action: "ai.settings_updated", orgId, userId: session.user.id, meta: { provider: input.provider, model: input.model, autoReply: input.autoReply, keyChanged: !!input.apiKey }, ip: clientIp(req) });
  return NextResponse.json({ ok: true });
});
