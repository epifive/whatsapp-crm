import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, clientIp, parseBody, requireApiUser, route } from "@/lib/api";
import { setSessionCookie } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { hashToken } from "@/lib/crypto";
import { db } from "@/lib/db";

const body = z.object({ token: z.string().min(10).max(200) });

// The signed-in user joins the organization; the invite must have been sent to their email
export const POST = route(async (req) => {
  const session = await requireApiUser();
  const { token } = await parseBody(req, body);

  const invitation = await db.invitation.findUnique({ where: { tokenHash: hashToken(token) }, include: { org: true } });
  if (!invitation || invitation.acceptedAt || invitation.expiresAt < new Date()) {
    throw new ApiError(400, "This invitation is invalid or has expired. Ask for a new one.", "invalid_invite");
  }
  if (invitation.email !== session.user.email.toLowerCase()) {
    throw new ApiError(403, `This invitation was sent to ${invitation.email}. Sign in with that account to accept it.`, "wrong_account");
  }

  await db.$transaction(async (tx) => {
    const claimed = await tx.invitation.updateMany({ where: { id: invitation.id, acceptedAt: null }, data: { acceptedAt: new Date() } });
    if (claimed.count !== 1) throw new ApiError(400, "This invitation was already used.");
    await tx.membership.upsert({
      where: { orgId_userId: { orgId: invitation.orgId, userId: session.user.id } },
      create: { orgId: invitation.orgId, userId: session.user.id, role: invitation.role },
      update: {},
    });
  });

  await setSessionCookie(session.user.id, session.user.sessionVersion, invitation.orgId, { impersonatorId: session.impersonatorId ?? undefined });
  await audit({ action: "team.joined", orgId: invitation.orgId, userId: session.user.id, targetType: "Invitation", targetId: invitation.id, ip: clientIp(req) });
  return NextResponse.json({ ok: true, org: { id: invitation.org.id, name: invitation.org.name } });
});
