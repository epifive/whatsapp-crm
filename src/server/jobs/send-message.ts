import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { trackMessageStatus } from "@/lib/campaigns/tracking";
import { emitEvent } from "@/lib/webhooks";
import { publish } from "@/lib/realtime";
import { readMedia } from "@/lib/storage";
import { dayKey, effectiveDailyLimit, jitterMs, sentTodayFor, typingMs } from "@/lib/whatsapp/anti-ban";
import { GraphApiError, sendMessage, uploadMedia } from "@/lib/whatsapp/official/client";
import { isWindowOpen } from "@/lib/whatsapp/window";
import type { SendProfile } from "@/lib/whatsapp/outbound";
import { QrNotConnectedError, type QrContent, type QrManager } from "../qr/manager";

const MAX_ATTEMPTS = 4;

/** An error worth retrying later (network hiccup, Meta 5xx/rate limit, QR number reconnecting) */
class RetryableError extends Error {}

interface MediaInfo {
  storageKey?: string;
  mimeType?: string;
  fileName?: string;
}

async function markFailed(messageId: string, orgId: string, conversationId: string, error: string) {
  await db.message.update({ where: { id: messageId }, data: { status: "FAILED", error } });
  await trackMessageStatus(messageId, "FAILED", error);
  await emitEvent(orgId, "message.status", { message_id: messageId, conversation_id: conversationId, status: "failed", error });
  await publish(`org:${orgId}`, "message.updated", { conversationId, messageId, status: "FAILED" });
}

async function countSent(accountId: string) {
  const day = dayKey();
  await db.$executeRaw`UPDATE "WhatsAppAccount"
    SET "sentToday" = CASE WHEN "sentTodayDate" = ${day} THEN "sentToday" + 1 ELSE 1 END, "sentTodayDate" = ${day}
    WHERE id = ${accountId}`;
}

