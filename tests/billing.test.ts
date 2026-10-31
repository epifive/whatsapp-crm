import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { couponProblem, fulfilPayment, quote } from "@/lib/billing/checkout";
import { assertFeature, assertLimit, assertWritable, effectiveStatus, getEntitlements } from "@/lib/billing/entitlements";
import { stripeSessionState, verifyRazorpayPayment, verifyRazorpayWebhook, verifyStripeSignature } from "@/lib/billing/gateways";
import { currencyDecimals, formatMoney, fromMinor, toMinor } from "@/lib/billing/money";
import { addInterval, ALL_FEATURES, readLimits, UNLIMITED } from "@/lib/billing/plans";
import { PlanError } from "@/lib/errors";
import { setSetting, DEFAULT_BILLING, type BillingSettings } from "@/lib/settings";
import { billingLifecycle } from "@/server/jobs/billing";

const DAY = 86_400_000;
const clearSettingsCache = () => (globalThis.__wacrmSettingsCache as Map<string, unknown> | undefined)?.clear();
const hmac = (secret: string, data: string) => crypto.createHmac("sha256", secret).update(data).digest("hex");

describe("money", () => {
  it("converts and formats amounts by currency", () => {
    expect([currencyDecimals("INR"), currencyDecimals("JPY"), currencyDecimals("KWD")]).toEqual([2, 0, 3]);
    expect([toMinor("499", "INR"), toMinor("499.5", "INR"), toMinor("1,299.99", "USD"), toMinor("500", "JPY")]).toEqual([49900, 49950, 129999, 500]);
    expect([toMinor("1.234", "USD"), toMinor("abc", "USD"), toMinor("-5", "USD")]).toEqual([null, null, null]);
    expect([fromMinor(49950, "INR"), fromMinor(500, "JPY")]).toEqual(["499.50", "500"]);
    expect(formatMoney(49900, "INR")).toBe("₹499");
    expect(formatMoney(129999, "USD")).toBe("$1,299.99");
  });

  it("adds billing periods without skipping months", () => {
    expect(addInterval(new Date("2026-01-31T10:00:00Z"), "MONTHLY").toISOString()).toBe("2026-02-28T10:00:00.000Z");
    expect(addInterval(new Date("2028-01-31T10:00:00Z"), "MONTHLY").toISOString()).toBe("2028-02-29T10:00:00.000Z");
    expect(addInterval(new Date("2026-03-15T00:00:00Z"), "MONTHLY").toISOString()).toBe("2026-04-15T00:00:00.000Z");
    expect(addInterval(new Date("2028-02-29T00:00:00Z"), "YEARLY").toISOString()).toBe("2029-02-28T00:00:00.000Z");
  });

  it("reads stored limits leniently", () => {
    expect(readLimits({ numbers: 2 })).toEqual({ numbers: 2, members: UNLIMITED, contacts: UNLIMITED, campaignsPerMonth: UNLIMITED, flows: UNLIMITED });
  });
});

describe("subscription status from dates", () => {
  const now = new Date("2026-06-10T00:00:00Z");
  const at = (d: string) => new Date(d);
  it("trials end hard, paid periods get a grace period", () => {
    expect(effectiveStatus({ status: "TRIALING", currentPeriodEnd: at("2026-06-11") }, 3, now).status).toBe("TRIALING");
    expect(effectiveStatus({ status: "TRIALING", currentPeriodEnd: at("2026-06-09") }, 3, now).status).toBe("EXPIRED");
    expect(effectiveStatus({ status: "ACTIVE", currentPeriodEnd: at("2026-06-11") }, 3, now).status).toBe("ACTIVE");
    const grace = effectiveStatus({ status: "ACTIVE", currentPeriodEnd: at("2026-06-08") }, 3, now);
    expect([grace.status, grace.graceEndsAt?.toISOString()]).toEqual(["PAST_DUE", "2026-06-11T00:00:00.000Z"]);
    expect(effectiveStatus({ status: "ACTIVE", currentPeriodEnd: at("2026-06-06") }, 3, now).status).toBe("EXPIRED");
    expect(effectiveStatus({ status: "ACTIVE", currentPeriodEnd: null }, 3, now).status).toBe("ACTIVE");
    // Expired stays expired until a payment starts a new period
    expect(effectiveStatus({ status: "EXPIRED", currentPeriodEnd: at("2026-07-01") }, 3, now).status).toBe("EXPIRED");
  });
});

