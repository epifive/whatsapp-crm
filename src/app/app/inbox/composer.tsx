"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { FileText, LayoutTemplate, Loader2, Paperclip, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/client/api-client";
import { getSocket } from "@/lib/client/realtime";
import { AiMenu } from "./ai-tools";
import type { ConversationItem, InboxContext, MessageItem, TemplateItem } from "./types";

const MAX_FILE_BYTES = 16 * 1024 * 1024;

export function Composer({
  conversation,
  canned,
  replyTo,
  onCancelReply,
  onSent,
}: {
  conversation: ConversationItem;
  canned: InboxContext["canned"];
  replyTo: MessageItem | null;
  onCancelReply: () => void;
  onSent: () => void;
}) {
  const t = useTranslations("inbox");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [templateMode, setTemplateMode] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastTypingPing = useRef(0);

  const official = conversation.account.channel === "OFFICIAL";
  const windowClosed = official && !conversation.window?.open;

  // "/shortcut" suggestions from canned replies
  const slash = text.startsWith("/") && !text.includes(" ") ? text.slice(1).toLowerCase() : null;
  const suggestions = useMemo(
    () => (slash === null ? [] : canned.filter((c) => c.shortcut.startsWith(slash) || c.title.toLowerCase().includes(slash)).slice(0, 6)),
    [slash, canned],
  );

  function pingTyping() {
    const now = Date.now();
    if (now - lastTypingPing.current > 3000) {
      lastTypingPing.current = now;
      getSocket().emit("conversation.presence", {
        conversationId: conversation.id,
        state: "typing",
      });
    }
  }

  async function send() {
    if (sending) return;
    if (file) {
      const form = new FormData();
      form.append("file", file);
      form.append("caption", text.trim());
      if (replyTo) form.append("replyToId", replyTo.id);
      setSending(true);
      const res = await fetch(`/api/inbox/conversations/${conversation.id}/messages`, { method: "POST", body: form, credentials: "same-origin" });
      setSending(false);
      if (!res.ok) return toast.error((await res.json().catch(() => null))?.error ?? t("sendFailed"));
      setFile(null);
      setText("");
      return onSent();
    }
    const body = text.trim();
    if (!body) return;
    setSending(true);
    const res = await apiFetch(`/api/inbox/conversations/${conversation.id}/messages`, { body: { type: "text", body, replyToId: replyTo?.id } });
    setSending(false);
    if (!res.ok) return toast.error(res.error);
    setText("");
    onSent();
  }

  if (windowClosed || templateMode) {
    return (
      <TemplateSender
        conversation={conversation}
        windowClosed={windowClosed}
        onClose={windowClosed ? undefined : () => setTemplateMode(false)}
        onSent={() => {
          setTemplateMode(false);
          onSent();
        }}
      />
    );
  }

  return (
    <div className="border-t bg-background p-3">
      {replyTo && (
        <div className="mb-2 flex items-start gap-2 rounded-lg border-s-2 border-primary bg-muted/60 px-3 py-2 text-xs">
          <span className="min-w-0 flex-1">
            <span className="block font-medium">{t("replyingTo")}</span>
            <span className="line-clamp-1 text-muted-foreground">{replyTo.body ?? t("attachment")}</span>
          </span>
          <button type="button" onClick={onCancelReply} aria-label={t("cancelReply")}>
            <X className="size-4 text-muted-foreground" />
          </button>
        </div>
      )}
      {file && (
        <div className="mb-2 flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <FileText className="size-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate">{file.name}</span>
          <button type="button" onClick={() => setFile(null)} aria-label={t("removeFile")}>
            <X className="size-4 text-muted-foreground" />
          </button>
        </div>
      )}
      {suggestions.length > 0 && (
        <div className="mb-2 overflow-hidden rounded-lg border bg-popover shadow-sm">
          {suggestions.map((c) => (
            <button key={c.id} type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => setText(c.body)}>
              <code className="text-xs text-primary">/{c.shortcut}</code> <span className="font-medium">{c.title}</span>
              <span className="block truncate text-xs text-muted-foreground">{c.body}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <input
          ref={fileInput}
          type="file"
          className="hidden"
          accept="image/jpeg,image/png,image/webp,video/mp4,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            if (f.size > MAX_FILE_BYTES) return toast.error(t("fileTooLarge"));
            setFile(f);
          }}
        />
        <Button type="button" variant="ghost" size="icon" onClick={() => fileInput.current?.click()} aria-label={t("attach")}>
          <Paperclip className="size-5" />
        </Button>
        {/* field-sizing-content textareas don't grow as flex items; the wrapper takes the width */}
        <div className="min-w-0 flex-1">
          <Textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              pingTyping();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            maxLength={4096}
            placeholder={file ? t("captionPlaceholder") : t("messagePlaceholder")}
            className="max-h-40 min-h-9 resize-none"
            aria-label={t("messagePlaceholder")}
          />
        </div>
        <AiMenu conversationId={conversation.id} text={text} onText={setText} />
        {official && (
          <Button type="button" variant="ghost" size="icon" onClick={() => setTemplateMode(true)} aria-label={t("templateButton")} title={t("templateButton")}>
            <LayoutTemplate className="size-5" />
          </Button>
        )}
        <Button type="button" size="icon" onClick={() => void send()} disabled={sending || (!text.trim() && !file)} aria-label={t("send")}>
          {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </Button>
      </div>
    </div>
  );
}

function TemplateSender({
  conversation,
  windowClosed,
  onClose,
  onSent,
}: {
  conversation: ConversationItem;
  windowClosed: boolean;
  onClose?: () => void;
  onSent: () => void;
}) {
  const t = useTranslations("inbox");
  const [templates, setTemplates] = useState<TemplateItem[] | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    void apiFetch<{ templates: TemplateItem[] }>(`/api/templates?accountId=${conversation.account.id}`).then((res) => setTemplates(res.data?.templates ?? []));
  }, [conversation.account.id]);

  const selected = templates?.find((tp) => tp.id === selectedId);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selected) return;
    const f = new FormData(e.currentTarget);
    const headerParams = Array.from({ length: selected.headerVariables }, (_, i) => String(f.get(`h${i}`) ?? ""));
    const bodyParams = Array.from({ length: selected.bodyVariables }, (_, i) => String(f.get(`b${i}`) ?? ""));
    setSending(true);
    const res = await apiFetch(`/api/inbox/conversations/${conversation.id}/messages`, {
      body: {
        type: "template",
        templateId: selected.id,
        headerParams,
        bodyParams,
      },
    });
    setSending(false);
    if (!res.ok) return toast.error(res.error);
    onSent();
  }

  return (
    <form onSubmit={submit} className="grid gap-3 border-t bg-background p-3">
      <div className="flex items-start gap-2">
        <p className="flex-1 text-xs text-muted-foreground">{windowClosed ? t("windowClosed") : t("templateHelp")}</p>
        {onClose && (
          <button type="button" onClick={onClose} aria-label={t("cancel")}>
            <X className="size-4 text-muted-foreground" />
          </button>
        )}
      </div>
      {templates === null ? (
        <p className="text-sm text-muted-foreground">{t("loading")}</p>
      ) : templates.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noTemplates")}</p>
      ) : (
        <>
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
            aria-label={t("chooseTemplate")}
            required
          >
            <option value="">{t("chooseTemplate")}</option>
            {templates.map((tp) => (
              <option key={tp.id} value={tp.id} disabled={tp.mediaHeader}>
                {tp.name} ({tp.language}){tp.mediaHeader ? ` — ${t("mediaHeaderLater")}` : ""}
              </option>
            ))}
          </select>
          {selected && (
            <>
              <p className="whitespace-pre-wrap rounded-lg bg-muted/60 p-3 text-sm">{selected.preview}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {Array.from({ length: selected.headerVariables }, (_, i) => (
                  <Input key={`h${i}`} name={`h${i}`} placeholder={t("headerVariable", { n: i + 1 })} required maxLength={60} />
                ))}
                {Array.from({ length: selected.bodyVariables }, (_, i) => (
                  <Input key={`b${i}`} name={`b${i}`} placeholder={t("bodyVariable", { n: i + 1 })} required maxLength={1024} />
                ))}
              </div>
              <Button type="submit" disabled={sending} className="justify-self-end">
                <Send className="size-4" />
                {t("sendTemplate")}
              </Button>
            </>
          )}
        </>
      )}
    </form>
  );
}
