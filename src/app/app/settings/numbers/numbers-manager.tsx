"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useId, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Copy, Loader2, Plus, QrCode, RefreshCw, ShieldCheck, Smartphone, Trash2 } from "lucide-react";
import { Field, FormMessage } from "@/components/forms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/client/api-client";
import { useRealtime } from "@/lib/client/realtime";
import { cn } from "@/lib/utils";
import { QrCanvas } from "./qr-code";

type Status = "DISCONNECTED" | "CONNECTING" | "QR_PENDING" | "CONNECTED" | "LOGGED_OUT" | "ERROR";

interface Account {
  id: string;
  name: string;
  channel: "OFFICIAL" | "QR";
  status: Status;
  statusMessage: string | null;
  phone: string | null;
  displayName: string | null;
  qualityRating: string | null;
  messagingTier: string | null;
  pendingQr?: string | null;
  official?: { phoneNumberId: string | null; wabaId: string | null; webhookUrl: string; verifyToken: string | null } | null;
  antiBan: {
    warmupEnabled: boolean;
    warmupDay: number | null;
    minDelaySec: number;
    maxDelaySec: number;
    dailyLimit: number;
    todayLimit: number;
    sentToday: number;
  } | null;
}

const STATUS_STYLE: Record<Status, string> = {
  CONNECTED: "bg-primary/10 text-primary",
  CONNECTING: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  QR_PENDING: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  DISCONNECTED: "bg-muted text-muted-foreground",
  LOGGED_OUT: "bg-destructive/10 text-destructive",
  ERROR: "bg-destructive/10 text-destructive",
};

