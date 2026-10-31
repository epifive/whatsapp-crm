import crypto from "node:crypto";
import { safeEqual } from "@/lib/crypto";
import type { MessageType } from "@/generated/prisma/client";

/** Meta signs webhook bodies: X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(appSecret, rawBody) */
export function verifyWebhookSignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  return safeEqual(header, expected);
}

export interface InboundMessageEvent {
  kind: "message";
  phoneNumberId: string;
  from: string; // digits
  profileName?: string;
  externalId: string;
  timestamp: Date;
  type: MessageType;
  body?: string;
  media?: { providerMediaId: string; mimeType?: string; fileName?: string; caption?: string };
  payload?: Record<string, unknown>;
  replyToExternalId?: string;
}

export interface StatusEvent {
  kind: "status";
  phoneNumberId: string;
  externalId: string;
  status: "SENT" | "DELIVERED" | "READ" | "FAILED";
  timestamp: Date;
  error?: string;
}

export interface TemplateStatusEvent {
  kind: "template";
  templateId: string;
  status: string;
  reason?: string;
}

export type WebhookEvent = InboundMessageEvent | StatusEvent | TemplateStatusEvent;

const MEDIA_TYPES: Record<string, MessageType> = {
  image: "IMAGE",
  video: "VIDEO",
  audio: "AUDIO",
  document: "DOCUMENT",
  sticker: "STICKER",
};

/* eslint-disable @typescript-eslint/no-explicit-any -- webhook JSON is untyped; fields are read defensively */
function parseMessage(phoneNumberId: string, m: any, profileName?: string): InboundMessageEvent | null {
  if (!m?.id || !m?.from) return null;
  const base = {
    kind: "message" as const,
    phoneNumberId,
    from: String(m.from).replace(/\D/g, ""),
    profileName,
    externalId: String(m.id),
    timestamp: new Date(Number(m.timestamp) * 1000 || Date.now()),
    replyToExternalId: m.context?.id ? String(m.context.id) : undefined,
  };
  if (m.type === "text") return { ...base, type: "TEXT", body: String(m.text?.body ?? "") };
  if (MEDIA_TYPES[m.type]) {
    const media = m[m.type] ?? {};
    return {
      ...base,
      type: MEDIA_TYPES[m.type],
      body: media.caption ? String(media.caption) : undefined,
      media: { providerMediaId: String(media.id), mimeType: media.mime_type, fileName: media.filename, caption: media.caption },
    };
  }
  if (m.type === "location") {
    const l = m.location ?? {};
    return { ...base, type: "LOCATION", body: [l.name, l.address].filter(Boolean).join(", ") || undefined, payload: { latitude: l.latitude, longitude: l.longitude, name: l.name, address: l.address } };
  }
  if (m.type === "contacts") return { ...base, type: "CONTACT", payload: { contacts: m.contacts } };
  if (m.type === "reaction") return { ...base, type: "REACTION", body: m.reaction?.emoji, payload: { targetExternalId: m.reaction?.message_id } };
  if (m.type === "interactive") {
    const reply = m.interactive?.button_reply ?? m.interactive?.list_reply;
    return { ...base, type: "INTERACTIVE", body: reply?.title, payload: { replyId: reply?.id, kind: m.interactive?.type } };
  }
  if (m.type === "button") return { ...base, type: "INTERACTIVE", body: m.button?.text, payload: { replyId: m.button?.payload, kind: "button" } };
  return { ...base, type: "UNSUPPORTED", body: undefined, payload: { originalType: m.type } };
}

const STATUS_MAP: Record<string, StatusEvent["status"]> = { sent: "SENT", delivered: "DELIVERED", read: "READ", failed: "FAILED" };

/** Flattens a Cloud API webhook payload into events */
export function parseWebhook(body: any): WebhookEvent[] {
  const events: WebhookEvent[] = [];
  for (const entry of Array.isArray(body?.entry) ? body.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      const value = change?.value ?? {};
      if (change?.field === "message_template_status_update") {
        if (value.message_template_id) {
          const reason = value.reason && value.reason !== "NONE" ? String(value.reason) : undefined;
          events.push({ kind: "template", templateId: String(value.message_template_id), status: String(value.event ?? ""), reason });
        }
        continue;
      }
      if (change?.field !== "messages") continue;
      const phoneNumberId = String(value.metadata?.phone_number_id ?? "");
      if (!phoneNumberId) continue;
      const names = new Map<string, string>();
      for (const c of value.contacts ?? []) if (c?.wa_id) names.set(String(c.wa_id), c.profile?.name);
      for (const m of value.messages ?? []) {
        const ev = parseMessage(phoneNumberId, m, names.get(String(m?.from)));
        if (ev) events.push(ev);
      }
      for (const s of value.statuses ?? []) {
        const status = STATUS_MAP[s?.status];
        if (!status || !s?.id) continue;
        const err = s.errors?.[0];
        events.push({
          kind: "status",
          phoneNumberId,
          externalId: String(s.id),
          status,
          timestamp: new Date(Number(s.timestamp) * 1000 || Date.now()),
          error: err ? `${err.title ?? "Error"}${err.code ? ` (${err.code})` : ""}${err.error_data?.details ? `: ${err.error_data.details}` : ""}` : undefined,
        });
      }
    }
  }
  return events;
}
/* eslint-enable @typescript-eslint/no-explicit-any */
