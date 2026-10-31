import type { Metadata } from "next";
import { requireOrg, roleAtLeast } from "@/lib/auth/session";
import { CURRENCIES } from "@/lib/crm/pipelines";
import { db } from "@/lib/db";
import { OrganizationForm } from "./organization-form";

export const metadata: Metadata = { title: "Organization settings" };

export default async function OrganizationSettingsPage() {
  const session = await requireOrg();
  const org = await db.organization.findUniqueOrThrow({ where: { id: session.org.id } });
  return (
    <OrganizationForm
      org={{ name: org.name, timezone: org.timezone, currency: org.currency, slug: org.slug }}
      // The runtime's list may use an older alias (Asia/Calcutta); keep the saved zone selectable
      timezones={[...new Set([org.timezone, ...Intl.supportedValuesOf("timeZone")])].sort()}
      currencies={[...CURRENCIES]}
      canEdit={roleAtLeast(session.role, "ADMIN")}
    />
  );
}
