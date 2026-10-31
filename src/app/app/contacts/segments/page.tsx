import type { Metadata } from "next";
import { requireOrg, roleAtLeast } from "@/lib/auth/session";
import { fieldDefs } from "@/lib/crm/contacts";
import { orgDb } from "@/lib/tenancy";
import { SegmentsManager } from "./segments-manager";

export const metadata: Metadata = { title: "Segments" };

export default async function SegmentsPage() {
  const session = await requireOrg();
  const tdb = orgDb(session.org.id);
  const [fields, tags, members] = await Promise.all([
    fieldDefs(tdb),
    tdb.tag.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, color: true } }),
    tdb.membership.findMany({ include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } }),
  ]);
  return <SegmentsManager fields={fields} tags={tags} members={members.map((m) => m.user)} canManage={roleAtLeast(session.role, "ADMIN")} />;
}
