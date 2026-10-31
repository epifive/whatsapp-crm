"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Field, FormMessage } from "@/components/forms";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/client/api-client";
import type { BillingSettings } from "@/lib/settings";

function useSave(key: string) {
  const ta = useTranslations("admin");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function save(body: unknown) {
    setPending(true);
    const res = await apiFetch(`/api/admin/settings/${key}`, { method: "PUT", body });
    setPending(false);
    if (!res.ok) return setError(res.error);
    setError(null);
    toast.success(ta("saved"));
    router.refresh();
  }
  return { save, error, pending };
}

function CheckRow({ name, label, defaultChecked, hint }: { name: string; label: string; defaultChecked: boolean; hint?: string }) {
  return (
    <label className="flex items-start gap-2 text-sm sm:col-span-2">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="mt-0.5 size-4 accent-[var(--primary)]" />
      <span>
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

export function BillingForm({ initial, plans }: { initial: BillingSettings; plans: { id: string; name: string }[] }) {
  const t = useTranslations("adminBilling");
  const a = useTranslations("admin");
  const { save, error, pending } = useSave("billing");
  return (
    <Card id="billing">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          save({
            enabled: f.get("enabled") === "on",
            currency: f.get("currency"),
            signupPlanId: f.get("signupPlanId") || null,
            graceDays: f.get("graceDays"),
            reminderDays: f.get("reminderDays"),
            taxName: f.get("taxName"),
            taxPercent: f.get("taxPercent"),
            invoicePrefix: f.get("invoicePrefix"),
            sellerName: f.get("sellerName"),
            sellerAddress: f.get("sellerAddress"),
            sellerTaxId: f.get("sellerTaxId"),
            invoiceFooter: f.get("invoiceFooter"),
          });
        }}
      >
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("text")}</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormMessage type="error">{error}</FormMessage>
          <CheckRow name="enabled" label={t("enabled")} hint={t("enabledHint")} defaultChecked={initial.enabled} />
          <div className="grid gap-1.5">
            <Label htmlFor="signupPlanId">{t("signupPlan")}</Label>
            <NativeSelect id="signupPlanId" name="signupPlanId" defaultValue={initial.signupPlanId ?? ""}>
              <option value="">{t("choosePlan")}</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">{plans.length ? t("signupPlanHint") : t("noPlansYet")}</p>
          </div>
          <Field id="currency" label={t("currency")} defaultValue={initial.currency} required maxLength={3} className="uppercase" hint={t("currencyHint")} />
          <Field id="graceDays" type="number" min={0} max={60} label={t("graceDays")} defaultValue={initial.graceDays} hint={t("graceDaysHint")} />
          <Field id="reminderDays" type="number" min={0} max={30} label={t("reminderDays")} defaultValue={initial.reminderDays} hint={t("reminderDaysHint")} />
          <Field id="taxName" label={t("taxName")} defaultValue={initial.taxName} required maxLength={20} placeholder="GST" />
          <Field id="taxPercent" type="number" min={0} max={100} step="0.01" label={t("taxPercent")} defaultValue={initial.taxPercent} hint={t("taxPercentHint")} />
          <Field id="invoicePrefix" label={t("invoicePrefix")} defaultValue={initial.invoicePrefix} maxLength={12} hint={t("invoicePrefixHint")} />
          <Field id="sellerName" label={t("sellerName")} defaultValue={initial.sellerName} maxLength={150} hint={t("sellerNameHint")} />
          <Field id="sellerTaxId" label={t("sellerTaxId")} defaultValue={initial.sellerTaxId} maxLength={50} />
          <div className="grid gap-1.5">
            <Label htmlFor="sellerAddress">{t("sellerAddress")}</Label>
            <Textarea id="sellerAddress" name="sellerAddress" rows={3} maxLength={500} defaultValue={initial.sellerAddress} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="invoiceFooter">{t("invoiceFooter")}</Label>
            <Textarea id="invoiceFooter" name="invoiceFooter" rows={3} maxLength={500} defaultValue={initial.invoiceFooter} placeholder={t("invoiceFooterPlaceholder")} />
          </div>
        </CardContent>
        <CardFooter className="mt-6">
          <Button type="submit" disabled={pending}>
            {a("save")}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function WebhookUrl({ url, label }: { url: string; label: string }) {
  const t = useTranslations("adminBilling");
  return (
    <div className="grid grid-cols-1 gap-1.5 sm:col-span-2">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-3 py-2 text-xs">{url}</code>
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={`${t("copy")}: ${label}`}
          onClick={() => {
            void navigator.clipboard.writeText(url);
            toast.success(t("copied"));
          }}
        >
          <Copy />
        </Button>
      </div>
    </div>
  );
}

const keep = (has: boolean, t: (k: string) => string) => (has ? { placeholder: "••••••••", hint: t("secretKept") } : {});

interface GatewayProps {
  stripe: { enabled: boolean; hasSecretKey: boolean; hasWebhookSecret: boolean; webhookUrl: string };
  razorpay: { enabled: boolean; keyId: string; hasKeySecret: boolean; hasWebhookSecret: boolean; webhookUrl: string };
  paypal: { enabled: boolean; mode: "sandbox" | "live"; clientId: string; hasClientSecret: boolean; webhookId: string; webhookUrl: string };
  offline: { enabled: boolean; instructions: string };
}

export function GatewayForms({ stripe, razorpay, paypal, offline }: GatewayProps) {
  const t = useTranslations("adminBilling");
  const a = useTranslations("admin");
  const s = useSave("stripe");
  const r = useSave("razorpay");
  const p = useSave("paypal");
  const o = useSave("offline");
  const [stripeOn, setStripeOn] = useState(stripe.enabled);
  const [razorpayOn, setRazorpayOn] = useState(razorpay.enabled);
  const [paypalOn, setPaypalOn] = useState(paypal.enabled);
  const [offlineOn, setOfflineOn] = useState(offline.enabled);

  const header = (title: string, text: string, on: boolean, setOn: (v: boolean) => void) => (
    <CardHeader>
      <div className="flex items-center gap-3">
        <Switch checked={on} onCheckedChange={setOn} aria-label={t("enableGateway", { name: title })} />
        <CardTitle>{title}</CardTitle>
      </div>
      <CardDescription>{text}</CardDescription>
    </CardHeader>
  );
  const footer = (pending: boolean) => (
    <CardFooter className="mt-6">
      <Button type="submit" disabled={pending}>
        {a("save")}
      </Button>
    </CardFooter>
  );

  return (
    <>
      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            s.save({ enabled: stripeOn, secretKey: f.get("stripeSecretKey") ?? "", webhookSecret: f.get("stripeWebhookSecret") ?? "" });
          }}
        >
          {header("Stripe", t("stripeText"), stripeOn, setStripeOn)}
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormMessage type="error">{s.error}</FormMessage>
            <Field id="stripeSecretKey" type="password" autoComplete="off" label={t("stripeSecretKey")} {...keep(stripe.hasSecretKey, t)} />
            <Field id="stripeWebhookSecret" type="password" autoComplete="off" label={t("webhookSecret")} {...keep(stripe.hasWebhookSecret, t)} />
            <WebhookUrl url={stripe.webhookUrl} label={t("stripeWebhookUrl")} />
          </CardContent>
          {footer(s.pending)}
        </form>
      </Card>

      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            r.save({ enabled: razorpayOn, keyId: f.get("razorpayKeyId"), keySecret: f.get("razorpayKeySecret") ?? "", webhookSecret: f.get("razorpayWebhookSecret") ?? "" });
          }}
        >
          {header("Razorpay", t("razorpayText"), razorpayOn, setRazorpayOn)}
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormMessage type="error">{r.error}</FormMessage>
            <Field id="razorpayKeyId" label={t("razorpayKeyId")} defaultValue={razorpay.keyId} placeholder="rzp_live_…" autoComplete="off" />
            <Field id="razorpayKeySecret" type="password" autoComplete="off" label={t("razorpayKeySecret")} {...keep(razorpay.hasKeySecret, t)} />
            <Field id="razorpayWebhookSecret" type="password" autoComplete="off" label={t("webhookSecret")} {...keep(razorpay.hasWebhookSecret, t)} />
            <WebhookUrl url={razorpay.webhookUrl} label={t("razorpayWebhookUrl")} />
          </CardContent>
          {footer(r.pending)}
        </form>
      </Card>

      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            p.save({ enabled: paypalOn, mode: f.get("paypalMode"), clientId: f.get("paypalClientId"), clientSecret: f.get("paypalClientSecret") ?? "", webhookId: f.get("paypalWebhookId") });
          }}
        >
          {header("PayPal", t("paypalText"), paypalOn, setPaypalOn)}
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormMessage type="error">{p.error}</FormMessage>
            <div className="grid gap-1.5">
              <Label htmlFor="paypalMode">{t("paypalMode")}</Label>
              <NativeSelect id="paypalMode" name="paypalMode" defaultValue={paypal.mode}>
                <option value="sandbox">{t("sandbox")}</option>
                <option value="live">{t("live")}</option>
              </NativeSelect>
            </div>
            <Field id="paypalClientId" label={t("paypalClientId")} defaultValue={paypal.clientId} autoComplete="off" />
            <Field id="paypalClientSecret" type="password" autoComplete="off" label={t("paypalClientSecret")} {...keep(paypal.hasClientSecret, t)} />
            <Field id="paypalWebhookId" label={t("paypalWebhookId")} defaultValue={paypal.webhookId} hint={t("paypalWebhookIdHint")} />
            <WebhookUrl url={paypal.webhookUrl} label={t("paypalWebhookUrl")} />
          </CardContent>
          {footer(p.pending)}
        </form>
      </Card>

      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            o.save({ enabled: offlineOn, instructions: new FormData(e.currentTarget).get("offlineInstructions") });
          }}
        >
          {header(t("offlineTitle"), t("offlineText"), offlineOn, setOfflineOn)}
          <CardContent className="grid gap-1.5">
            <FormMessage type="error">{o.error}</FormMessage>
            <Label htmlFor="offlineInstructions">{t("offlineInstructions")}</Label>
            <Textarea id="offlineInstructions" name="offlineInstructions" rows={5} maxLength={3000} defaultValue={offline.instructions} placeholder={t("offlineInstructionsPlaceholder")} />
          </CardContent>
          {footer(o.pending)}
        </form>
      </Card>
    </>
  );
}

