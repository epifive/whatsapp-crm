import { db } from "@/lib/db";
import { publish } from "@/lib/realtime";
import { enqueue, QUEUES } from "@/server/queue";
import type { Message, MessageType, Prisma } from "@/generated/prisma/client";
import { previewOf } from "./ingest";

export type SendProfile = "conversation" | "bulk";

export interface OutboundInput {
  orgId: string;
  conversationId: string;
  accountId: string;
  type: MessageType;
  body?: string | null;
  media?: Record<string, unknown> | null;
  payload?: Record<string, unknown> | null;
  sentById?: string | null;
  replyToId?: string | null;
  /** "conversation" = agent/bot reply (short anti-ban gap); "bulk" = campaign (full jitter) */
  profile?: SendProfile;
  /** Runs after the message row exists but before the worker can pick it up (e.g. link it to a campaign recipient) */
  beforeEnqueue?: (message: Message) => Promise<unknown>;
}

/**
 * Stores the message as QUEUED and hands it to the worker, which sends it through the right
 * driver (Cloud API, or QR with anti-ban pacing) and updates its status.
 */
export async function queueOutbound(input: OutboundInput) {
  const message = await db.message.create({
    data: {
      orgId: input.orgId,
      conversationId: input.conversationId,
      accountId: input.accountId,
      direction: "OUTBOUND",
      type: input.type,
      body: input.body ?? null,
      media: (input.media as Prisma.InputJsonValue) ?? undefined,
      payload: (input.payload as Prisma.InputJsonValue) ?? undefined,
      status: "QUEUED",
      sentById: input.sentById ?? null,
      replyToId: input.replyToId ?? null,
    },
  });
  await db.conversation.update({
    where: { id: input.conversationId },
    data: { lastMessageAt: message.createdAt, lastMessagePreview: previewOf(input.type, input.body) },
  });
  await input.beforeEnqueue?.(message);
  await enqueue(QUEUES.outboundSend, { messageId: message.id, profile: input.profile ?? "conversation" });
  await publish(`org:${input.orgId}`, "message.created", { conversationId: input.conversationId, messageId: message.id });
  return message;
}
