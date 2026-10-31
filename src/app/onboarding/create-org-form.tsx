"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Field, FormMessage } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/client/api-client";

export function CreateOrgForm() {
  const t = useTranslations("onboarding");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await apiFetch("/api/orgs", { body: { name: new FormData(e.currentTarget).get("orgName") } });
    if (!res.ok) {
      setError(res.error);
      setPending(false);
      return;
    }
    router.replace("/app");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <FormMessage type="error">{error}</FormMessage>
      <Field id="orgName" label={t("orgName")} placeholder={t("orgNamePlaceholder")} required minLength={2} maxLength={80} autoFocus />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? t("creating") : t("create")}
      </Button>
    </form>
  );
}
