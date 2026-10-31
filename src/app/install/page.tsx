import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Brand } from "@/components/brand";
import { isInstalled } from "@/lib/install-state";
import { DEFAULT_BRANDING } from "@/lib/settings";
import { InstallWizard } from "./install-wizard";

export const metadata: Metadata = { title: "Install" };

export default function InstallPage() {
  if (isInstalled()) redirect("/login");
  return (
    <main className="flex min-h-screen flex-col items-center bg-muted/40 px-4 py-10">
      <Brand appName={DEFAULT_BRANDING.appName} className="mb-8 text-lg" />
      <div className="w-full max-w-xl">
        <InstallWizard />
      </div>
    </main>
  );
}
