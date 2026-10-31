import { NextResponse } from "next/server";
import { ApiError, clientIp, parseBody, requireApiOrg, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { campaignData } from "@/lib/campaigns/refs";
import { campaignBodySchema } from "@/lib/campaigns/schema";
import { launchProblems } from "@/lib/campaigns/validate";
import { campaignInclude, campaignStats, campaignView } from "@/lib/campaigns/view";
import { publish } from "@/lib/realtime";
import { orgDb } from "@/lib/tenancy";
import { Prisma } from "@/generated/prisma/client";

type Ctx = RouteContext<"/api/campaigns/[id]">;

export const GET = route<Ctx>(async (_req, ctx) => {
  const session = await requireApiOrg("AGENT");
  const { id } = await ctx.params;
  const tdb = orgDb(session.org.id);
  const campaign = await tdb.campaign.findUnique({ where: { id }, include: campaignInclude });
  if (!campaign) throw new ApiError(404, "Campaign not found.");
  const stats = (await campaignStats([id])).get(id);
  // Drafts also report what still blocks launching and the live audience size
  const readiness = campaign.status === "DRAFT" ? await launchProblems(tdb, campaign) : null;
  return NextResponse.json({ campaign: campaignView(campaign, stats), readiness });
});

/** Edit a draft */
export const PATCH = route<Ctx>(async (req, ctx) => {
  const session = await requireApiOrg("ADMIN");
  const { id } = await ctx.params;
  const input = await parseBody(req, campaignBodySchema.partial());
  const tdb = orgDb(session.org.id);
  const current = await tdb.campaign.findUnique({ where: { id } });
  if (!current) throw new ApiError(404, "Campaign not found.");
  if (current.status !== "DRAFT") throw new ApiError(409, "Only drafts can be edited. Unschedule the campaign first.");
  // The channel rules in campaignData need the number even when it isn't changing
  const data = await campaignData(tdb, session.org.id, { accountId: current.accountId, ...input });
  await tdb.campaign.update({
    where: { id },
    data: {
      ...data,
      ...(data.templateParams === undefined && input.templateParams === null ? { templateParams: Prisma.DbNull } : {}),
      ...(input.media === null ? { media: Prisma.DbNull } : {}),
    },
  });
  await publish(`org:${session.org.id}`, "campaign.updated", { campaignId: id });
  const campaign = await tdb.campaign.findUniqueOrThrow({ where: { id }, include: campaignInclude });
  return NextResponse.json({ campaign: campaignView(campaign), readiness: await launchProblems(tdb, campaign) });
});

/** Drafts and finished campaigns can be deleted (with their recipient list, not the messages) */
export const DELETE = route<Ctx>(async (req, ctx) => {
  const session = await requireApiOrg("ADMIN");
  const { id } = await ctx.params;
  const tdb = orgDb(session.org.id);
  const campaign = await tdb.campaign.findUnique({ where: { id } });
  if (!campaign) throw new ApiError(404, "Campaign not found.");
  if (!["DRAFT", "COMPLETED", "CANCELLED"].includes(campaign.status)) throw new ApiError(409, "Pause or cancel the campaign before deleting it.");
  await tdb.campaign.delete({ where: { id } });
  await audit({ action: "campaign.deleted", orgId: session.org.id, userId: session.user.id, targetType: "campaign", targetId: id, meta: { name: campaign.name }, ip: clientIp(req) });
  await publish(`org:${session.org.id}`, "campaign.updated", { campaignId: id });
  return NextResponse.json({ ok: true });
});
