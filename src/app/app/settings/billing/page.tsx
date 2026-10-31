import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireOrg } from "@/lib/auth/session";
import { getBilling } from "@/lib/settings";
import { BillingSettings } from "./billing-settings";

export const metadata: Metadata = { title: "Billing" };

export default async function BillingPage() {
  await requireOrg("ADMIN");
  if (!(await getBilling()).enabled) redirect("/app/settings");
  return <BillingSettings />;
}
