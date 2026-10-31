import { assertFeature } from "@/lib/billing/entitlements";
import { NextResponse } from "next/server";
import { parseBody, requireApiOrg, route } from "@/lib/api";
import { campaignData } from "@/lib/campaigns/refs";
import { campaignBodySchema } from "@/lib/campaigns/schema";
import { campaignInclude, campaignStats, campaignView } from "@/lib/campaigns/view";
import { publish } from "@/lib/realtime";
import { orgDb } from "@/lib/tenancy";
import { Prisma } from "@/generated/prisma/client";

export const GET = route(async () => {
  const session = await requireApiOrg("AGENT");
  const campaigns = await orgDb(session.org.id).campaign.findMany({ include: campaignInclude, orderBy: { createdAt: "desc" }, take: 200 });
  const stats = await campaignStats(campaigns.map((c) => c.id));
  return NextResponse.json({ campaigns: campaigns.map((c) => campaignView(c, stats.get(c.id))) });
});

/** New campaign (saved as a draft) */
export const POST = route(async (req) => {
  const session = await requireApiOrg("ADMIN");
  const input = await parseBody(req, campaignBodySchema);
  await assertFeature(session.org.id, "campaigns");
  const tdb = orgDb(session.org.id);
  const data = await campaignData(tdb, session.org.id, input);
  const campaign = await tdb.campaign.create({
    data: {
      orgId: session.org.id,
      createdById: session.user.id,
      name: input.name,
      accountId: input.accountId,
      audience: input.audience,
      ...data,
      templateParams: data.templateParams ?? Prisma.DbNull,
      media: data.media ?? Prisma.DbNull,
    },
    include: campaignInclude,
  });
  await publish(`org:${session.org.id}`, "campaign.updated", { campaignId: campaign.id });
  return NextResponse.json({ campaign: campaignView(campaign) }, { status: 201 });
});
