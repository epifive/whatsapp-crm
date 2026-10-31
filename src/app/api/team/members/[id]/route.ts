import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, clientIp, parseBody, requireApiOrg, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { canManageMember, ownerCount } from "@/lib/orgs";
import { orgDb } from "@/lib/tenancy";

type Ctx = RouteContext<"/api/team/members/[id]">;

const body = z.object({ role: z.enum(["OWNER", "ADMIN", "AGENT"]) });

// Change a member's role
export const PATCH = route<Ctx>(async (req, ctx) => {
  const session = await requireApiOrg("ADMIN");
  const { id } = await ctx.params;
  const { role } = await parseBody(req, body);
  const tdb = orgDb(session.org.id);

  const member = await tdb.membership.findUnique({ where: { id } });
  if (!member) throw new ApiError(404, "Member not found.");
  if (member.userId === session.user.id) throw new ApiError(400, "You can't change your own role.");
  if (!canManageMember(session.role, member.role, role)) throw new ApiError(403, "You don't have permission to change this member's role.");
  if (member.role === "OWNER" && role !== "OWNER" && (await ownerCount(session.org.id)) <= 1) {
    throw new ApiError(400, "An organization needs at least one owner.");
  }

  const updated = await tdb.membership.update({ where: { id }, data: { role } });
  await audit({ action: "team.role_changed", orgId: session.org.id, userId: session.user.id, targetType: "Membership", targetId: id, meta: { from: member.role, to: role }, ip: clientIp(req) });
  return NextResponse.json({ member: updated });
});

// Remove a member (or leave, when removing yourself)
export const DELETE = route<Ctx>(async (req, ctx) => {
  const session = await requireApiOrg("AGENT");
  const { id } = await ctx.params;
  const tdb = orgDb(session.org.id);

  const member = await tdb.membership.findUnique({ where: { id } });
  if (!member) throw new ApiError(404, "Member not found.");
  const leaving = member.userId === session.user.id;
  if (!leaving && !canManageMember(session.role, member.role)) throw new ApiError(403, "You don't have permission to remove this member.");
  if (member.role === "OWNER" && (await ownerCount(session.org.id)) <= 1) {
    throw new ApiError(400, "The last owner can't leave. Make someone else an owner first.");
  }

  await tdb.membership.delete({ where: { id } });
  await audit({ action: leaving ? "team.left" : "team.removed", orgId: session.org.id, userId: session.user.id, targetType: "Membership", targetId: id, ip: clientIp(req) });
  return NextResponse.json({ ok: true });
});
