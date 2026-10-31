import crypto from "node:crypto";
import { safeEqual } from "@/lib/crypto";
import { UserInputError } from "@/lib/errors";
import type { PaypalSettings, RazorpaySettings, StripeSettings } from "@/lib/settings";
import { fromMinor } from "./money";

/**
 * Payment gateway calls over plain HTTPS (no SDKs to ship). Each checkout is a one-time payment
 * for one billing period. Base URLs can be overridden with STRIPE_API_BASE / RAZORPAY_API_BASE /
 * PAYPAL_API_BASE (proxies, tests).
 */

const TIMEOUT_MS = 30_000;
const base = (env: string | undefined, fallback: string) => (env || fallback).replace(/\/+$/, "");

async function call(gateway: string, url: string, init: RequestInit): Promise<{ status: number; json: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new UserInputError(`Could not reach ${gateway}: ${(err as Error).message}`);
  }
  const json = ((await res.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  return { status: res.status, json };
}

function gatewayError(gateway: string, status: number, json: Record<string, unknown>): UserInputError {
  const e = json.error as { message?: string; description?: string } | string | undefined;
  const detail = typeof e === "string" ? e : (e?.message ?? e?.description ?? (json.message as string | undefined) ?? (json.error_description as string | undefined));
  return new UserInputError(`${gateway} error (${status})${detail ? `: ${detail}` : ""}`);
}

const hmacHex = (secret: string, data: string) => crypto.createHmac("sha256", secret).update(data).digest("hex");

// ───────────────────────────── Stripe (Checkout Sessions) ─────────────────────────────

const stripeBase = () => base(process.env.STRIPE_API_BASE, "https://api.stripe.com");

async function stripe(cfg: StripeSettings, method: "GET" | "POST", path: string, form?: Record<string, string>) {
  const { status, json } = await call("Stripe", `${stripeBase()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${cfg.secretKey}`, ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  if (status >= 400) throw gatewayError("Stripe", status, json);
  return json;
}

export async function createStripeCheckout(
  cfg: StripeSettings,
  o: { paymentId: string; invoiceId: string; amount: number; currency: string; description: string; email?: string | null; successUrl: string; cancelUrl: string },
) {
  const json = await stripe(cfg, "POST", "/v1/checkout/sessions", {
    mode: "payment",
    client_reference_id: o.invoiceId,
    "metadata[paymentId]": o.paymentId,
    "metadata[invoiceId]": o.invoiceId,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": o.currency.toLowerCase(),
    "line_items[0][price_data][unit_amount]": String(o.amount),
    "line_items[0][price_data][product_data][name]": o.description,
    success_url: o.successUrl,
    cancel_url: o.cancelUrl,
    ...(o.email ? { customer_email: o.email } : {}),
  });
  return { id: String(json.id), url: String(json.url) };
}

export interface StripeSessionState {
  paid: boolean;
  amount: number;
  currency: string;
  paymentIntent: string | null;
}

export async function getStripeSession(cfg: StripeSettings, sessionId: string): Promise<StripeSessionState> {
  const json = await stripe(cfg, "GET", `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`);
  return stripeSessionState(json);
}

export function stripeSessionState(json: Record<string, unknown>): StripeSessionState {
  return {
    paid: json.payment_status === "paid",
    amount: Number(json.amount_total ?? 0),
    currency: String(json.currency ?? "").toUpperCase(),
    paymentIntent: typeof json.payment_intent === "string" ? json.payment_intent : null,
  };
}

/** Stripe-Signature: t=<unix>,v1=<hex HMAC of "<t>.<raw body>">, max 5 minutes old */
export function verifyStripeSignature(raw: string, header: string | null, secret: string, now = Date.now(), toleranceSec = 300): boolean {
  if (!header || !secret) return false;
  const parts = header.split(",").map((p) => p.trim().split("="));
  const t = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v ?? "");
  if (!t || !/^\d+$/.test(t) || !sigs.length) return false;
  if (Math.abs(now / 1000 - Number(t)) > toleranceSec) return false;
  const expected = hmacHex(secret, `${t}.${raw}`);
  return sigs.some((s) => safeEqual(s, expected));
}

// ───────────────────────────── Razorpay (Orders + Checkout.js) ─────────────────────────────

const razorpayBase = () => base(process.env.RAZORPAY_API_BASE, "https://api.razorpay.com");

export async function createRazorpayOrder(cfg: RazorpaySettings, o: { amount: number; currency: string; receipt: string; paymentId: string; invoiceId: string }) {
  const { status, json } = await call("Razorpay", `${razorpayBase()}/v1/orders`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${cfg.keyId}:${cfg.keySecret}`).toString("base64")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ amount: o.amount, currency: o.currency, receipt: o.receipt.slice(0, 40), notes: { paymentId: o.paymentId, invoiceId: o.invoiceId } }),
  });
  if (status >= 400) throw gatewayError("Razorpay", status, json);
  return { id: String(json.id), amount: Number(json.amount), currency: String(json.currency) };
}

/** Signature Checkout.js returns after a successful payment */
export function verifyRazorpayPayment(orderId: string, paymentId: string, signature: string, keySecret: string): boolean {
  if (!orderId || !paymentId || !signature || !keySecret) return false;
  return safeEqual(signature, hmacHex(keySecret, `${orderId}|${paymentId}`));
}

/** X-Razorpay-Signature: hex HMAC of the raw body with the webhook secret */
export function verifyRazorpayWebhook(raw: string, signature: string | null, webhookSecret: string): boolean {
  if (!signature || !webhookSecret) return false;
  return safeEqual(signature, hmacHex(webhookSecret, raw));
}

// ───────────────────────────── PayPal (Orders v2) ─────────────────────────────

const paypalBase = (cfg: PaypalSettings) => base(process.env.PAYPAL_API_BASE, cfg.mode === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com");

declare global {
  var __wacrmPaypalTokens: Map<string, { token: string; until: number }> | undefined;
}
const paypalTokens = (globalThis.__wacrmPaypalTokens ??= new Map());

async function paypalToken(cfg: PaypalSettings): Promise<string> {
  const cacheKey = `${paypalBase(cfg)}|${cfg.clientId}`;
  const hit = paypalTokens.get(cacheKey);
  if (hit && hit.until > Date.now()) return hit.token;
  const { status, json } = await call("PayPal", `${paypalBase(cfg)}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (status >= 400 || typeof json.access_token !== "string") throw gatewayError("PayPal", status, json);
  paypalTokens.set(cacheKey, { token: json.access_token, until: Date.now() + (Number(json.expires_in ?? 600) - 60) * 1000 });
  return json.access_token;
}

async function paypal(cfg: PaypalSettings, method: "GET" | "POST", path: string, body?: unknown) {
  const token = await paypalToken(cfg);
  return call("PayPal", `${paypalBase(cfg)}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function createPaypalOrder(
  cfg: PaypalSettings,
  o: { paymentId: string; invoiceId: string; amount: number; currency: string; description: string; brandName: string; returnUrl: string; cancelUrl: string },
) {
  const { status, json } = await paypal(cfg, "POST", "/v2/checkout/orders", {
    intent: "CAPTURE",
    purchase_units: [{ reference_id: o.invoiceId, custom_id: o.paymentId, description: o.description.slice(0, 127), amount: { currency_code: o.currency, value: fromMinor(o.amount, o.currency) } }],
    payment_source: {
      paypal: { experience_context: { brand_name: o.brandName.slice(0, 127), user_action: "PAY_NOW", shipping_preference: "NO_SHIPPING", return_url: o.returnUrl, cancel_url: o.cancelUrl } },
    },
  });
  if (status >= 400) throw gatewayError("PayPal", status, json);
  const links = (json.links as { rel: string; href: string }[] | undefined) ?? [];
  const approve = links.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
  if (!approve) throw new UserInputError("PayPal didn't return a payment page.");
  return { id: String(json.id), url: approve };
}

export interface PaypalCapture {
  completed: boolean;
  captureId: string | null;
  amount: number;
  currency: string;
}

function captureFrom(json: Record<string, unknown>): PaypalCapture {
  const unit = (json.purchase_units as { payments?: { captures?: { id: string; status: string; amount: { value: string; currency_code: string } }[] } }[] | undefined)?.[0];
  const capture = unit?.payments?.captures?.find((c) => c.status === "COMPLETED");
  if (!capture) return { completed: false, captureId: null, amount: 0, currency: "" };
  const currency = capture.amount.currency_code;
  const [whole, frac = ""] = capture.amount.value.split(".");
  const decimals = fromMinor(1, currency).split(".")[1]?.length ?? 0;
  return { completed: true, captureId: capture.id, amount: Number(whole) * 10 ** decimals + Number(frac.padEnd(decimals, "0").slice(0, decimals) || 0), currency };
}

/** Captures an approved order (or reads it if it was captured already) */
export async function capturePaypalOrder(cfg: PaypalSettings, orderId: string): Promise<PaypalCapture> {
  const path = `/v2/checkout/orders/${encodeURIComponent(orderId)}`;
  const { status, json } = await paypal(cfg, "POST", `${path}/capture`, {});
  if (status < 400) return captureFrom(json);
  const issue = (json.details as { issue?: string }[] | undefined)?.[0]?.issue;
  if (status === 422 && issue === "ORDER_ALREADY_CAPTURED") {
    const again = await paypal(cfg, "GET", path);
    if (again.status < 400) return captureFrom(again.json);
  }
  // Not approved yet (customer closed the page): nothing to capture
  if (status === 422 && issue === "ORDER_NOT_APPROVED") return { completed: false, captureId: null, amount: 0, currency: "" };
  throw gatewayError("PayPal", status, json);
}

/** PayPal webhooks are verified by PayPal itself (needs the webhook id from the dashboard) */
export async function verifyPaypalWebhook(cfg: PaypalSettings, headers: Headers, raw: string): Promise<boolean> {
  if (!cfg.webhookId) return false;
  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return false;
  }
  const { status, json } = await paypal(cfg, "POST", "/v1/notifications/verify-webhook-signature", {
    auth_algo: headers.get("paypal-auth-algo"),
    cert_url: headers.get("paypal-cert-url"),
    transmission_id: headers.get("paypal-transmission-id"),
    transmission_sig: headers.get("paypal-transmission-sig"),
    transmission_time: headers.get("paypal-transmission-time"),
    webhook_id: cfg.webhookId,
    webhook_event: event,
  });
  return status < 400 && json.verification_status === "SUCCESS";
}
