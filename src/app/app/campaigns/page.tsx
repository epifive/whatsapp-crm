import type { Metadata } from "next";
import { requireOrg, roleAtLeast } from "@/lib/auth/session";
import { orgDb } from "@/lib/tenancy";
import { CampaignsList } from "./campaigns-list";

export const metadata: Metadata = { title: "Campaigns" };

export default async function CampaignsPage() {
  const session = await requireOrg();
  const accounts = await orgDb(session.org.id).whatsAppAccount.findMany({ select: { id: true, name: true, phone: true, channel: true }, orderBy: { createdAt: "asc" } });
  return <CampaignsList accounts={accounts} canManage={roleAtLeast(session.role, "ADMIN")} />;
}
