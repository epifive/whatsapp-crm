import { NextResponse } from "next/server";
import { ApiError, clientIp, parseBody, requireApiOrg, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { isUniqueViolation } from "@/lib/crm/guards";
import { pipelineSchema, statusForStage } from "@/lib/crm/pipelines";
import { db } from "@/lib/db";
import { publish } from "@/lib/realtime";
import { orgDb } from "@/lib/tenancy";
import type { Prisma } from "@/generated/prisma/client";

type Ctx = RouteContext<"/api/pipelines/[id]">;

/** Rename and edit stages (the full list, in order: existing ones keep their id) */
export const PATCH = route<Ctx>(async (req, ctx) => {
  const session = await requireApiOrg("ADMIN");
  const { id } = await ctx.params;
  const input = await parseBody(req, pipelineSchema);
  const tdb = orgDb(session.org.id);
  const pipeline = await tdb.pipeline.findUnique({ where: { id }, include: { stages: { include: { _count: { select: { deals: true } } } } } });
  if (!pipeline) throw new ApiError(404, "Pipeline not found.");

  const current = new Map(pipeline.stages.map((s) => [s.id, s]));
  if (input.stages.some((s) => s.id && !current.has(s.id))) throw new ApiError(400, "Unknown stage.");
  const kept = new Set(input.stages.map((s) => s.id).filter(Boolean));
  const removed = pipeline.stages.filter((s) => !kept.has(s.id));
  const blocked = removed.find((s) => s._count.deals > 0);
  if (blocked) throw new ApiError(409, `Move the deals out of "${blocked.name}" before removing it.`);

  const now = new Date();
  const ops: Prisma.PrismaPromise<unknown>[] = [
    db.pipeline.update({ where: { id }, data: { name: input.name } }),
    db.stage.deleteMany({ where: { id: { in: removed.map((s) => s.id) }, pipelineId: id } }),
  ];
  input.stages.forEach((s, position) => {
    const data = { name: s.name, color: s.color, kind: s.kind, probability: s.probability, position };
    if (!s.id) {
      ops.push(db.stage.create({ data: { ...data, orgId: session.org.id, pipelineId: id } }));
      return;
    }
    ops.push(db.stage.update({ where: { id: s.id }, data }));
    // A stage that becomes Won/Lost (or open again) changes the status of the deals in it
    if (current.get(s.id)!.kind !== s.kind) {
      const status = statusForStage(s.kind);
      ops.push(db.deal.updateMany({ where: { stageId: s.id }, data: { status, closedAt: status === "OPEN" ? null : now } }));
    }
  });
  try {
    await db.$transaction(ops);
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApiError(409, "A pipeline with this name already exists.");
    throw err;
  }
  await publish(`org:${session.org.id}`, "deals.changed", { pipelineId: id });
  return NextResponse.json({ ok: true });
});

/** Deletes the pipeline with all its deals */
export const DELETE = route<Ctx>(async (req, ctx) => {
  const session = await requireApiOrg("ADMIN");
  const { id } = await ctx.params;
  const tdb = orgDb(session.org.id);
  const pipeline = await tdb.pipeline.findUnique({ where: { id }, include: { _count: { select: { deals: true } } } });
  if (!pipeline) throw new ApiError(404, "Pipeline not found.");
  if ((await tdb.pipeline.count()) <= 1) throw new ApiError(400, "You need at least one pipeline.");
  await tdb.pipeline.delete({ where: { id } });
  await audit({ action: "pipeline.deleted", orgId: session.org.id, userId: session.user.id, targetType: "pipeline", targetId: id, meta: { name: pipeline.name, deals: pipeline._count.deals }, ip: clientIp(req) });
  await publish(`org:${session.org.id}`, "deals.changed", { pipelineId: id });
  return NextResponse.json({ ok: true });
});
