import type { Metadata } from "next";
import { requireOrg, roleAtLeast } from "@/lib/auth/session";
import { orgDb } from "@/lib/tenancy";
import { CannedManager } from "./canned-manager";

export const metadata: Metadata = { title: "Canned replies" };

export default async function CannedPage() {
  const session = await requireOrg();
  const items = await orgDb(session.org.id).cannedResponse.findMany({ orderBy: { shortcut: "asc" } });
  return (
    <CannedManager
      initial={items.map(({ id, shortcut, title, body }) => ({ id, shortcut, title, body }))}
      canManage={roleAtLeast(session.role, "ADMIN")}
    />
  );
}
