import { db } from "@/lib/db";
import { PlanError } from "@/lib/errors";
import { getBilling, type BillingSettings } from "@/lib/settings";
import type { Plan, Subscription, SubscriptionStatus } from "@/generated/prisma/client";
import { ALL_FEATURES, UNLIMITED, UNLIMITED_LIMITS, isFreePlan, readFeatures, readLimits, type FeatureKey, type LimitKey, type PlanFeatures, type PlanLimits } from "./plans";

/**
 * What a workspace may do right now: its plan's limits and features, and whether it is
 * read-only. Used by API routes (web) and jobs (worker). With billing switched off in the admin
 * panel everything is unlimited.
 */

export type LockReason = "expired" | "suspended" | "no_plan";

export interface Entitlements {
  billingEnabled: boolean;
  plan: Pick<Plan, "id" | "name" | "priceMonthly" | "priceYearly"> | null;
  subscription: Subscription | null;
  // Status as of now (dates are checked here, so it is right even if the worker is behind)
  status: SubscriptionStatus | null;
  graceEndsAt: Date | null;
  limits: PlanLimits;
  features: PlanFeatures;
  locked: LockReason | null;
  suspendedReason: string | null;
}

const DAY = 86_400_000;

/** Status from the dates: trials end hard; paid periods get `graceDays` before expiring */
export function effectiveStatus(sub: Pick<Subscription, "status" | "currentPeriodEnd">, graceDays: number, now = new Date()): { status: SubscriptionStatus; graceEndsAt: Date | null } {
  // Expired stays expired until a payment (or the admin) starts a new period
  if (sub.status === "EXPIRED" || !sub.currentPeriodEnd || sub.currentPeriodEnd > now) {
    return { status: sub.status === "PAST_DUE" && sub.currentPeriodEnd && sub.currentPeriodEnd > now ? "ACTIVE" : sub.status, graceEndsAt: null };
  }
  if (sub.status === "TRIALING") return { status: "EXPIRED", graceEndsAt: null };
  const graceEndsAt = new Date(sub.currentPeriodEnd.getTime() + graceDays * DAY);
  return graceEndsAt > now ? { status: "PAST_DUE", graceEndsAt } : { status: "EXPIRED", graceEndsAt };
}

/** The first subscription of a workspace: the signup plan's trial, or free forever */
export async function startSignupSubscription(orgId: string, billing: BillingSettings, now = new Date()): Promise<(Subscription & { plan: Plan }) | null> {
  if (!billing.signupPlanId) return null;
  const plan = await db.plan.findUnique({ where: { id: billing.signupPlanId } });
  if (!plan) return null;
  const free = isFreePlan(plan);
  const trialEnd = plan.trialDays > 0 ? new Date(now.getTime() + plan.trialDays * DAY) : null;
  const data = {
    planId: plan.id,
    interval: "MONTHLY" as const,
    // A paid plan without a trial has to be paid before the workspace can be used
    status: free ? ("ACTIVE" as const) : trialEnd ? ("TRIALING" as const) : ("EXPIRED" as const),
    currentPeriodStart: now,
    currentPeriodEnd: free ? null : (trialEnd ?? now),
    trialEndsAt: free ? null : trialEnd,
  };
  try {
    return await db.subscription.create({ data: { orgId, ...data }, include: { plan: true } });
  } catch {
    // Created by a parallel request
    return db.subscription.findUnique({ where: { orgId }, include: { plan: true } });
  }
}

export async function getEntitlements(orgId: string, now = new Date()): Promise<Entitlements> {
  const [org, billing] = await Promise.all([
    db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { suspendedAt: true, suspendedReason: true, subscription: { include: { plan: true } } } }),
    getBilling(),
  ]);
  const suspended = org.suspendedAt ? ("suspended" as const) : null;
  const base = { suspendedReason: org.suspendedAt ? (org.suspendedReason ?? null) : null };
  if (!billing.enabled) {
    return { ...base, billingEnabled: false, plan: null, subscription: org.subscription, status: null, graceEndsAt: null, limits: UNLIMITED_LIMITS, features: ALL_FEATURES, locked: suspended };
  }
  const sub = org.subscription ?? (await startSignupSubscription(orgId, billing, now));
  if (!sub) {
    return { ...base, billingEnabled: true, plan: null, subscription: null, status: null, graceEndsAt: null, limits: UNLIMITED_LIMITS, features: ALL_FEATURES, locked: suspended ?? "no_plan" };
  }
  const { status, graceEndsAt } = effectiveStatus(sub, billing.graceDays, now);
  return {
    ...base,
    billingEnabled: true,
    plan: { id: sub.plan.id, name: sub.plan.name, priceMonthly: sub.plan.priceMonthly, priceYearly: sub.plan.priceYearly },
    subscription: sub,
    status,
    graceEndsAt,
    limits: readLimits(sub.plan.limits),
    features: readFeatures(sub.plan.features),
    locked: suspended ?? (status === "EXPIRED" ? "expired" : null),
  };
}

