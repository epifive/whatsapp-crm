import { NextResponse } from "next/server";
import { ApiError, clientIp, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { clearSessionCookie, getSession, setSessionCookie } from "@/lib/auth/session";
import { db } from "@/lib/db";

/** Ends "view as" and signs the platform admin back in as themselves */
export const POST = route(async (req) => {
  const session = await getSession();
  if (!session?.impersonatorId) throw new ApiError(400, "You're not viewing the app as someone else.");
  const admin = await db.user.findUnique({ where: { id: session.impersonatorId }, select: { id: true, sessionVersion: true, platformRole: true } });
  await audit({ action: "admin.impersonation_stopped", orgId: session.org?.id, userId: session.impersonatorId, targetType: "user", targetId: session.user.id, ip: clientIp(req) });
  if (!admin || admin.platformRole !== "SUPER_ADMIN") {
    await clearSessionCookie();
    return NextResponse.json({ ok: true, redirect: "/login" });
  }
  await setSessionCookie(admin.id, admin.sessionVersion);
  return NextResponse.json({ ok: true, redirect: session.org ? `/admin/workspaces/${session.org.id}` : "/admin" });
});
