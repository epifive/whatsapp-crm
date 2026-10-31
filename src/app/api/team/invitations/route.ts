import { assertLimit } from "@/lib/billing/entitlements";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, clientIp, parseBody, requireApiOrg, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { canInviteAs, sendInvitation } from "@/lib/orgs";
import { rateLimit } from "@/lib/rate-limit";
import { emailSchema } from "@/lib/validation";

const body = z.object({ email: emailSchema, role: z.enum(["OWNER", "ADMIN", "AGENT"]) });

export const POST = route(async (req) => {
  const session = await requireApiOrg("ADMIN");
  const { email, role } = await parseBody(req, body);

  if (!canInviteAs(session.role, role)) throw new ApiError(403, "Only owners can invite other owners.");
  if (!rateLimit(`invite:${session.org.id}`, 30, 60 * 60 * 1000).ok) throw new ApiError(429, "Too many invitations sent. Try again later.");

  const existing = await db.membership.findFirst({ where: { orgId: session.org.id, user: { email } } });
  if (existing) throw new ApiError(409, "This person is already a member.");
  // A new invitation to the same email replaces the pending one, so it doesn't count twice
  const pending = await db.invitation.count({ where: { orgId: session.org.id, email, acceptedAt: null, expiresAt: { gt: new Date() } } });
  await assertLimit(session.org.id, "members", pending ? 0 : 1);

  const invitation = await sendInvitation({
    orgId: session.org.id,
    orgName: session.org.name,
    email,
    role,
    invitedById: session.user.id,
    inviterName: session.user.name,
  });
  await audit({ action: "team.invited", orgId: session.org.id, userId: session.user.id, targetType: "Invitation", targetId: invitation.id, meta: { email, role }, ip: clientIp(req) });
  return NextResponse.json({ invitation: { id: invitation.id, email, role, expiresAt: invitation.expiresAt } }, { status: 201 });
});
