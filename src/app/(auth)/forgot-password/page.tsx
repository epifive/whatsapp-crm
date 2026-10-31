"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Field, FormMessage } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/client/api-client";

export default function ForgotPasswordPage() {
  const t = useTranslations("auth");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await apiFetch("/api/auth/forgot-password", { body: { email: new FormData(e.currentTarget).get("email") } });
    setPending(false);
    if (!res.ok) return setError(res.error);
    setSent(true);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t("forgotTitle")}</CardTitle>
        <CardDescription>{t("forgotSubtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        {sent ? (
          <FormMessage type="success">{t("forgotSent")}</FormMessage>
        ) : (
          <form onSubmit={onSubmit} className="grid gap-4">
            <FormMessage type="error">{error}</FormMessage>
            <Field id="email" type="email" label={t("email")} autoComplete="email" required autoFocus />
            <Button type="submit" disabled={pending} className="w-full">
              {t("sendResetLink")}
            </Button>
          </form>
        )}
      </CardContent>
      <CardFooter className="justify-center text-sm">
        <Link href="/login" className="text-muted-foreground hover:text-foreground">
          {t("backToSignIn")}
        </Link>
      </CardFooter>
    </Card>
  );
}
