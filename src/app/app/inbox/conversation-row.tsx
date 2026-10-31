"use client";

import { useFormatter, useTranslations } from "next-intl";
import { QrCode, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConversationItem } from "./types";

export function initials(name: string) {
  const letters = name
    .replace(/^\+/, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  return letters || "?";
}

export function ConversationRow({ item, selected, onSelect }: { item: ConversationItem; selected: boolean; onSelect: () => void }) {
  const t = useTranslations("inbox");
  const format = useFormatter();
  const when = item.lastMessageAt ? new Date(item.lastMessageAt) : null;
  const sameDay = when && when.toDateString() === new Date().toDateString();

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn("flex w-full gap-3 border-b px-3 py-3 text-left transition-colors hover:bg-muted/60", selected && "bg-primary/5 hover:bg-primary/10")}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-medium text-primary">{initials(item.contact.name)}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-sm", item.unreadCount ? "font-semibold" : "font-medium")}>{item.contact.name}</span>
          {when && <span className="shrink-0 text-[11px] text-muted-foreground">{sameDay ? format.dateTime(when, { hour: "numeric", minute: "2-digit" }) : format.dateTime(when, { day: "numeric", month: "short" })}</span>}
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          <span className={cn("min-w-0 flex-1 truncate text-xs", item.unreadCount ? "text-foreground" : "text-muted-foreground")}>{item.lastMessagePreview ?? t("noMessages")}</span>
          {item.unreadCount > 0 && (
            <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
              {item.unreadCount > 99 ? "99+" : item.unreadCount}
            </span>
          )}
        </span>
        <span className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {item.account.channel === "OFFICIAL" ? <ShieldCheck className="size-3" /> : <QrCode className="size-3" />}
          <span className="truncate">{item.account.name}</span>
          {item.assignee && <span className="truncate">· {item.assignee.name}</span>}
          {item.contact.tags.slice(0, 2).map((tag) => (
            <span key={tag.id} className="rounded px-1 py-px text-[10px] font-medium text-white" style={{ backgroundColor: tag.color }}>
              {tag.name}
            </span>
          ))}
        </span>
      </span>
    </button>
  );
}
