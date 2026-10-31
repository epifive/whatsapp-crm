"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Megaphone, Plus } from "lucide-react";
import { LocalTime } from "@/components/crm/local-time";
import { Field, FormMessage } from "@/components/forms";
import { NativeSelect } from "@/components/native-select";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/client/api-client";
import { debounce, useRealtime } from "@/lib/client/realtime";
import { cn } from "@/lib/utils";
import { pct, STATUS_STYLE, type CampaignItem } from "./types";

type Account = { id: string; name: string; phone: string | null; channel: "OFFICIAL" | "QR" };

export function CampaignsList({ accounts, canManage }: { accounts: Account[]; canManage: boolean }) {
  const t = useTranslations("campaigns");
  const [campaigns, setCampaigns] = useState<CampaignItem[] | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const res = await apiFetch<{ campaigns: CampaignItem[] }>("/api/campaigns");
    if (res.ok && res.data) setCampaigns(res.data.campaigns);
  }, []);
  useEffect(() => {
    // Fetch on mount; state is only set once the request resolves
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  const refresh = useMemo(() => debounce(() => void load(), 1000), [load]);
  useRealtime("campaign.updated", refresh);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1 basis-56">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <Link href="/app/templates" className={buttonVariants({ variant: "outline", size: "sm" })}>
            {t("templates")}
          </Link>
          {canManage && (
            <Button size="sm" onClick={() => setCreating(true)} disabled={!accounts.length}>
              <Plus />
              {t("new")}
            </Button>
          )}
        </div>
      </div>

      {!accounts.length && (
        <Card>
          <CardContent className="grid justify-items-center gap-3 py-10 text-center text-sm text-muted-foreground">
            {t("noNumbers")}
            <Link href="/app/settings/numbers" className={buttonVariants({ size: "sm" })}>
              {t("connectNumber")}
            </Link>
          </CardContent>
        </Card>
      )}

      {campaigns === null && accounts.length > 0 && <p className="py-6 text-center text-sm text-muted-foreground">{t("loading")}</p>}
      {campaigns?.length === 0 && accounts.length > 0 && (
        <Card>
          <CardContent className="grid justify-items-center gap-3 py-12 text-center">
            <Megaphone className="size-8 text-muted-foreground" />
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

      {campaigns && campaigns.length > 0 && (
        <Card className="py-0">
          <CardContent className="divide-y px-0">
            {campaigns.map((c) => {
              const s = c.stats;
              const done = s ? s.total - s.pending - s.queued : 0;
              return (
                <Link key={c.id} href={`/app/campaigns/${c.id}`} className="grid gap-2 px-4 py-3 hover:bg-muted/50 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{c.name}</span>
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", STATUS_STYLE[c.status])}>{t(`status.${c.status}`)}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                      <span>
                        {c.account.name} · {t(`channel.${c.account.channel}`)}
                      </span>
                      {c.status === "SCHEDULED" && c.scheduledAt ? (
                        <span>
                          {t("scheduledFor")} <LocalTime iso={c.scheduledAt} options={{ dateStyle: "medium", timeStyle: "short" }} />
                        </span>
                      ) : (
                        <LocalTime iso={c.startedAt ?? c.createdAt} options={{ dateStyle: "medium" }} />
                      )}
                    </div>
                    {s && s.total > 0 && c.status !== "DRAFT" && (
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full bg-primary" style={{ width: pct(done, s.total) }} />
                      </div>
                    )}
                  </div>
                  {s && s.total > 0 && (
                    <dl className="grid grid-cols-4 gap-4 text-center text-xs sm:w-80">
                      {(
                        [
                          ["sent", s.sent],
                          ["delivered", s.delivered],
                          ["read", s.read],
                          ["replied", s.replied],
                        ] as const
                      ).map(([k, v]) => (
                        <div key={k}>
                          <dd className="text-sm font-semibold tabular-nums">{v.toLocaleString()}</dd>
                          <dt className="text-muted-foreground">{t(`stats.${k}`)}</dt>
                        </div>
                      ))}
                    </dl>
                  )}
                </Link>
              );
            })}
          </CardContent>
        </Card>
      )}

      {creating && <NewCampaignDialog accounts={accounts} onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewCampaignDialog({ accounts, onClose }: { accounts: Account[]; onClose: () => void }) {
  const t = useTranslations("campaigns");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPending(true);
    const res = await apiFetch<{ campaign: { id: string } }>("/api/campaigns", {
      body: { name: f.get("name"), accountId: f.get("accountId"), audience: { type: "all", tagIds: [], consent: "any" } },
    });
    setPending(false);
    if (!res.ok) return setError(res.error);
    router.push(`/app/campaigns/${res.data!.campaign.id}`);
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
          <Field id="name" label={t("name")} required maxLength={120} placeholder={t("namePlaceholder")} autoFocus />
          <div className="grid gap-1.5">
            <Label htmlFor="accountId">{t("number")}</Label>
            <NativeSelect id="accountId" name="accountId">
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {t(`channel.${a.channel}`)}
                </option>
              ))}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">{t("numberHint")}</p>
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
