"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { NativeSelect } from "@/components/native-select";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { TemplatePreview } from "@/components/whatsapp/message-preview";
import { apiFetch } from "@/lib/client/api-client";
import { debounce, useRealtime } from "@/lib/client/realtime";
import { cn } from "@/lib/utils";

interface TemplateRow {
  id: string;
  name: string;
  language: string;
  category: string;
  status: "APPROVED" | "PENDING" | "REJECTED" | "PAUSED" | "DISABLED";
  statusReason: string | null;
  components: unknown;
}

const STATUS_STYLE: Record<TemplateRow["status"], string> = {
  APPROVED: "bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300",
  PENDING: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  REJECTED: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  PAUSED: "bg-orange-50 text-orange-700 dark:bg-orange-950 dark:text-orange-300",
  DISABLED: "bg-muted text-muted-foreground",
};

type Filter = "all" | "APPROVED" | "PENDING" | "REJECTED";

export function TemplatesManager({
  accounts,
  initialAccountId,
  canManage,
}: {
  accounts: { id: string; name: string; phone: string | null }[];
  initialAccountId: string;
  canManage: boolean;
}) {
  const t = useTranslations("templates");
  const [accountId, setAccountId] = useState(initialAccountId);
  const [templates, setTemplates] = useState<TemplateRow[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    const res = await apiFetch<{ templates: TemplateRow[] }>(`/api/templates?accountId=${accountId}&all=1`);
    if (res.ok && res.data) setTemplates(res.data.templates);
  }, [accountId]);

  useEffect(() => {
    // Fetch when the number changes; state is only set once the request resolves
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  const refresh = useMemo(() => debounce(() => void load(), 400), [load]);
  useRealtime<{ accountId: string }>("templates.changed", (ev) => ev.accountId === accountId && refresh());

  async function sync() {
    setSyncing(true);
    const res = await apiFetch<{ count: number }>(`/api/whatsapp/accounts/${accountId}/sync-templates`, { body: {} });
    setSyncing(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(t("synced", { count: res.data!.count }));
    void load();
  }

  async function remove(tpl: TemplateRow) {
    if (!confirm(t("confirmDelete", { name: tpl.name }))) return;
    const res = await apiFetch(`/api/templates/${tpl.id}`, { method: "DELETE", body: {} });
    if (!res.ok) return toast.error(res.error);
    toast.success(t("deleted"));
    void load();
  }

  if (!accounts.length) {
    return (
      <div className="grid gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <Card>
          <CardContent className="grid justify-items-center gap-3 py-10 text-center text-sm text-muted-foreground">
            <p className="max-w-md">{t("noOfficial")}</p>
            <Link href="/app/settings/numbers" className={buttonVariants({ size: "sm" })}>
              {t("connectOfficial")}
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const shown = (templates ?? []).filter((x) => filter === "all" || x.status === filter || (filter === "REJECTED" && (x.status === "PAUSED" || x.status === "DISABLED")));

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1 basis-56">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={sync} disabled={syncing}>
              <RefreshCw className={cn(syncing && "animate-spin")} />
              {t("sync")}
            </Button>
            <Link href={`/app/templates/new?account=${accountId}`} className={buttonVariants({ size: "sm" })}>
              <Plus />
              {t("new")}
            </Link>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {accounts.length > 1 && (
          <NativeSelect aria-label={t("number")} value={accountId} onChange={(e) => setAccountId(e.target.value)} className="max-w-64">
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.phone ? ` (+${a.phone})` : ""}
              </option>
            ))}
          </NativeSelect>
        )}
        <div className="flex gap-1 relative overflow-x-auto rounded-lg bg-muted p-1" role="tablist" aria-label={t("statusFilter")}>
          {(["all", "APPROVED", "PENDING", "REJECTED"] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className={cn("rounded-md px-3 py-1 text-sm font-medium whitespace-nowrap", filter === f ? "bg-background shadow-xs" : "text-muted-foreground hover:text-foreground")}
            >
              {t(`filter.${f}`)}
            </button>
          ))}
        </div>
      </div>

      {templates === null && <p className="py-6 text-center text-sm text-muted-foreground">{t("loading")}</p>}
      {templates && shown.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">{templates.length ? t("noneInFilter") : t("empty")}</CardContent>
        </Card>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((tpl) => (
          <Card key={tpl.id} className="gap-3">
            <CardContent className="grid gap-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium" title={tpl.name}>
                    {tpl.name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {tpl.language} · {t(`category.${tpl.category}`)}
                  </div>
                </div>
                <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLE[tpl.status])}>{t(`status.${tpl.status}`)}</span>
                {canManage && (
                  <Button variant="ghost" size="icon-xs" aria-label={t("delete")} onClick={() => remove(tpl)}>
                    <Trash2 className="text-muted-foreground" />
                  </Button>
                )}
              </div>
              {tpl.statusReason && <p className="text-xs text-destructive">{t("reason", { reason: tpl.statusReason })}</p>}
              <TemplatePreview components={tpl.components} />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
