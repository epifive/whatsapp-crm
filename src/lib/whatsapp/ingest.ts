import { db } from "@/lib/db";
import { publish } from "@/lib/realtime";
import type { MessageStatus, MessageType, Prisma } from "@/generated/prisma/client";
import { isOptOutMessage } from "./anti-ban";
import { logActivity } from "@/lib/crm/activity";
import { trackMessageStatus, trackReply } from "@/lib/campaigns/tracking";
import { emitEvent } from "@/lib/webhooks";
import { enqueue, QUEUES } from "@/server/queue";

/**
 * Shared inbound/outbound bookkeeping for both channels. Drivers translate their own events into
 * these calls, so the inbox never needs to know where a message came from.
 */

export interface IncomingMessage {
  accountId: string;
  orgId: string;
  from: string; // contact phone digits
  profileName?: string;
  externalId: string;
  timestamp: Date;
  type: MessageType;
  body?: string;
  media?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  replyToExternalId?: string;
  /** Sent from the phone itself (QR) or another device: store as outbound, don't bump unread */
  fromMe?: boolean;
}

export function previewOf(type: MessageType, body?: string | null): string {
  if (body) return body.slice(0, 120);
  const labels: Partial<Record<MessageType, string>> = {
    IMAGE: "📷 Photo",
    VIDEO: "🎥 Video",
    AUDIO: "🎤 Audio",
    DOCUMENT: "📄 Document",
    STICKER: "Sticker",
    LOCATION: "📍 Location",
    CONTACT: "👤 Contact",
    TEMPLATE: "Template",
    REACTION: "Reaction",
  };
  return labels[type] ?? "Message";
}

/** Stores an inbound (or phone-sent) message; returns null when it was already stored */
export async function recordIncoming(msg: IncomingMessage) {
  if (await db.message.findUnique({ where: { accountId_externalId: { accountId: msg.accountId, externalId: msg.externalId } }, select: { id: true } })) {
    return null;
  }

  const isNewContact = !(await db.contact.findUnique({ where: { orgId_phone: { orgId: msg.orgId, phone: msg.from } }, select: { id: true } }));
  const contact = await db.contact.upsert({
    where: { orgId_phone: { orgId: msg.orgId, phone: msg.from } },
    create: { orgId: msg.orgId, phone: msg.from, waName: msg.profileName || null, source: "whatsapp" },
    update: msg.profileName && !msg.fromMe ? { waName: msg.profileName } : {},
  });

  const inbound = !msg.fromMe;
  // Reactions only annotate another message; they don't move the conversation
  const countsAsActivity = msg.type !== "REACTION";

  const conversation = await db.conversation.upsert({
    where: { accountId_contactId: { accountId: msg.accountId, contactId: contact.id } },
    create: {
      orgId: msg.orgId,
      accountId: msg.accountId,
      contactId: contact.id,
      unreadCount: inbound ? 1 : 0,
      lastMessageAt: msg.timestamp,
      lastMessagePreview: previewOf(msg.type, msg.body),
      lastInboundAt: inbound ? msg.timestamp : null,
    },
    update: countsAsActivity
      ? {
          // A new customer message re-opens a closed conversation
          ...(inbound ? { unreadCount: { increment: 1 }, lastInboundAt: msg.timestamp, status: "OPEN" } : {}),
          lastMessageAt: msg.timestamp,
          lastMessagePreview: previewOf(msg.type, msg.body),
        }
      : {},
  });

  const replyTo = msg.replyToExternalId
    ? await db.message.findUnique({ where: { accountId_externalId: { accountId: msg.accountId, externalId: msg.replyToExternalId } }, select: { id: true } })
    : null;

  let message;
  try {
    message = await db.message.create({
      data: {
        orgId: msg.orgId,
        conversationId: conversation.id,
        accountId: msg.accountId,
        direction: inbound ? "INBOUND" : "OUTBOUND",
        type: msg.type,
        body: msg.body ?? null,
        media: (msg.media as Prisma.InputJsonValue) ?? undefined,
        payload: (msg.payload as Prisma.InputJsonValue) ?? undefined,
        externalId: msg.externalId,
        status: inbound ? "RECEIVED" : "SENT",
        replyToId: replyTo?.id ?? null,
        createdAt: msg.timestamp,
      },
    });
  } catch (err) {
    // Concurrent duplicate delivery of the same webhook/event
    if ((err as { code?: string }).code === "P2002") return null;
    throw err;
  }

  // STOP / unsubscribe replies blacklist the contact for campaigns
  if (inbound && msg.type === "TEXT" && isOptOutMessage(msg.body) && !contact.optedOut) {
    await db.contact.update({ where: { id: contact.id }, data: { optedOut: true, optedOutAt: new Date() } });
    await logActivity({ orgId: msg.orgId, contactId: contact.id, type: "contact.opted_out", data: { via: "reply", text: (msg.body ?? "").slice(0, 100) } });
  }

  if (inbound && countsAsActivity) await trackReply(msg.accountId, contact.id, msg.timestamp);
  await publish(`org:${msg.orgId}`, "message.created", { conversationId: conversation.id, messageId: message.id });

  if (isNewContact) await emitEvent(msg.orgId, "contact.created", { contact: { id: contact.id, phone: contact.phone, name: contact.waName, source: "whatsapp" } });
  if (inbound) {
    await emitEvent(msg.orgId, "message.received", {
      message: { id: message.id, type: message.type, text: message.body, timestamp: message.createdAt.toISOString(), reply_id: (msg.payload as { replyId?: string } | undefined)?.replyId ?? null },
      contact: { id: contact.id, phone: contact.phone, name: contact.name ?? contact.waName },
      conversation_id: conversation.id,
      account_id: msg.accountId,
    });
    // Chatbot flows: one FIFO lane per conversation, never retried (a failure must not block the chat)
    await enqueue(QUEUES.flowInbound, { messageId: message.id }, { singletonKey: conversation.id, retryLimit: 0 });
  }
  return { message, conversation, contact };
}

const STATUS_RANK: Record<MessageStatus, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4, RECEIVED: 0 };

/** Delivery receipts: statuses only move forward (sent → delivered → read), failures always win */
export async function recordStatus(accountId: string, externalId: string, status: MessageStatus, error?: string) {
  const message = await db.message.findUnique({ where: { accountId_externalId: { accountId, externalId } } });
  if (!message || message.direction !== "OUTBOUND") return;
  if (status !== "FAILED" && STATUS_RANK[status] <= STATUS_RANK[message.status]) return;
  await db.message.update({ where: { id: message.id }, data: { status, error: error ?? message.error } });
  await trackMessageStatus(message.id, status, error);
  await emitEvent(message.orgId, "message.status", { message_id: message.id, conversation_id: message.conversationId, status: status.toLowerCase(), error: error ?? null });
  await publish(`org:${message.orgId}`, "message.updated", { conversationId: message.conversationId, messageId: message.id, status });
}