function CopyRow({ label, value }: { label: string; value: string }) {
  const t = useTranslations("numbers");
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <Input id={id} readOnly value={value} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={`${t("copy")}: ${label}`}
          onClick={() => {
            void navigator.clipboard.writeText(value);
            toast.success(t("copied"));
          }}
        >
          <Copy className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function NumbersManager({ initial, canManage }: { initial: Account[]; canManage: boolean }) {
  const t = useTranslations("numbers");
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>(initial);
  const [adding, setAdding] = useState<null | "choose" | "OFFICIAL" | "QR">(null);

  const reload = useCallback(async () => {
    const res = await apiFetch<{ accounts: Account[] }>("/api/whatsapp/accounts");
    if (res.ok && res.data) setAccounts(res.data.accounts);
  }, []);

  // Live status and QR updates from the worker
  useRealtime<{ accountId: string; status: Status; qr?: string }>("account.updated", (ev) => {
    setAccounts((list) => list.map((a) => (a.id === ev.accountId ? { ...a, status: ev.status, pendingQr: ev.qr ?? (ev.status === "QR_PENDING" ? a.pendingQr : null) } : a)));
    if (ev.status === "CONNECTED" || ev.status === "LOGGED_OUT") void reload();
  });

  async function action(id: string, name: string, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    const res = await apiFetch(`/api/whatsapp/accounts/${id}/${name}`, { method: "POST", body: {} });
    if (!res.ok) return toast.error(res.error);
    if (name === "sync-templates") toast.success(t("templatesSynced", { count: (res.data as { count: number }).count }));
    await reload();
  }

  async function remove(a: Account) {
    if (!confirm(t("confirmRemove", { name: a.name }))) return;
    const res = await apiFetch(`/api/whatsapp/accounts/${a.id}`, { method: "DELETE", body: {} });
    if (!res.ok) return toast.error(res.error);
    toast.success(t("removed"));
    await reload();
    router.refresh();
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {canManage && (
          <Button onClick={() => setAdding("choose")}>
            <Plus className="size-4" />
            {t("add")}
          </Button>
        )}
      </div>

      {accounts.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <Smartphone className="size-10 text-muted-foreground" />
            <p className="font-medium">{t("emptyTitle")}</p>
            <p className="max-w-md text-sm text-muted-foreground">{t("emptyText")}</p>
          </CardContent>
        </Card>
      )}

      {accounts.map((a) => (
        <Card key={a.id}>
          <CardHeader>
            <div className="flex flex-wrap items-start gap-3">
              {/* 15rem basis: on narrow screens the actions wrap below instead of squeezing the name */}
              <div className="min-w-0 flex-1 basis-60">
                <CardTitle className="flex flex-wrap items-center gap-2">
                  <span className="truncate">{a.name}</span>
                  <Badge variant="outline">{a.channel === "OFFICIAL" ? t("official") : t("qr")}</Badge>
                  <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLE[a.status])}>{t(`status.${a.status}`)}</span>
                </CardTitle>
                <CardDescription className="mt-1">
                  {a.phone ? `+${a.phone}` : t("noNumberYet")}
                  {a.displayName ? ` · ${a.displayName}` : ""}
                  {a.qualityRating ? ` · ${t("quality")}: ${a.qualityRating}` : ""}
                </CardDescription>
                {a.statusMessage && <p className="mt-1 text-xs text-destructive">{a.statusMessage}</p>}
              </div>
              {canManage && (
                <div className="flex flex-wrap gap-2">
                  {a.channel === "QR" && a.status !== "CONNECTED" && a.status !== "QR_PENDING" && (
                    <Button size="sm" onClick={() => action(a.id, "connect")}>
                      <QrCode className="size-4" />
                      {t("connect")}
                    </Button>
                  )}
                  {a.channel === "QR" && (a.status === "CONNECTED" || a.status === "QR_PENDING" || a.status === "CONNECTING") && (
                    <Button size="sm" variant="outline" onClick={() => action(a.id, "logout", t("confirmLogout"))}>
                      {t("logout")}
                    </Button>
                  )}
                  {a.channel === "OFFICIAL" && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => action(a.id, "connect")}>
                        <RefreshCw className="size-4" />
                        {t("recheck")}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => action(a.id, "sync-templates")}>
                        {t("syncTemplates")}
                      </Button>
                    </>
                  )}
                  <Button size="icon" variant="ghost" aria-label={t("remove")} onClick={() => remove(a)}>
                    <Trash2 className="size-4 text-muted-foreground" />
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="grid gap-6">
            {a.channel === "QR" && a.status === "QR_PENDING" && a.pendingQr && (
              <div className="flex flex-col items-center gap-4 rounded-xl border bg-muted/40 p-4 sm:flex-row sm:items-start">
                <QrCanvas value={a.pendingQr} />
                <ol className="list-decimal space-y-1.5 ps-5 text-sm text-muted-foreground">
                  <li>{t("qrStep1")}</li>
                  <li>{t("qrStep2")}</li>
                  <li>{t("qrStep3")}</li>
                </ol>
              </div>
            )}
            {a.channel === "QR" && a.status === "CONNECTING" && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                {t("connecting")}
              </p>
            )}
            {a.channel === "OFFICIAL" && canManage && a.official && (
              <div className="grid gap-3 rounded-xl border bg-muted/40 p-4">
                <p className="text-sm font-medium">{t("webhookTitle")}</p>
                <p className="text-xs text-muted-foreground">{t("webhookText")}</p>
                <CopyRow label={t("callbackUrl")} value={a.official.webhookUrl} />
                <CopyRow label={t("verifyToken")} value={a.official.verifyToken ?? ""} />
              </div>
            )}
            {a.channel === "QR" && a.antiBan && <AntiBanSettings account={a} canManage={canManage} onSaved={reload} />}
          </CardContent>
        </Card>
      ))}

      <Dialog open={adding !== null} onOpenChange={(open) => !open && setAdding(null)}>
        <DialogContent className="sm:max-w-lg">
          {adding === "choose" && (
            <>
              <DialogHeader>
                <DialogTitle>{t("addTitle")}</DialogTitle>
                <DialogDescription>{t("addText")}</DialogDescription>
              </DialogHeader>
              <div className="grid gap-3">
                <button type="button" onClick={() => setAdding("OFFICIAL")} className="rounded-xl border p-4 text-left transition hover:border-primary hover:bg-primary/5">
                  <div className="flex items-center gap-2 font-medium">
                    <ShieldCheck className="size-5 text-primary" />
                    {t("official")}
                    <Badge>{t("recommended")}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{t("officialText")}</p>
                </button>
                <button type="button" onClick={() => setAdding("QR")} className="rounded-xl border p-4 text-left transition hover:border-primary hover:bg-primary/5">
                  <div className="flex items-center gap-2 font-medium">
                    <QrCode className="size-5 text-primary" />
                    {t("qr")}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{t("qrText")}</p>
                </button>
              </div>
            </>
          )}
          {adding === "OFFICIAL" && <AddOfficial onDone={async () => (setAdding(null), await reload())} />}
          {adding === "QR" && <AddQr onDone={async () => (setAdding(null), await reload())} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AddOfficial({ onDone }: { onDone: () => Promise<void> }) {
  const t = useTranslations("numbers");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    const res = await apiFetch("/api/whatsapp/accounts", {
      body: { channel: "OFFICIAL", name: f.get("name"), phoneNumberId: f.get("phoneNumberId"), wabaId: f.get("wabaId"), accessToken: f.get("accessToken"), appSecret: f.get("appSecret") },
    });
    setPending(false);
    if (!res.ok) return setError(res.error);
    toast.success(t("officialAdded"));
    await onDone();
  }
  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{t("official")}</DialogTitle>
        <DialogDescription>{t("officialHelp")}</DialogDescription>
      </DialogHeader>
      <FormMessage type="error">{error}</FormMessage>
      <Field id="name" label={t("label")} placeholder={t("labelPlaceholder")} required maxLength={60} />
      <Field id="phoneNumberId" label={t("phoneNumberId")} inputMode="numeric" required />
      <Field id="wabaId" label={t("wabaId")} inputMode="numeric" required />
      <Field id="accessToken" type="password" label={t("accessToken")} hint={t("accessTokenHint")} required autoComplete="off" />
      <Field id="appSecret" type="password" label={t("appSecret")} hint={t("appSecretHint")} required autoComplete="off" />
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
        {t("verifyAndConnect")}
      </Button>
    </form>
  );
}

