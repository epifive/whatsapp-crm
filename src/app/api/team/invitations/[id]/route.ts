import { NextResponse } from "next/server";
import { ApiError, clientIp, requireApiOrg, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { orgDb } from "@/lib/tenancy";

// Revoke a pending invitation
export const DELETE = route<RouteContext<"/api/team/invitations/[id]">>(async (req, ctx) => {
  const session = await requireApiOrg("ADMIN");
  const { id } = await ctx.params;
  const { count } = await orgDb(session.org.id).invitation.deleteMany({ where: { id, acceptedAt: null } });
  if (count === 0) throw new ApiError(404, "Invitation not found.");
  await audit({ action: "team.invitation_revoked", orgId: session.org.id, userId: session.user.id, targetType: "Invitation", targetId: id, ip: clientIp(req) });
  return NextResponse.json({ ok: true });
});