describe("gateway signatures", () => {
  it("verifies Stripe webhooks (and rejects tampering and replays)", () => {
    const raw = JSON.stringify({ type: "checkout.session.completed" });
    const t = Math.floor(Date.now() / 1000);
    const header = `t=${t},v1=${hmac("whsec_test", `${t}.${raw}`)}`;
    expect(verifyStripeSignature(raw, header, "whsec_test")).toBe(true);
    expect(verifyStripeSignature(raw + " ", header, "whsec_test")).toBe(false);
    expect(verifyStripeSignature(raw, header, "whsec_other")).toBe(false);
    const old = t - 600;
    expect(verifyStripeSignature(raw, `t=${old},v1=${hmac("whsec_test", `${old}.${raw}`)}`, "whsec_test")).toBe(false);
    expect(verifyStripeSignature(raw, null, "whsec_test")).toBe(false);
  });

  it("verifies Razorpay payments and webhooks", () => {
    expect(verifyRazorpayPayment("order_1", "pay_1", hmac("rzp_secret", "order_1|pay_1"), "rzp_secret")).toBe(true);
    expect(verifyRazorpayPayment("order_1", "pay_2", hmac("rzp_secret", "order_1|pay_1"), "rzp_secret")).toBe(false);
    const raw = '{"event":"payment.captured"}';
    expect(verifyRazorpayWebhook(raw, hmac("hook_secret", raw), "hook_secret")).toBe(true);
    expect(verifyRazorpayWebhook(raw, hmac("hook_secret", raw), "")).toBe(false);
  });

  it("reads Stripe sessions", () => {
    expect(stripeSessionState({ payment_status: "paid", amount_total: 59000, currency: "inr", payment_intent: "pi_1" })).toEqual({ paid: true, amount: 59000, currency: "INR", paymentIntent: "pi_1" });
  });
});

