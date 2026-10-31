import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { decrypt, safeEqual } from "@/lib/crypto";
import { verifyWebhookSignature } from "@/lib/whatsapp/official/webhook";
import { enqueue, QUEUES } from "@/server/queue";

type Ctx = RouteContext<"/api/webhooks/whatsapp/[accountId]">;

const MAX_BODY_BYTES = 1024 * 1024;

/** Meta's subscription handshake: echo hub.challenge when the verify token matches this number's */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { accountId } = await ctx.params;
  const p = req.nextUrl.searchParams;
  const account = await db.whatsAppAccount.findUnique({ where: { id: accountId }, select: { webhookVerifyToken: true, channel: true } });
  if (
    account?.channel === "OFFICIAL" &&
    account.webhookVerifyToken &&
    p.get("hub.mode") === "subscribe" &&
    safeEqual(p.get("hub.verify_token") ?? "", account.webhookVerifyToken)
  ) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

/**
 * Incoming messages / statuses. Verified with the app secret, then queued so we answer Meta
 * quickly (it retries slow or failed deliveries).
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { accountId } = await ctx.params;
  const raw = await req.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return new NextResponse("Payload too large", { status: 413 });

  const account = await db.whatsAppAccount.findUnique({ where: { id: accountId }, select: { id: true, channel: true, appSecretEnc: true } });
  if (!account || account.channel !== "OFFICIAL" || !account.appSecretEnc) return new NextResponse("Not found", { status: 404 });
  if (!verifyWebhookSignature(raw, req.headers.get("x-hub-signature-256"), decrypt(account.appSecretEnc))) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse("Bad request", { status: 400 });
  }
  await enqueue(QUEUES.officialInbound, { accountId: account.id, payload });
  return NextResponse.json({ ok: true });
}
