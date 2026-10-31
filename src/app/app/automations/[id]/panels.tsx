"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { LocalTime } from "@/components/crm/local-time";
import { Field, FormMessage } from "@/components/forms";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { apiFetch } from "@/lib/client/api-client";
import { cn } from "@/lib/utils";
import type { BuilderAccount } from "./builder";

export interface FlowInfo {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  trigger: "KEYWORD" | "FIRST_MESSAGE" | "ANY_MESSAGE" | "CAMPAIGN_REPLY" | "MANUAL";
  keywords: string[];
  match: "EXACT" | "CONTAINS" | "STARTS_WITH";
  accountIds: string[];
  campaignId: string | null;
  priority: number;
  timeoutMinutes: number;
  runs: number;
  completions: number;
  activeSessions: number;
}

const TRIGGERS = ["KEYWORD", "FIRST_MESSAGE", "ANY_MESSAGE", "CAMPAIGN_REPLY", "MANUAL"] as const;

export function FlowSettingsDialog({
  flow,
  accounts,
  campaigns,
  onClose,
  onSaved,
}: {
  flow: FlowInfo;
  accounts: BuilderAccount[];
  campaigns: { id: string; name: string }[];
  onClose: () => void;
  onSaved: (f: FlowInfo) => void;
}) {
  const t = useTranslations("flows");
  const [trigger, setTrigger] = useState(flow.trigger);
  const [accountIds, setAccountIds] = useState(flow.accountIds);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    const res = await apiFetch<{ flow: FlowInfo }>(`/api/flows/${flow.id}`, {
      method: "PATCH",
      body: {
        name: f.get("name"),
        description: f.get("description") || null,
        trigger,
        keywords: String(f.get("keywords") ?? "")
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean),
        match: f.get("match") ?? "CONTAINS",
        accountIds,
        campaignId: trigger === "CAMPAIGN_REPLY" ? f.get("campaignId") || null : null,
        priority: Number(f.get("priority") || 0),
        timeoutMinutes: Number(f.get("timeoutMinutes") || 60),
      },
    });
    setPending(false);
    if (!res.ok) return setError(res.error);
    toast.success(t("saved"));
    onSaved(res.data!.flow);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("settings")}</DialogTitle>
            <DialogDescription>{t("settingsHelp")}</DialogDescription>
          </DialogHeader>
          <FormMessage type="error">{error}</FormMessage>
          <Field id="name" label={t("name")} defaultValue={flow.name} required maxLength={100} />
          <Field id="description" label={t("description")} defaultValue={flow.description ?? ""} maxLength={300} />
          <div className="grid gap-1.5">
            <Label htmlFor="trigger">{t("startsWhen")}</Label>
            <NativeSelect id="trigger" value={trigger} onChange={(e) => setTrigger(e.target.value as FlowInfo["trigger"])}>
              {TRIGGERS.map((tr) => (
                <option key={tr} value={tr}>
                  {t(`trigger.${tr}`)}
                </option>
              ))}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">{t(`triggerHelp.${trigger}`)}</p>
          </div>
          {trigger === "KEYWORD" && (
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
              <Field id="keywords" label={t("keywords")} defaultValue={flow.keywords.join(", ")} hint={t("keywordsHint")} maxLength={1000} />
              <div className="grid content-start gap-1.5">
                <Label htmlFor="match">{t("matchType")}</Label>
                <NativeSelect id="match" name="match" defaultValue={flow.match}>
                  {(["CONTAINS", "EXACT", "STARTS_WITH"] as const).map((m) => (
                    <option key={m} value={m}>
                      {t(`matchKind.${m}`)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
          )}
          {trigger === "CAMPAIGN_REPLY" && (
            <div className="grid gap-1.5">
              <Label htmlFor="campaignId">{t("campaign")}</Label>
              <NativeSelect id="campaignId" name="campaignId" defaultValue={flow.campaignId ?? ""}>
                <option value="">{t("anyCampaign")}</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
          {accounts.length > 1 && (
            <fieldset className="grid gap-1.5">
              <legend className="mb-1 text-sm font-medium">{t("numbers")}</legend>
              <p className="text-xs text-muted-foreground">{t("numbersHint")}</p>
              {accounts.map((a) => (
                <label key={a.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={accountIds.includes(a.id)}
                    onChange={(e) => setAccountIds((ids) => (e.target.checked ? [...ids, a.id] : ids.filter((x) => x !== a.id)))}
                  />
                  {a.name} · {a.channel === "OFFICIAL" ? "Cloud API" : "QR"}
                </label>
              ))}
            </fieldset>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="priority" label={t("priority")} type="number" min={-100} max={100} defaultValue={String(flow.priority)} hint={t("priorityHint")} />
            <Field id="timeoutMinutes" label={t("timeout")} type="number" min={1} max={10080} defaultValue={String(flow.timeoutMinutes)} hint={t("timeoutHint")} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {t("saveSettings")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TestDialog({ flowId, accounts, onClose }: { flowId: string; accounts: BuilderAccount[]; onClose: () => void }) {
  const t = useTranslations("flows");
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const connected = accounts.filter((a) => a.status === "CONNECTED");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    const res = await apiFetch<{ conversationId: string }>(`/api/flows/${flowId}/start`, { body: { phone: f.get("phone"), accountId: f.get("accountId") } });
    setPending(false);
    if (!res.ok) return setError(res.error);
    setStarted(res.data!.conversationId);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {started ? (
          <div className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{t("testStarted")}</DialogTitle>
              <DialogDescription>{t("testStartedText")}</DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                {t("close")}
              </Button>
              <Link href={`/app/inbox?c=${started}`} className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">
                {t("openChat")}
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{t("test")}</DialogTitle>
              <DialogDescription>{t("testText")}</DialogDescription>
            </DialogHeader>
            <FormMessage type="error">{error}</FormMessage>
            {connected.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noConnectedNumber")}</p>
            ) : (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor="accountId">{t("fromNumber")}</Label>
                  <NativeSelect id="accountId" name="accountId">
                    {connected.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                        {a.phone ? ` (+${a.phone})` : ""}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <Field id="phone" label={t("yourPhone")} required inputMode="tel" placeholder="+91 90000 12345" />
              </>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                {t("cancel")}
              </Button>
              <Button type="submit" disabled={pending || !connected.length}>
                {t("startTest")}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface SessionRow {
  id: string;
  status: "ACTIVE" | "COMPLETED" | "EXPIRED" | "STOPPED" | "FAILED";
  endReason: string | null;
  variables: Record<string, string>;
  createdAt: string;
  conversationId: string;
  contact: { id: string; name: string };
}

const SESSION_STYLE: Record<SessionRow["status"], string> = {
  ACTIVE: "text-primary",
  COMPLETED: "text-green-700 dark:text-green-400",
  EXPIRED: "text-muted-foreground",
  STOPPED: "text-amber-600",
  FAILED: "text-destructive",
};

export function HistorySheet({ flowId, onClose }: { flowId: string; onClose: () => void }) {
  const t = useTranslations("flows");
  const [rows, setRows] = useState<SessionRow[] | null>(null);
  useEffect(() => {
    let live = true;
    void apiFetch<{ sessions: SessionRow[] }>(`/api/flows/${flowId}/sessions`).then((r) => live && setRows(r.data?.sessions ?? []));
    return () => {
      live = false;
    };
  }, [flowId]);

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-md">
        <SheetHeader className="border-b p-4">
          <SheetTitle>{t("history")}</SheetTitle>
        </SheetHeader>
        {rows === null && <p className="p-4 text-sm text-muted-foreground">{t("loading")}</p>}
        {rows?.length === 0 && <p className="p-4 text-sm text-muted-foreground">{t("noRuns")}</p>}
        <ul className="divide-y">
          {rows?.map((r) => (
            <li key={r.id} className="grid gap-1 px-4 py-3 text-sm">
              <div className="flex items-center gap-2">
                <Link href={`/app/inbox?c=${r.conversationId}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                  {r.contact.name}
                </Link>
                <span className={cn("text-xs font-medium", SESSION_STYLE[r.status])}>{t(`sessionStatus.${r.status}`)}</span>
              </div>
              <div className="text-xs text-muted-foreground">
                <LocalTime iso={r.createdAt} options={{ dateStyle: "medium", timeStyle: "short" }} />
                {r.endReason ? ` · ${r.endReason}` : ""}
              </div>
              {Object.keys(r.variables ?? {}).length > 0 && (
                <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 rounded bg-muted/50 px-2 py-1 font-mono text-[11px]">
                  {Object.entries(r.variables).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="truncate">{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </li>
          ))}
        </ul>
      </SheetContent>
    </Sheet>
  );
}
