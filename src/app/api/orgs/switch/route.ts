import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, parseBody, requireApiUser, route } from "@/lib/api";
import { setSessionCookie } from "@/lib/auth/session";

const body = z.object({ orgId: z.string().min(1) });

export const POST = route(async (req) => {
  const session = await requireApiUser();
  const { orgId } = await parseBody(req, body);
  if (!session.memberships.some((m) => m.orgId === orgId)) throw new ApiError(403, "You're not a member of that organization.");
  await setSessionCookie(session.user.id, session.user.sessionVersion, orgId, { impersonatorId: session.impersonatorId ?? undefined });
  return NextResponse.json({ ok: true });
});
