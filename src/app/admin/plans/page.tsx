import type { Metadata } from "next";
import { readFeatures, readLimits } from "@/lib/billing/plans";
import { db } from "@/lib/db";
import { getBilling } from "@/lib/settings";
import { PlansManager } from "./plans-manager";

export const metadata: Metadata = { title: "Plans" };

export default async function AdminPlansPage() {
  const [plans, billing, counts] = await Promise.all([
    db.plan.findMany({ orderBy: [{ sortOrder: "asc" }, { priceMonthly: "asc" }] }),
    getBilling(),
    db.subscription.groupBy({ by: ["planId"], _count: { _all: true } }),
  ]);
  const used = new Map(counts.map((c) => [c.planId, c._count._all]));
  return (
    <PlansManager
      currency={billing.currency}
      signupPlanId={billing.signupPlanId}
      plans={plans.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description ?? "",
        priceMonthly: p.priceMonthly,
        priceYearly: p.priceYearly,
        trialDays: p.trialDays,
        limits: readLimits(p.limits),
        features: readFeatures(p.features),
        isPublic: p.isPublic,
        isActive: p.isActive,
        sortOrder: p.sortOrder,
        workspaces: used.get(p.id) ?? 0,
      }))}
    />
  );
}
