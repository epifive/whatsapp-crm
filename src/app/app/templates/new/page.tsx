import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/auth/session";
import { orgDb } from "@/lib/tenancy";
import { TEMPLATE_LANGUAGES } from "@/lib/whatsapp/templates";
import { TemplateBuilder } from "./template-builder";

export const metadata: Metadata = { title: "New template" };

export default async function NewTemplatePage({ searchParams }: PageProps<"/app/templates/new">) {
  const session = await requireOrg("ADMIN");
  const sp = await searchParams;
  const accounts = await orgDb(session.org.id).whatsAppAccount.findMany({ where: { channel: "OFFICIAL" }, select: { id: true, name: true, phone: true }, orderBy: { createdAt: "asc" } });
  if (!accounts.length) redirect("/app/templates");
  const requested = typeof sp.account === "string" ? sp.account : "";
  return <TemplateBuilder accounts={accounts} initialAccountId={accounts.some((a) => a.id === requested) ? requested : accounts[0]!.id} languages={[...TEMPLATE_LANGUAGES]} />;
}
