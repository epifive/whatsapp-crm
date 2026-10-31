import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth/session";
import { fieldDefs } from "@/lib/crm/contacts";
import { ensureDefaultPipeline, listPipelines } from "@/lib/crm/pipelines";
import { flowView } from "@/lib/flows/schema";
import { orgDb } from "@/lib/tenancy";
import { Builder } from "./builder";

export const metadata: Metadata = { title: "Flow builder" };

export default async function FlowBuilderPage({ params }: PageProps<"/app/automations/[id]">) {
  const session = await requireOrg("ADMIN");
  const { id } = await params;
  const tdb = orgDb(session.org.id);
  const flow = await tdb.flow.findUnique({ where: { id } });
  if (!flow) notFound();
  await ensureDefaultPipeline(tdb, session.org.id);
  const [members, pipelines, tags, fields, accounts, campaigns] = await Promise.all([
    tdb.membership.findMany({ include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } }),
    listPipelines(tdb),
    tdb.tag.findMany({ select: { name: true }, orderBy: { name: "asc" } }),
    fieldDefs(tdb),
    tdb.whatsAppAccount.findMany({ select: { id: true, name: true, channel: true, phone: true, status: true }, orderBy: { createdAt: "asc" } }),
    tdb.campaign.findMany({ where: { status: { not: "DRAFT" } }, select: { id: true, name: true }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  return (
    <Builder
      initialFlow={JSON.parse(JSON.stringify(flowView(flow)))}
      initialGraph={flow.graph as never}
      members={members.map((m) => m.user)}
      pipelines={pipelines}
      tagNames={tags.map((t) => t.name)}
      fields={fields}
      accounts={accounts}
      campaigns={campaigns}
    />
  );
}
