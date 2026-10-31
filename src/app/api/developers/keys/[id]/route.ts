import { NextResponse } from "next/server";
import { ApiError, clientIp, requireApiOrg, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { orgDb } from "@/lib/tenancy";

/** Revoke an API key (requests with it fail immediately) */
export const DELETE = route<RouteContext<"/api/developers/keys/[id]">>(async (req, ctx) => {
  const session = await requireApiOrg("ADMIN");
  const { id } = await ctx.params;
  const { count } = await orgDb(session.org.id).apiKey.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (!count) throw new ApiError(404, "API key not found.");
  await audit({ action: "api_key.revoked", orgId: session.org.id, userId: session.user.id, targetType: "api_key", targetId: id, ip: clientIp(req) });
  return NextResponse.json({ ok: true });
});
