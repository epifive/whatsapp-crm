import type { Metadata } from "next";
import { requireOrg } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { DevelopersSettings } from "./developers-settings";

export const metadata: Metadata = { title: "Developers" };

export default async function DevelopersPage() {
  await requireOrg("ADMIN");
  return <DevelopersSettings baseUrl={env().APP_URL} />;
}