export function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** How much of each limit the workspace uses now */
export async function usageOf(orgId: string, key: LimitKey, now = new Date()): Promise<number> {
  switch (key) {
    case "numbers":
      return db.whatsAppAccount.count({ where: { orgId } });
    case "members": {
      // Pending invitations count too, so a workspace can't invite past its limit
      const [members, invites] = await Promise.all([
        db.membership.count({ where: { orgId } }),
        db.invitation.count({ where: { orgId, acceptedAt: null, expiresAt: { gt: now } } }),
      ]);
      return members + invites;
    }
    case "contacts":
      return db.contact.count({ where: { orgId } });
    case "campaignsPerMonth":
      // Campaigns started this month, plus those scheduled to start
      return db.campaign.count({ where: { orgId, OR: [{ startedAt: { gte: monthStart(now) } }, { status: "SCHEDULED" }] } });
    case "flows":
      return db.flow.count({ where: { orgId } });
  }
}

export async function usageAll(orgId: string): Promise<Record<LimitKey, number>> {
  const keys: LimitKey[] = ["numbers", "members", "contacts", "campaignsPerMonth", "flows"];
  const values = await Promise.all(keys.map((k) => usageOf(orgId, k)));
  return Object.fromEntries(keys.map((k, i) => [k, values[i]])) as Record<LimitKey, number>;
}

const LIMIT_TEXT: Record<LimitKey, string> = {
  numbers: "WhatsApp numbers",
  members: "team members (pending invitations included)",
  contacts: "contacts",
  campaignsPerMonth: "campaigns a month",
  flows: "chatbot flows",
};

const FEATURE_TEXT: Record<FeatureKey, string> = {
  official: "the official WhatsApp Cloud API",
  qr: "WhatsApp QR connections",
  campaigns: "bulk campaigns",
  flows: "chatbot flows",
  ai: "the AI assistant",
  api: "the REST API",
  webhooks: "webhooks",
};

export function lockMessage(e: Pick<Entitlements, "locked" | "suspendedReason">): string {
  if (e.locked === "suspended") return `This workspace is suspended${e.suspendedReason ? `: ${e.suspendedReason}` : ""}. Contact support to restore it.`;
  if (e.locked === "no_plan") return "Choose a plan in Settings › Billing to continue.";
  return "Your subscription isn't active. Choose or renew a plan in Settings › Billing to continue; your data is safe and you can still view it.";
}

/** Throws unless the workspace may make changes (not expired, not suspended) */
export async function assertWritable(orgId: string, e?: Entitlements): Promise<Entitlements> {
  const ent = e ?? (await getEntitlements(orgId));
  if (ent.locked) throw new PlanError(lockMessage(ent), ent.locked === "suspended" ? "suspended" : "subscription_inactive");
  return ent;
}

export async function assertFeature(orgId: string, feature: FeatureKey, e?: Entitlements): Promise<Entitlements> {
  const ent = e ?? (await getEntitlements(orgId));
  if (!ent.features[feature]) throw new PlanError(`Your plan doesn't include ${FEATURE_TEXT[feature]}. Upgrade your plan in Settings › Billing to use it.`, "plan_feature");
  return ent;
}

/** Throws if adding `adding` more would go over the plan's limit */
export async function assertLimit(orgId: string, key: LimitKey, adding = 1, e?: Entitlements): Promise<Entitlements> {
  const ent = e ?? (await getEntitlements(orgId));
  const max = ent.limits[key];
  if (max === UNLIMITED) return ent;
  const used = await usageOf(orgId, key);
  if (used + adding > max) {
    throw new PlanError(`Your plan includes up to ${max.toLocaleString("en")} ${LIMIT_TEXT[key]}. Upgrade your plan in Settings › Billing to add more.`, "plan_limit");
  }
  return ent;
}

/** For jobs: may this workspace send automated messages / run campaigns right now? */
export async function canRun(orgId: string, feature?: FeatureKey): Promise<boolean> {
  const ent = await getEntitlements(orgId);
  return !ent.locked && (!feature || ent.features[feature]);
}
