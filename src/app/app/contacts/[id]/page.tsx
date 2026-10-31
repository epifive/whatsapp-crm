import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOrg, roleAtLeast } from "@/lib/auth/session";
import { contactDetail } from "@/lib/crm/contact-detail";
import { fieldDefs } from "@/lib/crm/contacts";
import { ensureDefaultPipeline, listPipelines } from "@/lib/crm/pipelines";
import { timeline } from "@/lib/crm/timeline";
import { orgDb } from "@/lib/tenancy";
import { ContactProfile } from "./contact-profile";

export const metadata: Metadata = { title: "Contact" };

export default async function ContactPage({ params }: PageProps<"/app/contacts/[id]">) {
  const session = await requireOrg();
  const { id } = await params;
  const tdb = orgDb(session.org.id);
  const detail = await contactDetail(tdb, id);
  if (!detail) notFound();
  await ensureDefaultPipeline(tdb, session.org.id);
  const [fields, members, accounts, pipelines, history, tags] = await Promise.all([
    fieldDefs(tdb),
    tdb.membership.findMany({ include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } }),
    tdb.whatsAppAccount.findMany({ select: { id: true, name: true, phone: true, channel: true, status: true }, orderBy: { createdAt: "asc" } }),
    listPipelines(tdb),
    timeline(tdb, { contactId: id }),
    tdb.tag.findMany({ orderBy: { name: "asc" }, select: { name: true } }),
  ]);
  // Server objects (Dates) go to the client as JSON, the same shape the API returns
  const json = <T,>(v: T) => JSON.parse(JSON.stringify(v));
  return (
    <ContactProfile
      initial={json(detail)}
      initialTimeline={json(history)}
      fields={fields}
      members={members.map((m) => m.user)}
      accounts={accounts}
      pipelines={pipelines}
      tagNames={tags.map((t) => t.name)}
      currency={session.org.currency}
      meId={session.user.id}
      isAdmin={roleAtLeast(session.role, "ADMIN")}
    />
  );
}
