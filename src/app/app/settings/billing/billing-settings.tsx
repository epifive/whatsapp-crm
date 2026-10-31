"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Minus } from "lucide-react";
import { toast } from "sonner";
import { Field, FormMessage } from "@/components/forms";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/client/api-client";
import { formatMoney } from "@/lib/billing/money";
import { FEATURE_KEYS, LIMIT_KEYS, UNLIMITED, type FeatureKey, type LimitKey, type PlanFeatures, type PlanLimits } from "@/lib/billing/plans";
import { cn } from "@/lib/utils";
import { CheckoutDialog, OfflineReferenceForm, type CheckoutTarget, type Gateway } from "./checkout-dialog";

type Interval = "MONTHLY" | "YEARLY";

export interface PlanView {
  id: string;
  name: string;
  description: string | null;
  priceMonthly: number;
  priceYearly: number;
  trialDays: number;
  limits: PlanLimits;
  features: PlanFeatures;
}

interface InvoiceRow {
  id: string;
  number: string;
  description: string;
  total: number;
  currency: string;
  status: "OPEN" | "PAID" | "VOID";
  createdAt: string;
  paidAt: string | null;
  payment: { id: string; gateway: string; status: string; reference: string | null } | null;
}

interface BillingData {
  enabled: boolean;
  currency: string;
  tax: { name: string; percent: number } | null;
  subscription: {
    planId: string;
    planName: string;
    status: "TRIALING" | "ACTIVE" | "PAST_DUE" | "EXPIRED";
    interval: Interval;
    currentPeriodEnd: string | null;
    trialEndsAt: string | null;
    graceEndsAt: string | null;
  } | null;
  locked: string | null;
  limits: PlanLimits;
  features: PlanFeatures;
  usage: Record<LimitKey, number>;
  plans: PlanView[];
  gateways: Gateway[];
  invoices: InvoiceRow[];
  details: { name: string; email: string; address: string; taxId: string };
}

const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "");