describe("billing in the database", () => {
  const stamp = Date.now();
  let trialPlan: string, freePlan: string, proPlan: string, ownerId: string;
  const orgs: string[] = [];
  const billing = (over: Partial<BillingSettings> = {}): BillingSettings => ({ ...DEFAULT_BILLING, enabled: true, currency: "INR", signupPlanId: trialPlan, graceDays: 3, reminderDays: 3, taxName: "GST", taxPercent: 18, ...over });

  async function newOrg(name: string) {
    const org = await db.organization.create({ data: { name, slug: `bill-${stamp}-${orgs.length}`, memberships: { create: { userId: ownerId, role: "OWNER" } } } });
    orgs.push(org.id);
    return org.id;
  }

  beforeAll(async () => {
    ownerId = (await db.user.create({ data: { email: `bill-owner-${stamp}@test.local`, name: "Owner", passwordHash: "x" } })).id;
    const limits = { numbers: 1, members: 2, contacts: 3, campaignsPerMonth: 2, flows: 1 };
    trialPlan = (await db.plan.create({ data: { name: `Starter ${stamp}`, priceMonthly: 49900, priceYearly: 499000, trialDays: 14, limits, features: { ...ALL_FEATURES, campaigns: false } } })).id;
    freePlan = (await db.plan.create({ data: { name: `Free ${stamp}`, limits, features: ALL_FEATURES } })).id;
    proPlan = (await db.plan.create({ data: { name: `Pro ${stamp}`, priceMonthly: 99900, priceYearly: 0, limits: { ...limits, numbers: UNLIMITED }, features: ALL_FEATURES } })).id;
  });
  beforeEach(async () => {
    await setSetting("billing", billing());
    clearSettingsCache();
  });
  afterAll(async () => {
    await db.setting.deleteMany({ where: { key: "billing" } });
    clearSettingsCache();
    await db.organization.deleteMany({ where: { id: { in: orgs } } });
    await db.coupon.deleteMany({ where: { code: { startsWith: `T${stamp}` } } });
    await db.plan.deleteMany({ where: { id: { in: [trialPlan, freePlan, proPlan] } } });
    await db.user.deleteMany({ where: { id: ownerId } });
    await db.$disconnect();
  });

  it("billing off: everything unlimited", async () => {
    await setSetting("billing", billing({ enabled: false }));
    clearSettingsCache();
    const id = await newOrg("Off");
    const e = await getEntitlements(id);
    expect([e.billingEnabled, e.locked, e.limits.contacts, e.features.campaigns, e.subscription]).toEqual([false, null, UNLIMITED, true, null]);
  });

  it("new workspaces start the signup plan's trial; limits and features apply", async () => {
    const id = await newOrg("Trial");
    const e = await getEntitlements(id);
    expect([e.status, e.plan?.id, e.locked, e.limits.numbers]).toEqual(["TRIALING", trialPlan, null, 1]);
    expect(Math.round((e.subscription!.currentPeriodEnd!.getTime() - Date.now()) / DAY)).toBe(14);
    await db.whatsAppAccount.create({ data: { orgId: id, name: "QR", channel: "QR" } });
    await expect(assertLimit(id, "numbers")).rejects.toMatchObject({ code: "plan_limit" });
    await expect(assertFeature(id, "campaigns")).rejects.toBeInstanceOf(PlanError);
    await expect(assertFeature(id, "flows")).resolves.toBeTruthy();
    // Pending invitations count towards the member limit
    await db.invitation.create({ data: { orgId: id, email: "x@test.local", role: "AGENT", tokenHash: `h-${stamp}`, invitedById: ownerId, expiresAt: new Date(Date.now() + DAY) } });
    await expect(assertLimit(id, "members")).rejects.toMatchObject({ code: "plan_limit" });
  });

  it("a free signup plan is active with no end", async () => {
    await setSetting("billing", billing({ signupPlanId: freePlan }));
    clearSettingsCache();
    const e = await getEntitlements(await newOrg("Free"));
    expect([e.status, e.subscription?.currentPeriodEnd, e.locked]).toEqual(["ACTIVE", null, null]);
  });

  it("expired and suspended workspaces are read-only", async () => {
    const id = await newOrg("Locked");
    await getEntitlements(id);
    await db.subscription.update({ where: { orgId: id }, data: { currentPeriodEnd: new Date(Date.now() - DAY) } });
    await expect(assertWritable(id)).rejects.toMatchObject({ code: "subscription_inactive" });
    await db.subscription.update({ where: { orgId: id }, data: { status: "ACTIVE", currentPeriodEnd: new Date(Date.now() + 10 * DAY) } });
    await expect(assertWritable(id)).resolves.toBeTruthy();
    await db.organization.update({ where: { id }, data: { suspendedAt: new Date(), suspendedReason: "Spam" } });
    await expect(assertWritable(id)).rejects.toMatchObject({ code: "suspended", message: expect.stringContaining("Spam") });
  });

  it("quotes with coupons and tax", async () => {
    const q = await quote({ planId: trialPlan, interval: "MONTHLY" });
    expect([q.subtotal, q.discount, q.tax, q.total, q.taxLabel]).toEqual([49900, 0, 8982, 58882, "GST 18%"]);
    await db.coupon.create({ data: { code: `T${stamp}P`, percentOff: 20 } });
    await db.coupon.create({ data: { code: `T${stamp}A`, amountOff: 100000, planIds: [trialPlan] } });
    const p = await quote({ planId: trialPlan, interval: "MONTHLY", couponCode: `t${stamp}p` });
    expect([p.discount, p.tax, p.total]).toEqual([9980, 7186, 47106]);
    // A fixed discount never goes below zero
    const a = await quote({ planId: trialPlan, interval: "MONTHLY", couponCode: `T${stamp}A` });
    expect([a.discount, a.total]).toEqual([49900, 0]);
    await expect(quote({ planId: proPlan, interval: "MONTHLY", couponCode: `T${stamp}A` })).rejects.toThrow("doesn't apply");
    await expect(quote({ planId: proPlan, interval: "YEARLY" })).rejects.toThrow("isn't sold yearly");
    await expect(quote({ planId: trialPlan, interval: "MONTHLY", couponCode: "NOPE" })).rejects.toThrow("isn't valid");
    expect(couponProblem({ isActive: true, expiresAt: new Date(Date.now() - 1000), maxRedemptions: null, redemptions: 0, planIds: [] } as never, trialPlan)).toContain("expired");
    expect(couponProblem({ isActive: true, expiresAt: null, maxRedemptions: 1, redemptions: 1, planIds: [] } as never, trialPlan)).toContain("used up");
  });

  async function invoiceFor(orgId: string, planId: string, total: number, extra: { couponCode?: string; interval?: "MONTHLY" | "YEARLY" } = {}) {
    const inv = await db.invoice.create({
      data: { number: `T-${stamp}-${Math.random()}`, orgId, planId, interval: extra.interval ?? "MONTHLY", description: "test", currency: "INR", subtotal: total, total, couponCode: extra.couponCode, billTo: {}, seller: {} },
    });
    return db.payment.create({ data: { invoiceId: inv.id, orgId, gateway: "STRIPE", gatewayRef: `cs_${stamp}_${Math.random()}`, amount: total, currency: "INR" } });
  }

  it("a payment starts the plan once, renewals continue the period, wrong amounts are refused", async () => {
    const id = await newOrg("Pays");
    await getEntitlements(id); // trial
    await db.coupon.create({ data: { code: `T${stamp}R`, percentOff: 10 } });
    const pay = await invoiceFor(id, proPlan, 99900, { couponCode: `T${stamp}R` });
    expect(await fulfilPayment(pay.id, { amount: 99900, currency: "inr", gatewayPaymentId: "pi_1" })).toBe(true);
    expect(await fulfilPayment(pay.id, { amount: 99900 })).toBe(false); // webhook + return page: only once
    const sub = await db.subscription.findUniqueOrThrow({ where: { orgId: id } });
    expect([sub.planId, sub.status, sub.trialEndsAt]).toEqual([proPlan, "ACTIVE", null]);
    const end1 = sub.currentPeriodEnd!;
    expect(Math.round((end1.getTime() - Date.now()) / DAY)).toBeGreaterThanOrEqual(28);
    expect((await db.coupon.findUniqueOrThrow({ where: { code: `T${stamp}R` } })).redemptions).toBe(1);
    expect((await db.invoice.findFirstOrThrow({ where: { payments: { some: { id: pay.id } } } })).status).toBe("PAID");

    // Paying early for the same plan adds a month after the current end
    const renew = await invoiceFor(id, proPlan, 99900);
    await fulfilPayment(renew.id, {});
    const end2 = (await db.subscription.findUniqueOrThrow({ where: { orgId: id } })).currentPeriodEnd!;
    expect(end2.toISOString()).toBe(addInterval(end1, "MONTHLY").toISOString());

    const cheat = await invoiceFor(id, proPlan, 99900);
    expect(await fulfilPayment(cheat.id, { amount: 100, currency: "INR" })).toBe(false);
    expect((await db.payment.findUniqueOrThrow({ where: { id: cheat.id } })).status).toBe("FAILED");
    // Receipts went to the owner
    const outbox = path.join(process.cwd(), "storage", "mail-outbox");
    expect(fs.readdirSync(outbox).some((f) => f.includes(`bill-owner-${stamp}`))).toBe(true);
  });

  it("lifecycle: reminders once, grace period, then expired; abandoned checkouts voided", async () => {
    const id = await newOrg("Lifecycle");
    await getEntitlements(id);
    const now = new Date();
    // Trial ending in 2 days → one reminder
    await db.subscription.update({ where: { orgId: id }, data: { currentPeriodEnd: new Date(now.getTime() + 2 * DAY) } });
    await billingLifecycle(now);
    const r1 = (await db.subscription.findUniqueOrThrow({ where: { orgId: id } })).remindedAt;
    expect(r1).not.toBeNull();
    await billingLifecycle(now);
    expect((await db.subscription.findUniqueOrThrow({ where: { orgId: id } })).remindedAt?.getTime()).toBe(r1!.getTime());

    // Paid period ended yesterday → payment due (grace), then expired after the grace period
    await db.subscription.update({ where: { orgId: id }, data: { status: "ACTIVE", currentPeriodEnd: new Date(now.getTime() - DAY) } });
    await billingLifecycle(now);
    const pastDue = await db.subscription.findUniqueOrThrow({ where: { orgId: id } });
    expect([pastDue.status, Math.round((pastDue.graceEndsAt!.getTime() - now.getTime()) / DAY)]).toEqual(["PAST_DUE", 2]);
    await billingLifecycle(new Date(now.getTime() + 3 * DAY));
    expect((await db.subscription.findUniqueOrThrow({ where: { orgId: id } })).status).toBe("EXPIRED");

    const stale = await invoiceFor(id, proPlan, 99900);
    await db.payment.update({ where: { id: stale.id }, data: { createdAt: new Date(now.getTime() - 3 * DAY) } });
    await billingLifecycle(now);
    expect((await db.payment.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe("FAILED");
    expect((await db.invoice.findUniqueOrThrow({ where: { id: stale.invoiceId } })).status).toBe("VOID");
  });
});
