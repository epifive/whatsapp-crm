import type { Metadata } from "next";
import { requireOrg, roleAtLeast } from "@/lib/auth/session";
import { orgDb } from "@/lib/tenancy";
import { TagsManager } from "./tags-manager";

export const metadata: Metadata = { title: "Tags" };

export default async function TagsPage() {
  const session = await requireOrg();
  const tags = await orgDb(session.org.id).tag.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { contacts: true } } } });
  return (
    <TagsManager
      initial={tags.map((t) => ({ id: t.id, name: t.name, color: t.color, contacts: t._count.contacts }))}
      canManage={roleAtLeast(session.role, "ADMIN")}
    />
  );
}
