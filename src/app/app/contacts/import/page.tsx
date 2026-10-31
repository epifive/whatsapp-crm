import type { Metadata } from "next";
import { requireOrg } from "@/lib/auth/session";
import { fieldDefs } from "@/lib/crm/contacts";
import { importView } from "@/lib/crm/imports";
import { orgDb } from "@/lib/tenancy";
import { ImportWizard } from "./import-wizard";

export const metadata: Metadata = { title: "Import contacts" };

export default async function ImportPage() {
  const session = await requireOrg("ADMIN");
  const tdb = orgDb(session.org.id);
  const [fields, recent] = await Promise.all([
    fieldDefs(tdb),
    tdb.contactImport.findMany({ where: { status: { not: "DRAFT" } }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  return <ImportWizard fields={fields} recent={JSON.parse(JSON.stringify(recent.map(importView)))} />;
}
