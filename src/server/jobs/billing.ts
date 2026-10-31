import { db } from "@/lib/db";
import { billingRecipients } from "@/lib/billing/checkout";
import { effectiveStatus } from "@/lib/billing/entitlements";
import { formatMoney } from "@/lib/billing/money";
import { planPrice, type Interval } from "@/lib/billing/plans";
import { sendTemplateEmail, type EmailTemplateKey } from "@/lib/email-templates";
import { env } from "@/lib/env";
import { getBilling } from "@/lib/settings";

const DAY = 86_400_000;

async function notify(orgId: string, key: EmailTemplateKey, vars: Record<string, string>) {
  const org = await db.organization.findUnique({ where: { id: orgId }, select: { name: true } });
  for (const r of await billingRecipients(orgId)) {
    await sendTemplateEmail(key, { to: r.email, url: `${env().APP_URL}/app/settings/billing`, vars: { name: r.name, workspace: org?.name ?? "", ...vars } }).catch((err) =>
      console.error(`[billing] ${key} email to ${r.email} failed:`, err),
    );
  }
}

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Worker cron (every 10 minutes): records trials and periods that ended (grace period, then
 * read-only), sends trial-ending / renewal reminders once per period, and voids abandoned
 * checkouts. Access itself never waits for this job: entitlements check the dates directly.
 */
export async function billingLifecycle(now = new Date()) {
  const billing = await getBilling();
  if (!billing.enabled) return;

  // Periods that ended: ACTIVE → PAST_DUE (grace) → EXPIRED, trials → EXPIRED
  const ended = await db.subscription.findMany({
    where: { status: { in: ["TRIALING", "ACTIVE", "PAST_DUE"] }, currentPeriodEnd: { lte: now } },
    include: { plan: { select: { name: true } } },
    take: 500,
  });
  for (const sub of ended) {
    const next = effectiveStatus(sub, billing.graceDays, now);
    if (next.status === sub.status) continue;
    // Conditional update: only one worker moves (and emails about) each subscription
    const { count } = await db.subscription.updateMany({ where: { id: sub.id, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd }, data: { status: next.status, graceEndsAt: next.graceEndsAt } });
    if (!count) continue;
    if (next.status === "PAST_DUE") await notify(sub.orgId, "payment_due", { plan: sub.plan.name, date: day(next.graceEndsAt!) });
    else if (next.status === "EXPIRED") await notify(sub.orgId, "subscription_expired", { plan: sub.plan.name });
  }

  // One reminder per period, `reminderDays` before it ends
  if (billing.reminderDays > 0) {
    const soon = await db.subscription.findMany({
      where: { status: { in: ["TRIALING", "ACTIVE"] }, currentPeriodEnd: { gt: now, lte: new Date(now.getTime() + billing.reminderDays * DAY) }, remindedAt: null },
      include: { plan: true },
      take: 500,
    });
    for (const sub of soon) {
      const { count } = await db.subscription.updateMany({ where: { id: sub.id, remindedAt: null }, data: { remindedAt: now } });
      if (!count) continue;
      const vars = { plan: sub.plan.name, date: day(sub.currentPeriodEnd!) };
      if (sub.status === "TRIALING") await notify(sub.orgId, "trial_ending", vars);
      else await notify(sub.orgId, "renewal_reminder", { ...vars, amount: formatMoney(planPrice(sub.plan, sub.interval as Interval), billing.currency) });
    }
  }

  // Checkouts nobody finished: online after 2 days, offline ones never reported after 14
  const abandoned = await db.payment.findMany({
    where: {
      status: "PENDING",
      OR: [
        { gateway: { in: ["STRIPE", "RAZORPAY", "PAYPAL"] }, createdAt: { lt: new Date(now.getTime() - 2 * DAY) } },
        { gateway: "OFFLINE", createdAt: { lt: new Date(now.getTime() - 14 * DAY) } },
      ],
    },
    select: { id: true, invoiceId: true },
    take: 500,
  });
  for (const p of abandoned) {
    await db.payment.updateMany({ where: { id: p.id, status: "PENDING" }, data: { status: "FAILED", error: "Checkout not completed." } });
    await db.invoice.updateMany({ where: { id: p.invoiceId, status: "OPEN" }, data: { status: "VOID" } });
  }
}
