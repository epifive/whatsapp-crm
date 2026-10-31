import type { Metadata } from "next";
import { requireOrg, roleAtLeast } from "@/lib/auth/session";
import { orgDb } from "@/lib/tenancy";
import { publicAccount } from "@/lib/whatsapp/accounts";
import { NumbersManager } from "./numbers-manager";

export const metadata: Metadata = { title: "WhatsApp numbers" };

export default async function NumbersPage() {
  const session = await requireOrg();
  const admin = roleAtLeast(session.role, "ADMIN");
  const accounts = await orgDb(session.org.id).whatsAppAccount.findMany({ orderBy: { createdAt: "asc" } });
  return <NumbersManager initial={JSON.parse(JSON.stringify(accounts.map((a) => publicAccount(a, { admin }))))} canManage={admin} />;
}
