import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { DEMO_ACCOUNTS, DEMO_PASSWORD, isDemo } from "@/lib/demo/mode";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  const t = await getTranslations("auth");
  const demo = isDemo() ? DEMO_ACCOUNTS.map((a) => ({ key: a.key, email: a.email, password: DEMO_PASSWORD, next: a.key === "admin" ? "/admin" : "/app" })) : undefined;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t("signInTitle")}</CardTitle>
        <CardDescription>{t("signInSubtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Suspense>
          <LoginForm demo={demo} />
        </Suspense>
      </CardContent>
      {!demo && (
        <CardFooter className="justify-center text-sm text-muted-foreground">
          {t("noAccount")}&nbsp;
          <Link href="/register" className="font-medium text-foreground hover:underline">
            {t("createAccount")}
          </Link>
        </CardFooter>
      )}
    </Card>
  );
}
