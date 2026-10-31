import { NextResponse } from "next/server";
import { ApiError, parseBody, requireApiOrg, route } from "@/lib/api";
import { logActivity } from "@/lib/crm/activity";
import { topPosition } from "@/lib/crm/deals";
import { assertContact, assertMember } from "@/lib/crm/guards";
import { dealBodySchema, dealInclude, dealView, ensureDefaultPipeline, listPipelines, statusForStage } from "@/lib/crm/pipelines";
import { publish } from "@/lib/realtime";
import { orgDb } from "@/lib/tenancy";
import type { Prisma } from "@/generated/prisma/client";

const BOARD_LIMIT = 1000;

/**
 * GET ?pipelineId=&q=&owner=me|<userId> : the Kanban board (stages, deals, per-stage totals)
 * GET ?contactId= : a contact's deals
 */
export const GET = route(async (req) => {
  const session = await requireApiOrg("AGENT");
  const tdb = orgDb(session.org.id);
  const params = req.nextUrl.searchParams;

  const contactId = params.get("contactId");
  if (contactId) {
    const deals = await tdb.deal.findMany({ where: { contactId }, include: dealInclude, orderBy: [{ status: "asc" }, { updatedAt: "desc" }], take: 100 });
    return NextResponse.json({ deals: deals.map(dealView) });
  }

  await ensureDefaultPipeline(tdb, session.org.id);
  const pipelines = await listPipelines(tdb);
  const pipeline = pipelines.find((p) => p.id === params.get("pipelineId")) ?? pipelines[0]!;

  const where: Prisma.DealWhereInput = { pipelineId: pipeline.id };
  const q = params.get("q")?.trim().slice(0, 100);
  if (q) {
    const digits = q.replace(/\D/g, "");
    where.OR = [
      { title: { contains: q, mode: "insensitive" } },
      { contact: { name: { contains: q, mode: "insensitive" } } },
      { contact: { waName: { contains: q, mode: "insensitive" } } },
      ...(digits.length >= 3 ? [{ contact: { phone: { contains: digits } } }] : []),
    ];
  }
  const owner = params.get("owner");
  if (owner) where.ownerId = owner === "me" ? session.user.id : owner;

  const [deals, totals] = await Promise.all([
    tdb.deal.findMany({ where, include: dealInclude, orderBy: [{ position: "asc" }, { createdAt: "desc" }], take: BOARD_LIMIT }),
    tdb.deal.groupBy({ by: ["stageId"], where, _count: { _all: true }, _sum: { value: true } }),
  ]);
  return NextResponse.json({
    pipelines: pipelines.map(({ id, name }) => ({ id, name })),
    pipeline,
    deals: deals.map(dealView),
    totals: Object.fromEntries(totals.map((t) => [t.stageId, { count: t._count._all, value: t._sum.value?.toNumber() ?? 0 }])),
    currency: session.org.currency,
  });
});

export const POST = route(async (req) => {
  const session = await requireApiOrg("AGENT");
  const input = await parseBody(req, dealBodySchema);
  const tdb = orgDb(session.org.id);
  const stage = await tdb.stage.findUnique({ where: { id: input.stageId } });
  if (!stage || stage.pipelineId !== input.pipelineId) throw new ApiError(400, "Stage not found.");
  await assertContact(tdb, input.contactId);
  const ownerId = input.ownerId === undefined ? session.user.id : input.ownerId;
  await assertMember(tdb, ownerId);
  const status = statusForStage(stage.kind);

  const deal = await tdb.deal.create({
    data: {
      orgId: session.org.id,
      title: input.title,
      value: input.value,
      currency: session.org.currency,
      pipelineId: stage.pipelineId,
      stageId: stage.id,
      contactId: input.contactId ?? null,
      ownerId,
      expectedCloseAt: input.expectedCloseAt ?? null,
      status,
      closedAt: status === "OPEN" ? null : new Date(),
      position: await topPosition(tdb, stage.id),
    },
    include: dealInclude,
  });
  await logActivity({ orgId: session.org.id, dealId: deal.id, contactId: deal.contactId, actorId: session.user.id, type: "deal.created", data: { title: deal.title, stage: stage.name } });
  await publish(`org:${session.org.id}`, "deals.changed", { pipelineId: stage.pipelineId });
  return NextResponse.json({ deal: dealView(deal) }, { status: 201 });
});
