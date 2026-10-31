import type { Metadata } from "next";
import { requireOrg, roleAtLeast } from "@/lib/auth/session";
import { fieldDefs } from "@/lib/crm/contacts";
import { orgDb } from "@/lib/tenancy";
import { ContactsView } from "./contacts-view";

export const metadata: Metadata = { title: "Contacts" };

export default async function ContactsPage({ searchParams }: PageProps<"/app/contacts">) {
  const session = await requireOrg();
  const tdb = orgDb(session.org.id);
  const sp = await searchParams;
  const [tags, segments, members, fields] = await Promise.all([
    tdb.tag.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, color: true } }),
    tdb.segment.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    tdb.membership.findMany({ include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } }),
    fieldDefs(tdb),
  ]);
  return (
    <ContactsView
      tags={tags}
      segments={segments}
      members={members.map((m) => m.user)}
      fields={fields}
      meId={session.user.id}
      isAdmin={roleAtLeast(session.role, "ADMIN")}
      initialSegmentId={typeof sp.segment === "string" ? sp.segment : ""}
      initialTagId={typeof sp.tag === "string" ? sp.tag : ""}
    />
  );
}
