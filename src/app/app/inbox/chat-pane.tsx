"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, PanelRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { apiFetch } from "@/lib/client/api-client";
import { debounce, getSocket, useRealtime } from "@/lib/client/realtime";
import { Composer } from "./composer";
import type { AutomationState } from "./automation-panel";
import { DetailsPanel } from "./details-panel";
import { MessageBubble } from "./message-bubble";
import type { ConversationItem, InboxContext, MessageItem, NoteItem } from "./types";

interface Presence {
  name: string;
  state: "viewing" | "typing";
  at: number;
}

export function ChatPane({
  conversationId,
  ctx,
  onBack,
  onChanged,
}: {
  conversationId: string;
  ctx: InboxContext;
  onBack: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations("inbox");
  const [conversation, setConversation] = useState<ConversationItem | null>(null);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [automation, setAutomation] = useState<AutomationState>({ pausedUntil: null, session: null });
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [replyTo, setReplyTo] = useState<MessageItem | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [presence, setPresence] = useState<Record<string, Presence>>({});
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const loadConversation = useCallback(async () => {
    const res = await apiFetch<{ conversation: ConversationItem; notes: NoteItem[]; automation: AutomationState }>(`/api/inbox/conversations/${conversationId}`);
    if (res.status === 404) return setNotFound(true);
    if (res.ok && res.data) {
      setConversation(res.data.conversation);
      setNotes(res.data.notes);
      setAutomation(res.data.automation);
    }
  }, [conversationId]);

  // Latest page, merged with any older pages already loaded
  const loadLatest = useCallback(async () => {
    const res = await apiFetch<{ messages: MessageItem[]; hasMore: boolean }>(`/api/inbox/conversations/${conversationId}/messages`);
    if (!res.ok || !res.data) return;
    const latest = res.data.messages;
    setMessages((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]));
      for (const m of latest) byId.set(m.id, m);
      return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    });
    setHasMore((h) => (messages.length === 0 ? res.data!.hasMore : h));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the first page decides hasMore
  }, [conversationId]);

  async function loadOlder() {
    const oldest = messages[0];
    if (!oldest) return;
    const el = scroller.current;
    const prevHeight = el?.scrollHeight ?? 0;
    const res = await apiFetch<{ messages: MessageItem[]; hasMore: boolean }>(`/api/inbox/conversations/${conversationId}/messages?before=${oldest.id}`);
    if (!res.ok || !res.data) return;
    stickToBottom.current = false;
    setMessages((prev) => [...res.data!.messages.filter((m) => !prev.some((p) => p.id === m.id)), ...prev]);
    setHasMore(res.data.hasMore);
    // Keep the viewport on the same message after prepending
    requestAnimationFrame(() => {
      if (el) el.scrollTop = el.scrollHeight - prevHeight;
    });
  }

  const markRead = useCallback(() => {
    void apiFetch(`/api/inbox/conversations/${conversationId}/read`, { method: "POST", body: {} }).then(onChanged);
  }, [conversationId, onChanged]);

  useEffect(() => {
    // Data loads set state only after their fetch resolves, not synchronously in the effect
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadConversation();
    void loadLatest();
    markRead();
    const socket = getSocket();
    socket.emit("conversation.presence", { conversationId, state: "viewing" });
    return () => {
      socket.emit("conversation.presence", { conversationId, state: "left" });
    };
  }, [conversationId, loadConversation, loadLatest, markRead]);

  const refreshMessages = useMemo(() => debounce(() => void loadLatest(), 150), [loadLatest]);
  const refreshConversation = useMemo(() => debounce(() => void loadConversation(), 300), [loadConversation]);

  useRealtime<{ conversationId: string }>("message.created", (ev) => {
    if (ev.conversationId !== conversationId) return;
    refreshMessages();
    refreshConversation();
    if (document.visibilityState === "visible") markRead();
  });
  useRealtime<{ conversationId: string }>("message.updated", (ev) => {
    if (ev.conversationId === conversationId) refreshMessages();
  });
  useRealtime<{ conversationId: string }>("conversation.updated", (ev) => {
    if (ev.conversationId === conversationId) refreshConversation();
  });
  useRealtime("contact.updated", refreshConversation);
  useRealtime<{ conversationId: string; userId: string; name: string; state: "viewing" | "typing" | "left" }>("conversation.presence", (ev) => {
    if (ev.conversationId !== conversationId || ev.userId === ctx.me.id) return;
    setPresence((p) => {
      const next = { ...p };
      if (ev.state === "left") delete next[ev.userId];
      else next[ev.userId] = { name: ev.name, state: ev.state, at: Date.now() };
      return next;
    });
  });
  // Typing indicators fade after a few seconds without updates
  useEffect(() => {
    const timer = setInterval(() => {
      setPresence((p) => {
        const now = Date.now();
        let changed = false;
        const next: Record<string, Presence> = {};
        for (const [id, v] of Object.entries(p)) {
          if (v.state === "typing" && now - v.at > 6000) {
            next[id] = { ...v, state: "viewing" };
            changed = true;
          } else next[id] = v;
        }
        return changed ? next : p;
      });
    }, 2000);
    return () => clearInterval(timer);
  }, []);

  // Follow new messages while the user is at the bottom
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const others = Object.values(presence);
  const typing = others.filter((p) => p.state === "typing");

  if (notFound) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground">
        {t("notFound")}
        <Button variant="outline" size="sm" onClick={onBack}>
          {t("back")}
        </Button>
      </div>
    );
  }

  const details = conversation && (
    <DetailsPanel
      conversation={conversation}
      notes={notes}
      automation={automation}
      ctx={ctx}
      onChanged={async () => {
        await loadConversation();
        onChanged();
      }}
    />
  );

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col bg-muted/30">
        <header className="flex items-center gap-2 border-b bg-background px-3 py-2">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={onBack} aria-label={t("back")}>
            <ArrowLeft className="size-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{conversation?.contact.name ?? "…"}</div>
            <div className="truncate text-xs text-muted-foreground">
              {typing.length > 0
                ? t("typing", { names: typing.map((p) => p.name).join(", ") })
                : others.length > 0
                  ? t("viewing", { names: others.map((p) => p.name).join(", ") })
                  : conversation
                    ? `+${conversation.contact.phone} · ${conversation.account.name}`
                    : ""}
            </div>
          </div>
          <Button variant="ghost" size="icon" className="xl:hidden" onClick={() => setDetailsOpen(true)} aria-label={t("details")}>
            <PanelRight className="size-5" />
          </Button>
        </header>

        <div
          ref={scroller}
          className="flex-1 overflow-y-auto px-3 py-4 sm:px-6"
          onScroll={(e) => {
            const el = e.currentTarget;
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          {hasMore && (
            <div className="mb-4 text-center">
              <Button variant="ghost" size="sm" onClick={loadOlder}>
                {t("loadOlder")}
              </Button>
            </div>
          )}
          <div className="grid gap-2">
            {messages.map((m) => (
              <MessageBubble key={m.id} m={m} quoted={m.replyToId ? byId.get(m.replyToId) : undefined} onReply={() => setReplyTo(m)} />
            ))}
          </div>
          {messages.length === 0 && conversation && <p className="mt-10 text-center text-sm text-muted-foreground">{t("startTheConversation")}</p>}
        </div>

        {conversation && (
          <Composer
            conversation={conversation}
            canned={ctx.canned}
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
            onSent={() => {
              setReplyTo(null);
              stickToBottom.current = true;
              void loadLatest();
              onChanged();
            }}
          />
        )}
      </div>

      {/* Details: side panel on wide screens, sheet on smaller ones */}
      <aside className="hidden w-80 shrink-0 overflow-y-auto border-s bg-background xl:block">{details}</aside>
      <Sheet open={detailsOpen} onOpenChange={setDetailsOpen}>
        <SheetContent side="right" className="w-80 overflow-y-auto p-0 xl:hidden">
          <SheetTitle className="sr-only">{t("details")}</SheetTitle>
          {details}
        </SheetContent>
      </Sheet>
    </div>
  );
}
