import type { Metadata } from "next";
import { requireOrg, roleAtLeast } from "@/lib/auth/session";
import { FlowsList } from "./flows-list";

export const metadata: Metadata = { title: "Automations" };

export default async function AutomationsPage() {
  const session = await requireOrg();
  return <FlowsList canManage={roleAtLeast(session.role, "ADMIN")} />;
}
