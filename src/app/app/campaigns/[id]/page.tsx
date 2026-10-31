import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOrg, roleAtLeast } from "@/lib/auth/session";
import { launchProblems } from "@/lib/campaigns/validate";
import { campaignInclude, campaignStats, campaignView } from "@/lib/campaigns/view";
import { fieldDefs } from "@/lib/crm/contacts";
import { orgDb } from "@/lib/tenancy";
import { templateSpec } from "@/lib/whatsapp/templates";
import { CampaignPage } from "./campaign-page";

export const metadata: Metadata = { title: "Campaign" };

export default async function Page({ params }: PageProps<"/app/campaigns/[id]">) {
  const session = await requireOrg();
  const { id } = await params;
  const tdb = orgDb(session.org.id);
  const campaign = await tdb.campaign.findUnique({ where: { id }, include: campaignInclude });
  if (!campaign) notFound();
  const [stats, readiness, accounts, segments, tags, fields, templates, canned] = await Promise.all([
    campaignStats([id]),
    campaign.status === "DRAFT" ? launchProblems(tdb, campaign) : Promise.resolve(null),
    tdb.whatsAppAccount.findMany({ select: { id: true, name: true, phone: true, channel: true, status: true, minDelaySec: true, maxDelaySec: true }, orderBy: { createdAt: "asc" } }),
    tdb.segment.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    tdb.tag.findMany({ select: { id: true, name: true, color: true }, orderBy: { name: "asc" } }),
    fieldDefs(tdb),
    tdb.template.findMany({ where: { status: "APPROVED" }, orderBy: [{ name: "asc" }, { language: "asc" }] }),
    tdb.cannedResponse.findMany({ select: { id: true, title: true, body: true }, orderBy: { shortcut: "asc" } }),
  ]);
  const json = <T,>(v: T) => JSON.parse(JSON.stringify(v));
  return (
    <CampaignPage
      initial={json(campaignView(campaign, stats.get(id)))}
      initialReadiness={readiness}
      accounts={accounts}
      segments={segments}
      tags={tags}
      fields={fields}
      templates={templates.map((t) => ({ id: t.id, accountId: t.accountId, name: t.name, language: t.language, components: json(t.components), spec: templateSpec(t.components) }))}
      canned={canned}
      canManage={roleAtLeast(session.role, "ADMIN")}
    />
  );
}