interface TemplateRow {
  key: string;
  vars: string[];
  defaults: { subject: string; heading: string; body: string; button: string };
  custom: { subject: string; heading: string; body: string; button: string } | null;
}

export function EmailTemplatesForm({ templates }: { templates: TemplateRow[] }) {
  const tm = useTranslations("adminEmails");
  const a = useTranslations("admin");
  const { save, error, pending } = useSave("emailTemplates");
  const [selected, setSelected] = useState(templates[0]!.key);
  const [values, setValues] = useState<Record<string, TemplateRow["defaults"]>>(() =>
    Object.fromEntries(templates.map((tpl) => [tpl.key, { subject: tpl.custom?.subject ?? "", heading: tpl.custom?.heading ?? "", body: tpl.custom?.body ?? "", button: tpl.custom?.button ?? "" }])),
  );
  const tpl = templates.find((x) => x.key === selected)!;
  const v = values[selected]!;
  const set = (field: keyof TemplateRow["defaults"], value: string) => setValues({ ...values, [selected]: { ...v, [field]: value } });

  return (
    <Card>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save(values);
        }}
      >
        <CardHeader>
          <CardTitle>{tm("title")}</CardTitle>
          <CardDescription>{tm("text")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <FormMessage type="error">{error}</FormMessage>
          <div className="grid gap-1.5 sm:max-w-sm">
            <Label htmlFor="template">{tm("template")}</Label>
            <NativeSelect id="template" value={selected} onChange={(e) => setSelected(e.target.value)}>
              {templates.map((x) => (
                <option key={x.key} value={x.key}>
                  {tm(`name.${x.key}`)}
                </option>
              ))}
            </NativeSelect>
          </div>
          <p className="text-xs text-muted-foreground">{tm("placeholders", { list: tpl.vars.map((x) => `{{${x}}}`).join("  ") })}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="tplSubject" label={tm("subject")} value={v.subject} onChange={(e) => set("subject", e.target.value)} placeholder={tpl.defaults.subject} maxLength={200} />
            <Field id="tplHeading" label={tm("heading")} value={v.heading} onChange={(e) => set("heading", e.target.value)} placeholder={tpl.defaults.heading} maxLength={200} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="tplBody">{tm("body")}</Label>
            <Textarea id="tplBody" rows={4} value={v.body} onChange={(e) => set("body", e.target.value)} placeholder={tpl.defaults.body} maxLength={3000} />
          </div>
          <Field id="tplButton" label={tm("button")} value={v.button} onChange={(e) => set("button", e.target.value)} placeholder={tpl.defaults.button} maxLength={60} className="sm:max-w-sm" />
          <p className="text-xs text-muted-foreground">{tm("emptyUsesDefault")}</p>
        </CardContent>
        <CardFooter className="mt-6 gap-2">
          <Button type="submit" disabled={pending}>
            {a("save")}
          </Button>
          <Button type="button" variant="outline" onClick={() => setValues({ ...values, [selected]: { subject: "", heading: "", body: "", button: "" } })}>
            {tm("reset")}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
