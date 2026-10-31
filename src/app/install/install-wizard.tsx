"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Field, FormMessage } from "@/components/forms";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/client/api-client";
import { cn } from "@/lib/utils";

interface Status {
  version: string;
  requirements: { key: string; ok: boolean; detail: string }[];
  databaseFromEnv: boolean;
  appUrl: string;
}

type DbForm = { host: string; port: string; database: string; user: string; password: string; ssl: boolean };

const STEPS = ["requirements", "database", "admin", "done"] as const;
type Step = (typeof STEPS)[number];

export function InstallWizard() {
  const t = useTranslations("install");
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("requirements");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [appUrl, setAppUrl] = useState("");
  const [db, setDb] = useState<DbForm>({ host: "127.0.0.1", port: "5432", database: "", user: "", password: "", ssl: false });
  const [dbInfo, setDbInfo] = useState<{ version: string; ourSchema: boolean; hasAdmin: boolean } | null>(null);
  const [done, setDone] = useState<{ email: string } | null>(null);

  useEffect(() => {
    void apiFetch<Status>("/api/install").then((res) => {
      if (!res.ok) return setLoadError(res.error);
      setStatus(res.data!);
      setAppUrl(res.data!.appUrl);
    });
  }, []);

  const go = (s: Step) => {
    setError(null);
    setStep(s);
  };
  const dbBody = () => (status?.databaseFromEnv ? {} : { database: { ...db, port: Number(db.port) || 5432 } });

  async function checkDatabase() {
    setBusy(true);
    const res = await apiFetch<NonNullable<typeof dbInfo>>("/api/install/database", { body: dbBody() });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setDbInfo(res.data!);
    go("admin");
  }

  async function runInstall(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get("password") !== f.get("password2")) return setError(t("passwordsDiffer"));
    setBusy(true);
    setError(null);
    const res = await apiFetch<{ email: string }>("/api/install", {
      body: {
        ...dbBody(),
        appUrl,
        appName: f.get("appName"),
        admin: { name: f.get("name"), email: f.get("email"), password: f.get("password") },
        demo: f.get("demo") === "on",
      },
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setDone(res.data!);
    go("done");
  }

  if (loadError) {
    return (
      <Card>
        <CardContent>
          <FormMessage type="error">{loadError}</FormMessage>
        </CardContent>
      </Card>
    );
  }
  if (!status) return <Loader2 className="mx-auto size-6 animate-spin text-muted-foreground" />;
  const allOk = status.requirements.every((r) => r.ok);

  return (
    <div className="grid gap-4">
      <ol className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs" aria-label={t("progress")}>
        {STEPS.map((s, i) => (
          <li key={s} className={cn("flex items-center gap-1.5", s === step ? "font-semibold text-foreground" : STEPS.indexOf(step) > i ? "text-primary" : "text-muted-foreground")} aria-current={s === step ? "step" : undefined}>
            <span className={cn("flex size-5 items-center justify-center rounded-full border text-[11px]", STEPS.indexOf(step) > i && "border-primary bg-primary text-primary-foreground")}>{i + 1}</span>
            {t(`step.${s}`)}
          </li>
        ))}
      </ol>

      {step === "requirements" && (
        <Card>
          <CardHeader>
            <CardTitle>{t("welcome", { version: status.version })}</CardTitle>
            <CardDescription>{t("welcomeText")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="grid gap-2">
              {status.requirements.map((r) => (
                <li key={r.key} className="flex items-start gap-2 text-sm">
                  {r.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />}
                  <span className="min-w-0">
                    <span className="font-medium">{t(`req.${r.key}`)}</span>
                    <span className="block break-all text-xs text-muted-foreground">{r.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
            {!allOk && <p className="mt-4 text-sm text-destructive">{t("fixRequirements")}</p>}
          </CardContent>
          <CardFooter className="mt-6 justify-end">
            <Button onClick={() => go("database")} disabled={!allOk}>
              {t("next")}
            </Button>
          </CardFooter>
        </Card>
      )}

      {step === "database" && (
        <Card>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void checkDatabase();
            }}
          >
            <CardHeader>
              <CardTitle>{t("databaseTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <FormMessage type="error">{error}</FormMessage>
              {status.databaseFromEnv ? (
                <p className="text-sm text-muted-foreground sm:col-span-2">{t("databaseFromEnv")}</p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground sm:col-span-2">{t("databaseText")}</p>
                  <Field id="dbHost" label={t("dbHost")} value={db.host} onChange={(e) => setDb({ ...db, host: e.target.value })} required />
                  <Field id="dbPort" label={t("dbPort")} value={db.port} onChange={(e) => setDb({ ...db, port: e.target.value })} inputMode="numeric" required />
                  <Field id="dbName" label={t("dbName")} value={db.database} onChange={(e) => setDb({ ...db, database: e.target.value })} required />
                  <Field id="dbUser" label={t("dbUser")} value={db.user} onChange={(e) => setDb({ ...db, user: e.target.value })} required autoComplete="off" />
                  <Field id="dbPassword" type="password" label={t("dbPassword")} value={db.password} onChange={(e) => setDb({ ...db, password: e.target.value })} autoComplete="new-password" />
                  <label className="flex items-center gap-2 self-end pb-2 text-sm">
                    <input type="checkbox" checked={db.ssl} onChange={(e) => setDb({ ...db, ssl: e.target.checked })} className="size-4 accent-[var(--primary)]" />
                    {t("dbSsl")}
                  </label>
                </>
              )}
            </CardContent>
            <CardFooter className="mt-6 justify-between">
              <Button type="button" variant="ghost" onClick={() => go("requirements")}>
                {t("back")}
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="animate-spin" />}
                {t("testConnection")}
              </Button>
            </CardFooter>
          </form>
        </Card>
      )}

      {step === "admin" && (
        <Card>
          <form onSubmit={runInstall}>
            <CardHeader>
              <CardTitle>{t("adminTitle")}</CardTitle>
              <CardDescription>
                {dbInfo && (dbInfo.ourSchema ? t("databaseExisting", { version: dbInfo.version }) : t("databaseEmpty", { version: dbInfo.version }))}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <FormMessage type="error">{error}</FormMessage>
              <Field id="appName" label={t("appName")} defaultValue="CRM for WhatsApp" required maxLength={60} />
              <Field id="appUrl" label={t("appUrl")} value={appUrl} onChange={(e) => setAppUrl(e.target.value)} required hint={t("appUrlHint")} />
              <Field id="name" label={t("adminName")} required maxLength={100} autoComplete="name" />
              <Field id="email" type="email" label={t("adminEmail")} required autoComplete="email" />
              <Field id="password" type="password" label={t("adminPassword")} required minLength={8} autoComplete="new-password" hint={t("passwordHint")} />
              <Field id="password2" type="password" label={t("adminPassword2")} required minLength={8} autoComplete="new-password" />
              <label className="flex items-start gap-2 text-sm sm:col-span-2">
                <input type="checkbox" name="demo" className="mt-0.5 size-4 accent-[var(--primary)]" />
                <span>
                  <span className="font-medium">{t("demo")}</span>
                  <span className="block text-xs text-muted-foreground">{t("demoHint")}</span>
                </span>
              </label>
            </CardContent>
            <CardFooter className="mt-6 justify-between">
              <Button type="button" variant="ghost" onClick={() => go("database")} disabled={busy}>
                {t("back")}
              </Button>
              <Button type="submit" disabled={busy}>
                {busy && <Loader2 className="animate-spin" />}
                {busy ? t("installing") : t("install")}
              </Button>
            </CardFooter>
          </form>
        </Card>
      )}

      {step === "done" && done && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-primary" />
              {t("doneTitle")}
            </CardTitle>
            <CardDescription>{t("doneText", { email: done.email })}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm">
            <p className="font-medium">{t("nextSteps")}</p>
            <ul className="list-disc space-y-1 ps-5 text-muted-foreground">
              <li>{t("nextWorker")}</li>
              <li>{t("nextSmtp")}</li>
              <li>{t("nextWhatsapp")}</li>
            </ul>
          </CardContent>
          <CardFooter className="mt-6 justify-end">
            {/* A full page load: the app's settings were just written */}
            <a href="/login" className={buttonVariants()}>
              {t("signIn")}
            </a>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}
