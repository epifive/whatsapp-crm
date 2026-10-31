import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db";
import { EMAIL_TEMPLATES, EMAIL_TEMPLATE_KEYS } from "@/lib/email-templates";
import { env } from "@/lib/env";
import { getBilling, getBranding, getSetting } from "@/lib/settings";
import { BillingForm, EmailTemplatesForm, GatewayForms } from "./billing-forms";
import { BrandingForm, SmtpForm } from "./settings-forms";

export const metadata: Metadata = { title: "Platform settings" };

export default async function AdminSettingsPage() {
  const [t, smtp, branding, billing, stripe, razorpay, paypal, offline, templates, plans] = await Promise.all([
    getTranslations("admin"),
    getSetting("smtp"),
    getBranding(),
    getBilling(),
    getSetting("stripe"),
    getSetting("razorpay"),
    getSetting("paypal"),
    getSetting("offline"),
    getSetting("emailTemplates"),
    db.plan.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { priceMonthly: "asc" }], select: { id: true, name: true } }),
  ]);
  const hook = (g: string) => `${env().APP_URL}/api/billing/webhooks/${g}`;
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("settings")}</h1>
      <BrandingForm initial={branding} />
      {/* The stored SMTP password is never sent to the browser */}
      <SmtpForm
        initial={{
          host: smtp?.host ?? "",
          port: smtp?.port ?? 587,
          secure: smtp?.secure ?? false,
          user: smtp?.user ?? "",
          fromName: smtp?.fromName ?? branding.appName,
          fromEmail: smtp?.fromEmail ?? "",
          hasPassword: !!smtp?.password,
        }}
      />
      <BillingForm initial={billing} plans={plans} />
      {/* Gateway secrets stay on the server too: the forms only learn whether one is saved */}
      <GatewayForms
        stripe={{ enabled: !!stripe?.enabled, hasSecretKey: !!stripe?.secretKey, hasWebhookSecret: !!stripe?.webhookSecret, webhookUrl: hook("stripe") }}
        razorpay={{ enabled: !!razorpay?.enabled, keyId: razorpay?.keyId ?? "", hasKeySecret: !!razorpay?.keySecret, hasWebhookSecret: !!razorpay?.webhookSecret, webhookUrl: hook("razorpay") }}
        paypal={{ enabled: !!paypal?.enabled, mode: paypal?.mode ?? "sandbox", clientId: paypal?.clientId ?? "", hasClientSecret: !!paypal?.clientSecret, webhookId: paypal?.webhookId ?? "", webhookUrl: hook("paypal") }}
        offline={{ enabled: !!offline?.enabled, instructions: offline?.instructions ?? "" }}
      />
      <EmailTemplatesForm
        templates={EMAIL_TEMPLATE_KEYS.map((key) => ({
          key,
          vars: [...EMAIL_TEMPLATES[key].vars, "app_name"],
          defaults: { subject: EMAIL_TEMPLATES[key].subject, heading: EMAIL_TEMPLATES[key].heading, body: EMAIL_TEMPLATES[key].body, button: EMAIL_TEMPLATES[key].button },
          custom: templates?.[key] ?? null,
        }))}
      />
    </div>
  );
}
