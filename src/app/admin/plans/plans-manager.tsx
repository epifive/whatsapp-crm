"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Field, FormMessage } from "@/components/forms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/client/api-client";
import { formatMoney, fromMinor } from "@/lib/billing/money";
import { ALL_FEATURES, FEATURE_KEYS, LIMIT_KEYS, UNLIMITED, type PlanFeatures, type PlanLimits } from "@/lib/billing/plans";

export interface AdminPlan {
  id: string;
  name: string;
  description: string;
  priceMonthly: number;
  priceYearly: number;
  trialDays: number;
  limits: PlanLimits;
  features: PlanFeatures;
  isPublic: boolean;
  isActive: boolean;
  sortOrder: number;
  workspaces: number;
}

export function PlansManager({ plans, currency, signupPlanId }: { plans: AdminPlan[]; currency: string; signupPlanId: string | null }) {
  const t = useTranslations("adminPlans");
  const router = useRouter();
  const [editing, setEditing] = useState<AdminPlan | "new" | null>(null);

  async function remove(p: AdminPlan) {
    if (!confirm(t("confirmDelete", { name: p.name }))) return;
    const res = await apiFetch(`/api/admin/plans/${p.id}`, { method: "DELETE", body: {} });
    if (!res.ok) return toast.error(res.error);
    toast.success(t("deleted"));
    router.refresh();
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle", { currency })}</p>
        </div>
        <Button onClick={() => setEditing("new")}>
          <Plus />
          {t("new")}
        </Button>
      </div>
      {!plans.length && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">{t("empty")}</CardContent>
        </Card>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {plans.map((p) => (
          <Card key={p.id} className={p.isActive ? undefined : "opacity-70"}>
            <CardContent className="grid gap-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{p.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {p.priceMonthly === 0 && p.priceYearly === 0
                      ? t("free")
                      : [p.priceMonthly ? t("perMonth", { price: formatMoney(p.priceMonthly, currency) }) : null, p.priceYearly ? t("perYear", { price: formatMoney(p.priceYearly, currency) }) : null].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <Button variant="ghost" size="icon-sm" onClick={() => setEditing(p)} aria-label={t("edit")}>
                  <Pencil />
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => void remove(p)} aria-label={t("delete")}>
                  <Trash2 className="text-muted-foreground" />
                </Button>
              </div>
              <div className="flex flex-wrap gap-1">
                {p.id === signupPlanId && <Badge>{t("signupPlan")}</Badge>}
                <Badge variant={p.isActive ? "secondary" : "outline"}>{p.isActive ? t("active") : t("inactive")}</Badge>
                <Badge variant="outline">{p.isPublic ? t("public") : t("hidden")}</Badge>
                {p.trialDays > 0 && <Badge variant="outline">{t("trialDays", { days: p.trialDays })}</Badge>}
              </div>
              <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-sm">
                {LIMIT_KEYS.map((k) => (
                  <div key={k} className="contents">
                    <dt className="text-muted-foreground">{t(`limit.${k}`)}</dt>
                    <dd className="text-end tabular-nums">{p.limits[k] === UNLIMITED ? "∞" : p.limits[k].toLocaleString()}</dd>
                  </div>
                ))}
              </dl>
              <div className="flex flex-wrap gap-1">
                {FEATURE_KEYS.filter((f) => p.features[f]).map((f) => (
                  <Badge key={f} variant="outline" className="font-normal">
                    {t(`feature.${f}`)}
                  </Badge>
                ))}
              </div>
              <div className="text-xs text-muted-foreground">{t("workspaces", { count: p.workspaces })}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      {editing && (
        <PlanDialog
          plan={editing === "new" ? null : editing}
          currency={currency}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

const DEFAULT_LIMITS: PlanLimits = { numbers: 1, members: 3, contacts: 1000, campaignsPerMonth: 10, flows: 5 };

function PlanDialog({ plan, currency, onClose, onSaved }: { plan: AdminPlan | null; currency: string; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations("adminPlans");
  const [limits, setLimits] = useState<PlanLimits>(plan?.limits ?? DEFAULT_LIMITS);
  const [features, setFeatures] = useState<PlanFeatures>(plan?.features ?? ALL_FEATURES);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      name: f.get("name"),
      description: f.get("description"),
      priceMonthly: f.get("priceMonthly"),
      priceYearly: f.get("priceYearly"),
      trialDays: f.get("trialDays"),
      sortOrder: f.get("sortOrder"),
      isPublic: f.get("isPublic") === "on",
      isActive: f.get("isActive") === "on",
      limits,
      features,
    };
    setBusy(true);
    const res = plan ? await apiFetch(`/api/admin/plans/${plan.id}`, { method: "PATCH", body }) : await apiFetch("/api/admin/plans", { body });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    toast.success(t("saved"));
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{plan ? t("editTitle", { name: plan.name }) : t("new")}</DialogTitle>
          </DialogHeader>
          <FormMessage type="error">{error}</FormMessage>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="name" label={t("name")} defaultValue={plan?.name} required maxLength={60} placeholder={t("namePlaceholder")} />
            <Field id="description" label={t("description")} defaultValue={plan?.description} maxLength={300} placeholder={t("descriptionPlaceholder")} />
            <Field id="priceMonthly" label={t("priceMonthly", { currency })} inputMode="decimal" defaultValue={plan ? fromMinor(plan.priceMonthly, currency) : "0"} hint={t("priceHint")} />
            <Field id="priceYearly" label={t("priceYearly", { currency })} inputMode="decimal" defaultValue={plan ? fromMinor(plan.priceYearly, currency) : "0"} hint={t("priceHint")} />
            <Field id="trialDays" type="number" min={0} max={365} label={t("trial")} defaultValue={plan?.trialDays ?? 14} hint={t("trialHint")} />
            <Field id="sortOrder" type="number" min={0} max={1000} label={t("sortOrder")} defaultValue={plan?.sortOrder ?? 0} hint={t("sortOrderHint")} />
          </div>

          <fieldset className="grid gap-2 rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">{t("limits")}</legend>
            {LIMIT_KEYS.map((k) => {
              const unlimited = limits[k] === UNLIMITED;
              return (
                <div key={k} className="grid grid-cols-[1fr_7rem_auto] items-center gap-3 text-sm">
                  <Label htmlFor={`limit-${k}`}>{t(`limit.${k}`)}</Label>
                  <input
                    id={`limit-${k}`}
                    type="number"
                    min={0}
                    disabled={unlimited}
                    value={unlimited ? "" : limits[k]}
                    onChange={(e) => setLimits({ ...limits, [k]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                    className="h-8 rounded-md border border-input bg-transparent px-2 text-sm disabled:opacity-50"
                  />
                  <label className="flex items-center gap-1.5 whitespace-nowrap text-xs">
                    <input type="checkbox" checked={unlimited} onChange={(e) => setLimits({ ...limits, [k]: e.target.checked ? UNLIMITED : DEFAULT_LIMITS[k] })} className="size-4 accent-[var(--primary)]" />
                    {t("unlimited")}
                  </label>
                </div>
              );
            })}
          </fieldset>

          <fieldset className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
            <legend className="px-1 text-sm font-medium">{t("features")}</legend>
            {FEATURE_KEYS.map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={features[k]} onChange={(e) => setFeatures({ ...features, [k]: e.target.checked })} className="size-4 accent-[var(--primary)]" />
                {t(`feature.${k}`)}
              </label>
            ))}
          </fieldset>

          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="isActive" defaultChecked={plan?.isActive ?? true} className="size-4 accent-[var(--primary)]" />
              {t("activeLabel")}
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="isPublic" defaultChecked={plan?.isPublic ?? true} className="size-4 accent-[var(--primary)]" />
              {t("publicLabel")}
            </label>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={busy}>
              {t("save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
