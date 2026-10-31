import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, clientIp, parseBody, requireApiOrg, requireApiUser, route } from "@/lib/api";
import { setSessionCookie } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { createOrganization } from "@/lib/orgs";
import { CURRENCIES } from "@/lib/crm/pipelines";
import { isValidTimeZone } from "@/lib/time";

const createBody = z.object({ name: z.string().trim().min(2, "Organization name is too short.").max(80) });

const MAX_ORGS_PER_USER = 10;

// Create an organization; the creator becomes its owner and it becomes the active one
export const POST = route(async (req) => {
  const session = await requireApiUser();
  const { name } = await parseBody(req, createBody);

  if (session.memberships.filter((m) => m.role === "OWNER").length >= MAX_ORGS_PER_USER) {
    throw new ApiError(403, `You can own at most ${MAX_ORGS_PER_USER} organizations.`);
  }

  const org = await createOrganization(session.user.id, name);
  await setSessionCookie(session.user.id, session.user.sessionVersion, org.id, { impersonatorId: session.impersonatorId ?? undefined });
  await audit({ action: "org.created", orgId: org.id, userId: session.user.id, ip: clientIp(req) });
  return NextResponse.json({ org: { id: org.id, name: org.name, slug: org.slug } }, { status: 201 });
});

const updateBody = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  currency: z.enum(CURRENCIES).optional(),
});

// Update the active organization (admins and owners)
export const PATCH = route(async (req) => {
  const session = await requireApiOrg("ADMIN");
  const data = await parseBody(req, updateBody);
  if (data.timezone && !isValidTimeZone(data.timezone)) {
    throw new ApiError(400, "Unknown time zone.");
  }
  const org = await db.organization.update({ where: { id: session.org.id }, data });
  await audit({ action: "org.updated", orgId: org.id, userId: session.user.id, meta: data, ip: clientIp(req) });
  return NextResponse.json({ org });
});
