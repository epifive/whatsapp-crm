import { ApiError } from "@/lib/api";
import { db } from "@/lib/db";
import type { OrgDb } from "@/lib/tenancy";
import type { Deal } from "@/generated/prisma/client";
import { emitEvent } from "@/lib/webhooks";
import { logActivity, type ActivityInput } from "./activity";
import { positionBetween, statusForStage } from "./pipelines";

const MIN_GAP = 1e-6;

/** Top of a stage column */
export async function topPosition(tdb: OrgDb, stageId: string): Promise<number> {
  const first = await tdb.deal.findFirst({ where: { stageId }, orderBy: { position: "asc" }, select: { position: true } });
  return positionBetween(null, first?.position);
}

// Fractional positions run out of precision after many moves into the same gap: respace the column
async function respace(stageId: string) {
  const deals = await db.deal.findMany({ where: { stageId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { id: true } });
  await db.$transaction(deals.map((d, i) => db.deal.update({ where: { id: d.id }, data: { position: (i + 1) * 1024 } })));
}

/**
 * Moves a deal to a stage (any pipeline of the workspace), between two neighbours of the
 * target column (`beforeId` ends up above it, `afterId` below; both optional). Entering a
 * Won/Lost stage closes the deal; leaving one reopens it. Stage changes go on the timeline.
 */
export async function moveDeal(
  tdb: OrgDb,
  deal: Deal,
  target: { stageId: string; beforeId?: string | null; afterId?: string | null },
  actorId: string,
): Promise<void> {
  const stage = await tdb.stage.findUnique({ where: { id: target.stageId } });
  if (!stage) throw new ApiError(400, "Stage not found.");
  const neighbour = async (id?: string | null) =>
    id && id !== deal.id ? tdb.deal.findFirst({ where: { id, stageId: stage.id }, select: { position: true } }) : null;

  let [before, after] = await Promise.all([neighbour(target.beforeId), neighbour(target.afterId)]);
  if (before && after && after.position - before.position < MIN_GAP) {
    await respace(stage.id);
    [before, after] = await Promise.all([neighbour(target.beforeId), neighbour(target.afterId)]);
  }
  const position = before || after ? positionBetween(before?.position, after?.position) : await topPosition(tdb, stage.id);

  const status = statusForStage(stage.kind);
  const stageChanged = stage.id !== deal.stageId;
  await tdb.deal.update({
    where: { id: deal.id },
    data: {
      stageId: stage.id,
      pipelineId: stage.pipelineId,
      position,
      status,
      ...(status !== deal.status ? { closedAt: status === "OPEN" ? null : new Date() } : {}),
    },
  });
  if (!stageChanged) return;

  const from = await tdb.stage.findUnique({ where: { id: deal.stageId }, select: { name: true } });
  const base = { orgId: deal.orgId, dealId: deal.id, contactId: deal.contactId, actorId };
  const entries: ActivityInput[] = [{ ...base, type: "deal.stage_changed", data: { title: deal.title, from: from?.name ?? null, to: stage.name } }];
  if (status !== deal.status) {
    entries.push({ ...base, type: status === "WON" ? "deal.won" : status === "LOST" ? "deal.lost" : "deal.reopened", data: { title: deal.title, value: deal.value.toNumber(), currency: deal.currency } });
  }
  await logActivity(entries);
  const payload = { deal: { id: deal.id, title: deal.title, value: deal.value.toNumber(), currency: deal.currency, contact_id: deal.contactId }, from: from?.name ?? null, to: stage.name, status };
  await emitEvent(deal.orgId, "deal.stage_changed", payload);
  if (status === "WON" && deal.status !== "WON") await emitEvent(deal.orgId, "deal.won", payload);
}
