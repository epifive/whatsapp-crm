import { NextResponse } from "next/server";
import { ApiError, requireApiOrg, route } from "@/lib/api";
import { contactDisplayName } from "@/lib/inbox";
import { orgDb } from "@/lib/tenancy";

/** The flow's latest runs: who, outcome, collected answers */
export const GET = route<RouteContext<"/api/flows/[id]/sessions">>(async (_req, ctx) => {
  const session = await requireApiOrg("AGENT");
  const { id } = await ctx.params;
  const tdb = orgDb(session.org.id);
  if (!(await tdb.flow.findUnique({ where: { id }, select: { id: true } }))) throw new ApiError(404, "Flow not found.");
  const rows = await tdb.flowSession.findMany({
    where: { flowId: id },
    include: { conversation: { select: { id: true, contact: { select: { id: true, phone: true, name: true, waName: true } } } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return NextResponse.json({
    sessions: rows.map((s) => ({
      id: s.id,
      status: s.status,
      endReason: s.endReason,
      variables: s.variables,
      createdAt: s.createdAt,
      endedAt: s.endedAt,
      conversationId: s.conversation.id,
      contact: { id: s.conversation.contact.id, name: contactDisplayName(s.conversation.contact) },
    })),
  });
});
