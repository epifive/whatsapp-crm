import { NextResponse, type NextRequest } from "next/server";
import { handleStripeEvent } from "@/lib/billing/confirm";
import { verifyStripeSignature } from "@/lib/billing/gateways";
import { getSetting } from "@/lib/settings";

/** Stripe → us (signed with the webhook signing secret). Events: checkout.session.completed */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const cfg = await getSetting("stripe");
  if (!cfg?.webhookSecret || !verifyStripeSignature(raw, req.headers.get("stripe-signature"), cfg.webhookSecret)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }
  try {
    await handleStripeEvent(JSON.parse(raw));
  } catch (err) {
    // 500 makes Stripe retry later
    console.error("[billing] Stripe webhook failed:", err);
    return NextResponse.json({ error: "Processing failed." }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