function AddQr({ onDone }: { onDone: () => Promise<void> }) {
  const t = useTranslations("numbers");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await apiFetch("/api/whatsapp/accounts", { body: { channel: "QR", name: new FormData(e.currentTarget).get("name") } });
    setPending(false);
    if (!res.ok) return setError(res.error);
    await onDone();
  }
  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{t("qr")}</DialogTitle>
        <DialogDescription>{t("qrHelp")}</DialogDescription>
      </DialogHeader>
      <FormMessage type="error">{error}</FormMessage>
      <Field id="name" label={t("label")} placeholder={t("labelPlaceholder")} required maxLength={60} autoFocus />
      <p className="rounded-lg bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300">{t("qrWarning")}</p>
      <Button type="submit" disabled={pending}>
        <QrCode className="size-4" />
        {t("generateQr")}
      </Button>
    </form>
  );
}

function AntiBanSettings({ account, canManage, onSaved }: { account: Account; canManage: boolean; onSaved: () => Promise<void> }) {
  const t = useTranslations("numbers");
  const ab = account.antiBan!;
  const [warmup, setWarmup] = useState(ab.warmupEnabled);
  const [pending, setPending] = useState(false);
  const usage = Math.min(100, Math.round((ab.sentToday / Math.max(1, ab.todayLimit)) * 100));

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    const res = await apiFetch(`/api/whatsapp/accounts/${account.id}`, {
      method: "PATCH",
      body: { warmupEnabled: warmup, minDelaySec: Number(f.get("minDelay")), maxDelaySec: Number(f.get("maxDelay")), dailyLimit: Number(f.get("dailyLimit")) },
    });
    setPending(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(t("saved"));
    await onSaved();
  }

  return (
    <form onSubmit={save} className="grid gap-4 rounded-xl border p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <ShieldCheck className="size-4 text-primary" />
        {t("antiBanTitle")}
      </div>
      <div className="grid gap-1.5">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{t("sentToday")}</span>
          <span className="font-mono">
            {ab.sentToday} / {ab.todayLimit}
            {ab.warmupEnabled && ab.warmupDay && ab.todayLimit < ab.dailyLimit ? ` · ${t("warmupDay", { day: ab.warmupDay })}` : ""}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className={cn("h-full rounded-full", usage > 80 ? "bg-amber-500" : "bg-primary")} style={{ width: `${usage}%` }} />
        </div>
      </div>
      <label className="flex items-start justify-between gap-4 text-sm">
        <span>
          <span className="block font-medium">{t("warmup")}</span>
          <span className="block text-xs text-muted-foreground">{t("warmupText")}</span>
        </span>
        <Switch checked={warmup} onCheckedChange={setWarmup} disabled={!canManage} />
      </label>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="minDelay" type="number" label={t("minDelay")} defaultValue={ab.minDelaySec} min={5} max={600} disabled={!canManage} />
        <Field id="maxDelay" type="number" label={t("maxDelay")} defaultValue={ab.maxDelaySec} min={7} max={900} disabled={!canManage} />
        <Field id="dailyLimit" type="number" label={t("dailyLimit")} defaultValue={ab.dailyLimit} min={1} max={100000} disabled={!canManage} />
      </div>
      {canManage && (
        <Button type="submit" variant="outline" disabled={pending} className="justify-self-start">
          {t("saveProtection")}
        </Button>
      )}
    </form>
  );
}
