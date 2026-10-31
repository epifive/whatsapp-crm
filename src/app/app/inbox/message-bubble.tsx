"use client";

import { useFormatter, useTranslations } from "next-intl";
import { AlertCircle, Bot, Check, CheckCheck, Clock, FileText, MapPin, Reply, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { TranslateMessage } from "./ai-tools";
import type { MessageItem } from "./types";

function StatusIcon({ status, error }: { status: MessageItem["status"]; error: string | null }) {
  const t = useTranslations("inbox");
  if (status === "QUEUED") return <Clock className="size-3.5" aria-label={t("tick.QUEUED")} />;
  if (status === "SENT") return <Check className="size-3.5" aria-label={t("tick.SENT")} />;
  if (status === "DELIVERED") return <CheckCheck className="size-3.5" aria-label={t("tick.DELIVERED")} />;
  if (status === "READ") return <CheckCheck className="size-3.5 text-sky-500" aria-label={t("tick.READ")} />;
  if (status === "FAILED") return <AlertCircle className="size-3.5 text-destructive" aria-label={error ?? t("tick.FAILED")} />;
  return null;
}

function formatSize(bytes: number | null) {
  if (!bytes) return "";
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}

function Media({ m }: { m: MessageItem }) {
  const t = useTranslations("inbox");
  const media = m.media!;
  if (media.error) return <p className="text-xs italic text-muted-foreground">{t("mediaUnavailable")}</p>;
  if (media.pending || !media.url) return <p className="text-xs italic text-muted-foreground">{t("mediaLoading")}</p>;
  if (m.type === "IMAGE" || m.type === "STICKER") {
    return (
      <a href={media.url} target="_blank" rel="noopener noreferrer">
        {/* eslint-disable-next-line @next/next/no-img-element -- authenticated media route, unknown dimensions */}
        <img src={media.url} alt={media.fileName ?? t("image")} className={cn("rounded-lg object-cover", m.type === "STICKER" ? "size-32" : "max-h-72 w-full max-w-xs")} loading="lazy" />
      </a>
    );
  }
  if (m.type === "VIDEO") return <video src={media.url} controls className="max-h-72 w-full max-w-xs rounded-lg" preload="metadata" />;
  if (m.type === "AUDIO") return <audio src={media.url} controls className="w-64 max-w-full" preload="none" />;
  return (
    <a href={media.url} className="flex items-center gap-2 rounded-lg border bg-background/60 p-2 text-sm hover:bg-background" download>
      <FileText className="size-6 shrink-0 text-primary" />
      <span className="min-w-0">
        <span className="block truncate font-medium">{media.fileName ?? t("document")}</span>
        <span className="block text-xs text-muted-foreground">{formatSize(media.size)}</span>
      </span>
    </a>
  );
}

export function MessageBubble({ m, quoted, onReply }: { m: MessageItem; quoted?: MessageItem; onReply?: () => void }) {
  const t = useTranslations("inbox");
  const format = useFormatter();
  const outbound = m.direction === "OUTBOUND";

  if (m.type === "REACTION") {
    return (
      <div className={cn("flex", outbound ? "justify-end" : "justify-start")}>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {t("reacted", { emoji: m.body ?? "" })}
        </span>
      </div>
    );
  }

  const location = m.type === "LOCATION" ? (m.payload as { latitude?: number; longitude?: number } | null) : null;
  // Messages written by the AI or a chatbot flow (no teammate sent them)
  const automated = m.payload?.ai ? "ai" : m.payload?.flowSessionId ? "bot" : null;

  return (
    <div className={cn("group flex", outbound ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "relative max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-xs sm:max-w-[70%]",
          outbound ? "rounded-ee-sm bg-primary/10" : "rounded-es-sm border bg-background",
          m.status === "FAILED" && "border border-destructive/40",
        )}
      >
        {quoted && (
          <div className="mb-1.5 rounded-md border-s-2 border-primary bg-background/70 px-2 py-1 text-xs text-muted-foreground">
            <span className="line-clamp-2">{quoted.body ?? t("attachment")}</span>
          </div>
        )}
        {m.type === "TEMPLATE" && <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("template")}</div>}
        {m.media && <div className="mb-1">{<Media m={m} />}</div>}
        {location?.latitude != null && (
          <a
            href={`https://www.google.com/maps?q=${location.latitude},${location.longitude}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mb-1 flex items-center gap-1.5 text-primary hover:underline"
          >
            <MapPin className="size-4" />
            {t("openMap")}
          </a>
        )}
        {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
        {!outbound && m.body && (m.type === "TEXT" || m.type === "INTERACTIVE") && <TranslateMessage messageId={m.id} />}
        {m.type === "UNSUPPORTED" && <p className="italic text-muted-foreground">{t("unsupported")}</p>}
        <div className="mt-1 flex items-center justify-end gap-1.5 text-[11px] text-muted-foreground">
          {outbound && m.sentBy && <span className="truncate">{m.sentBy.name} ·</span>}
          {outbound && !m.sentBy && automated && (
            <span className="inline-flex items-center gap-0.5">
              {automated === "ai" ? <Sparkles className="size-3 text-fuchsia-600" /> : <Bot className="size-3" />}
              {t(automated === "ai" ? "sentByAi" : "sentByBot")} ·
            </span>
          )}
          <time dateTime={m.createdAt}>{format.dateTime(new Date(m.createdAt), { hour: "numeric", minute: "2-digit" })}</time>
          {outbound && <StatusIcon status={m.status} error={m.error} />}
        </div>
        {m.status === "FAILED" && m.error && <p className="mt-1 text-xs text-destructive">{m.error}</p>}
        {onReply && (
          <button
            type="button"
            onClick={onReply}
            className={cn(
              "absolute top-1 hidden rounded-full border bg-background p-1 text-muted-foreground shadow-sm hover:text-foreground group-hover:block",
              outbound ? "-start-8" : "-end-8",
            )}
            aria-label={t("reply")}
          >
            <Reply className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
