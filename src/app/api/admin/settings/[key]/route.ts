import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, clientIp, parseBody, requireApiSuperAdmin, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { isValidCurrency } from "@/lib/billing/money";
import { db } from "@/lib/db";
import { EMAIL_TEMPLATE_KEYS } from "@/lib/email-templates";
import { getSetting, setSetting, type SettingTypes } from "@/lib/settings";
import { isPublicHttpUrl } from "@/lib/url";

const smtpSchema = z.object({
  host: z.string().trim().max(255),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.boolean(),
  user: z.string().trim().max(255),
  // Empty = keep the stored password (the form never receives the real one)
  password: z.string().max(500),
  fromName: z.string().trim().min(1).max(100),
  fromEmail: z.string().trim().email().max(254),
});

const imageUrl = (label: string) =>
  z
    .string()
    .trim()
    .max(2000)
    .nullable()
    .optional()
    .transform((v) => v || null)
    .refine((v) => v === null || isPublicHttpUrl(v) || v.startsWith("/"), `${label} must be an https:// URL or a path like /logo.png.`);

const brandingSchema = z.object({
  appName: z.string().trim().min(1).max(60),
  logoUrl: imageUrl("Logo"),
  faviconUrl: imageUrl("Favicon"),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex color like #16a34a."),
  supportEmail: z
    .string()
    .trim()
    .max(254)
    .nullable()
    .transform((v) => v || null)
    .refine((v) => v === null || z.string().email().safeParse(v).success, "Enter a valid support email."),
});

const text = (max: number) => z.string().trim().max(max).default("");

const billingSchema = z.object({
  enabled: z.boolean(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .refine(isValidCurrency, "Use a 3-letter currency code like USD or INR."),
  signupPlanId: z.string().nullable(),
  graceDays: z.coerce.number().int().min(0).max(60),
  reminderDays: z.coerce.number().int().min(0).max(30),
  taxName: z.string().trim().min(1, "Name the tax, e.g. GST or VAT.").max(20),
  taxPercent: z.coerce.number().min(0).max(100),
  invoicePrefix: z
    .string()
    .trim()
    .max(12)
    .regex(/^[A-Za-z0-9/_-]*$/, "Use letters, numbers, - / or _ for the invoice prefix."),
  sellerName: text(150),
  sellerAddress: text(500),
  sellerTaxId: text(50),
  invoiceFooter: text(500),
});

// Secrets: empty = keep the stored value (the form never receives them)
const secret = z.string().trim().max(500).default("");

const stripeSchema = z.object({ enabled: z.boolean(), secretKey: secret, webhookSecret: secret });
const razorpaySchema = z.object({ enabled: z.boolean(), keyId: z.string().trim().max(100).default(""), keySecret: secret, webhookSecret: secret });
const paypalSchema = z.object({ enabled: z.boolean(), mode: z.enum(["sandbox", "live"]), clientId: z.string().trim().max(200).default(""), clientSecret: secret, webhookId: z.string().trim().max(100).default("") });
const offlineSchema = z.object({ enabled: z.boolean(), instructions: text(3000) });
const templateSchema = z.object({ subject: text(200), heading: text(200), body: text(3000), button: text(60) });
const emailTemplatesSchema = z.object(Object.fromEntries(EMAIL_TEMPLATE_KEYS.map((k) => [k, templateSchema.optional()]))).strict();

/** Fills empty secret fields from the stored settings */
async function keepSecrets<K extends "stripe" | "razorpay" | "paypal">(key: K, value: SettingTypes[K], fields: (keyof SettingTypes[K])[]): Promise<SettingTypes[K]> {
  const stored = await getSetting(key);
  for (const f of fields) if (!value[f] && stored?.[f]) value[f] = stored[f];
  return value;
}

export const PUT = route<RouteContext<"/api/admin/settings/[key]">>(async (req, ctx) => {
  const session = await requireApiSuperAdmin();
  const { key } = await ctx.params;

  if (key === "smtp") {
    const value = await parseBody(req, smtpSchema);
    if (!value.password) value.password = (await getSetting("smtp"))?.password ?? "";
    await setSetting("smtp", value);
  } else if (key === "branding") {
    await setSetting("branding", await parseBody(req, brandingSchema));
  } else if (key === "billing") {
    const value = await parseBody(req, billingSchema);
    if (value.signupPlanId && !(await db.plan.findFirst({ where: { id: value.signupPlanId, isActive: true } }))) throw new ApiError(400, "Choose an active plan for new workspaces.");
    if (value.enabled && !value.signupPlanId) throw new ApiError(400, "Choose the plan new workspaces start on before turning billing on.");
    await setSetting("billing", value);
  } else if (key === "stripe") {
    const value = await keepSecrets("stripe", await parseBody(req, stripeSchema), ["secretKey", "webhookSecret"]);
    if (value.enabled && !value.secretKey) throw new ApiError(400, "Enter the Stripe secret key.");
    if (value.secretKey && !/^(sk|rk)_(test|live)_/.test(value.secretKey)) throw new ApiError(400, "The Stripe secret key starts with sk_test_ or sk_live_.");
    await setSetting("stripe", value);
  } else if (key === "razorpay") {
    const value = await keepSecrets("razorpay", await parseBody(req, razorpaySchema), ["keySecret", "webhookSecret"]);
    if (value.enabled && (!value.keyId || !value.keySecret)) throw new ApiError(400, "Enter the Razorpay key id and key secret.");
    await setSetting("razorpay", value);
  } else if (key === "paypal") {
    const value = await keepSecrets("paypal", await parseBody(req, paypalSchema), ["clientSecret"]);
    if (value.enabled && (!value.clientId || !value.clientSecret)) throw new ApiError(400, "Enter the PayPal client id and secret.");
    await setSetting("paypal", value);
  } else if (key === "offline") {
    const value = await parseBody(req, offlineSchema);
    if (value.enabled && !value.instructions) throw new ApiError(400, "Write the payment instructions (bank details) customers should follow.");
    await setSetting("offline", value);
  } else if (key === "emailTemplates") {
    const value = await parseBody(req, emailTemplatesSchema);
    // Only keep templates the admin actually changed
    const changed = Object.fromEntries(Object.entries(value).filter(([, t]) => t && (t.subject || t.heading || t.body || t.button)));
    await setSetting("emailTemplates", changed as SettingTypes["emailTemplates"]);
  } else {
    throw new ApiError(404, "Unknown settings group.");
  }

  await audit({ action: `settings.${key}.updated`, userId: session.user.id, ip: clientIp(req) });
  return NextResponse.json({ ok: true });
});
