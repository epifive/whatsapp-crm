"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";
import { Bot, Copy, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Field, FormMessage } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/client/api-client";
import { cn } from "@/lib/utils";
import type { FlowInfo } from "./[id]/panels";

const STARTERS = ["blank", "welcome_menu", "lead_capture"] as const;

export function FlowsList({ canManage }: { canManage: boolean }) {
  const t = useTranslations("flows");
  const router = useRouter();
  const [flows, setFlows] = useState<FlowInfo[] | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch<{ flows: FlowInfo[] }>("/api/flows");
    if (res.ok && res.data) setFlows(res.data.flows);
  }, []);
  useEffect(() => {
    // Fetch on mount; state is only set once the request resolves
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function toggle(f: FlowInfo, on: boolean) {
    const res = await apiFetch(`/api/flows/${f.id}`, { method: "PATCH", body: { isActive: on } });
    if (!res.ok) {
      toast.error(res.error);
      return router.push(`/app/automations/${f.id}`);
    }
    toast.success(on ? t("activated") : t("deactivated"));
    void load();
  }

  async function duplicate(f: FlowInfo) {
    const res = await apiFetch<{ flow: FlowInfo }>(`/api/flows/${f.id}/duplicate`, { body: {} });
    if (!res.ok) return toast.error(res.error);
    void load();
  }

  async function remove(f: FlowInfo) {
    if (!confirm(t("confirmDelete", { name: f.name }))) return;
    const res = await apiFetch(`/api/flows/${f.id}`, { method: "DELETE", body: {} });
    if (!res.ok) return toast.error(res.error);
    void load();
  }

  return (
    <div className="grid max-w-5xl gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1 basis-56">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {canManage && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus />
            {t("new")}
          </Button>
        )}
      </div>

      {flows === null && <p className="py-6 text-center text-sm text-muted-foreground">{t("loading")}</p>}
      {flows?.length === 0 && (
        <Card>
          <CardContent className="grid justify-items-center gap-3 py-12 text-center">
            <Bot className="size-8 text-muted-foreground" />
            <p className="max-w-md text-sm text-muted-foreground">{t("empty")}</p>
            {canManage && (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus />
                {t("new")}
              </Button>
            )}
          </CardContent>
        </Card>
      )}
      {flows && flows.length > 0 && (
        <Card className="py-0">
          <CardContent className="divide-y px-0">
            {flows.map((f) => (
              <div key={f.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                {canManage && <Switch checked={f.isActive} onCheckedChange={(v) => void toggle(f, v)} aria-label={t("toggle", { name: f.name })} />}
                <div className="min-w-0 flex-1 basis-48">
                  {canManage ? (
                    <Link href={`/app/automations/${f.id}`} className="block truncate font-medium hover:underline">
                      {f.name}
                    </Link>
                  ) : (
                    <span className="block truncate font-medium">{f.name}</span>
                  )}
                  <div className="truncate text-xs text-muted-foreground">
                    {f.trigger === "KEYWORD" ? t("triggerKeyword", { keywords: f.keywords.join(", ") || "—" }) : t(`trigger.${f.trigger}`)}
                  </div>
                </div>
                <dl className="flex gap-5 text-center text-xs">
                  <div>
                    <dd className="text-sm font-semibold tabular-nums">{f.runs.toLocaleString()}</dd>
                    <dt className="text-muted-foreground">{t("runs")}</dt>
                  </div>
                  <div>
                    <dd className="text-sm font-semibold tabular-nums">{f.completions.toLocaleString()}</dd>
                    <dt className="text-muted-foreground">{t("completed")}</dt>
                  </div>
                  <div>
                    <dd className={cn("text-sm font-semibold tabular-nums", f.activeSessions > 0 && "text-primary")}>{f.activeSessions}</dd>
                    <dt className="text-muted-foreground">{t("inProgress")}</dt>
                  </div>
                </dl>
                {canManage && (
                  <div className="flex">
                    <Button variant="ghost" size="icon-sm" onClick={() => duplicate(f)} aria-label={t("duplicate")}>
                      <Copy />
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => remove(f)} aria-label={t("delete")}>
                      <Trash2 className="text-muted-foreground" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {creating && <NewFlowDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewFlowDialog({ onClose }: { onClose: () => void }) {
  const t = useTranslations("flows");
  const router = useRouter();
  const [starter, setStarter] = useState<(typeof STARTERS)[number]>("welcome_menu");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    const res = await apiFetch<{ flow: { id: string } }>("/api/flows", { body: { name: new FormData(e.currentTarget).get("name"), starter } });
    setPending(false);
    if (!res.ok) return setError(res.error);
    router.push(`/app/automations/${res.data!.flow.id}`);
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("new")}</DialogTitle>
            <DialogDescription>{t("newText")}</DialogDescription>
          </DialogHeader>
          <FormMessage type="error">{error}</FormMessage>
          <Field id="name" label={t("name")} required maxLength={100} placeholder={t("namePlaceholder")} autoFocus />
          <div className="grid gap-2" role="radiogroup" aria-label={t("startFrom")}>
            {STARTERS.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={starter === s}
                onClick={() => setStarter(s)}
                className={cn("rounded-lg border p-3 text-left", starter === s ? "border-primary bg-primary/5" : "hover:bg-muted")}
              >
                <div className="text-sm font-medium">{t(`starter.${s}.title`)}</div>
                <div className="text-xs text-muted-foreground">{t(`starter.${s}.text`)}</div>
              </button>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {t("create")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
