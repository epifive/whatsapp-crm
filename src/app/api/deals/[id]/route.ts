import { NextResponse } from "next/server";
import { ApiError, clientIp, parseBody, requireApiOrg, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { roleAtLeast } from "@/lib/auth/session";
import { moveDeal } from "@/lib/crm/deals";
import { assertContact, assertMember } from "@/lib/crm/guards";
import { dealBodySchema, dealInclude, dealView } from "@/lib/crm/pipelines";
import { taskInclude, taskView } from "@/lib/crm/tasks";
import { timeline } from "@/lib/crm/timeline";
import { publish } from "@/lib/realtime";
import { orgDb } from "@/lib/tenancy";

type Ctx = RouteContext<"/api/deals/[id]">;

export const GET = route<Ctx>(async (_req, ctx) => {
  const session = await requireApiOrg("AGENT");
  const { id } = await ctx.params;
  const tdb = orgDb(session.org.id);
  const deal = await tdb.deal.findUnique({ where: { id }, include: dealInclude });
  if (!deal) throw new ApiError(404, "Deal not found.");
  const [tasks, history] = await Promise.all([
    tdb.task.findMany({ where: { dealId: id }, include: taskInclude, orderBy: [{ completedAt: { sort: "desc", nulls: "first" } }, { dueAt: { sort: "asc", nulls: "last" } }], take: 50 }),
    timeline(tdb, { dealId: id }, { limit: 50 }),
  ]);
  return NextResponse.json({ deal: dealView(deal), tasks: tasks.map(taskView), timeline: history.items });
});

export const PATCH = route<Ctx>(async (req, ctx) => {
  const session = await requireApiOrg("AGENT");
  const { id } = await ctx.params;
  const input = await parseBody(req, dealBodySchema.partial());
  const tdb = orgDb(session.org.id);
  const deal = await tdb.deal.findUnique({ where: { id } });
  if (!deal) throw new ApiError(404, "Deal not found.");
  if (input.contactId) await assertContact(tdb, input.contactId);
  if (input.ownerId) await assertMember(tdb, input.ownerId);

  await tdb.deal.update({
    where: { id },
    data: {
      title: input.title,
      value: input.value,
      contactId: input.contactId,
      ownerId: input.ownerId,
      expectedCloseAt: input.expectedCloseAt,
      lostReason: input.lostReason,
    },
  });
  if (input.stageId && input.stageId !== deal.stageId) await moveDeal(tdb, deal, { stageId: input.stageId }, session.user.id);

  const updated = await tdb.deal.findUniqueOrThrow({ where: { id }, include: dealInclude });
  await publish(`org:${session.org.id}`, "deals.changed", { pipelineId: updated.pipelineId });
  return NextResponse.json({ deal: dealView(updated) });
});

/** Deal owners and admins can delete a deal */
export const DELETE = route<Ctx>(async (req, ctx) => {
  const session = await requireApiOrg("AGENT");
  const { id } = await ctx.params;
  const tdb = orgDb(session.org.id);
  const deal = await tdb.deal.findUnique({ where: { id } });
  if (!deal) throw new ApiError(404, "Deal not found.");
  if (deal.ownerId !== session.user.id && !roleAtLeast(session.role, "ADMIN")) throw new ApiError(403, "Only the deal owner or an admin can delete this deal.");
  await tdb.deal.delete({ where: { id } });
  await audit({ action: "deal.deleted", orgId: session.org.id, userId: session.user.id, targetType: "deal", targetId: id, meta: { title: deal.title }, ip: clientIp(req) });
  await publish(`org:${session.org.id}`, "deals.changed", { pipelineId: deal.pipelineId });
  return NextResponse.json({ ok: true });
});
