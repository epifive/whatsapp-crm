import { db } from "@/lib/db";
import { sendTemplateEmail } from "@/lib/email-templates";
import { env } from "@/lib/env";
import { UserInputError } from "@/lib/errors";
import { getBilling, getBranding, getSetting, type BillingSettings } from "@/lib/settings";
import type { Coupon, PaymentGateway, Plan } from "@/generated/prisma/client";
import { effectiveStatus } from "./entitlements";
import { createPaypalOrder, createRazorpayOrder, createStripeCheckout } from "./gateways";
import { formatMoney } from "./money";
import { addInterval, isFreePlan, planPrice, type Interval } from "./plans";

/** Gateways a workspace can pay with */
export const CHECKOUT_GATEWAYS = ["STRIPE", "RAZORPAY", "PAYPAL", "OFFLINE"] as const;
export type CheckoutGateway = (typeof CHECKOUT_GATEWAYS)[number];

export async function enabledGateways(): Promise<CheckoutGateway[]> {
  const [stripe, razorpay, paypal, offline] = await Promise.all([getSetting("stripe"), getSetting("razorpay"), getSetting("paypal"), getSetting("offline")]);
  const out: CheckoutGateway[] = [];
  if (stripe?.enabled && stripe.secretKey) out.push("STRIPE");
  if (razorpay?.enabled && razorpay.keyId && razorpay.keySecret) out.push("RAZORPAY");
  if (paypal?.enabled && paypal.clientId && paypal.clientSecret) out.push("PAYPAL");
  if (offline?.enabled) out.push("OFFLINE");
  return out;
}

export interface Quote {
  plan: Plan;
  interval: Interval;
  currency: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  taxLabel: string | null;
  coupon: Coupon | null;
}

export function couponProblem(c: Coupon | null, planId: string, now = new Date()): string | null {
  if (!c || !c.isActive) return "This coupon code isn't valid.";
  if (c.expiresAt && c.expiresAt < now) return "This coupon has expired.";
  if (c.maxRedemptions !== null && c.redemptions >= c.maxRedemptions) return "This coupon has been used up.";
  if (c.planIds.length && !c.planIds.includes(planId)) return "This coupon doesn't apply to this plan.";
  return null;
}

/** Price of a plan for one period with the coupon and tax, as it will be invoiced */
export async function quote(opts: { planId: string; interval: Interval; couponCode?: string | null; currentPlanId?: string | null }, billing?: BillingSettings): Promise<Quote> {
  const b = billing ?? (await getBilling());
  const plan = await db.plan.findUnique({ where: { id: opts.planId } });
  // Hidden plans can still be renewed by the workspaces that are on them
  if (!plan || !plan.isActive || (!plan.isPublic && plan.id !== opts.currentPlanId)) throw new UserInputError("This plan isn't available.");
  const subtotal = planPrice(plan, opts.interval);
  if (subtotal === 0 && !isFreePlan(plan)) throw new UserInputError(opts.interval === "YEARLY" ? "This plan isn't sold yearly." : "This plan isn't sold monthly.");

  let coupon: Coupon | null = null;
  let discount = 0;
  const code = opts.couponCode?.trim().toUpperCase();
  if (code && subtotal > 0) {
    coupon = await db.coupon.findUnique({ where: { code } });
    const problem = couponProblem(coupon, plan.id);
    if (problem) throw new UserInputError(problem);
    discount = coupon!.percentOff ? Math.round((subtotal * coupon!.percentOff) / 100) : Math.min(coupon!.amountOff ?? 0, subtotal);
  }
  const taxable = subtotal - discount;
  const tax = b.taxPercent > 0 ? Math.round((taxable * b.taxPercent) / 100) : 0;
  return {
    plan,
    interval: opts.interval,
    currency: b.currency,
    subtotal,
    discount,
    tax,
    total: taxable + tax,
    taxLabel: b.taxPercent > 0 ? `${b.taxName} ${b.taxPercent}%` : null,
    coupon,
  };
}

async function nextInvoiceNumber(prefix: string): Promise<string> {
  const [row] = await db.$queryRaw<{ n: bigint }[]>`SELECT nextval('invoice_number_seq') AS n`;
  return `${prefix}${row!.n}`;
}

async function billTo(orgId: string) {
  const org = await db.organization.findUniqueOrThrow({
    where: { id: orgId },
    select: { name: true, billingName: true, billingEmail: true, billingAddress: true, billingTaxId: true, memberships: { where: { role: "OWNER" }, take: 1, orderBy: { createdAt: "asc" }, select: { user: { select: { email: true } } } } },
  });
  return {
    name: org.billingName || org.name,
    email: org.billingEmail || org.memberships[0]?.user.email || null,
    address: org.billingAddress || null,
    taxId: org.billingTaxId || null,
  };
}

