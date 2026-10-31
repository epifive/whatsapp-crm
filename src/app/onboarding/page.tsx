import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Brand } from "@/components/brand";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { getBranding } from "@/lib/settings";
import { CreateOrgForm } from "./create-org-form";

export const metadata: Metadata = { title: "Create your workspace" };

export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  const session = await requireUser();
  const { new: wantsNew } = await searchParams;
  // Users who already belong to an organization only come here to add another one
  if (session.org && !wantsNew) redirect("/app");

  const [t, brand] = await Promise.all([getTranslations("onboarding"), getBranding()]);
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-muted/40 px-4 py-10">
      <Brand appName={brand.appName} logoUrl={brand.logoUrl} className="mb-8 text-lg" />
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">{t("title")}</CardTitle>
          <CardDescription>{t("subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <CreateOrgForm />
        </CardContent>
      </Card>
    </main>
  );
}
