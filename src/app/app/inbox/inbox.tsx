"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MessageSquarePlus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/client/api-client";
import { debounce, useRealtime } from "@/lib/client/realtime";
import { cn } from "@/lib/utils";
import { ChatPane } from "./chat-pane";
import { ConversationRow } from "./conversation-row";
import { NewChatDialog } from "./new-chat-dialog";
import type { ConversationItem, InboxContext } from "./types";

type StatusFilter = "OPEN" | "PENDING" | "CLOSED" | "ALL";
type AssigneeFilter = "all" | "me" | "unassigned";

const selectClass = "h-8 rounded-md border border-input bg-transparent px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

export function Inbox({ ctx, initialConversationId }: { ctx: InboxContext; initialConversationId: string | null }) {
  const t = useTranslations("inbox");
  const [status, setStatus] = useState<StatusFilter>("OPEN");
  const [assignee, setAssignee] = useState<AssigneeFilter>("all");
  const [accountId, setAccountId] = useState("");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ConversationItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(initialConversationId);
  const [newChatOpen, setNewChatOpen] = useState(false);

  const params = useMemo(() => {
    const p = new URLSearchParams({ status, assignee });
    if (accountId) p.set("accountId", accountId);
    if (query.trim()) p.set("q", query.trim());
    return p.toString();
  }, [status, assignee, accountId, query]);

  const load = useCallback(async () => {
    const res = await apiFetch<{ conversations: ConversationItem[]; nextCursor: string | null }>(`/api/inbox/conversations?${params}`);
    if (res.ok && res.data) {
      setItems(res.data.conversations);
      setNextCursor(res.data.nextCursor);
    }
    setLoading(false);
  }, [params]);

  useEffect(() => {
    const timer = setTimeout(load, query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  async function loadMore() {
    if (!nextCursor) return;
    const res = await apiFetch<{ conversations: ConversationItem[]; nextCursor: string | null }>(`/api/inbox/conversations?${params}&cursor=${nextCursor}`);
    if (res.ok && res.data) {
      setItems((prev) => [...prev, ...res.data!.conversations.filter((c) => !prev.some((p) => p.id === c.id))]);
      setNextCursor(res.data.nextCursor);
    }
  }

  // Any message or conversation change in this workspace refreshes the list (coalesced)
  const refresh = useMemo(() => debounce(() => void load(), 400), [load]);
  useRealtime("message.created", refresh);
  useRealtime("message.updated", refresh);
  useRealtime("conversation.updated", refresh);
  useRealtime("contact.updated", refresh);

  // Keep the URL shareable (?c=<id>) without a navigation
  useEffect(() => {
    const url = new URL(window.location.href);
    if (selectedId) url.searchParams.set("c", selectedId);
    else url.searchParams.delete("c");
    window.history.replaceState(null, "", url);
  }, [selectedId]);

  const noNumbers = ctx.accounts.length === 0;

  return (
    <div className="flex h-full">
      {/* Conversation list (hidden on mobile while a chat is open) */}
      <section className={cn("flex w-full flex-col border-e bg-background md:w-80 lg:w-96", selectedId && "hidden md:flex")}>
        <div className="grid gap-2 border-b p-3">
          <div className="flex items-center gap-2">
            <h1 className="flex-1 text-lg font-semibold">{t("title")}</h1>
            <Button size="sm" variant="outline" onClick={() => setNewChatOpen(true)} disabled={noNumbers} title={t("newChat")}>
              <MessageSquarePlus className="size-4" />
              <span className="sr-only sm:not-sr-only">{t("newChat")}</span>
            </Button>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("search")} className="ps-8" aria-label={t("search")} />
          </div>
          <div className="flex flex-wrap gap-2">
            <select aria-label={t("statusFilter")} value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className={selectClass}>
              {(["OPEN", "PENDING", "CLOSED", "ALL"] as const).map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </select>
            <select aria-label={t("assigneeFilter")} value={assignee} onChange={(e) => setAssignee(e.target.value as AssigneeFilter)} className={selectClass}>
              <option value="all">{t("assignee.all")}</option>
              <option value="me">{t("assignee.me")}</option>
              <option value="unassigned">{t("assignee.unassigned")}</option>
            </select>
            {ctx.accounts.length > 1 && (
              <select aria-label={t("numberFilter")} value={accountId} onChange={(e) => setAccountId(e.target.value)} className={cn(selectClass, "max-w-36")}>
                <option value="">{t("allNumbers")}</option>
                {ctx.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {noNumbers ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {t("noNumbers")}{" "}
              <a href="/app/settings/numbers" className="font-medium text-primary hover:underline">
                {t("connectNumber")}
              </a>
            </div>
          ) : loading && items.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">{t("loading")}</div>
          ) : items.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">{t("empty")}</div>
          ) : (
            <>
              {items.map((c) => (
                <ConversationRow key={c.id} item={c} selected={c.id === selectedId} onSelect={() => setSelectedId(c.id)} />
              ))}
              {nextCursor && (
                <div className="p-3">
                  <Button variant="ghost" size="sm" className="w-full" onClick={loadMore}>
                    {t("loadMore")}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {/* Chat */}
      <section className={cn("min-w-0 flex-1", !selectedId && "hidden md:flex")}>
        {selectedId ? (
          <ChatPane key={selectedId} conversationId={selectedId} ctx={ctx} onBack={() => setSelectedId(null)} onChanged={refresh} />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-muted/30 p-6 text-center text-sm text-muted-foreground">{t("pickConversation")}</div>
        )}
      </section>

      <NewChatDialog
        open={newChatOpen}
        onOpenChange={setNewChatOpen}
        accounts={ctx.accounts}
        onStarted={(id) => {
          setNewChatOpen(false);
          setSelectedId(id);
          void load();
        }}
      />
    </div>
  );
}
