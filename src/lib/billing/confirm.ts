import { db } from "@/lib/db";
import { sendTemplateEmail } from "@/lib/email-templates";
import { env } from "@/lib/env";
import { UserInputError } from "@/lib/errors";
import { getSetting } from "@/lib/settings";
import { fulfilPayment } from "./checkout";
import { capturePaypalOrder, getStripeSession, stripeSessionState, verifyRazorpayPayment } from "./gateways";
import { formatMoney } from "./money";

export type PaymentOutcome = "paid" | "pending" | "review" | "failed";

/**
 * The customer is back from the gateway (or reports an offline transfer): check the payment
 * with the gateway and activate the plan. Webhooks do the same thing independently, so a
 * customer who closes the tab still gets their plan.
 */
export async function confirmPayment(
  orgId: string,
  paymentId: string,
  input: { razorpay?: { orderId: string; paymentId: string; signature: string }; reference?: string },
): Promise<{ outcome: PaymentOutcome; invoiceId: string }> {
  const payment = await db.payment.findFirst({ where: { id: paymentId, orgId }, include: { invoice: { select: { id: true, number: true, org: { select: { name: true } } } } } });
  if (!payment) throw new UserInputError("Payment not found.");
  const result = (outcome: PaymentOutcome) => ({ outcome, invoiceId: payment.invoiceId });
  if (payment.status === "SUCCEEDED") return result("paid");
  if (payment.status === "FAILED") return result("failed");

  switch (payment.gateway) {
    case "STRIPE": {
      const s = await getStripeSession((await getSetting("stripe"))!, payment.gatewayRef!);
      if (!s.paid) return result("pending");
      await fulfilPayment(payment.id, { gatewayPaymentId: s.paymentIntent, amount: s.amount, currency: s.currency });
      break;
    }
    case "PAYPAL": {
      const c = await capturePaypalOrder((await getSetting("paypal"))!, payment.gatewayRef!);
      if (!c.completed) return result("pending");
      await fulfilPayment(payment.id, { gatewayPaymentId: c.captureId, amount: c.amount, currency: c.currency });
      break;
    }
    case "RAZORPAY": {
      const r = input.razorpay;
      const cfg = await getSetting("razorpay");
      if (!r || r.orderId !== payment.gatewayRef || !verifyRazorpayPayment(r.orderId, r.paymentId, r.signature, cfg?.keySecret ?? "")) {
        throw new UserInputError("The payment couldn't be verified.");
      }
      // The order was created for the invoice amount, so a valid signature means it was paid in full
      await fulfilPayment(payment.id, { gatewayPaymentId: r.paymentId });
      break;
    }
    case "OFFLINE": {
      const reference = input.reference?.trim();
      if (!reference) throw new UserInputError("Enter the transfer reference (UTR / transaction id).");
      if (payment.status === "REVIEW") return result("review");
      await db.payment.update({ where: { id: payment.id }, data: { status: "REVIEW", reference: reference.slice(0, 100) } });
      const admins = await db.user.findMany({ where: { platformRole: "SUPER_ADMIN" }, select: { email: true } });
      for (const a of admins) {
        await sendTemplateEmail("offline_payment_review", {
          to: a.email,
          url: `${env().APP_URL}/admin/invoices?status=review`,
          vars: { workspace: payment.invoice.org.name, amount: formatMoney(payment.amount, payment.currency), invoice: payment.invoice.number, reference },
        }).catch((err) => console.error("[billing] offline review email failed:", err));
      }
      return result("review");
    }
    case "MANUAL":
      break;
  }
  const after = await db.payment.findUniqueOrThrow({ where: { id: payment.id }, select: { status: true } });
  return result(after.status === "SUCCEEDED" ? "paid" : after.status === "FAILED" ? "failed" : "pending");
}

// ───────────────────────────── Webhooks (already verified) ─────────────────────────────

async function paymentByRef(gateway: "STRIPE" | "RAZORPAY" | "PAYPAL", ref: string | undefined | null) {
  if (!ref) return null;
  return db.payment.findUnique({ where: { gateway_gatewayRef: { gateway, gatewayRef: ref } } });
}

export async function handleStripeEvent(event: { type?: string; data?: { object?: Record<string, unknown> } }) {
  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") return;
  const session = event.data?.object ?? {};
  const payment = await paymentByRef("STRIPE", session.id as string);
  if (!payment) return;
  const s = stripeSessionState(session);
  if (s.paid) await fulfilPayment(payment.id, { gatewayPaymentId: s.paymentIntent, amount: s.amount, currency: s.currency });
}

export async function handleRazorpayEvent(event: { event?: string; payload?: { payment?: { entity?: Record<string, unknown> } } }) {
  if (event.event !== "payment.captured" && event.event !== "order.paid") return;
  const p = event.payload?.payment?.entity ?? {};
  const payment = await paymentByRef("RAZORPAY", p.order_id as string);
  if (!payment) return;
  await fulfilPayment(payment.id, { gatewayPaymentId: (p.id as string) ?? null, amount: Number(p.amount), currency: String(p.currency ?? "") });
}

export async function handlePaypalEvent(event: { event_type?: string; resource?: Record<string, unknown> }) {
  const r = event.resource ?? {};
  let orderId: string | undefined;
  if (event.event_type === "CHECKOUT.ORDER.APPROVED") orderId = r.id as string;
  else if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") orderId = (r.supplementary_data as { related_ids?: { order_id?: string } } | undefined)?.related_ids?.order_id;
  else return;
  const payment = await paymentByRef("PAYPAL", orderId);
  if (!payment || payment.status === "SUCCEEDED") return;
  const c = await capturePaypalOrder((await getSetting("paypal"))!, orderId!);
  if (c.completed) await fulfilPayment(payment.id, { gatewayPaymentId: c.captureId, amount: c.amount, currency: c.currency });
}