const billingUrl = (q = "") => `${env().APP_URL}/app/settings/billing${q}`;

export type CheckoutResult =
  | { kind: "paid"; invoiceId: string }
  | { kind: "redirect"; url: string; paymentId: string }
  | { kind: "razorpay"; paymentId: string; keyId: string; orderId: string; amount: number; currency: string; name: string; description: string; email: string | null }
  | { kind: "offline"; paymentId: string; invoiceId: string; instructions: string; amount: number; currency: string; invoiceNumber: string };

/** Issues the invoice and starts the payment with the chosen gateway */
export async function startCheckout(opts: { orgId: string; planId: string; interval: Interval; couponCode?: string | null; gateway: CheckoutGateway }): Promise<CheckoutResult> {
  const billing = await getBilling();
  if (!billing.enabled) throw new UserInputError("Billing isn't enabled on this platform.");
  const sub = await db.subscription.findUnique({ where: { orgId: opts.orgId }, select: { planId: true } });
  const q = await quote({ planId: opts.planId, interval: opts.interval, couponCode: opts.couponCode, currentPlanId: sub?.planId }, billing);
  const gateway: PaymentGateway = q.total === 0 ? "MANUAL" : opts.gateway;
  if (gateway !== "MANUAL" && !(await enabledGateways()).includes(opts.gateway)) throw new UserInputError("This payment method isn't available.");

  const description = `${q.plan.name} plan · ${q.interval === "YEARLY" ? "yearly" : "monthly"}`;
  const invoice = await db.invoice.create({
    data: {
      number: await nextInvoiceNumber(billing.invoicePrefix),
      orgId: opts.orgId,
      planId: q.plan.id,
      interval: q.interval,
      description,
      currency: q.currency,
      subtotal: q.subtotal,
      discount: q.discount,
      tax: q.tax,
      total: q.total,
      couponCode: q.coupon?.code ?? null,
      taxLabel: q.taxLabel,
      billTo: await billTo(opts.orgId),
      seller: { name: billing.sellerName || (await getBranding()).appName, address: billing.sellerAddress || null, taxId: billing.sellerTaxId || null, footer: billing.invoiceFooter || null },
    },
  });
  const payment = await db.payment.create({ data: { invoiceId: invoice.id, orgId: opts.orgId, gateway, amount: q.total, currency: q.currency } });

  if (gateway === "MANUAL") {
    await fulfilPayment(payment.id, {});
    return { kind: "paid", invoiceId: invoice.id };
  }
  const to = (invoice.billTo as { email: string | null }).email;
  if (gateway === "STRIPE") {
    const s = await createStripeCheckout((await getSetting("stripe"))!, {
      paymentId: payment.id,
      invoiceId: invoice.id,
      amount: q.total,
      currency: q.currency,
      description,
      email: to,
      successUrl: billingUrl(`?payment=${payment.id}`),
      cancelUrl: billingUrl(`?payment=${payment.id}&cancelled=1`),
    });
    await db.payment.update({ where: { id: payment.id }, data: { gatewayRef: s.id } });
    return { kind: "redirect", url: s.url, paymentId: payment.id };
  }
  if (gateway === "PAYPAL") {
    const o = await createPaypalOrder((await getSetting("paypal"))!, {
      paymentId: payment.id,
      invoiceId: invoice.id,
      amount: q.total,
      currency: q.currency,
      description,
      brandName: (await getBranding()).appName,
      returnUrl: billingUrl(`?payment=${payment.id}`),
      cancelUrl: billingUrl(`?payment=${payment.id}&cancelled=1`),
    });
    await db.payment.update({ where: { id: payment.id }, data: { gatewayRef: o.id } });
    return { kind: "redirect", url: o.url, paymentId: payment.id };
  }
  if (gateway === "RAZORPAY") {
    const cfg = (await getSetting("razorpay"))!;
    const o = await createRazorpayOrder(cfg, { amount: q.total, currency: q.currency, receipt: invoice.number, paymentId: payment.id, invoiceId: invoice.id });
    await db.payment.update({ where: { id: payment.id }, data: { gatewayRef: o.id } });
    return { kind: "razorpay", paymentId: payment.id, keyId: cfg.keyId, orderId: o.id, amount: o.amount, currency: o.currency, name: (await getBranding()).appName, description, email: to };
  }
  const offline = await getSetting("offline");
  return { kind: "offline", paymentId: payment.id, invoiceId: invoice.id, instructions: offline?.instructions ?? "", amount: q.total, currency: q.currency, invoiceNumber: invoice.number };
}

