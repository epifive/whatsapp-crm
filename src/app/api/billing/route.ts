import { NextResponse } from "next/server";
import { requireApiOrg, route } from "@/lib/api";
import { enabledGateways } from "@/lib/billing/checkout";
import { getEntitlements, usageAll } from "@/lib/billing/entitlements";
import { readFeatures, readLimits } from "@/lib/billing/plans";
import { db } from "@/lib/db";
import { getBilling } from "@/lib/settings";
import { orgDb } from "@/lib/tenancy";

/** Settings › Billing: the plan, usage against its limits, plans to switch to and invoices */
export const GET = route(async () => {
  const session = await requireApiOrg("ADMIN");
  const orgId = session.org.id;
  const [ent, billing] = await Promise.all([getEntitlements(orgId), getBilling()]);
  const tdb = orgDb(orgId);
  const [usage, plans, gateways, invoices, org] = await Promise.all([
    usageAll(orgId),
    db.plan.findMany({ where: { isActive: true, OR: [{ isPublic: true }, ...(ent.plan ? [{ id: ent.plan.id }] : [])] }, orderBy: [{ sortOrder: "asc" }, { priceMonthly: "asc" }] }),
    enabledGateways(),
    tdb.invoice.findMany({ orderBy: { createdAt: "desc" }, take: 50, include: { payments: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, gateway: true, status: true, reference: true } } } }),
    db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { name: true, billingName: true, billingEmail: true, billingAddress: true, billingTaxId: true } }),
  ]);
  const sub = ent.subscription;
  return NextResponse.json({
    enabled: ent.billingEnabled,
    currency: billing.currency,
    tax: billing.taxPercent > 0 ? { name: billing.taxName, percent: billing.taxPercent } : null,
    subscription: sub
      ? {
          planId: sub.planId,
          planName: ent.plan?.name ?? "",
          status: ent.status,
          interval: sub.interval,
          currentPeriodEnd: sub.currentPeriodEnd,
          trialEndsAt: sub.trialEndsAt,
          graceEndsAt: ent.graceEndsAt,
        }
      : null,
    locked: ent.locked,
    limits: ent.limits,
    features: ent.features,
    usage,
    plans: plans.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      priceMonthly: p.priceMonthly,
      priceYearly: p.priceYearly,
      trialDays: p.trialDays,
      limits: readLimits(p.limits),
      features: readFeatures(p.features),
    })),
    gateways,
    invoices: invoices.map((i) => ({
      id: i.id,
      number: i.number,
      description: i.description,
      total: i.total,
      currency: i.currency,
      status: i.status,
      createdAt: i.createdAt,
      paidAt: i.paidAt,
      payment: i.payments[0] ?? null,
    })),
    details: { name: org.billingName ?? org.name, email: org.billingEmail ?? "", address: org.billingAddress ?? "", taxId: org.billingTaxId ?? "" },
  });
});
