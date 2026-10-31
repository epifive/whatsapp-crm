"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Briefcase, CheckCircle2, ListTodo, MessageSquare, StickyNote, Tag, UserCog, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/client/api-client";
import { cn } from "@/lib/utils";
import { formatMoney } from "./format";
import { LocalTime } from "./local-time";
import type { TimelineEntry } from "./types";

const ACTIVITY_ICON: Record<string, typeof Tag> = {
  "contact.created": UserPlus,
  "contact.updated": UserCog,
  "contact.owner_changed": UserCog,
  "contact.opted_in": CheckCircle2,
  "contact.opted_out": UserCog,
  "tag.added": Tag,
  "tag.removed": Tag,
  "task.created": ListTodo,
  "task.completed": CheckCircle2,
};

function str(v: unknown): string {
  return typeof v === "string" || typeof v === "number" ? String(v) : "";
}

/** One line describing an activity, e.g. "Deal 'Website' moved from Lead to Won" */
function ActivityText({ entry }: { entry: Extract<TimelineEntry, { kind: "activity" }> }) {
  const ta = useTranslations("crm.activity");
  const d = entry.data;
  const value = typeof d.value === "number" && str(d.currency) ? formatMoney(d.value, str(d.currency)) : "";
  switch (entry.type) {
    case "contact.created":
      return <>{ta(d.source === "import" ? "contactImported" : d.source === "manual" ? "contactCreatedManual" : "contactCreated", { file: str(d.file) })}</>;
    case "contact.updated":
      return <>{ta("contactUpdated", { fields: Array.isArray(d.fields) ? d.fields.join(", ") : "" })}</>;
    case "contact.owner_changed":
      return <>{ta("ownerChanged")}</>;
    case "contact.opted_in":
      return <>{ta("optedIn")}</>;
    case "contact.opted_out":
      return <>{d.via === "reply" ? ta("optedOutReply", { text: str(d.text) }) : ta("optedOut")}</>;
    case "tag.added":
      return <>{ta("tagAdded", { tag: str(d.tag) })}</>;
    case "tag.removed":
      return <>{ta("tagRemoved", { tag: str(d.tag) })}</>;
    case "deal.created":
      return <>{ta("dealCreated", { title: str(d.title), stage: str(d.stage) })}</>;
    case "deal.stage_changed":
      return <>{ta("dealMoved", { title: str(d.title), from: str(d.from), to: str(d.to) })}</>;
    case "deal.won":
      return <>{ta("dealWon", { title: str(d.title), value })}</>;
    case "deal.lost":
      return <>{ta("dealLost", { title: str(d.title) })}</>;
    case "deal.reopened":
      return <>{ta("dealReopened", { title: str(d.title) })}</>;
    case "task.created":
      return <>{ta("taskCreated", { title: str(d.title) })}</>;
    case "task.completed":
      return <>{ta("taskCompleted", { title: str(d.title) })}</>;
    default:
      return <>{entry.type}</>;
  }
}

/**
 * History feed with a note box. `notePath` is the API to post notes to; `loadMore` fetches the
 * next (older) page when the feed supports paging.
 */
export function Timeline({
  entries,
  notePath,
  onNoteAdded,
  hasMore,
  onLoadMore,
}: {
  entries: TimelineEntry[];
  notePath: string;
  onNoteAdded: () => void;
  hasMore?: boolean;
  onLoadMore?: () => void;
}) {
  const t = useTranslations("crm");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    setSaving(true);
    const res = await apiFetch(notePath, { body: { body: note } });
    setSaving(false);
    if (!res.ok) return toast.error(res.error);
    setNote("");
    onNoteAdded();
  }

  return (
    <div className="grid gap-4">
      <form onSubmit={addNote} className="grid gap-2">
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("notePlaceholder")} rows={2} maxLength={4000} aria-label={t("addNote")} />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={saving || !note.trim()}>
            {t("addNote")}
          </Button>
        </div>
      </form>

      {entries.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">{t("noHistory")}</p>}
      <ol className="relative grid gap-4 border-s ps-5">
        {entries.map((e) => {
          let Icon = ACTIVITY_ICON[e.kind === "activity" ? e.type : ""] ?? Briefcase;
          if (e.kind === "note") Icon = StickyNote;
          if (e.kind === "message") Icon = e.direction === "INBOUND" ? ArrowDownLeft : ArrowUpRight;
          return (
            <li key={`${e.kind}-${e.id}`} className="relative">
              <span
                className={cn(
                  "absolute -start-[1.95rem] top-0.5 flex size-6 items-center justify-center rounded-full border bg-background",
                  e.kind === "note" && "border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950",
                  e.kind === "message" && "border-primary/30 text-primary",
                )}
              >
                <Icon className="size-3.5" />
              </span>
              {e.kind === "note" && (
                <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm dark:bg-amber-950/40">
                  <p className="whitespace-pre-wrap break-words">{e.body}</p>
                </div>
              )}
              {e.kind === "message" && (
                <div className="text-sm">
                  <span className="text-muted-foreground">{e.direction === "INBOUND" ? t("received", { number: e.accountName }) : t("sent", { number: e.accountName })} </span>
                  <Link href={`/app/inbox?c=${e.conversationId}`} className="inline-flex items-center gap-1 font-medium hover:underline">
                    <MessageSquare className="size-3" />
                    {t("openChat")}
                  </Link>
                  <p className="mt-0.5 line-clamp-3 break-words whitespace-pre-wrap">{e.body ?? t(`messageType.${e.type}`)}</p>
                </div>
              )}
              {e.kind === "activity" && (
                <p className="text-sm">
                  <ActivityText entry={e} />
                </p>
              )}
              <div className="mt-0.5 text-xs text-muted-foreground">
                {e.kind === "note" && e.author ? `${e.author} · ` : ""}
                {e.kind === "activity" && e.actor ? `${e.actor} · ` : ""}
                <LocalTime iso={e.at} options={{ dateStyle: "medium", timeStyle: "short" }} />
              </div>
            </li>
          );
        })}
      </ol>
      {hasMore && onLoadMore && (
        <Button variant="ghost" size="sm" onClick={onLoadMore}>
          {t("loadOlder")}
        </Button>
      )}
    </div>
  );
}
