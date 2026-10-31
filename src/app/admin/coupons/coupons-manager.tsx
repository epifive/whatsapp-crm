"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Field, FormMessage } from "@/components/forms";
import { NativeSelect } from "@/components/native-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/client/api-client";
import { formatMoney } from "@/lib/billing/money";

interface CouponRow {
  id: string;
  code: string;
  percentOff: number | null;
  amountOff: number | null;
  planIds: string[];
  maxRedemptions: number | null;
  redemptions: number;
  expiresAt: string | null;
  isActive: boolean;
}

export function CouponsManager({ coupons, plans, currency }: { coupons: CouponRow[]; plans: { id: string; name: string }[]; currency: string }) {
  const t = useTranslations("adminCoupons");
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const planName = new Map(plans.map((p) => [p.id, p.name]));

  async function toggle(c: CouponRow, isActive: boolean) {
    const res = await apiFetch(`/api/admin/coupons/${c.id}`, { method: "PATCH", body: { isActive } });
    if (!res.ok) return toast.error(res.error);
    router.refresh();
  }
  async function remove(c: CouponRow) {
    if (!confirm(t("confirmDelete", { code: c.code }))) return;
    const res = await apiFetch(`/api/admin/coupons/${c.id}`, { method: "DELETE", body: {} });
    if (!res.ok) return toast.error(res.error);
    router.refresh();
  }

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus />
          {t("new")}
        </Button>
      </div>
      <Card className="py-0">
        <CardContent className="divide-y p-0">
          {!coupons.length && <p className="p-6 text-center text-sm text-muted-foreground">{t("empty")}</p>}
          {coupons.map((c) => {
            const expired = !!c.expiresAt && new Date(c.expiresAt) < new Date();
            return (
              <div key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
                <Switch checked={c.isActive} onCheckedChange={(v) => void toggle(c, v)} aria-label={t("activeFor", { code: c.code })} />
                <div className="min-w-0 flex-1">
                  <div className="font-mono font-semibold">{c.code}</div>
                  <div className="text-xs text-muted-foreground">
                    {c.planIds.length ? c.planIds.map((id) => planName.get(id) ?? "?").join(", ") : t("allPlans")}
                    {c.expiresAt && ` · ${t("expires", { date: new Date(c.expiresAt).toLocaleDateString() })}`}
                  </div>
                </div>
                <Badge variant="secondary">{c.percentOff ? t("percentOff", { n: c.percentOff }) : t("amountOff", { amount: formatMoney(c.amountOff ?? 0, currency) })}</Badge>
                <span className="tabular-nums text-muted-foreground">{c.maxRedemptions ? t("usedOf", { used: c.redemptions, max: c.maxRedemptions }) : t("used", { used: c.redemptions })}</span>
                {expired && <Badge variant="outline">{t("expired")}</Badge>}
                <Button variant="ghost" size="icon-sm" onClick={() => void remove(c)} aria-label={t("delete")}>
                  <Trash2 className="text-muted-foreground" />
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>
      {creating && (
        <CouponDialog
          plans={plans}
          currency={currency}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function CouponDialog({ plans, currency, onClose, onSaved }: { plans: { id: string; name: string }[]; currency: string; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations("adminCoupons");
  const [type, setType] = useState<"percent" | "amount">("percent");
  const [planIds, setPlanIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const res = await apiFetch("/api/admin/coupons", {
      body: {
        code: f.get("code"),
        type,
        ...(type === "percent" ? { percentOff: f.get("percentOff") } : { amountOff: f.get("amountOff") }),
        planIds,
        maxRedemptions: f.get("maxRedemptions") || null,
        expiresAt: f.get("expiresAt") || null,
      },
    });
    if (!res.ok) return setError(res.error);
    toast.success(t("created"));
    onSaved();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("new")}</DialogTitle>
          </DialogHeader>
          <FormMessage type="error">{error}</FormMessage>
          <Field id="code" label={t("code")} required maxLength={30} placeholder="DIWALI25" className="uppercase" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="type">{t("type")}</Label>
              <NativeSelect id="type" value={type} onChange={(e) => setType(e.target.value as "percent" | "amount")}>
                <option value="percent">{t("typePercent")}</option>
                <option value="amount">{t("typeAmount", { currency })}</option>
              </NativeSelect>
            </div>
            {type === "percent" ? (
              <Field id="percentOff" type="number" min={1} max={100} label={t("percent")} required />
            ) : (
              <Field id="amountOff" inputMode="decimal" label={t("amount", { currency })} required placeholder="100" />
            )}
            <Field id="maxRedemptions" type="number" min={1} label={t("maxRedemptions")} hint={t("maxRedemptionsHint")} />
            <Field id="expiresAt" type="date" label={t("expiresAt")} hint={t("expiresAtHint")} />
          </div>
          <fieldset className="grid gap-2 rounded-lg border p-3">
            <legend className="px-1 text-sm font-medium">{t("plans")}</legend>
            <p className="text-xs text-muted-foreground">{t("plansHint")}</p>
            {plans.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={planIds.includes(p.id)}
                  onChange={(e) => setPlanIds(e.target.checked ? [...planIds, p.id] : planIds.filter((x) => x !== p.id))}
                  className="size-4 accent-[var(--primary)]"
                />
                {p.name}
              </label>
            ))}
          </fieldset>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button type="submit">{t("create")}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
