import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/lib/db";
import type { OrgRole } from "@/generated/prisma/client";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession, verifySessionToken } from "./token";

const ROLE_RANK: Record<OrgRole, number> = { AGENT: 1, ADMIN: 2, OWNER: 3 };

export function roleAtLeast(role: OrgRole, min: OrgRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export async function setSessionCookie(userId: string, sessionVersion: number, orgId?: string, opts: { impersonatorId?: string } = {}) {
  // Impersonation sessions are short: an admin's view-as ends by itself after two hours
  const ttl = opts.impersonatorId ? IMPERSONATION_TTL_SECONDS : SESSION_TTL_SECONDS;
  (await cookies()).set(SESSION_COOKIE, signSession({ sub: userId, sv: sessionVersion, org: orgId, ...(opts.impersonatorId ? { imp: opts.impersonatorId } : {}) }, ttl), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ttl,
  });
}

export const IMPERSONATION_TTL_SECONDS = 2 * 60 * 60;

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

/**
 * The signed-in user (or null). A token only counts while its session version matches the
 * user's current one, so a password change or "log out everywhere" revokes old tokens.
 * Memoised per request.
 */
export const getSession = cache(async () => {
  const payload = verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!payload) return null;

  const user = await db.user.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, name: true, platformRole: true, emailVerifiedAt: true, sessionVersion: true, locale: true },
  });
  if (!user || user.sessionVersion !== payload.sv) return null;

  const memberships = await db.membership.findMany({
    where: { userId: user.id },
    include: { org: { select: { id: true, name: true, slug: true, timezone: true, currency: true } } },
    orderBy: { createdAt: "asc" },
  });
  // The token's org if the user still belongs to it, else their first organization
  const active = memberships.find((m) => m.orgId === payload.org) ?? memberships[0] ?? null;

  return {
    user,
    memberships,
    org: active?.org ?? null,
    role: active?.role ?? null,
    // Platform admin using the app as this user ("view as"), if any
    impersonatorId: payload.imp ?? null,
  };
});

export type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;

/** For pages: signed-in and verified user, otherwise redirect */
export async function requireUser(): Promise<Session> {
  const session = await getSession();
  // Not /login directly: the proxy would bounce a signed-but-revoked cookie back to /app
  if (!session) redirect("/auth/expired");
  if (!session.user.emailVerifiedAt) redirect("/verify-email");
  return session;
}

/** For pages: user with an active organization (and at least `minRole`) */
export async function requireOrg(minRole: OrgRole = "AGENT") {
  const session = await requireUser();
  if (!session.org || !session.role) redirect("/onboarding");
  if (!roleAtLeast(session.role, minRole)) redirect("/app?denied=1");
  return session as Session & { org: NonNullable<Session["org"]>; role: OrgRole };
}

export async function requireSuperAdmin() {
  const session = await requireUser();
  if (session.user.platformRole !== "SUPER_ADMIN") redirect("/app");
  return session;
}
