import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { publish } from "@/lib/realtime";
import { saveMedia } from "@/lib/storage";
import { downloadMedia } from "@/lib/whatsapp/official/client";
import { parseWebhook } from "@/lib/whatsapp/official/webhook";
import { recordIncoming, recordStatus } from "@/lib/whatsapp/ingest";
import { enqueue, QUEUES } from "../queue";
import type { TemplateStatus } from "@/generated/prisma/client";

const TEMPLATE_STATUS: Record<string, TemplateStatus> = {
  APPROVED: "APPROVED",
  PENDING: "PENDING",
  REJECTED: "REJECTED",
  PAUSED: "PAUSED",
  DISABLED: "DISABLED",
};

/** Worker handler for QUEUES.officialInbound: a verified webhook body for one account */
export async function processOfficialInbound(data: { accountId: string; payload: unknown }) {
  const account = await db.whatsAppAccount.findUnique({ where: { id: data.accountId } });
  if (!account || account.channel !== "OFFICIAL") return;

  for (const ev of parseWebhook(data.payload)) {
    if (ev.kind === "template") {
      const status = TEMPLATE_STATUS[ev.status.toUpperCase()];
      if (status) await db.template.updateMany({ where: { accountId: account.id, externalId: ev.templateId }, data: { status, statusReason: ev.reason ?? null } });
      await publish(`org:${account.orgId}`, "templates.changed", { accountId: account.id });
      continue;
    }
    // Events for a different number on the same Meta app don't belong to this account
    if (ev.phoneNumberId !== account.phoneNumberId) continue;

    if (ev.kind === "status") {
      await recordStatus(account.id, ev.externalId, ev.status, ev.error);
      continue;
    }

    const result = await recordIncoming({
      accountId: account.id,
      orgId: account.orgId,
      from: ev.from,
      profileName: ev.profileName,
      externalId: ev.externalId,
      timestamp: ev.timestamp,
      type: ev.type,
      body: ev.body,
      media: ev.media ? { providerMediaId: ev.media.providerMediaId, mimeType: ev.media.mimeType, fileName: ev.media.fileName } : undefined,
      payload: ev.payload,
      replyToExternalId: ev.replyToExternalId,
    });
    if (result && ev.media) await enqueue(QUEUES.mediaDownload, { messageId: result.message.id });
  }
}

/** Worker handler for QUEUES.mediaDownload: fetch Cloud API media into our storage */
export async function processMediaDownload(data: { messageId: string }) {
  const msg = await db.message.findUnique({ where: { id: data.messageId }, include: { account: true } });
  const media = (msg?.media ?? {}) as { providerMediaId?: string; storageKey?: string; mimeType?: string; fileName?: string };
  if (!msg || media.storageKey || !media.providerMediaId || !msg.account.accessTokenEnc) return;

  const file = await downloadMedia(media.providerMediaId, decrypt(msg.account.accessTokenEnc));
  const saved = await saveMedia(msg.orgId, file.data, file.mimeType || media.mimeType, media.fileName);
  await db.message.update({ where: { id: msg.id }, data: { media: { ...media, ...saved, mimeType: file.mimeType || media.mimeType } } });
  await publish(`org:${msg.orgId}`, "message.updated", { conversationId: msg.conversationId, messageId: msg.id });
}
