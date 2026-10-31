import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, parseBody, requireApiOrg, route } from "@/lib/api";
import { publish } from "@/lib/realtime";
import { orgDb } from "@/lib/tenancy";

const body = z.object({ body: z.string().trim().min(1, "Write a note.").max(4000) });

/** Note on a deal; it also shows on the deal's contact */
export const POST = route<RouteContext<"/api/deals/[id]/notes">>(async (req, ctx) => {
  const session = await requireApiOrg("AGENT");
  const { id } = await ctx.params;
  const input = await parseBody(req, body);
  const tdb = orgDb(session.org.id);
  const deal = await tdb.deal.findUnique({ where: { id }, select: { id: true, contactId: true, pipelineId: true } });
  if (!deal) throw new ApiError(404, "Deal not found.");
  const note = await tdb.note.create({ data: { orgId: session.org.id, dealId: id, contactId: deal.contactId, authorId: session.user.id, body: input.body } });
  await publish(`org:${session.org.id}`, "deals.changed", { pipelineId: deal.pipelineId, dealId: id });
  return NextResponse.json({ note: { id: note.id, body: note.body, createdAt: note.createdAt, author: session.user.name } }, { status: 201 });
});
