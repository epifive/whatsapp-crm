"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useState } from "react";
import { Field, FormMessage } from "@/components/forms";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/client/api-client";
import { PASSWORD_MIN_LENGTH } from "@/lib/validation";

function ResetForm() {
  const t = useTranslations("auth");
  const token = useSearchParams().get("token") ?? "";
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    if (form.get("password") !== form.get("confirm")) return setError(t("passwordsDontMatch"));
    setPending(true);
    setError(null);
    const res = await apiFetch("/api/auth/reset-password", { body: { token, password: form.get("password") } });
    setPending(false);
    if (!res.ok) return setError(res.error);
    setDone(true);
  }

  if (!token) return <FormMessage type="error">{t("resetLinkMissing")}</FormMessage>;
  if (done) {
    return (
      <div className="grid gap-4">
        <FormMessage type="success">{t("resetDone")}</FormMessage>
        <Link href="/login" className={buttonVariants({ className: "w-full" })}>
          {t("signIn")}
        </Link>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <FormMessage type="error">{error}</FormMessage>
      <Field
        id="password"
        type="password"
        label={t("newPassword")}
        autoComplete="new-password"
        required
        minLength={PASSWORD_MIN_LENGTH}
        hint={t("passwordHint", { min: PASSWORD_MIN_LENGTH })}
        autoFocus
      />
      <Field id="confirm" type="password" label={t("confirmPassword")} autoComplete="new-password" required />
      <Button type="submit" disabled={pending} className="w-full">
        {t("setNewPassword")}
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  const t = useTranslations("auth");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{t("resetTitle")}</CardTitle>
        <CardDescription>{t("resetSubtitle")}</CardDescription>
      </CardHeader>
      <CardContent>
        <Suspense>
          <ResetForm />
        </Suspense>
      </CardContent>
    </Card>
  );
}
