import crypto from "node:crypto";
import { db } from "@/lib/db";
import { hashToken, randomToken } from "@/lib/crypto";
import { env } from "@/lib/env";
import { sendTemplateEmail } from "@/lib/email-templates";
import type { OrgRole } from "@/generated/prisma/client";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "org"}-${crypto.randomBytes(3).toString("hex")}`;
}

export async function createOrganization(userId: string, name: string) {
  return db.organization.create({
    data: { name, slug: slugify(name), memberships: { create: { userId, role: "OWNER" } } },
  });
}

/**
 * Who may change whose role. Owners manage everyone; admins only manage agents and can't
 * hand out ownership; nobody manages themselves here (owners leave via ownership transfer).
 */
export function canManageMember(actor: OrgRole, target: OrgRole, newRole?: OrgRole): boolean {
  if (actor === "OWNER") return true;
  if (actor === "ADMIN") return target === "AGENT" && (newRole === undefined || newRole !== "OWNER");
  return false;
}

export function canInviteAs(actor: OrgRole, role: OrgRole): boolean {
  if (actor === "OWNER") return true;
  if (actor === "ADMIN") return role !== "OWNER";
  return false;
}

export async function ownerCount(orgId: string): Promise<number> {
  return db.membership.count({ where: { orgId, role: "OWNER" } });
}

export async function sendInvitation(opts: {
  orgId: string;
  orgName: string;
  email: string;
  role: OrgRole;
  invitedById: string;
  inviterName: string;
}) {
  const token = randomToken();
  // A fresh invite replaces any pending one for the same email
  await db.invitation.deleteMany({ where: { orgId: opts.orgId, email: opts.email, acceptedAt: null } });
  const invitation = await db.invitation.create({
    data: {
      orgId: opts.orgId,
      email: opts.email,
      role: opts.role,
      tokenHash: hashToken(token),
      invitedById: opts.invitedById,
      expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    },
  });
  await sendTemplateEmail("invitation", {
    to: opts.email,
    vars: { inviter: opts.inviterName, workspace: opts.orgName, role: opts.role.toLowerCase() },
    url: `${env().APP_URL}/invite?token=${encodeURIComponent(token)}`,
    footer: "If you weren't expecting this invitation, you can ignore this email.",
  });
  return invitation;
}
