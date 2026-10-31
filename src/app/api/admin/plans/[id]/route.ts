import { NextResponse } from "next/server";
import { ApiError, clientIp, parseBody, requireApiSuperAdmin, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { planBody } from "@/lib/billing/admin-schemas";
import { db } from "@/lib/db";
import { getBilling } from "@/lib/settings";

type Ctx = RouteContext<"/api/admin/plans/[id]">;

/** Changes apply to every workspace on the plan right away (limits are read live) */
export const PATCH = route<Ctx>(async (req, ctx) => {
  const session = await requireApiSuperAdmin();
  const { id } = await ctx.params;
  const billing = await getBilling();
  const input = await parseBody(req, planBody(billing.currency));
  if (!(await db.plan.findUnique({ where: { id } }))) throw new ApiError(404, "Plan not found.");
  if (!input.isActive && billing.signupPlanId === id) throw new ApiError(400, "New workspaces start on this plan. Choose another signup plan in Settings first.");
  await db.plan.update({ where: { id }, data: { ...input, description: input.description || null } });
  await audit({ action: "plan.updated", userId: session.user.id, targetType: "plan", targetId: id, meta: { name: input.name }, ip: clientIp(req) });
  return NextResponse.json({ ok: true });
});

/** Only plans no workspace has ever used can be deleted; others can be switched off */
export const DELETE = route<Ctx>(async (req, ctx) => {
  const session = await requireApiSuperAdmin();
  const { id } = await ctx.params;
  if ((await getBilling()).signupPlanId === id) throw new ApiError(400, "New workspaces start on this plan. Choose another signup plan in Settings first.");
  const [subs, invoices] = await Promise.all([db.subscription.count({ where: { planId: id } }), db.invoice.count({ where: { planId: id } })]);
  if (subs || invoices) throw new ApiError(409, "Workspaces use (or paid for) this plan, so it can't be deleted. Switch it off instead.");
  const { count } = await db.plan.deleteMany({ where: { id } });
  if (!count) throw new ApiError(404, "Plan not found.");
  await audit({ action: "plan.deleted", userId: session.user.id, targetType: "plan", targetId: id, ip: clientIp(req) });
  return NextResponse.json({ ok: true });
});
