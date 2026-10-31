"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Field, FormMessage } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/client/api-client";

export function OrganizationForm({
  org,
  timezones,
  currencies,
  canEdit,
}: {
  org: { name: string; timezone: string; currency: string; slug: string };
  timezones: string[];
  currencies: string[];
  canEdit: boolean;
}) {
  const t = useTranslations("settings");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const res = await apiFetch("/api/orgs", { method: "PATCH", body: { name: form.get("orgName"), timezone: form.get("timezone"), currency: form.get("currency") } });
    setPending(false);
    if (!res.ok) return setError(res.error);
    toast.success(t("saved"));
    router.refresh();
  }

  return (
    <Card>
      <form onSubmit={onSubmit}>
        <CardHeader>
          <CardTitle>{t("organization")}</CardTitle>
          <CardDescription>{canEdit ? t("organizationText") : t("readOnly")}</CardDescription>
        </CardHeader>
        <CardContent className="grid max-w-md gap-4">
          <FormMessage type="error">{error}</FormMessage>
          <Field id="orgName" label={t("orgName")} defaultValue={org.name} required minLength={2} maxLength={80} disabled={!canEdit} />
          <div className="grid gap-1.5">
            <Label htmlFor="timezone">{t("timezone")}</Label>
            <select
              id="timezone"
              name="timezone"
              defaultValue={org.timezone}
              disabled={!canEdit}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
            >
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="currency">{t("currency")}</Label>
            <select
              id="currency"
              name="currency"
              defaultValue={org.currency}
              disabled={!canEdit}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
            >
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">{t("currencyHint")}</p>
          </div>
        </CardContent>
        {canEdit && (
          <CardFooter className="mt-6">
            <Button type="submit" disabled={pending}>
              {t("save")}
            </Button>
          </CardFooter>
        )}
      </form>
    </Card>
  );
}
