import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, parseBody, requireApiOrg, route } from "@/lib/api";
import { moveDeal } from "@/lib/crm/deals";
import { dealInclude, dealView } from "@/lib/crm/pipelines";
import { publish } from "@/lib/realtime";
import { orgDb } from "@/lib/tenancy";

const body = z.object({
  stageId: z.string().min(1),
  beforeId: z.string().min(1).nullable().optional(), // the deal that ends up directly above
  afterId: z.string().min(1).nullable().optional(), // the deal that ends up directly below
});

/** Drag and drop on the board */
export const POST = route<RouteContext<"/api/deals/[id]/move">>(async (req, ctx) => {
  const session = await requireApiOrg("AGENT");
  const { id } = await ctx.params;
  const input = await parseBody(req, body);
  const tdb = orgDb(session.org.id);
  const deal = await tdb.deal.findUnique({ where: { id } });
  if (!deal) throw new ApiError(404, "Deal not found.");
  await moveDeal(tdb, deal, input, session.user.id);
  const updated = await tdb.deal.findUniqueOrThrow({ where: { id }, include: dealInclude });
  await publish(`org:${session.org.id}`, "deals.changed", { pipelineId: updated.pipelineId, dealId: id });
  return NextResponse.json({ deal: dealView(updated) });
});
