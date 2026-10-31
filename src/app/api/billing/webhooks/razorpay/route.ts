import { NextResponse, type NextRequest } from "next/server";
import { handleRazorpayEvent } from "@/lib/billing/confirm";
import { verifyRazorpayWebhook } from "@/lib/billing/gateways";
import { getSetting } from "@/lib/settings";

/** Razorpay → us (X-Razorpay-Signature). Events: payment.captured, order.paid */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const cfg = await getSetting("razorpay");
  if (!cfg?.webhookSecret || !verifyRazorpayWebhook(raw, req.headers.get("x-razorpay-signature"), cfg.webhookSecret)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }
  try {
    await handleRazorpayEvent(JSON.parse(raw));
  } catch (err) {
    console.error("[billing] Razorpay webhook failed:", err);
    return NextResponse.json({ error: "Processing failed." }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
