import { db } from "./db";
import { decrypt, encrypt } from "./crypto";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Platform settings live in the `Setting` table so buyers configure everything from the admin
 * panel instead of editing .env. Fields listed as secret are stored encrypted as {"$enc": "..."}.
 */

export interface SmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromName: string;
  fromEmail: string;
}

export interface BrandingSettings {
  appName: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  supportEmail: string | null;
}

/** SaaS billing (Admin › Settings). With `enabled` off every workspace is unlimited. */
export interface BillingSettings {
  enabled: boolean;
  // ISO 4217; plan prices are in this currency
  currency: string;
  // Plan new workspaces start on (its trial, or free forever when it costs nothing)
  signupPlanId: string | null;
  // Days a workspace keeps working after its period ends without payment
  graceDays: number;
  // Renewal reminder this many days before the period ends
  reminderDays: number;
  taxName: string;
  taxPercent: number;
  invoicePrefix: string;
  sellerName: string;
  sellerAddress: string;
  sellerTaxId: string;
  invoiceFooter: string;
}

export interface StripeSettings {
  enabled: boolean;
  secretKey: string;
  webhookSecret: string;
}

export interface RazorpaySettings {
  enabled: boolean;
  keyId: string;
  keySecret: string;
  webhookSecret: string;
}

export interface PaypalSettings {
  enabled: boolean;
  mode: "sandbox" | "live";
  clientId: string;
  clientSecret: string;
  webhookId: string;
}

export interface OfflineSettings {
  enabled: boolean;
  // Bank details etc. shown to the customer
  instructions: string;
}

/** Admin overrides of the built-in email texts (see src/lib/email-templates.ts) */
export type EmailTemplatesSettings = Partial<Record<string, { subject: string; heading: string; body: string; button: string }>>;

export interface SettingTypes {
  smtp: SmtpSettings;
  branding: BrandingSettings;
  billing: BillingSettings;
  stripe: StripeSettings;
  razorpay: RazorpaySettings;
  paypal: PaypalSettings;
  offline: OfflineSettings;
  emailTemplates: EmailTemplatesSettings;
}

const SECRET_FIELDS: { [K in keyof SettingTypes]?: (keyof SettingTypes[K])[] } = {
  smtp: ["password"],
  stripe: ["secretKey", "webhookSecret"],
  razorpay: ["keySecret", "webhookSecret"],
  paypal: ["clientSecret"],
};

export const DEFAULT_BRANDING: BrandingSettings = {
  appName: "CRM for WhatsApp",
  logoUrl: null,
  faviconUrl: null,
  primaryColor: "#16a34a",
  supportEmail: null,
};

// Short TTL: the worker is a separate process and won't see invalidations from the web app.
// Kept on globalThis so every module instance in this process (pages, route handlers) shares it
// and a save in one is immediately visible in the others.
const CACHE_TTL_MS = 30_000;
declare global {
  var __wacrmSettingsCache: Map<string, { value: unknown; at: number }> | undefined;
}
const cache = (globalThis.__wacrmSettingsCache ??= new Map());

function isEncrypted(v: unknown): v is { $enc: string } {
  return typeof v === "object" && v !== null && typeof (v as { $enc?: unknown }).$enc === "string";
}

export async function getSetting<K extends keyof SettingTypes>(key: K): Promise<SettingTypes[K] | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as SettingTypes[K] | null;

  const row = await db.setting.findUnique({ where: { key } });
  let value: SettingTypes[K] | null = null;
  if (row && typeof row.value === "object" && row.value !== null) {
    const out: Record<string, unknown> = { ...(row.value as Record<string, unknown>) };
    for (const [field, v] of Object.entries(out)) if (isEncrypted(v)) out[field] = decrypt(v.$enc);
    value = out as unknown as SettingTypes[K];
  }
  cache.set(key, { value, at: Date.now() });
  return value;
}

export async function setSetting<K extends keyof SettingTypes>(key: K, value: SettingTypes[K]): Promise<void> {
  const stored: Record<string, unknown> = { ...(value as unknown as Record<string, unknown>) };
  for (const field of (SECRET_FIELDS[key] ?? []) as string[]) {
    if (typeof stored[field] === "string" && stored[field]) stored[field] = { $enc: encrypt(stored[field] as string) };
  }
  await db.setting.upsert({
    where: { key },
    create: { key, value: stored as Prisma.InputJsonValue },
    update: { value: stored as Prisma.InputJsonValue },
  });
  cache.delete(key);
}

export async function getBranding(): Promise<BrandingSettings> {
  return { ...DEFAULT_BRANDING, ...((await getSetting("branding")) ?? {}) };
}

export const DEFAULT_BILLING: BillingSettings = {
  enabled: false,
  currency: "USD",
  signupPlanId: null,
  graceDays: 3,
  reminderDays: 3,
  taxName: "Tax",
  taxPercent: 0,
  invoicePrefix: "INV-",
  sellerName: "",
  sellerAddress: "",
  sellerTaxId: "",
  invoiceFooter: "",
};

export async function getBilling(): Promise<BillingSettings> {
  return { ...DEFAULT_BILLING, ...((await getSetting("billing")) ?? {}) };
}