export function BillingSettings() {
  const t = useTranslations("billing");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [data, setData] = useState<BillingData | null>(null);
  const [interval, setInterval] = useState<Interval>("MONTHLY");
  const [checkout, setCheckout] = useState<CheckoutTarget | null>(null);
  const handledReturn = useRef(false);

  const load = useCallback(async () => {
    const res = await apiFetch<BillingData>("/api/billing");
    if (res.ok && res.data) {
      setData(res.data);
      if (res.data.subscription?.status !== "TRIALING" && res.data.subscription?.interval) setInterval(res.data.subscription.interval);
    }
  }, []);
  useEffect(() => {
    // Fetch on mount; state is only set once the request resolves
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Back from Stripe / PayPal: check the payment, then clean the URL
  useEffect(() => {
    const paymentId = params.get("payment");
    if (!paymentId || handledReturn.current) return;
    handledReturn.current = true;
    const cancelled = params.get("cancelled") === "1";
    void (async () => {
      if (cancelled) toast.message(t("paymentCancelled"));
      else {
        const res = await apiFetch<{ outcome: string }>("/api/billing/confirm", { body: { paymentId } });
        if (!res.ok) toast.error(res.error);
        else if (res.data!.outcome === "paid") toast.success(t("paymentDone"));
        else if (res.data!.outcome === "failed") toast.error(t("paymentFailed"));
        else toast.message(t("paymentProcessing"));
      }
      router.replace(pathname);
      router.refresh();
      void load();
    })();
  }, [params, pathname, router, load, t]);

  if (!data) return <p className="py-6 text-center text-sm text-muted-foreground">{t("loading")}</p>;
  const sub = data.subscription;
  const money = (n: number) => formatMoney(n, data.currency);
  const statusTone = sub?.status === "ACTIVE" ? "default" : sub?.status === "TRIALING" ? "secondary" : "destructive";
  const currentPlan = data.plans.find((p) => p.id === sub?.planId);
  const renewable = !!currentPlan && !!sub && (currentPlan.priceMonthly > 0 || currentPlan.priceYearly > 0);

  function open(plan: PlanView, iv: Interval) {
    setCheckout({ plan, interval: iv });
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("currentPlan")}</CardTitle>
          <CardDescription>{t("currentPlanText")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-lg border p-4">
            {sub ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xl font-semibold">{sub.planName}</span>
                  <Badge variant={statusTone}>{t(`status.${sub.status}`)}</Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {sub.status === "TRIALING"
                    ? t("trialEnds", { date: fmtDate(sub.trialEndsAt ?? sub.currentPeriodEnd) })
                    : sub.status === "PAST_DUE"
                      ? t("graceEnds", { date: fmtDate(sub.graceEndsAt) })
                      : sub.status === "EXPIRED"
                        ? t("expiredText")
                        : sub.currentPeriodEnd
                          ? t("paidUntil", { date: fmtDate(sub.currentPeriodEnd), interval: t(`interval.${sub.interval}`) })
                          : t("noEnd")}
                </p>
                {renewable && sub.status !== "TRIALING" && (
                  <Button className="mt-3" size="sm" variant={sub.status === "ACTIVE" ? "outline" : "default"} onClick={() => open(currentPlan!, sub.interval)}>
                    {sub.status === "ACTIVE" ? t("renewEarly") : t("renewNow")}
                  </Button>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t("noPlan")}</p>
            )}
          </div>
          <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2 lg:col-span-2">
            {LIMIT_KEYS.map((k) => (
              <UsageMeter key={k} label={t(`limit.${k}`)} used={data.usage[k]} max={data.limits[k]} unlimitedLabel={t("unlimited")} />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("plans")}</CardTitle>
          <CardDescription>{t("plansText")}</CardDescription>
          <div className="mt-2 inline-flex w-fit rounded-lg border p-0.5" role="radiogroup" aria-label={t("billingPeriod")}>
            {(["MONTHLY", "YEARLY"] as const).map((iv) => (
              <button
                key={iv}
                type="button"
                role="radio"
                aria-checked={interval === iv}
                onClick={() => setInterval(iv)}
                className={cn("rounded-md px-3 py-1 text-sm font-medium", interval === iv ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
              >
                {t(`interval.${iv}`)}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.plans.map((p) => {
            const price = interval === "YEARLY" ? p.priceYearly : p.priceMonthly;
            const free = p.priceMonthly === 0 && p.priceYearly === 0;
            const sold = free || price > 0;
            const current = p.id === sub?.planId && (free || sub?.interval === interval) && sub?.status !== "TRIALING";
            const saving = interval === "YEARLY" && p.priceMonthly > 0 && p.priceYearly > 0 ? Math.round((1 - p.priceYearly / (p.priceMonthly * 12)) * 100) : 0;
            return (
              <div key={p.id} className={cn("flex flex-col rounded-lg border p-4", p.id === sub?.planId && "border-primary")}>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{p.name}</span>
                  {p.id === sub?.planId && <Badge variant="secondary">{t("yourPlan")}</Badge>}
                </div>
                {p.description && <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>}
                <div className="mt-3">
                  {free ? (
                    <span className="text-2xl font-semibold">{t("free")}</span>
                  ) : sold ? (
                    <>
                      <span className="text-2xl font-semibold">{money(price)}</span>
                      <span className="text-sm text-muted-foreground"> / {t(`per.${interval}`)}</span>
                      {saving > 0 && <span className="ms-2 text-xs font-medium text-green-700 dark:text-green-500">{t("save", { percent: saving })}</span>}
                    </>
                  ) : (
                    <span className="text-sm text-muted-foreground">{t(`notSold.${interval}`)}</span>
                  )}
                  {data.tax && !free && sold && <div className="text-xs text-muted-foreground">{t("plusTax", { name: data.tax.name })}</div>}
                </div>
                <ul className="mt-3 grid flex-1 gap-1 text-sm">
                  {LIMIT_KEYS.map((k) => (
                    <li key={k} className="flex gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                      {p.limits[k] === UNLIMITED ? t(`planLimitUnlimited.${k}`) : t(`planLimit.${k}`, { n: p.limits[k] })}
                    </li>
                  ))}
                  {FEATURE_KEYS.map((f) => (
                    <FeatureLine key={f} feature={f} on={p.features[f]} label={t(`feature.${f}`)} />
                  ))}
                </ul>
                <Button className="mt-4" variant={current ? "outline" : "default"} disabled={!sold || (current && free)} onClick={() => open(p, free ? "MONTHLY" : interval)}>
                  {current ? (free ? t("currentPlanButton") : t("renew")) : free ? t("switchFree") : t("choose")}
                </Button>
              </div>
            );
          })}
          {!data.plans.length && <p className="text-sm text-muted-foreground">{t("noPlans")}</p>}
        </CardContent>
      </Card>

      <InvoicesCard invoices={data.invoices} onChanged={load} />
      <DetailsCard initial={data.details} />

      {checkout && (
        <CheckoutDialog
          target={checkout}
          currency={data.currency}
          gateways={data.gateways}
          onClose={() => setCheckout(null)}
          onPaid={() => {
            setCheckout(null);
            router.refresh();
            void load();
          }}
        />
      )}
    </div>
  );
}

function UsageMeter({ label, used, max, unlimitedLabel }: { label: string; used: number; max: number; unlimitedLabel: string }) {
  const unlimited = max === UNLIMITED;
  const pct = unlimited ? 0 : max === 0 ? 100 : Math.min(100, Math.round((used / max) * 100));
  // Amber when (nearly) full; red only when over the limit (e.g. after moving to a smaller plan)
  const tone = !unlimited && used > max ? "bg-destructive" : pct >= 80 ? "bg-amber-500" : "bg-primary";
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="min-w-0 truncate text-muted-foreground" title={label}>
          {label}
        </span>
        <span className="shrink-0 whitespace-nowrap tabular-nums">
          {used.toLocaleString()} / {unlimited ? unlimitedLabel : max.toLocaleString()}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={label} aria-valuenow={used} aria-valuemax={unlimited ? undefined : max}>
        {!unlimited && <div className={cn("h-full rounded-full", tone)} style={{ width: `${pct}%` }} />}
      </div>
    </div>
  );
}

function FeatureLine({ feature, on, label }: { feature: FeatureKey; on: boolean; label: string }) {
  return (
    <li key={feature} className={cn("flex gap-2", !on && "text-muted-foreground line-through")}>
      {on ? <Check className="mt-0.5 size-4 shrink-0 text-primary" /> : <Minus className="mt-0.5 size-4 shrink-0" />}
      {label}
    </li>
  );
}

function InvoicesCard({ invoices, onChanged }: { invoices: InvoiceRow[]; onChanged: () => void }) {
  const t = useTranslations("billing");
  const [reporting, setReporting] = useState<InvoiceRow | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("invoices")}</CardTitle>
        <CardDescription>{t("invoicesText")}</CardDescription>
      </CardHeader>
      <CardContent>
        {!invoices.length ? (
          <p className="text-sm text-muted-foreground">{t("noInvoices")}</p>
        ) : (
          <div className="divide-y">
            {invoices.map((i) => {
              const waiting = i.status === "OPEN" && i.payment?.status === "REVIEW";
              const needsReference = i.status === "OPEN" && i.payment?.gateway === "OFFLINE" && i.payment.status === "PENDING";
              return (
                <div key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-sm first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{i.number}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {fmtDate(i.createdAt)} · {i.description}
                    </div>
                  </div>
                  <span className="tabular-nums">{formatMoney(i.total, i.currency)}</span>
                  <Badge variant={i.status === "PAID" ? "default" : i.status === "VOID" ? "outline" : "secondary"}>{waiting ? t("invoiceStatus.REVIEW") : t(`invoiceStatus.${i.status}`)}</Badge>
                  {needsReference && (
                    <Button size="sm" variant="outline" onClick={() => setReporting(i)}>
                      {t("reportPayment")}
                    </Button>
                  )}
                  <Link href={`/app/settings/billing/invoices/${i.id}`} className="text-primary hover:underline">
                    {t("view")}
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
      {reporting && (
        <OfflineReferenceForm
          paymentId={reporting.payment!.id}
          onCancel={() => setReporting(null)}
          onDone={() => {
            setReporting(null);
            onChanged();
          }}
        />
      )}
    </Card>
  );
}

function DetailsCard({ initial }: { initial: BillingData["details"] }) {
  const t = useTranslations("billing");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setSaving(true);
    const res = await apiFetch("/api/billing/details", { method: "PUT", body: { name: f.get("billingName"), email: f.get("billingEmail"), address: f.get("billingAddress"), taxId: f.get("billingTaxId") } });
    setSaving(false);
    if (!res.ok) return setError(res.error);
    setError(null);
    toast.success(t("detailsSaved"));
  }
  return (
    <Card>
      <form onSubmit={submit}>
        <CardHeader>
          <CardTitle>{t("details")}</CardTitle>
          <CardDescription>{t("detailsText")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <FormMessage type="error">{error}</FormMessage>
          <Field id="billingName" label={t("detailsName")} defaultValue={initial.name} required maxLength={150} />
          <Field id="billingEmail" type="email" label={t("detailsEmail")} defaultValue={initial.email} maxLength={254} hint={t("detailsEmailHint")} />
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="billingAddress">{t("detailsAddress")}</Label>
            <Textarea id="billingAddress" name="billingAddress" rows={3} maxLength={500} defaultValue={initial.address} />
          </div>
          <Field id="billingTaxId" label={t("detailsTaxId")} defaultValue={initial.taxId} maxLength={50} placeholder={t("detailsTaxIdPlaceholder")} />
        </CardContent>
        <CardFooter className="mt-6">
          <Button type="submit" disabled={saving}>
            {t("saveDetails")}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
