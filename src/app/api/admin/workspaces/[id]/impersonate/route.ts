import { NextResponse } from "next/server";
import { ApiError, clientIp, requireApiSuperAdmin, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { setSessionCookie } from "@/lib/auth/session";
import { db } from "@/lib/db";

/**
 * Super admin: open the app as the workspace's owner to help them ("view as"). The session is
 * marked, shows a banner, ends after two hours, and both start and stop are audit-logged.
 */
export const POST = route<RouteContext<"/api/admin/workspaces/[id]/impersonate">>(async (req, ctx) => {
  const session = await requireApiSuperAdmin();
  if (session.impersonatorId) throw new ApiError(400, "Stop viewing as the current user first.");
  const { id } = await ctx.params;
  const owner = await db.membership.findFirst({ where: { orgId: id, role: "OWNER" }, orderBy: { createdAt: "asc" }, include: { user: { select: { id: true, sessionVersion: true, platformRole: true, email: true } } } });
  if (!owner) throw new ApiError(404, "This workspace has no owner to view as.");
  if (owner.user.platformRole === "SUPER_ADMIN") throw new ApiError(400, "You can't view the app as another platform admin.");
  await audit({ action: "admin.impersonation_started", orgId: id, userId: session.user.id, targetType: "user", targetId: owner.user.id, meta: { email: owner.user.email }, ip: clientIp(req) });
  await setSessionCookie(owner.user.id, owner.user.sessionVersion, id, { impersonatorId: session.user.id });
  return NextResponse.json({ ok: true, redirect: "/app" });
});
