import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { MailCheck } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSession } from "@/lib/auth/session";
import { ConfirmToken, ResendButton, SignOutLink } from "./verify-client";

export const metadata: Metadata = { title: "Verify email" };

export default async function VerifyEmailPage({ searchParams }: PageProps<"/verify-email">) {
  const t = await getTranslations("auth");
  const { token } = await searchParams;
  const session = await getSession();

  if (typeof token === "string" && token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{t("verifyTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ConfirmToken token={token} signedIn={!!session} />
        </CardContent>
      </Card>
    );
  }

  if (!session) redirect("/login");
  if (session.user.emailVerifiedAt) redirect("/app");

  return (
    <Card>
      <CardHeader>
        <MailCheck className="mb-2 size-8 text-primary" />
        <CardTitle className="text-xl">{t("checkInboxTitle")}</CardTitle>
        <CardDescription>{t("checkInboxText", { email: session.user.email })}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        <ResendButton />
        <SignOutLink />
      </CardContent>
    </Card>
  );
}