/** Worker handler for QUEUES.outboundSend */
export async function processOutbound(data: { messageId: string; profile?: SendProfile }, attempt: number, qr: QrManager | null) {
  const msg = await db.message.findUnique({
    where: { id: data.messageId },
    include: { account: true, conversation: { include: { contact: true } } },
  });
  if (!msg || msg.status !== "QUEUED") return; // already handled (retry after success, or cancelled)
  const { account, conversation } = msg;
  const contact = conversation.contact;
  const media = (msg.media ?? {}) as MediaInfo;
  const replyTo = msg.replyToId ? await db.message.findUnique({ where: { id: msg.replyToId } }) : null;

  try {
    let externalId: string;

    if (account.channel === "OFFICIAL") {
      if (msg.type !== "TEMPLATE" && !isWindowOpen(conversation.lastInboundAt)) {
        return markFailed(msg.id, msg.orgId, conversation.id, "The 24-hour reply window is closed. Send an approved template to restart the conversation.");
      }
      if (!account.phoneNumberId || !account.accessTokenEnc) return markFailed(msg.id, msg.orgId, conversation.id, "This number's Cloud API credentials are missing.");
      const token = decrypt(account.accessTokenEnc);
      const context = replyTo?.externalId ? { context: { message_id: replyTo.externalId } } : {};

      let payload: Record<string, unknown>;
      if (msg.type === "TEXT") {
        payload = { to: contact.phone, type: "text", text: { body: msg.body ?? "", preview_url: true }, ...context };
      } else if (["IMAGE", "VIDEO", "AUDIO", "DOCUMENT"].includes(msg.type)) {
        if (!media.storageKey) return markFailed(msg.id, msg.orgId, conversation.id, "Attachment is missing.");
        const id = await uploadMedia(account.phoneNumberId, token, {
          data: await readMedia(media.storageKey),
          mimeType: media.mimeType ?? "application/octet-stream",
          fileName: media.fileName ?? "file",
        });
        const kind = msg.type.toLowerCase();
        const part: Record<string, unknown> = { id };
        if (msg.body && kind !== "audio") part.caption = msg.body;
        if (kind === "document") part.filename = media.fileName ?? "file";
        payload = { to: contact.phone, type: kind, [kind]: part, ...context };
      } else if (msg.type === "TEMPLATE" || msg.type === "INTERACTIVE") {
        const p = (msg.payload ?? {}) as Record<string, unknown>;
        payload = msg.type === "TEMPLATE" ? { to: contact.phone, type: "template", template: p.template } : { to: contact.phone, type: "interactive", interactive: p.interactive, ...context };
      } else {
        return markFailed(msg.id, msg.orgId, conversation.id, `Sending ${msg.type.toLowerCase()} messages isn't supported.`);
      }

      try {
        externalId = await sendMessage(account.phoneNumberId, token, payload);
      } catch (err) {
        // Rate limits and server errors are temporary; other 4xx are final (bad number, template, token)
        if (err instanceof GraphApiError && err.status >= 400 && err.status < 500 && err.status !== 429) {
          return markFailed(msg.id, msg.orgId, conversation.id, err.message);
        }
        throw new RetryableError((err as Error).message);
      }
    } else {
      // QR number: anti-ban checks before anything touches WhatsApp
      if (!qr) throw new RetryableError("The QR worker is not running.");
      if (contact.optedOut && !isWindowOpen(conversation.lastInboundAt)) {
        return markFailed(msg.id, msg.orgId, conversation.id, "This contact opted out (replied STOP). You can reply only after they message you again.");
      }
      const limit = effectiveDailyLimit(account);
      if (sentTodayFor(account) >= limit) {
        return markFailed(msg.id, msg.orgId, conversation.id, `Daily sending limit for this number reached (${limit} today${account.warmupEnabled && limit < account.dailyLimit ? ", warmup" : ""}). Try again tomorrow.`);
      }
      if (!qr.isConnected(account.id)) throw new RetryableError(new QrNotConnectedError().message);

      const kind = msg.type === "TEXT" || msg.type === "TEMPLATE" || msg.type === "INTERACTIVE" ? "text" : (msg.type.toLowerCase() as QrContent["kind"]);
      const content: QrContent = {
        kind,
        // Interactive messages (buttons/lists) aren't reliable over WhatsApp Web: send the text fallback
        text: kind === "text" ? (msg.body ?? String((msg.payload as { fallbackText?: string } | null)?.fallbackText ?? "")) : undefined,
        caption: kind !== "text" ? (msg.body ?? undefined) : undefined,
        storageKey: media.storageKey,
        mimeType: media.mimeType,
        fileName: media.fileName,
        quoted: replyTo?.externalId ? { externalId: replyTo.externalId, fromMe: replyTo.direction === "OUTBOUND", body: replyTo.body } : undefined,
      };
      const textLength = content.text?.length ?? content.caption?.length ?? 0;
      // Conversation replies: short human pause; bulk sends: the number's full jitter range
      const idle = data.profile === "bulk" ? jitterMs(account.minDelaySec, account.maxDelaySec) : 2000 + Math.floor(Math.random() * 2000);
      try {
        externalId = await qr.send(account.id, contact.phone, content, typingMs(textLength) + idle);
      } catch (err) {
        if (err instanceof QrNotConnectedError) throw new RetryableError(err.message);
        return markFailed(msg.id, msg.orgId, conversation.id, (err as Error).message);
      }
    }

    try {
      await db.message.update({ where: { id: msg.id }, data: { status: "SENT", externalId, error: null } });
    } catch (err) {
      if ((err as { code?: string }).code !== "P2002") throw err;
      // The message went out, but an echo of it (e.g. from another linked device) was stored first
      // under the same id: drop the echo and keep our record, which has the sender and reply info
      await db.message.deleteMany({ where: { accountId: account.id, externalId, id: { not: msg.id } } });
      await db.message.update({ where: { id: msg.id }, data: { status: "SENT", externalId, error: null } });
    }
    await countSent(account.id);
    await trackMessageStatus(msg.id, "SENT");
    await emitEvent(msg.orgId, "message.status", { message_id: msg.id, conversation_id: conversation.id, status: "sent", error: null });
    await publish(`org:${msg.orgId}`, "message.updated", { conversationId: conversation.id, messageId: msg.id, status: "SENT" });
  } catch (err) {
    if (err instanceof RetryableError && attempt + 1 < MAX_ATTEMPTS) throw err; // pg-boss retries with backoff
    await markFailed(msg.id, msg.orgId, conversation.id, (err as Error).message || "Sending failed.");
  }
}
