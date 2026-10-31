import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, clientIp, parseBody, requireApiSuperAdmin, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";

type Ctx = RouteContext<"/api/admin/coupons/[id]">;

// The code and discount are fixed once created (invoices refer to them); these can change
const patchBody = z.object({
  isActive: z.boolean().optional(),
  maxRedemptions: z.coerce.number().int().min(1).max(1_000_000).nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
});

export const PATCH = route<Ctx>(async (req, ctx) => {
  const session = await requireApiSuperAdmin();
  const { id } = await ctx.params;
  const input = await parseBody(req, patchBody);
  const { count } = await db.coupon.updateMany({ where: { id }, data: input });
  if (!count) throw new ApiError(404, "Coupon not found.");
  await audit({ action: "coupon.updated", userId: session.user.id, targetType: "coupon", targetId: id, ip: clientIp(req) });
  return NextResponse.json({ ok: true });
});

export const DELETE = route<Ctx>(async (req, ctx) => {
  const session = await requireApiSuperAdmin();
  const { id } = await ctx.params;
  const { count } = await db.coupon.deleteMany({ where: { id } });
  if (!count) throw new ApiError(404, "Coupon not found.");
  await audit({ action: "coupon.deleted", userId: session.user.id, targetType: "coupon", targetId: id, ip: clientIp(req) });
  return NextResponse.json({ ok: true });
});
