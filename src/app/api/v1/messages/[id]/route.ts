import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api";
import { apiV1 } from "@/lib/api-v1";
import { orgDb } from "@/lib/tenancy";

/** GET /api/v1/messages/:id — delivery status of a message */
export const GET = apiV1<RouteContext<"/api/v1/messages/[id]">>(async (_req, ctx, auth) => {
  const { id } = await ctx.params;
  const m = await orgDb(auth.orgId).message.findUnique({ where: { id } });
  if (!m) throw new ApiError(404, "Message not found.", "not_found");
  return NextResponse.json({
    data: { id: m.id, direction: m.direction.toLowerCase(), type: m.type.toLowerCase(), text: m.body, status: m.status.toLowerCase(), error: m.error, conversation_id: m.conversationId, created_at: m.createdAt },
  });
});
