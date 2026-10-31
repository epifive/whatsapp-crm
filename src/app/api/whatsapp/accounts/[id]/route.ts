import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, clientIp, parseBody, requireApiOrg, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { encrypt } from "@/lib/crypto";
import { orgDb } from "@/lib/tenancy";
import { publicAccount } from "@/lib/whatsapp/accounts";
import { GraphApiError, getPhoneNumber } from "@/lib/whatsapp/official/client";
import { sendWorkerCommand } from "@/lib/whatsapp/worker-commands";

type Ctx = RouteContext<"/api/whatsapp/accounts/[id]">;

const patchBody = z
  .object({
    name: z.string().trim().min(1).max(60).optional(),
    // Anti-ban (QR numbers)
    warmupEnabled: z.boolean().optional(),
    minDelaySec: z.number().int().min(5).max(600).optional(),
    maxDelaySec: z.number().int().min(7).max(900).optional(),
    dailyLimit: z.number().int().min(1).max(100_000).optional(),
    // Rotate Cloud API credentials
    accessToken: z.string().trim().min(20).optional(),
    appSecret: z.string().trim().min(16).optional(),
  })
  .refine((v) => v.minDelaySec === undefined || v.maxDelaySec === undefined || v.maxDelaySec >= v.minDelaySec + 2, {
    message: "Maximum delay must be at least 2 seconds more than the minimum.",
  });

export const PATCH = route<Ctx>(async (req, ctx) => {
  const session = await requireApiOrg("ADMIN");
  const { id } = await ctx.params;
  const input = await parseBody(req, patchBody);
  const tdb = orgDb(session.org.id);
  const account = await tdb.whatsAppAccount.findUnique({ where: { id } });
  if (!account) throw new ApiError(404, "Number not found.");

  const data: Record<string, unknown> = {};
  if (input.name) data.name = input.name;
  if (account.channel === "QR") {
    for (const k of ["warmupEnabled", "minDelaySec", "maxDelaySec", "dailyLimit"] as const) if (input[k] !== undefined) data[k] = input[k];
    const min = (data.minDelaySec as number | undefined) ?? account.minDelaySec;
    const max = (data.maxDelaySec as number | undefined) ?? account.maxDelaySec;
    if (max < min + 2) throw new ApiError(400, "Maximum delay must be at least 2 seconds more than the minimum.");
  } else {
    if (input.accessToken) {
      try {
        await getPhoneNumber(account.phoneNumberId!, input.accessToken);
      } catch (err) {
        throw new ApiError(400, `Meta rejected the new token: ${err instanceof GraphApiError ? err.message : "unreachable"}`);
      }
      data.accessTokenEnc = encrypt(input.accessToken);
      data.status = "CONNECTED";
    }
    if (input.appSecret) data.appSecretEnc = encrypt(input.appSecret);
  }

  const updated = await tdb.whatsAppAccount.update({ where: { id }, data });
  await audit({ action: "whatsapp.updated", orgId: session.org.id, userId: session.user.id, targetType: "WhatsAppAccount", targetId: id, meta: Object.keys(data), ip: clientIp(req) });
  return NextResponse.json({ account: publicAccount(updated, { admin: true }) });
});

export const DELETE = route<Ctx>(async (req, ctx) => {
  const session = await requireApiOrg("ADMIN");
  const { id } = await ctx.params;
  const tdb = orgDb(session.org.id);
  const account = await tdb.whatsAppAccount.findUnique({ where: { id } });
  if (!account) throw new ApiError(404, "Number not found.");
  // Unlink the phone first so the worker doesn't keep a session for a deleted number
  if (account.channel === "QR") await sendWorkerCommand({ action: "qr.logout", accountId: id });
  await tdb.whatsAppAccount.delete({ where: { id } });
  await audit({ action: "whatsapp.deleted", orgId: session.org.id, userId: session.user.id, targetType: "WhatsAppAccount", targetId: id, ip: clientIp(req) });
  return NextResponse.json({ ok: true });
});
