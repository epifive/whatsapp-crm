import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, clientIp, parseBody, requireApiSuperAdmin, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { isFreePlan } from "@/lib/billing/plans";
import { db } from "@/lib/db";

const body = z.discriminatedUnion("action", [
  // Put the workspace on a plan until a date (or with no end), e.g. a deal agreed outside the app
  z.object({ action: z.literal("set_plan"), planId: z.string().min(1), interval: z.enum(["MONTHLY", "YEARLY"]), periodEnd: z.coerce.date().nullable() }),
  // Give a trial of its plan until a date
  z.object({ action: z.literal("trial"), trialEnd: z.coerce.date() }),
  z.object({ action: z.literal("expire") }),
  z.object({ action: z.literal("suspend"), reason: z.string().trim().max(300).default("") }),
  z.object({ action: z.literal("unsuspend") }),
]);

/** Super admin: change a workspace's subscription or suspend it */
export const PATCH = route<RouteContext<"/api/admin/workspaces/[id]">>(async (req, ctx) => {
  const session = await requireApiSuperAdmin();
  const { id } = await ctx.params;
  const input = await parseBody(req, body);
  const org = await db.organization.findUnique({ where: { id }, include: { subscription: true } });
  if (!org) throw new ApiError(404, "Workspace not found.");
  const now = new Date();

  if (input.action === "set_plan") {
    const plan = await db.plan.findUnique({ where: { id: input.planId } });
    if (!plan) throw new ApiError(404, "Plan not found.");
    if (input.periodEnd && input.periodEnd <= now) throw new ApiError(400, "Choose a date in the future.");
    const data = {
      planId: plan.id,
      interval: input.interval,
      status: "ACTIVE" as const,
      currentPeriodStart: now,
      currentPeriodEnd: isFreePlan(plan) ? null : input.periodEnd,
      trialEndsAt: null,
      graceEndsAt: null,
      remindedAt: null,
    };
    await db.subscription.upsert({ where: { orgId: id }, create: { orgId: id, ...data }, update: data });
  } else if (input.action === "trial") {
    if (!org.subscription) throw new ApiError(400, "Put the workspace on a plan first.");
    if (input.trialEnd <= now) throw new ApiError(400, "Choose a date in the future.");
    await db.subscription.update({ where: { orgId: id }, data: { status: "TRIALING", currentPeriodEnd: input.trialEnd, trialEndsAt: input.trialEnd, graceEndsAt: null, remindedAt: null } });
  } else if (input.action === "expire") {
    if (!org.subscription) throw new ApiError(400, "This workspace has no subscription.");
    await db.subscription.update({ where: { orgId: id }, data: { status: "EXPIRED", currentPeriodEnd: org.subscription.currentPeriodEnd ?? now, graceEndsAt: null } });
  } else if (input.action === "suspend") {
    await db.organization.update({ where: { id }, data: { suspendedAt: now, suspendedReason: input.reason || null } });
  } else {
    await db.organization.update({ where: { id }, data: { suspendedAt: null, suspendedReason: null } });
  }

  await audit({ action: `admin.workspace.${input.action}`, orgId: id, userId: session.user.id, targetType: "organization", targetId: id, meta: { ...input }, ip: clientIp(req) });
  return NextResponse.json({ ok: true });
});
