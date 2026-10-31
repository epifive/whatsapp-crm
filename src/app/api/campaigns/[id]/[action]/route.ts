import { assertFeature, assertLimit } from "@/lib/billing/entitlements";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, clientIp, requireApiOrg, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { launchProblems } from "@/lib/campaigns/validate";
import { campaignInclude, campaignView } from "@/lib/campaigns/view";
import { db } from "@/lib/db";
import { publish } from "@/lib/realtime";
import { orgDb } from "@/lib/tenancy";
import { Prisma } from "@/generated/prisma/client";
import { scheduleDispatch } from "@/server/jobs/campaigns";
import { enqueue, QUEUES } from "@/server/queue";

const launchBody = z.object({ scheduledAt: z.coerce.date().nullable().optional() });

/**
 * POST /api/campaigns/:id/launch      { scheduledAt? } send now or at a time
 * POST /api/campaigns/:id/unschedule  back to draft
 * POST /api/campaigns/:id/pause | resume | cancel
 * POST /api/campaigns/:id/retry       send again to recipients whose message failed
 * POST /api/campaigns/:id/duplicate   copy as a new draft
 */
export const POST = route<RouteContext<"/api/campaigns/[id]/[action]">>(async (req, ctx) => {
  const session = await requireApiOrg("ADMIN");
  const { id, action } = await ctx.params;
  const tdb = orgDb(session.org.id);
  const campaign = await tdb.campaign.findUnique({ where: { id } });
  if (!campaign) throw new ApiError(404, "Campaign not found.");
  const transition = async (from: string[], data: Prisma.CampaignUpdateManyMutationInput, conflict: string) => {
    const { count } = await tdb.campaign.updateMany({ where: { id, status: { in: from as never } }, data });
    if (!count) throw new ApiError(409, conflict);
  };

  let newId: string | undefined;
  if (action === "launch") {
    const { scheduledAt } = launchBody.parse(await req.json().catch(() => ({})));
    if (scheduledAt && scheduledAt.getTime() < Date.now() - 60_000) throw new ApiError(400, "Choose a time in the future.");
    const { problems } = await launchProblems(tdb, campaign);
    if (problems.length) throw new ApiError(400, problems[0]!, "not_ready");
    const ent = await assertFeature(session.org.id, "campaigns");
    await assertLimit(session.org.id, "campaignsPerMonth", 1, ent);
    await transition(["DRAFT"], { status: "SCHEDULED", scheduledAt: scheduledAt ?? null, statusMessage: null }, "This campaign was already launched.");
    const later = scheduledAt && scheduledAt.getTime() > Date.now();
    await enqueue(QUEUES.campaignStart, { campaignId: id }, { singletonKey: id, ...(later ? { startAfter: scheduledAt } : {}) });
  } else if (action === "unschedule") {
    await transition(["SCHEDULED"], { status: "DRAFT", scheduledAt: null }, "The campaign has already started.");
  } else if (action === "pause") {
    await transition(["RUNNING"], { status: "PAUSED", statusMessage: null }, "Only a running campaign can be paused.");
  } else if (action === "resume") {
    await transition(["PAUSED"], { status: "RUNNING", statusMessage: null }, "Only a paused campaign can be resumed.");
    await scheduleDispatch(id);
  } else if (action === "cancel") {
    await transition(["SCHEDULED", "RUNNING", "PAUSED"], { status: "CANCELLED", completedAt: new Date(), statusMessage: null }, "This campaign has already finished.");
    // Messages already handed to WhatsApp can't be recalled; the rest are not sent
    await db.campaignRecipient.updateMany({ where: { campaignId: id, status: "PENDING" }, data: { status: "SKIPPED", error: "Campaign cancelled." } });
  } else if (action === "retry") {
    if (!["RUNNING", "PAUSED", "COMPLETED"].includes(campaign.status)) throw new ApiError(409, "Only started campaigns can retry failed messages.");
    const { count } = await db.campaignRecipient.updateMany({ where: { campaignId: id, status: "FAILED" }, data: { status: "PENDING", error: null, messageId: null } });
    if (!count) throw new ApiError(400, "There are no failed messages to retry.");
    await tdb.campaign.update({ where: { id }, data: { status: "RUNNING", completedAt: null, statusMessage: null } });
    await scheduleDispatch(id);
  } else if (action === "duplicate") {
    const copy = await tdb.campaign.create({
      data: {
        orgId: session.org.id,
        createdById: session.user.id,
        name: `${campaign.name} (copy)`.slice(0, 120),
        accountId: campaign.accountId,
        audience: campaign.audience as Prisma.InputJsonValue,
        segmentId: campaign.segmentId,
        templateId: campaign.templateId,
        templateParams: (campaign.templateParams as Prisma.InputJsonValue) ?? Prisma.DbNull,
        body: campaign.body,
        media: (campaign.media as Prisma.InputJsonValue) ?? Prisma.DbNull,
      },
    });
    newId = copy.id;
  } else {
    throw new ApiError(404, "Unknown action.");
  }

  await audit({ action: `campaign.${action}`, orgId: session.org.id, userId: session.user.id, targetType: "campaign", targetId: id, ip: clientIp(req) });
  await publish(`org:${session.org.id}`, "campaign.updated", { campaignId: newId ?? id });
  const updated = await tdb.campaign.findUniqueOrThrow({ where: { id: newId ?? id }, include: campaignInclude });
  return NextResponse.json({ campaign: campaignView(updated) });
});
