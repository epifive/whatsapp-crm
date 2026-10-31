import { z } from "zod";

/**
 * Plan limits and features. Shared by the server (enforcement) and the browser (plan editor,
 * usage meters). A limit of -1 means unlimited.
 */

export const LIMIT_KEYS = ["numbers", "members", "contacts", "campaignsPerMonth", "flows"] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];
export type PlanLimits = Record<LimitKey, number>;

export const FEATURE_KEYS = ["official", "qr", "campaigns", "flows", "ai", "api", "webhooks"] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type PlanFeatures = Record<FeatureKey, boolean>;

export const UNLIMITED = -1;

export const UNLIMITED_LIMITS: PlanLimits = { numbers: UNLIMITED, members: UNLIMITED, contacts: UNLIMITED, campaignsPerMonth: UNLIMITED, flows: UNLIMITED };
export const ALL_FEATURES: PlanFeatures = { official: true, qr: true, campaigns: true, flows: true, ai: true, api: true, webhooks: true };

const limit = z.coerce.number().int().min(UNLIMITED).max(100_000_000);
export const limitsSchema = z.object({
  numbers: limit,
  members: limit,
  contacts: limit,
  campaignsPerMonth: limit,
  flows: limit,
});
export const featuresSchema = z.object(Object.fromEntries(FEATURE_KEYS.map((k) => [k, z.boolean()])) as Record<FeatureKey, z.ZodBoolean>);

/** Stored JSON → complete limits (missing keys = unlimited, so older plans keep working) */
export function readLimits(json: unknown): PlanLimits {
  const v = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  return Object.fromEntries(LIMIT_KEYS.map((k) => [k, typeof v[k] === "number" ? (v[k] as number) : UNLIMITED])) as PlanLimits;
}

export function readFeatures(json: unknown): PlanFeatures {
  const v = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  return Object.fromEntries(FEATURE_KEYS.map((k) => [k, v[k] !== false])) as PlanFeatures;
}

export type Interval = "MONTHLY" | "YEARLY";

export function planPrice(plan: { priceMonthly: number; priceYearly: number }, interval: Interval): number {
  return interval === "YEARLY" ? plan.priceYearly : plan.priceMonthly;
}

export function isFreePlan(plan: { priceMonthly: number; priceYearly: number }): boolean {
  return plan.priceMonthly === 0 && plan.priceYearly === 0;
}

/** End of a billing period that starts at `from` (same day next month / next year) */
export function addInterval(from: Date, interval: Interval): Date {
  const d = new Date(from);
  const day = d.getUTCDate();
  if (interval === "YEARLY") d.setUTCFullYear(d.getUTCFullYear() + 1);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  // 31 Jan + 1 month → 28/29 Feb, not 3 Mar
  if (d.getUTCDate() < day) d.setUTCDate(0);
  return d;
}
