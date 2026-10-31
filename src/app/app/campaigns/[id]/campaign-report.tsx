"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Copy, MessageSquare, Pause, Play, RotateCcw, Trash2, Undo2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { LocalTime } from "@/components/crm/local-time";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MessagePreview } from "@/components/whatsapp/message-preview";
import { apiFetch } from "@/lib/client/api-client";
import { debounce, useRealtime } from "@/lib/client/realtime";
import { cn } from "@/lib/utils";
import { pct, STATUS_STYLE, type CampaignItem } from "../types";
import type { CampaignContext } from "./campaign-page";

type Filter = "all" | "sent" | "delivered" | "read" | "replied" | "failed" | "skipped" | "pending";

interface Recipient {
  id: string;
  status: "PENDING" | "QUEUED" | "SENT" | "DELIVERED" | "READ" | "FAILED" | "SKIPPED";
  error: string | null;
  sentAt: string | null;
  repliedAt: string | null;
  contact: { id: string; phone: string; name: string };
  conversationId: string | null;
}

const RECIPIENT_STYLE: Record<Recipient["status"], string> = {
  PENDING: "text-muted-foreground",
  QUEUED: "text-muted-foreground",
  SENT: "text-foreground",
  DELIVERED: "text-foreground",
  READ: "text-sky-600",
  FAILED: "text-destructive",
  SKIPPED: "text-amber-600",
};

