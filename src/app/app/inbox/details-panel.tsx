"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Ban, Clock, QrCode, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/client/api-client";
import { cn } from "@/lib/utils";
import { SummaryButton } from "./ai-tools";
import { AutomationPanel, type AutomationState } from "./automation-panel";
import { initials } from "./conversation-row";
import type { ConversationItem, InboxContext, NoteItem } from "./types";

const selectClass = "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm";

export function DetailsPanel({
  conversation,
  notes,
  automation,
  ctx,
  onChanged,
}: {
  conversation: ConversationItem;
  notes: NoteItem[];
  automation: AutomationState;
  ctx: InboxContext;
  onChanged: () => Promise<void>;
}) {
  const t = useTranslations("inbox");
  const format = useFormatter();
  const [note, setNote] = useState("");
  const [tagName, setTagName] = useState("");
  const c = conversation;

  async function patch(body: Record<string, unknown>, success?: string) {
    const res = await apiFetch(`/api/inbox/conversations/${c.id}`, { method: "PATCH", body });
    if (!res.ok) return toast.error(res.error);
    if (success) toast.success(success);
    await onChanged();
  }

  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    const res = await apiFetch(`/api/inbox/conversations/${c.id}/notes`, { body: { body: note } });
    if (!res.ok) return toast.error(res.error);
    setNote("");
    await onChanged();
  }

  async function addTag(e: React.FormEvent) {
    e.preventDefault();
    if (!tagName.trim()) return;
    const res = await apiFetch(`/api/contacts/${c.contact.id}/tags`, { body: { name: tagName.trim() } });
    if (!res.ok) return toast.error(res.error);
    setTagName("");
    await onChanged();
  }

  async function removeTag(tagId: string) {
    const res = await apiFetch(`/api/contacts/${c.contact.id}/tags?tagId=${tagId}`, { method: "DELETE", body: {} });
    if (!res.ok) return toast.error(res.error);
    await onChanged();
  }

  return (
    <div className="grid gap-6 p-4">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-lg font-medium text-primary">{initials(c.contact.name)}</span>
        <div className="font-medium">{c.contact.name}</div>
        <div className="text-sm text-muted-foreground">+{c.contact.phone}</div>
        <Link href={`/app/contacts/${c.contact.id}`} className="text-xs font-medium text-primary hover:underline">
          {t("viewProfile")}
        </Link>
        {c.contact.waName && c.contact.savedName && <div className="text-xs text-muted-foreground">{t("onWhatsAppAs", { name: c.contact.waName })}</div>}
        {c.contact.optedOut && (
          <span className="flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive">
            <Ban className="size-3" />
            {t("optedOut")}
          </span>
        )}
      </div>

      <form
        className="grid gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          const name = String(new FormData(e.currentTarget).get("contactName") ?? "").trim();
          void patch({ contactName: name || null }, t("saved"));
        }}
      >
        <Label htmlFor="contactName">{t("contactName")}</Label>
        <div className="flex gap-2">
          <Input id="contactName" name="contactName" defaultValue={c.contact.savedName ?? ""} placeholder={c.contact.waName ?? ""} maxLength={100} key={c.contact.savedName ?? ""} />
          <Button type="submit" variant="outline" size="sm">
            {t("save")}
          </Button>
        </div>
      </form>

      <div className="grid gap-1.5 text-sm">
        <Label>{t("viaNumber")}</Label>
        <div className="flex items-center gap-2 text-muted-foreground">
          {c.account.channel === "OFFICIAL" ? <ShieldCheck className="size-4 text-primary" /> : <QrCode className="size-4" />}
          <span className="truncate">
            {c.account.name}
            {c.account.phone ? ` (+${c.account.phone})` : ""}
          </span>
        </div>
        {c.window && (
          <div className={cn("flex items-center gap-1.5 text-xs", c.window.open ? "text-muted-foreground" : "text-amber-700 dark:text-amber-400")}>
            <Clock className="size-3.5" />
            {c.window.open && c.window.expiresAt ? t("windowOpenUntil", { time: format.dateTime(new Date(c.window.expiresAt), { weekday: "short", hour: "numeric", minute: "2-digit" }) }) : t("windowClosedShort")}
          </div>
        )}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="assignee">{t("assignedTo")}</Label>
        <select id="assignee" className={selectClass} value={c.assignee?.id ?? ""} onChange={(e) => void patch({ assigneeId: e.target.value || null })}>
          <option value="">{t("unassigned")}</option>
          {ctx.members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.id === ctx.me.id ? ` (${t("you")})` : ""}
            </option>
          ))}
        </select>
      </div>

      <AutomationPanel conversationId={c.id} state={automation} onChanged={() => void onChanged()} />

      <div className="grid gap-1.5">
        <Label>{t("conversationStatus")}</Label>
        <div className="grid grid-cols-3 gap-1">
          {(["OPEN", "PENDING", "CLOSED"] as const).map((s) => (
            <Button key={s} type="button" size="sm" variant={c.status === s ? "default" : "outline"} onClick={() => void patch({ status: s })}>
              {t(`status.${s}`)}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-2">
        <Label>{t("tags")}</Label>
        <div className="flex flex-wrap gap-1.5">
          {c.contact.tags.length === 0 && <span className="text-xs text-muted-foreground">{t("noTags")}</span>}
          {c.contact.tags.map((tag) => (
            <span key={tag.id} className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-white" style={{ backgroundColor: tag.color }}>
              {tag.name}
              <button type="button" onClick={() => void removeTag(tag.id)} aria-label={t("removeTag", { name: tag.name })}>
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
        <form onSubmit={addTag} className="flex gap-2">
          <Input value={tagName} onChange={(e) => setTagName(e.target.value)} placeholder={t("addTag")} maxLength={30} aria-label={t("addTag")} />
          <Button type="submit" variant="outline" size="sm">
            {t("add")}
          </Button>
        </form>
      </div>

      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <Label>{t("notes")}</Label>
          <SummaryButton conversationId={c.id} onNoteSaved={() => void onChanged()} />
        </div>
        <p className="text-xs text-muted-foreground">{t("notesHint")}</p>
        <div className="grid gap-2">
          {notes.map((n) => (
            <div key={n.id} className="rounded-lg bg-amber-500/10 p-2 text-sm">
              <p className="whitespace-pre-wrap break-words">{n.body}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {n.author ?? t("someone")} · {format.dateTime(new Date(n.createdAt), { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}
              </p>
            </div>
          ))}
        </div>
        <form onSubmit={addNote} className="grid gap-2">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={4000} placeholder={t("notePlaceholder")} aria-label={t("notePlaceholder")} />
          <Button type="submit" variant="outline" size="sm" className="justify-self-end" disabled={!note.trim()}>
            {t("addNote")}
          </Button>
        </form>
      </div>
    </div>
  );
}
