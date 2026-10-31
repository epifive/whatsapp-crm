import type { Metadata } from "next";
import { requireOrg, roleAtLeast } from "@/lib/auth/session";
import { orgDb } from "@/lib/tenancy";
import { TemplatesManager } from "./templates-manager";

export const metadata: Metadata = { title: "Templates" };

export default async function TemplatesPage({ searchParams }: PageProps<"/app/templates">) {
  const session = await requireOrg();
  const sp = await searchParams;
  const accounts = await orgDb(session.org.id).whatsAppAccount.findMany({
    where: { channel: "OFFICIAL" },
    select: { id: true, name: true, phone: true },
    orderBy: { createdAt: "asc" },
  });
  const requested = typeof sp.account === "string" ? sp.account : "";
  return (
    <TemplatesManager
      accounts={accounts}
      initialAccountId={accounts.some((a) => a.id === requested) ? requested : (accounts[0]?.id ?? "")}
      canManage={roleAtLeast(session.role, "ADMIN")}
    />
  );
}
