import { NextResponse } from "next/server";
import { ApiError, clientIp, parseBody, requireApiSuperAdmin, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { couponBody } from "@/lib/billing/admin-schemas";
import { db } from "@/lib/db";
import { getBilling } from "@/lib/settings";

export const POST = route(async (req) => {
  const session = await requireApiSuperAdmin();
  const input = await parseBody(req, couponBody((await getBilling()).currency));
  if (await db.coupon.findUnique({ where: { code: input.code } })) throw new ApiError(409, "A coupon with this code already exists.");
  const coupon = await db.coupon.create({
    data: {
      code: input.code,
      percentOff: input.type === "percent" ? input.percentOff! : null,
      amountOff: input.type === "amount" ? input.amountOff! : null,
      planIds: input.planIds,
      maxRedemptions: input.maxRedemptions,
      expiresAt: input.expiresAt,
      isActive: input.isActive,
    },
  });
  await audit({ action: "coupon.created", userId: session.user.id, targetType: "coupon", targetId: coupon.id, meta: { code: coupon.code }, ip: clientIp(req) });
  return NextResponse.json({ coupon: { id: coupon.id } }, { status: 201 });
});
