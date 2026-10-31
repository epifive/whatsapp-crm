"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Field, FormMessage } from "@/components/forms";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/client/api-client";
import { formatMoney } from "@/lib/billing/money";
import { cn } from "@/lib/utils";
import type { PlanView } from "./billing-settings";

export type Gateway = "STRIPE" | "RAZORPAY" | "PAYPAL" | "OFFLINE";
export interface CheckoutTarget {
  plan: PlanView;
  interval: "MONTHLY" | "YEARLY";
}

interface Quote {
  currency: string;
  subtotal: number;
  discount: number;
  tax: number;
  taxLabel: string | null;
  total: number;
  coupon: { code: string } | null;
}

type CheckoutResult =
  | { kind: "paid" }
  | { kind: "redirect"; url: string }
  | { kind: "razorpay"; paymentId: string; keyId: string; orderId: string; amount: number; currency: string; name: string; description: string; email: string | null }
  | { kind: "offline"; paymentId: string; instructions: string; amount: number; currency: string; invoiceNumber: string };

interface RazorpayResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

function loadRazorpay(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load Razorpay."));
    document.body.appendChild(s);
  });
}

export function CheckoutDialog({ target, currency, gateways, onClose, onPaid }: { target: CheckoutTarget; currency: string; gateways: Gateway[]; onClose: () => void; onPaid: () => void }) {
  const t = useTranslations("billing");
  const [coupon, setCoupon] = useState("");
  const [applied, setApplied] = useState<string | undefined>();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gateway, setGateway] = useState<Gateway | null>(gateways[0] ?? null);
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState<Extract<CheckoutResult, { kind: "offline" }> | null>(null);

  useEffect(() => {
    let live = true;
    void apiFetch<Quote>("/api/billing/quote", { body: { planId: target.plan.id, interval: target.interval, coupon: applied } }).then((res) => {
      if (!live) return;
      if (res.ok) {
        setQuote(res.data!);
        setError(null);
      } else {
        setError(res.error);
        // A bad coupon: show the price without it
        if (applied) setApplied(undefined);
      }
    });
    return () => {
      live = false;
    };
  }, [target, applied]);

  async function pay() {
    if (!quote) return;
    if (quote.total > 0 && !gateway) return;
    setBusy(true);
    const res = await apiFetch<CheckoutResult>("/api/billing/checkout", { body: { planId: target.plan.id, interval: target.interval, coupon: applied, gateway: gateway ?? "OFFLINE" } });
    if (!res.ok) {
      setBusy(false);
      return setError(res.error);
    }
    const r = res.data!;
    if (r.kind === "paid") {
      toast.success(t("paymentDone"));
      return onPaid();
    }
    if (r.kind === "redirect") {
      window.location.assign(r.url);
      return;
    }
    if (r.kind === "offline") {
      setBusy(false);
      return setOffline(r);
    }
    try {
      await loadRazorpay();
    } catch (err) {
      setBusy(false);
      return setError((err as Error).message);
    }
    const rzp = new window.Razorpay!({
      key: r.keyId,
      order_id: r.orderId,
      amount: r.amount,
      currency: r.currency,
      name: r.name,
      description: r.description,
      prefill: r.email ? { email: r.email } : undefined,
      handler: async (resp: RazorpayResponse) => {
        const c = await apiFetch<{ outcome: string }>("/api/billing/confirm", {
          body: { paymentId: r.paymentId, razorpay: { orderId: resp.razorpay_order_id, paymentId: resp.razorpay_payment_id, signature: resp.razorpay_signature } },
        });
        setBusy(false);
        if (!c.ok) return setError(c.error);
        toast.success(t("paymentDone"));
        onPaid();
      },
      modal: { ondismiss: () => setBusy(false) },
    });
    rzp.open();
  }

  if (offline) {
    return (
      <OfflineReferenceForm
        paymentId={offline.paymentId}
        instructions={offline.instructions}
        amount={formatMoney(offline.amount, offline.currency)}
        invoiceNumber={offline.invoiceNumber}
        onCancel={onPaid}
        onDone={onPaid}
      />
    );
  }

  const free = quote?.total === 0;
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("checkoutTitle", { plan: target.plan.name })}</DialogTitle>
          <DialogDescription>{t(`checkoutPeriod.${target.interval}`)}</DialogDescription>
        </DialogHeader>
        <FormMessage type="error">{error}</FormMessage>

        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(coupon.trim() || undefined);
          }}
        >
          <Input value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} placeholder={t("couponPlaceholder")} aria-label={t("coupon")} maxLength={40} />
          <Button type="submit" variant="outline" disabled={!coupon.trim()}>
            {t("applyCoupon")}
          </Button>
        </form>

        {quote ? (
          <dl className="grid gap-1.5 rounded-lg border p-3 text-sm">
            <Row label={t("subtotal")} value={formatMoney(quote.subtotal, currency)} />
            {quote.discount > 0 && <Row label={t("discount", { code: quote.coupon?.code ?? "" })} value={`− ${formatMoney(quote.discount, currency)}`} />}
            {quote.tax > 0 && <Row label={quote.taxLabel ?? t("tax")} value={formatMoney(quote.tax, currency)} />}
            <div className="mt-1 border-t pt-2">
              <Row label={t("total")} value={formatMoney(quote.total, currency)} strong />
            </div>
          </dl>
        ) : (
          !error && <Loader2 className="mx-auto size-5 animate-spin text-muted-foreground" />
        )}

        {quote && !free && (
          <div className="grid gap-2" role="radiogroup" aria-label={t("payWith")}>
            <div className="text-sm font-medium">{t("payWith")}</div>
            {gateways.length === 0 && <p className="text-sm text-muted-foreground">{t("noGateways")}</p>}
            {gateways.map((g) => (
              <button
                key={g}
                type="button"
                role="radio"
                aria-checked={gateway === g}
                onClick={() => setGateway(g)}
                className={cn("rounded-lg border p-3 text-left text-sm", gateway === g ? "border-primary bg-primary/5" : "hover:bg-muted")}
              >
                <div className="font-medium">{t(`gateway.${g}.title`)}</div>
                <div className="text-xs text-muted-foreground">{t(`gateway.${g}.text`)}</div>
              </button>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button onClick={() => void pay()} disabled={busy || !quote || (!free && !gateway)}>
            {busy && <Loader2 className="animate-spin" />}
            {free ? t("activate") : quote ? t("payAmount", { amount: formatMoney(quote.total, currency) }) : t("pay")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-4", strong && "font-semibold")}>
      <dt className={strong ? undefined : "text-muted-foreground"}>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

/** Bank transfer: show the instructions, then the customer enters their transfer reference */
export function OfflineReferenceForm({
  paymentId,
  instructions,
  amount,
  invoiceNumber,
  onCancel,
  onDone,
}: {
  paymentId: string;
  instructions?: string;
  amount?: string;
  invoiceNumber?: string;
  onCancel: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("billing");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const res = await apiFetch("/api/billing/confirm", { body: { paymentId, reference: new FormData(e.currentTarget).get("reference") } });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    toast.success(t("offlineReported"));
    onDone();
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{t("offlineTitle")}</DialogTitle>
            <DialogDescription>{amount && invoiceNumber ? t("offlineText", { amount, invoice: invoiceNumber }) : t("offlineTextLater")}</DialogDescription>
          </DialogHeader>
          {instructions && <div className="whitespace-pre-wrap rounded-lg border bg-muted/40 p-3 text-sm">{instructions}</div>}
          <FormMessage type="error">{error}</FormMessage>
          <Field id="reference" label={t("offlineReference")} required maxLength={100} placeholder={t("offlineReferencePlaceholder")} hint={t("offlineReferenceHint")} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              {t("payLater")}
            </Button>
            <Button type="submit" disabled={busy}>
              {t("offlineSubmit")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
