"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Bot, Pause, Play, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/client/api-client";

export interface AutomationState {
  pausedUntil: string | null;
  session: { id: string; flow: { id: string; name: string }; startedAt: string; waiting: "delay" | "answer" | null } | null;
}

const selectClass = "h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm";

/** Chatbot status for one chat: what's running, stop / pause / resume, start a flow by hand */
export function AutomationPanel({ conversationId, state, onChanged }: { conversationId: string; state: AutomationState; onChanged: () => void }) {
  const t = useTranslations("inbox.automation");
  const format = useFormatter();
  const [flows, setFlows] = useState<{ id: string; name: string; isActive: boolean }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void apiFetch<{ flows: { id: string; name: string; isActive: boolean }[] }>("/api/flows").then((r) => live && r.ok && setFlows(r.data!.flows));
    return () => {
      live = false;
    };
  }, []);

  async function act(action: "stop" | "pause" | "resume" | "start", flowId?: string) {
    setBusy(true);
    const res = await apiFetch(`/api/inbox/conversations/${conversationId}/automation`, { body: { action, flowId } });
    setBusy(false);
    if (!res.ok) return toast.error(res.error);
    if (action === "start") toast.success(t("started"));
    onChanged();
  }

  return (
    <div className="grid gap-2">
      <Label className="flex items-center gap-1.5">
        <Bot className="size-4" />
        {t("title")}
      </Label>
      {state.session ? (
        <div className="grid gap-2 rounded-lg border border-primary/30 bg-primary/5 p-2.5 text-sm">
          <div>
            {t("running")}{" "}
            <Link href={`/app/automations/${state.session.flow.id}`} className="font-medium hover:underline">
              {state.session.flow.name}
            </Link>
            {state.session.waiting && <span className="block text-xs text-muted-foreground">{t(`waiting.${state.session.waiting}`)}</span>}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act("stop")}>
              <Square />
              {t("stop")}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => act("pause")}>
              <Pause />
              {t("pause")}
            </Button>
          </div>
        </div>
      ) : state.pausedUntil ? (
        <div className="grid gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-sm dark:bg-amber-950/40">
          <span>{t("pausedUntil", { time: format.dateTime(new Date(state.pausedUntil), { weekday: "short", hour: "numeric", minute: "2-digit" }) })}</span>
          <Button size="sm" variant="outline" className="justify-self-start" disabled={busy} onClick={() => act("resume")}>
            <Play />
            {t("resume")}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t("idle")}</p>
      )}
      {flows.length > 0 && (
        <select
          className={selectClass}
          value=""
          disabled={busy}
          aria-label={t("startFlow")}
          onChange={(e) => {
            if (e.target.value && confirm(t("confirmStart"))) void act("start", e.target.value);
          }}
        >
          <option value="">{t("startFlow")}</option>
          {flows.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
              {f.isActive ? "" : ` (${t("off")})`}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
