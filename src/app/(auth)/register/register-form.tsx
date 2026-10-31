"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Field, FormMessage } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/client/api-client";
import { PASSWORD_MIN_LENGTH } from "@/lib/validation";

export function RegisterForm() {
  const t = useTranslations("auth");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const res = await apiFetch("/api/auth/register", {
      body: { name: form.get("name"), email: form.get("email"), password: form.get("password") },
    });
    if (!res.ok) {
      setError(res.error);
      setPending(false);
      return;
    }
    router.replace("/verify-email");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <FormMessage type="error">{error}</FormMessage>
      <Field id="name" label={t("name")} autoComplete="name" required autoFocus maxLength={100} />
      <Field id="email" type="email" label={t("email")} autoComplete="email" required />
      <Field
        id="password"
        type="password"
        label={t("password")}
        autoComplete="new-password"
        required
        minLength={PASSWORD_MIN_LENGTH}
        hint={t("passwordHint", { min: PASSWORD_MIN_LENGTH })}
      />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? t("creatingAccount") : t("createAccount")}
      </Button>
    </form>
  );
}