/** Owners' emails plus the billing email: who hears about payments and renewals */
export async function billingRecipients(orgId: string): Promise<{ email: string; name: string }[]> {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { billingEmail: true, memberships: { where: { role: "OWNER" }, select: { user: { select: { email: true, name: true } } } } } });
  if (!org) return [];
  const list = org.memberships.map((m) => ({ email: m.user.email, name: m.user.name }));
  if (org.billingEmail && !list.some((r) => r.email.toLowerCase() === org.billingEmail!.toLowerCase())) list.push({ email: org.billingEmail, name: "" });
  return list;
}

/**
 * Marks a payment as paid and starts the plan period. Safe to call more than once and from
 * several places (return page, webhook): only the first call does anything. When the gateway
 * reports the amount, it must match the invoice.
 */
export async function fulfilPayment(paymentId: string, paid: { gatewayPaymentId?: string | null; amount?: number; currency?: string }, now = new Date()): Promise<boolean> {
  const payment = await db.payment.findUnique({ where: { id: paymentId }, include: { invoice: true } });
  if (!payment) return false;
  if (paid.amount !== undefined && (paid.amount !== payment.amount || (paid.currency ?? payment.currency).toUpperCase() !== payment.currency.toUpperCase())) {
    await db.payment.updateMany({
      where: { id: paymentId, status: { in: ["PENDING", "REVIEW"] } },
      data: { status: "FAILED", error: `Paid ${paid.amount} ${paid.currency ?? ""} but the invoice is ${payment.amount} ${payment.currency}.` },
    });
    console.error(`[billing] amount mismatch on payment ${paymentId}`);
    return false;
  }
  const billing = await getBilling();
  const inv = payment.invoice;
  const done = await db.$transaction(async (tx) => {
    const claimed = await tx.payment.updateMany({ where: { id: paymentId, status: { in: ["PENDING", "REVIEW"] } }, data: { status: "SUCCEEDED", gatewayPaymentId: paid.gatewayPaymentId ?? undefined, error: null } });
    if (!claimed.count) return null;
    await tx.invoice.update({ where: { id: inv.id }, data: { status: "PAID", paidAt: now } });
    if (inv.couponCode) await tx.coupon.updateMany({ where: { code: inv.couponCode }, data: { redemptions: { increment: 1 } } });
    if (!inv.planId) return { periodEnd: null };
    const plan = await tx.plan.findUniqueOrThrow({ where: { id: inv.planId } });
    const interval = (inv.interval ?? "MONTHLY") as Interval;
    const sub = await tx.subscription.findUnique({ where: { orgId: inv.orgId } });
    // Paying again for the same plan continues the current period (paying early loses nothing,
    // paying during the grace period has no free gap); anything else starts today
    const renewal = sub && sub.planId === plan.id && sub.interval === interval && sub.status !== "TRIALING" && sub.currentPeriodEnd && effectiveStatus(sub, billing.graceDays, now).status !== "EXPIRED";
    const start = renewal ? sub.currentPeriodEnd! : now;
    const periodEnd = isFreePlan(plan) ? null : addInterval(start, interval);
    const data = { planId: plan.id, interval, status: "ACTIVE" as const, currentPeriodStart: start, currentPeriodEnd: periodEnd, trialEndsAt: null, graceEndsAt: null, remindedAt: null };
    await tx.subscription.upsert({ where: { orgId: inv.orgId }, create: { orgId: inv.orgId, ...data }, update: data });
    return { periodEnd, planName: plan.name };
  });
  if (!done) return false;

  // Receipt (best effort: the payment is recorded either way)
  try {
    const org = await db.organization.findUnique({ where: { id: inv.orgId }, select: { name: true } });
    for (const r of await billingRecipients(inv.orgId)) {
      await sendTemplateEmail("payment_receipt", {
        to: r.email,
        url: `${env().APP_URL}/app/settings/billing/invoices/${inv.id}`,
        vars: {
          name: r.name,
          workspace: org?.name ?? "",
          plan: ("planName" in done ? done.planName : "") ?? "",
          amount: formatMoney(inv.total, inv.currency),
          invoice: inv.number,
          period_end: done.periodEnd ? done.periodEnd.toISOString().slice(0, 10) : "—",
        },
      });
    }
  } catch (err) {
    console.error(`[billing] receipt for ${inv.number} failed:`, err);
  }
  return true;
}
