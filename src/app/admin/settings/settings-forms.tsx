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

function useSave(key: string) {
  const t = useTranslations("admin");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function save(body: unknown) {
    setPending(true);
    setError(null);
    const res = await apiFetch(`/api/admin/settings/${key}`, { method: "PUT", body });
    setPending(false);
    if (!res.ok) return setError(res.error);
    toast.success(t("saved"));
    router.refresh();
  }
  return { save, error, pending };
}

export function BrandingForm({
  initial,
}: {
  initial: { appName: string; logoUrl: string | null; faviconUrl: string | null; primaryColor: string; supportEmail: string | null };
}) {
  const t = useTranslations("admin");
  const { save, error, pending } = useSave("branding");
  return (
    <Card>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          save({ appName: f.get("appName"), logoUrl: f.get("logoUrl") || null, faviconUrl: f.get("faviconUrl") || null, primaryColor: f.get("primaryColor"), supportEmail: f.get("supportEmail") || null });
        }}
      >
        <CardHeader>
          <CardTitle>{t("branding")}</CardTitle>
          <CardDescription>{t("brandingText")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormMessage type="error">{error}</FormMessage>
          <Field id="appName" label={t("appName")} defaultValue={initial.appName} required maxLength={60} />
          <Field id="supportEmail" type="email" label={t("supportEmail")} defaultValue={initial.supportEmail ?? ""} />
          <Field id="logoUrl" label={t("logoUrl")} defaultValue={initial.logoUrl ?? ""} placeholder="https://…/logo.png" hint={t("logoHint")} />
          <Field id="faviconUrl" label={t("faviconUrl")} defaultValue={initial.faviconUrl ?? ""} placeholder="https://…/favicon.png" hint={t("faviconHint")} />
          <div className="grid gap-1.5">
            <Label htmlFor="primaryColor">{t("primaryColor")}</Label>
            <input id="primaryColor" name="primaryColor" type="color" defaultValue={initial.primaryColor} className="h-9 w-20 cursor-pointer rounded-md border" />
          </div>
        </CardContent>
        <CardFooter className="mt-6">
          <Button type="submit" disabled={pending}>
            {t("save")}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

export function SmtpForm({
  initial,
}: {
  initial: { host: string; port: number; secure: boolean; user: string; fromName: string; fromEmail: string; hasPassword: boolean };
}) {
  const t = useTranslations("admin");
  const { save, error, pending } = useSave("smtp");
  const [testing, setTesting] = useState(false);

  async function sendTest() {
    setTesting(true);
    const res = await apiFetch<{ to: string }>("/api/admin/smtp-test", { method: "POST", body: {} });
    setTesting(false);
    if (res.ok) toast.success(t("testSent", { email: res.data?.to ?? "" }));
    else toast.error(res.error);
  }

  return (
    <Card>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          save({
            host: f.get("host"),
            port: Number(f.get("port")),
            secure: f.get("secure") === "on",
            user: f.get("smtpUser"),
            password: f.get("smtpPassword") ?? "",
            fromName: f.get("fromName"),
            fromEmail: f.get("fromEmail"),
          });
        }}
      >
        <CardHeader>
          <CardTitle>{t("smtp")}</CardTitle>
          <CardDescription>{t("smtpText")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormMessage type="error">{error}</FormMessage>
          <Field id="host" label={t("smtpHost")} defaultValue={initial.host} placeholder="smtp.gmail.com" />
          <Field id="port" type="number" label={t("smtpPort")} defaultValue={initial.port} min={1} max={65535} />
          <Field id="smtpUser" label={t("smtpUser")} defaultValue={initial.user} autoComplete="off" />
          <Field
            id="smtpPassword"
            type="password"
            label={t("smtpPassword")}
            autoComplete="new-password"
            placeholder={initial.hasPassword ? "••••••••" : ""}
            hint={initial.hasPassword ? t("passwordKept") : undefined}
          />
          <Field id="fromName" label={t("fromName")} defaultValue={initial.fromName} required />
          <Field id="fromEmail" type="email" label={t("fromEmail")} defaultValue={initial.fromEmail} required />
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="secure" defaultChecked={initial.secure} className="size-4 accent-[var(--primary)]" />
            {t("smtpSecure")}
          </label>
        </CardContent>
        <CardFooter className="mt-6 flex flex-wrap gap-2">
          <Button type="submit" disabled={pending}>
            {t("save")}
          </Button>
          <Button type="button" variant="outline" onClick={sendTest} disabled={testing}>
            {t("sendTest")}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
