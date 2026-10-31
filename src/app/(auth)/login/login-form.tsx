"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Field, FormMessage } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { apiFetch, safeNextPath } from "@/lib/client/api-client";

export interface DemoLogin {
  key: string;
  email: string;
  password: string;
  next: string;
}

export function LoginForm({ demo }: { demo?: DemoLogin[] }) {
  const t = useTranslations("auth");
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function signIn(email: FormDataEntryValue | null, password: FormDataEntryValue | null, next?: string) {
    setPending(true);
    setError(null);
    const res = await apiFetch<{ verified: boolean }>("/api/auth/login", { body: { email, password } });
    if (!res.ok) {
      setError(res.error);
      setPending(false);
      return;
    }
    router.replace(res.data?.verified ? (next ?? safeNextPath(params.get("next"))) : "/verify-email");
    router.refresh();
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    void signIn(form.get("email"), form.get("password"));
  }

  return (
    <div className="grid gap-6">
      {demo && (
        <div className="grid gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
          <p className="text-sm font-medium">{t("demoTitle")}</p>
          <div className="grid gap-2">
            {demo.map((d) => (
              <Button key={d.key} type="button" variant="outline" disabled={pending} onClick={() => void signIn(d.email, d.password, d.next)} className="h-auto justify-between gap-2 py-2">
                <span className="font-medium">{t(`demoAccount.${d.key}`)}</span>
                <span className="truncate text-xs font-normal text-muted-foreground">{d.email}</span>
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{t("demoPassword", { password: demo[0]?.password ?? "" })}</p>
        </div>
      )}
      <form onSubmit={onSubmit} className="grid gap-4">
        <FormMessage type="error">{error}</FormMessage>
        <Field id="email" type="email" label={t("email")} autoComplete="email" required autoFocus={!demo} />
        <div className="grid gap-1.5">
          <Field id="password" type="password" label={t("password")} autoComplete="current-password" required />
          {!demo && (
            <Link href="/forgot-password" className="justify-self-end text-xs text-muted-foreground hover:text-foreground">
              {t("forgotPassword")}
            </Link>
          )}
        </div>
        <Button type="submit" disabled={pending} className="w-full">
          {pending ? t("signingIn") : t("signIn")}
        </Button>
      </form>
    </div>
  );
}