export function CampaignReport({ campaign: c, ctx, onChanged }: { campaign: CampaignItem; ctx: CampaignContext; onChanged: () => void }) {
  const t = useTranslations("campaigns");
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [rows, setRows] = useState<Recipient[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const s = c.stats ?? { total: 0, pending: 0, queued: 0, sent: 0, delivered: 0, read: 0, failed: 0, skipped: 0, replied: 0 };

  const load = useCallback(async () => {
    const res = await apiFetch<{ recipients: Recipient[]; nextCursor: string | null }>(`/api/campaigns/${c.id}/recipients?status=${filter}`);
    if (res.ok && res.data) {
      setRows(res.data.recipients);
      setCursor(res.data.nextCursor);
    }
  }, [c.id, filter]);
  useEffect(() => {
    // Fetch when the filter changes; state is only set once the request resolves
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  const refresh = useMemo(() => debounce(() => void load(), 1500), [load]);
  useRealtime<{ campaignId: string }>("campaign.updated", (ev) => ev.campaignId === c.id && refresh());

  async function more() {
    if (!cursor) return;
    const res = await apiFetch<{ recipients: Recipient[]; nextCursor: string | null }>(`/api/campaigns/${c.id}/recipients?status=${filter}&cursor=${cursor}`);
    if (res.ok && res.data) {
      setRows((r) => [...(r ?? []), ...res.data!.recipients]);
      setCursor(res.data.nextCursor);
    }
  }

  async function act(action: string, confirmText?: string) {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true);
    const res = await apiFetch<{ campaign: { id: string } }>(`/api/campaigns/${c.id}/${action}`, { body: {} });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    if (action === "duplicate") return router.push(`/app/campaigns/${res.data!.campaign.id}`);
    toast.success(t(`done.${action}`));
    onChanged();
  }

  async function remove() {
    if (!confirm(t("confirmDelete", { name: c.name }))) return;
    const res = await apiFetch(`/api/campaigns/${c.id}`, { method: "DELETE", body: {} });
    if (!res.ok) return toast.error(res.error);
    router.push("/app/campaigns");
  }

  const processed = s.total - s.pending - s.queued;
  const cards: { key: Filter; label: string; value: number; of?: number }[] = [
    { key: "all", label: t("stats.recipients"), value: s.total },
    { key: "sent", label: t("stats.sent"), value: s.sent, of: s.total },
    { key: "delivered", label: t("stats.delivered"), value: s.delivered, of: s.sent },
    { key: "read", label: t("stats.read"), value: s.read, of: s.delivered },
    { key: "replied", label: t("stats.replied"), value: s.replied, of: s.sent },
    { key: "failed", label: t("stats.failed"), value: s.failed, of: s.total },
    { key: "skipped", label: t("stats.skipped"), value: s.skipped, of: s.total },
  ];
  const template = c.template ? ctx.templates.find((x) => x.id === c.template!.id) : null;
  // Template preview with each variable shown as where its value comes from: [First name], [City], fixed text
  type Comp = { type: string; format?: string; text?: string; buttons?: { type: string; text?: string }[] };
  const comps = (template?.components ?? []) as Comp[];
  const header = comps.find((x) => x.type === "HEADER");
  const labels = (list: { source: string; value: string }[]) =>
    list.map((p) =>
      p.source === "text" ? p.value : `[${p.source.startsWith("field:") ? (ctx.fields.find((f) => `field:${f.key}` === p.source)?.label ?? p.source.slice(6)) : t(`source.${p.source}`)}]`,
    );
  const fill = (text: string | undefined, vars: string[], values: string[]) => (text ?? "").replace(/{{\s*([A-Za-z0-9_]+)\s*}}/g, (m, n: string) => values[vars.indexOf(n)] || m);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-start gap-3">
        <Link href="/app/campaigns" className={buttonVariants({ variant: "ghost", size: "icon" })} aria-label={t("back")}>
          <ArrowLeft />
        </Link>
        <div className="min-w-0 flex-1 basis-56">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{c.name}</h1>
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLE[c.status])}>{t(`status.${c.status}`)}</span>
          </div>
          <p className="text-sm text-muted-foreground">
            {c.account.name} · {t(`channel.${c.account.channel}`)}
            {c.status === "SCHEDULED" && c.scheduledAt && (
              <>
                {" · "}
                {t("scheduledFor")} <LocalTime iso={c.scheduledAt} options={{ dateStyle: "medium", timeStyle: "short" }} />
              </>
            )}
            {c.startedAt && (
              <>
                {" · "}
                {t("startedAt")} <LocalTime iso={c.startedAt} options={{ dateStyle: "medium", timeStyle: "short" }} />
              </>
            )}
          </p>
          {c.statusMessage && <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">{c.statusMessage}</p>}
        </div>
        {ctx.canManage && (
          <div className="flex flex-wrap gap-2">
            {c.status === "SCHEDULED" && (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => act("unschedule")}>
                <Undo2 />
                {t("action.unschedule")}
              </Button>
            )}
            {c.status === "RUNNING" && (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => act("pause")}>
                <Pause />
                {t("action.pause")}
              </Button>
            )}
            {c.status === "PAUSED" && (
              <Button size="sm" disabled={busy} onClick={() => act("resume")}>
                <Play />
                {t("action.resume")}
              </Button>
            )}
            {s.failed > 0 && ["RUNNING", "PAUSED", "COMPLETED"].includes(c.status) && (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => act("retry", t("confirmRetry", { count: s.failed }))}>
                <RotateCcw />
                {t("action.retry")}
              </Button>
            )}
            {["SCHEDULED", "RUNNING", "PAUSED"].includes(c.status) && (
              <Button variant="outline" size="sm" disabled={busy} onClick={() => act("cancel", t("confirmCancel"))}>
                <XCircle />
                {t("action.cancel")}
              </Button>
            )}
            <Button variant="outline" size="sm" disabled={busy} onClick={() => act("duplicate")}>
              <Copy />
              {t("action.duplicate")}
            </Button>
            {["COMPLETED", "CANCELLED"].includes(c.status) && (
              <Button variant="ghost" size="icon-sm" onClick={remove} aria-label={t("delete")}>
                <Trash2 className="text-muted-foreground" />
              </Button>
            )}
          </div>
        )}
      </div>

      {s.total > 0 && (
        <div className="grid gap-1.5">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{t("progress", { done: processed, total: s.total })}</span>
            <span>{pct(processed, s.total)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={processed} aria-valuemin={0} aria-valuemax={s.total}>
            <div className="h-full bg-primary transition-all" style={{ width: pct(processed, s.total) }} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        {cards.map((card) => (
          <button
            key={card.key}
            type="button"
            onClick={() => setFilter(card.key)}
            aria-pressed={filter === card.key}
            className={cn("rounded-xl border bg-card p-3 text-left transition-colors hover:bg-muted/50", filter === card.key && "border-primary ring-1 ring-primary")}
          >
            <div className="text-xs text-muted-foreground">{card.label}</div>
            <div className="text-2xl font-semibold tabular-nums">{card.value.toLocaleString()}</div>
            {card.of !== undefined && <div className="text-xs text-muted-foreground">{pct(card.value, card.of)}</div>}
          </button>
        ))}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Card className="py-0">
          <CardHeader className="pt-4">
            <CardTitle>{t(`filterTitle.${filter}`)}</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            {rows === null && <p className="p-6 text-center text-sm text-muted-foreground">{t("loading")}</p>}
            {rows?.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">{c.status === "SCHEDULED" ? t("notStarted") : t("noRecipients")}</p>}
            <ul className="divide-y">
              {rows?.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
                  <Link href={`/app/contacts/${r.contact.id}`} className="min-w-0 flex-1 basis-40 hover:underline">
                    <span className="block truncate font-medium">{r.contact.name}</span>
                    <span className="block text-xs text-muted-foreground tabular-nums">+{r.contact.phone}</span>
                  </Link>
                  <div className="min-w-0 basis-40 text-xs">
                    <span className={cn("font-medium", RECIPIENT_STYLE[r.status])}>{t(`recipientStatus.${r.status}`)}</span>
                    {r.repliedAt && <span className="ms-2 rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">{t("repliedBadge")}</span>}
                    {r.error && <span className="block break-words text-muted-foreground">{r.error}</span>}
                  </div>
                  {r.conversationId && (
                    <Link href={`/app/inbox?c=${r.conversationId}`} className={buttonVariants({ variant: "ghost", size: "icon-sm" })} aria-label={t("openChat")}>
                      <MessageSquare />
                    </Link>
                  )}
                </li>
              ))}
            </ul>
            {cursor && (
              <div className="p-3 text-center">
                <Button variant="ghost" size="sm" onClick={more}>
                  {t("loadMore")}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-3">
          <div className="text-sm font-medium">{t("message")}</div>
          {template ? (
            <MessagePreview
              headerFormat={header?.format}
              headerText={header && (header.format ?? "TEXT") === "TEXT" ? fill(header.text, template.spec.header?.vars ?? [], labels(c.templateParams?.header ?? [])) : null}
              mediaName={c.media?.fileName}
              body={fill(comps.find((x) => x.type === "BODY")?.text, template.spec.body, labels(c.templateParams?.body ?? []))}
              footer={comps.find((x) => x.type === "FOOTER")?.text}
              buttons={comps.find((x) => x.type === "BUTTONS")?.buttons ?? []}
            />
          ) : (
            <MessagePreview headerFormat={c.media ? ({ "image/jpeg": "IMAGE", "image/png": "IMAGE", "video/mp4": "VIDEO" }[c.media.mimeType] ?? "DOCUMENT") : null} mediaName={c.media?.fileName} body={c.body ?? ""} />
          )}
          <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">{t("audienceLabel")}</dt>
            <dd>{c.audience.type === "segment" ? (c.segment?.name ?? t("deletedSegment")) : t(`audience.${c.audience.type}`)}</dd>
            <dt className="text-muted-foreground">{t("consentLabel")}</dt>
            <dd>{c.audience.consent === "opted_in" ? t("onlyOptedInShort") : t("allButOptedOut")}</dd>
            {c.createdBy && (
              <>
                <dt className="text-muted-foreground">{t("createdBy")}</dt>
                <dd>{c.createdBy}</dd>
              </>
            )}
            {c.completedAt && (
              <>
                <dt className="text-muted-foreground">{t("finishedAt")}</dt>
                <dd>
                  <LocalTime iso={c.completedAt} options={{ dateStyle: "medium", timeStyle: "short" }} />
                </dd>
              </>
            )}
          </dl>
        </div>
      </div>
    </div>
  );
}
