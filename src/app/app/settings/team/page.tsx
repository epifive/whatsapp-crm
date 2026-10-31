import type { Metadata } from "next";
import { requireOrg } from "@/lib/auth/session";
import { orgDb } from "@/lib/tenancy";
import { TeamManager } from "./team-manager";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const session = await requireOrg();
  const tdb = orgDb(session.org.id);
  const [members, invitations] = await Promise.all([
    tdb.membership.findMany({ include: { user: { select: { name: true, email: true } } }, orderBy: { createdAt: "asc" } }),
    tdb.invitation.findMany({ where: { acceptedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } }),
  ]);

  return (
    <TeamManager
      currentUserId={session.user.id}
      currentRole={session.role}
      members={members.map((m) => ({ id: m.id, userId: m.userId, name: m.user.name, email: m.user.email, role: m.role }))}
      invitations={invitations.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt.toISOString() }))}
    />
  );
}
