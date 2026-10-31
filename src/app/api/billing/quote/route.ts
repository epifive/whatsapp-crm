import { NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireApiOrg, route } from "@/lib/api";
import { quote } from "@/lib/billing/checkout";
import { db } from "@/lib/db";

const body = z.object({
  planId: z.string().min(1),
  interval: z.enum(["MONTHLY", "YEARLY"]),
  coupon: z.string().trim().max(40).optional(),
});

/** Price breakdown (coupon, tax) before paying */
export const POST = route(async (req) => {
  const session = await requireApiOrg("ADMIN");
  const input = await parseBody(req, body);
  const sub = await db.subscription.findUnique({ where: { orgId: session.org.id }, select: { planId: true } });
  const q = await quote({ planId: input.planId, interval: input.interval, couponCode: input.coupon, currentPlanId: sub?.planId });
  return NextResponse.json({
    currency: q.currency,
    subtotal: q.subtotal,
    discount: q.discount,
    tax: q.tax,
    taxLabel: q.taxLabel,
    total: q.total,
    coupon: q.coupon ? { code: q.coupon.code, percentOff: q.coupon.percentOff, amountOff: q.coupon.amountOff } : null,
  });
});
