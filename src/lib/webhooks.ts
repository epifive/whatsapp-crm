import crypto from "node:crypto";
import { db } from "@/lib/db";
import { decrypt, deriveKey } from "@/lib/crypto";
import { safeRequest } from "@/lib/safe-http";
import { enqueue, QUEUES } from "@/server/queue";

/**
 * Outbound webhooks. Every request carries:
 *   X-WACRM-Event, X-WACRM-Delivery (unique id), X-WACRM-Timestamp (unix seconds) and
 *   X-WACRM-Signature: sha256=HMAC_SHA256(secret, "<timestamp>.<raw body>")
 * Receivers verify the signature and reject old timestamps (replays).
 */
export const WEBHOOK_EVENTS = [
  "message.received",
  "message.status",
  "contact.created",
  "flow.completed",
  "deal.stage_changed",
  "deal.won",
  "campaign.completed",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number] | "webhook.test";

export function generateWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(24).toString("hex")}`;
}

/**
 * Secret that signs requests from flow "Webhook" steps: derived from APP_KEY per workspace, so
 * nothing extra is stored. Shown to admins in Settings › Developers.
 */
export function flowSigningSecret(orgId: string): string {
  return `whsec_flow_${crypto.createHmac("sha256", deriveKey("flow-webhook")).update(orgId).digest("hex").slice(0, 48)}`;
}

export function signPayload(secret: string, timestamp: string, rawBody: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export interface PostResult {
  ok: boolean;
  status: number | null;
  durationMs: number;
  body: string;
  error?: string;
}

/** Signed POST to a user-supplied URL (SSRF-safe, 10 s timeout, 64 KB response cap) */
export async function postSigned(url: string, secret: string, event: string, payload: Record<string, unknown>, deliveryId: string = crypto.randomUUID()): Promise<PostResult> {
  const started = Date.now();
  const timestamp = String(Math.floor(started / 1000));
  const raw = JSON.stringify({ id: deliveryId, event, created_at: new Date(started).toISOString(), data: payload });
  try {
    const res = await safeRequest(url, {
      method: "POST",
      body: raw,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "WhatsApp-CRM-Webhook/1.0",
        "X-WACRM-Event": event,
        "X-WACRM-Delivery": deliveryId,
        "X-WACRM-Timestamp": timestamp,
        "X-WACRM-Signature": signPayload(secret, timestamp, raw),
      },
    });
    return { ok: res.status >= 200 && res.status < 300, status: res.status, durationMs: Date.now() - started, body: res.body.toString("utf8").slice(0, 4000) };
  } catch (err) {
    return { ok: false, status: null, durationMs: Date.now() - started, body: "", error: (err as Error).message };
  }
}

/** Queues `event` for every active endpoint of the workspace subscribed to it. Never throws. */
export async function emitEvent(orgId: string, event: WebhookEvent, data: Record<string, unknown>): Promise<void> {
  try {
    // Not cached: the web app adds endpoints while the worker emits events, and one indexed
    // query per event keeps a new webhook working from its first message
    const endpoints = await db.webhookEndpoint.findMany({ where: { orgId, isActive: true, events: { has: event } }, select: { id: true } });
    for (const ep of endpoints) {
      await enqueue(QUEUES.webhookDeliver, { endpointId: ep.id, event, data, deliveryId: crypto.randomUUID(), createdAt: new Date().toISOString() }, { retryLimit: 5, retryDelay: 30 });
    }
  } catch (err) {
    console.error(`[webhooks] could not queue ${event}`, err);
  }
}

const DISABLE_AFTER_FAILURES = 50;

/** Worker handler for QUEUES.webhookDeliver; throws on failure so pg-boss retries with backoff */
export async function deliverWebhookJob(job: { endpointId: string; event: string; data: Record<string, unknown>; deliveryId: string }, attempt: number) {
  const ep = await db.webhookEndpoint.findUnique({ where: { id: job.endpointId } });
  if (!ep || !ep.isActive) return;
  const res = await postSigned(ep.url, decrypt(ep.secretEnc), job.event, job.data, job.deliveryId);
  await db.webhookDelivery.create({
    data: {
      orgId: ep.orgId,
      endpointId: ep.id,
      event: job.event,
      payload: job.data as never,
      status: res.status,
      ok: res.ok,
      attempt: attempt + 1,
      durationMs: res.durationMs,
      error: res.error ?? (res.ok ? null : `HTTP ${res.status}`),
      response: res.body.slice(0, 1000) || null,
    },
  });
  const failures = res.ok ? 0 : ep.failureCount + 1;
  await db.webhookEndpoint.update({
    where: { id: ep.id },
    data: { failureCount: failures, lastStatus: res.status, lastDeliveryAt: new Date(), ...(failures >= DISABLE_AFTER_FAILURES ? { isActive: false } : {}) },
  });
  if (!res.ok) throw new Error(`Webhook ${job.event} to ${ep.url} failed: ${res.error ?? `HTTP ${res.status}`}`);
}
