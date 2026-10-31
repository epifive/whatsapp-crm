import type { Metadata } from "next";
import { requireOrg, roleAtLeast } from "@/lib/auth/session";
import { orgDb } from "@/lib/tenancy";
import { FieldsManager } from "./fields-manager";

export const metadata: Metadata = { title: "Custom fields" };

export default async function FieldsPage() {
  const session = await requireOrg();
  const fields = await orgDb(session.org.id).customField.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
  return (
    <FieldsManager
      initial={fields.map(({ id, key, label, type, options }) => ({ id, key, label, type, options }))}
      canManage={roleAtLeast(session.role, "ADMIN")}
    />
  );
}
