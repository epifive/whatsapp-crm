import { assertFeature, assertLimit } from "@/lib/billing/entitlements";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, clientIp, parseBody, requireApiOrg, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { encrypt, randomToken } from "@/lib/crypto";
import { roleAtLeast } from "@/lib/auth/session";
import { orgDb } from "@/lib/tenancy";
import { publicAccount } from "@/lib/whatsapp/accounts";
import { GraphApiError, getPhoneNumber, subscribeApp } from "@/lib/whatsapp/official/client";
import { sendWorkerCommand } from "@/lib/whatsapp/worker-commands";

export const GET = route(async () => {
  const session = await requireApiOrg("AGENT");
  const accounts = await orgDb(session.org.id).whatsAppAccount.findMany({ orderBy: { createdAt: "asc" } });
  const admin = roleAtLeast(session.role, "ADMIN");
  return NextResponse.json({ accounts: accounts.map((a) => publicAccount(a, { admin })) });
});

const createBody = z.discriminatedUnion("channel", [
  z.object({ channel: z.literal("QR"), name: z.string().trim().min(1).max(60) }),
  z.object({
    channel: z.literal("OFFICIAL"),
    name: z.string().trim().min(1).max(60),
    phoneNumberId: z.string().trim().regex(/^\d{5,30}$/, "Phone number ID is a number from Meta (WhatsApp › API setup)."),
    wabaId: z.string().trim().regex(/^\d{5,30}$/, "WhatsApp Business Account ID is a number from Meta."),
    accessToken: z.string().trim().min(20, "Paste the permanent access token (System User token)."),
    appSecret: z.string().trim().min(16, "Paste the Meta app secret (App settings › Basic)."),
  }),
]);

const MAX_NUMBERS_PER_ORG = 50;

export const POST = route(async (req) => {
  const session = await requireApiOrg("ADMIN");
  const input = await parseBody(req, createBody);
  const tdb = orgDb(session.org.id);
  if ((await tdb.whatsAppAccount.count()) >= MAX_NUMBERS_PER_ORG) throw new ApiError(403, `A workspace can have at most ${MAX_NUMBERS_PER_ORG} numbers.`);
  const ent = await assertFeature(session.org.id, input.channel === "QR" ? "qr" : "official");
  await assertLimit(session.org.id, "numbers", 1, ent);

  if (input.channel === "QR") {
    const account = await tdb.whatsAppAccount.create({ data: { orgId: session.org.id, name: input.name, channel: "QR", status: "CONNECTING" } });
    await sendWorkerCommand({ action: "qr.start", accountId: account.id });
    await audit({ action: "whatsapp.qr_added", orgId: session.org.id, userId: session.user.id, targetType: "WhatsAppAccount", targetId: account.id, ip: clientIp(req) });
    return NextResponse.json({ account: publicAccount(account, { admin: true }) }, { status: 201 });
  }

  if (await tdb.whatsAppAccount.findFirst({ where: { phoneNumberId: input.phoneNumberId } })) {
    throw new ApiError(409, "This phone number is already connected.");
  }

  // Validate the credentials against Meta before saving anything
  let info;
  try {
    info = await getPhoneNumber(input.phoneNumberId, input.accessToken);
    await subscribeApp(input.wabaId, input.accessToken);
  } catch (err) {
    const msg = err instanceof GraphApiError ? err.message : "Could not reach Meta.";
    throw new ApiError(400, `Meta rejected these details: ${msg}`, "meta_validation");
  }

  let account;
  try {
    account = await tdb.whatsAppAccount.create({
      data: {
        orgId: session.org.id,
        name: input.name,
        channel: "OFFICIAL",
        status: "CONNECTED",
        phone: info.display_phone_number.replace(/\D/g, ""),
        displayName: info.verified_name ?? null,
        qualityRating: info.quality_rating ?? null,
        messagingTier: info.messaging_limit_tier ?? null,
        phoneNumberId: input.phoneNumberId,
        wabaId: input.wabaId,
        accessTokenEnc: encrypt(input.accessToken),
        appSecretEnc: encrypt(input.appSecret),
        webhookVerifyToken: randomToken(24),
        connectedAt: new Date(),
      },
    });
  } catch (err) {
    // Connected in another workspace (phoneNumberId is globally unique)
    if ((err as { code?: string }).code === "P2002") throw new ApiError(409, "This phone number is already connected to another workspace.");
    throw err;
  }
  await audit({ action: "whatsapp.official_added", orgId: session.org.id, userId: session.user.id, targetType: "WhatsAppAccount", targetId: account.id, ip: clientIp(req) });
  return NextResponse.json({ account: publicAccount(account, { admin: true }) }, { status: 201 });
});
