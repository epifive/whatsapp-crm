import { NextResponse, type NextRequest } from "next/server";
import { handlePaypalEvent } from "@/lib/billing/confirm";
import { verifyPaypalWebhook } from "@/lib/billing/gateways";
import { getSetting } from "@/lib/settings";

/** PayPal → us (verified with PayPal's API). Events: CHECKOUT.ORDER.APPROVED, PAYMENT.CAPTURE.COMPLETED */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const cfg = await getSetting("paypal");
  try {
    if (!cfg?.clientId || !(await verifyPaypalWebhook(cfg, req.headers, raw))) return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
    await handlePaypalEvent(JSON.parse(raw));
  } catch (err) {
    console.error("[billing] PayPal webhook failed:", err);
    return NextResponse.json({ error: "Processing failed." }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
