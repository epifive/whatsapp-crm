import type { Metadata } from "next";
import { requireOrg, roleAtLeast } from "@/lib/auth/session";
import { SUGGESTED_MODELS } from "@/lib/ai/providers";
import { AiSettings } from "./ai-settings";

export const metadata: Metadata = { title: "AI assistant" };

export default async function AiSettingsPage() {
  const session = await requireOrg();
  return <AiSettings canManage={roleAtLeast(session.role, "ADMIN")} suggestedModels={SUGGESTED_MODELS} />;
}
