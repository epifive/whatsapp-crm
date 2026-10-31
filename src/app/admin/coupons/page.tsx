import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getBilling } from "@/lib/settings";
import { CouponsManager } from "./coupons-manager";

export const metadata: Metadata = { title: "Coupons" };

export default async function AdminCouponsPage() {
  const [coupons, plans, billing] = await Promise.all([
    db.coupon.findMany({ orderBy: { createdAt: "desc" } }),
    db.plan.findMany({ orderBy: [{ sortOrder: "asc" }, { priceMonthly: "asc" }], select: { id: true, name: true } }),
    getBilling(),
  ]);
  return (
    <CouponsManager
      currency={billing.currency}
      plans={plans}
      coupons={coupons.map((c) => ({
        id: c.id,
        code: c.code,
        percentOff: c.percentOff,
        amountOff: c.amountOff,
        planIds: c.planIds,
        maxRedemptions: c.maxRedemptions,
        redemptions: c.redemptions,
        expiresAt: c.expiresAt?.toISOString() ?? null,
        isActive: c.isActive,
      }))}
    />
  );
}
