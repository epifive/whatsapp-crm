import makeWASocket, {
  DisconnectReason,
  downloadMediaMessage,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isLidUser,
  isPnUser,
  makeCacheableSignalKeyStore,
  normalizeMessageContent,
  proto,
  type WAMessage,
  type WASocket,
} from "@whiskeysockets/baileys";
import pino from "pino";
import { db } from "@/lib/db";
import { publish } from "@/lib/realtime";
import { readMedia, saveMedia } from "@/lib/storage";
import { phoneToJid } from "@/lib/whatsapp/phone";
import { PacingQueue, typingMs } from "@/lib/whatsapp/anti-ban";
import { recordIncoming, recordStatus, type IncomingMessage } from "@/lib/whatsapp/ingest";
import type { MessageType } from "@/generated/prisma/client";
import { loadPostgresAuthState } from "./auth-state";

const logger = pino({ level: process.env.BAILEYS_LOG_LEVEL || "silent" });

interface Session {
  socket: WASocket;
  orgId: string;
  connected: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Phone digits for a 1:1 chat JID; LID chats resolve through the alternate (phone) JID */
function chatPhone(key: WAMessage["key"]): string | null {
  const jid = key.remoteJid ?? "";
  if (!jid || isJidGroup(jid) || isJidBroadcast(jid) || isJidNewsletter(jid)) return null;
  if (isPnUser(jid)) return jid.split("@")[0].split(":")[0];
  if (isLidUser(jid) && key.remoteJidAlt && isPnUser(key.remoteJidAlt)) return key.remoteJidAlt.split("@")[0].split(":")[0];
  return null;
}

/** Converts a Baileys message into our stored shape (without media bytes) */
function describe(msg: WAMessage): Pick<IncomingMessage, "type" | "body" | "payload" | "replyToExternalId"> & { mediaKind?: string; mimeType?: string; fileName?: string } | null {
  const m = normalizeMessageContent(msg.message);
  if (!m) return null;
  const ctx = (m.extendedTextMessage ?? m.imageMessage ?? m.videoMessage ?? m.documentMessage ?? m.audioMessage)?.contextInfo;
  const replyToExternalId = ctx?.stanzaId ?? undefined;

  if (m.conversation || m.extendedTextMessage) return { type: "TEXT", body: m.conversation ?? m.extendedTextMessage?.text ?? "", replyToExternalId };
  const media: [keyof proto.IMessage, MessageType][] = [
    ["imageMessage", "IMAGE"],
    ["videoMessage", "VIDEO"],
    ["audioMessage", "AUDIO"],
    ["documentMessage", "DOCUMENT"],
    ["stickerMessage", "STICKER"],
  ];
  for (const [field, type] of media) {
    const part = m[field] as { caption?: string | null; mimetype?: string | null; fileName?: string | null } | null | undefined;
    if (part) return { type, body: part.caption ?? undefined, mediaKind: field, mimeType: part.mimetype ?? undefined, fileName: part.fileName ?? undefined, replyToExternalId };
  }
  if (m.locationMessage) {
    const l = m.locationMessage;
    return { type: "LOCATION", body: [l.name, l.address].filter(Boolean).join(", ") || undefined, payload: { latitude: l.degreesLatitude, longitude: l.degreesLongitude, name: l.name, address: l.address } };
  }
  if (m.contactMessage || m.contactsArrayMessage) return { type: "CONTACT", body: m.contactMessage?.displayName ?? undefined };
  if (m.reactionMessage) return { type: "REACTION", body: m.reactionMessage.text ?? undefined, payload: { targetExternalId: m.reactionMessage.key?.id } };
  if (m.buttonsResponseMessage) return { type: "INTERACTIVE", body: m.buttonsResponseMessage.selectedDisplayText ?? undefined, payload: { replyId: m.buttonsResponseMessage.selectedButtonId } };
  if (m.listResponseMessage) return { type: "INTERACTIVE", body: m.listResponseMessage.title ?? undefined, payload: { replyId: m.listResponseMessage.singleSelectReply?.selectedRowId } };
  if (m.templateButtonReplyMessage) return { type: "INTERACTIVE", body: m.templateButtonReplyMessage.selectedDisplayText ?? undefined, payload: { replyId: m.templateButtonReplyMessage.selectedId } };
  // Protocol messages, receipts, key distribution etc. carry nothing for the inbox
  return null;
}

const RECEIPT_STATUS: Record<number, "SENT" | "DELIVERED" | "READ"> = {
  [proto.WebMessageInfo.Status.SERVER_ACK]: "SENT",
  [proto.WebMessageInfo.Status.DELIVERY_ACK]: "DELIVERED",
  [proto.WebMessageInfo.Status.READ]: "READ",
  [proto.WebMessageInfo.Status.PLAYED]: "READ",
};

/**
 * Owns every QR (WhatsApp Web) connection. Runs only in the worker; one worker at a time holds
 * the QR lock so two processes never fight over the same WhatsApp session.
 */
export class QrManager {
  private sessions = new Map<string, Session>();
  // Consecutive failed connection attempts per account, for reconnect backoff
  private retries = new Map<string, number>();
  readonly pacing = new PacingQueue();

  isConnected(accountId: string): boolean {
    return this.sessions.get(accountId)?.connected ?? false;
  }

  private async setStatus(accountId: string, orgId: string, data: { status: "DISCONNECTED" | "CONNECTING" | "QR_PENDING" | "CONNECTED" | "LOGGED_OUT" | "ERROR"; statusMessage?: string | null; pendingQr?: string | null; phone?: string; connectedAt?: Date }) {
    await db.whatsAppAccount.update({ where: { id: accountId }, data: { statusMessage: null, ...data } });
    await publish(`org:${orgId}`, "account.updated", { accountId, status: data.status, ...(data.pendingQr ? { qr: data.pendingQr } : {}) });
  }

  /** Reconnects every QR number that was connected before the worker (re)started */
  async restoreAll() {
    const accounts = await db.whatsAppAccount.findMany({
      where: { channel: "QR", status: { in: ["CONNECTED", "CONNECTING"] } },
      select: { id: true },
    });
    for (const a of accounts) await this.start(a.id).catch((err) => console.error(`[qr] restore ${a.id} failed:`, err));
    if (accounts.length) console.log(`> Restored ${accounts.length} QR session(s)`);
  }

  async start(accountId: string) {
    const existing = this.sessions.get(accountId);
    if (existing) return;
    const account = await db.whatsAppAccount.findUnique({ where: { id: accountId } });
    if (!account || account.channel !== "QR") return;

    const { state, saveCreds, clear } = await loadPostgresAuthState(accountId);
    const socket = makeWASocket({
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
      logger,
      browser: ["CRM for WhatsApp", "Chrome", "120.0"],
      markOnlineOnConnect: false,
      syncFullHistory: false,
      // Our own sends are stored by the outbound pipeline; don't echo them back as new messages
      emitOwnEvents: false,
      generateHighQualityLinkPreview: false,
      // Lets WhatsApp re-request a message we sent (retry receipts)
      getMessage: async (key) => {
        if (!key.id) return undefined;
        const stored = await db.message.findUnique({ where: { accountId_externalId: { accountId, externalId: key.id } }, select: { body: true } });
        return stored?.body ? { conversation: stored.body } : undefined;
      },
    });
    const session: Session = { socket, orgId: account.orgId, connected: false };
    this.sessions.set(accountId, session);
    await this.setStatus(accountId, account.orgId, { status: "CONNECTING" });

    socket.ev.on("creds.update", () => void saveCreds().catch((err) => console.error("[qr] saveCreds failed", err)));

    socket.ev.on("connection.update", async (update) => {
      // A newer session replaced this one, or it was stopped on purpose: ignore its events
      if (this.sessions.get(accountId) !== session) return;
      try {
        if (update.qr) await this.setStatus(accountId, account.orgId, { status: "QR_PENDING", pendingQr: update.qr });

        if (update.connection === "open") {
          session.connected = true;
          this.retries.set(accountId, 0);
          const phone = socket.user?.id ? socket.user.id.split("@")[0].split(":")[0] : undefined;
          const current = await db.whatsAppAccount.findUnique({ where: { id: accountId }, select: { connectedAt: true } });
          await this.setStatus(accountId, account.orgId, {
            status: "CONNECTED",
            pendingQr: null,
            phone,
            // Warmup counts from the first time this number connected
            ...(current?.connectedAt ? {} : { connectedAt: new Date() }),
          });
          await db.whatsAppAccount.update({ where: { id: accountId }, data: { displayName: socket.user?.name ?? undefined } });
        }

        if (update.connection === "close") {
          session.connected = false;
          const code = (update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
          this.sessions.delete(accountId);
          if (code === DisconnectReason.loggedOut) {
            await clear();
            await this.setStatus(accountId, account.orgId, { status: "LOGGED_OUT", pendingQr: null, statusMessage: "Logged out from the phone. Scan the QR code again." });
            return;
          }
          // Exponential backoff up to a minute
          const attempt = this.retries.get(accountId) ?? 0;
          this.retries.set(accountId, attempt + 1);
          const delay = Math.min(60_000, 2000 * 2 ** attempt);
          await this.setStatus(accountId, account.orgId, { status: "CONNECTING", statusMessage: `Reconnecting (code ${code ?? "?"})…` });
          setTimeout(() => {
            if (this.sessions.has(accountId)) return;
            void db.whatsAppAccount.findUnique({ where: { id: accountId }, select: { status: true } }).then((a) => {
              // Only reconnect if nobody stopped it meanwhile
              if (a && a.status === "CONNECTING") void this.start(accountId);
            });
          }, delay);
        }
      } catch (err) {
        console.error(`[qr] connection.update ${accountId}:`, err);
      }
    });

    socket.ev.on("messages.upsert", async ({ messages, type }) => {
      // "notify" = new messages; "append" = sent from the phone / other linked devices
      if (type !== "notify" && type !== "append") return;
      for (const msg of messages) {
        try {
          await this.handleIncoming(accountId, account.orgId, socket, msg);
        } catch (err) {
          console.error(`[qr] inbound ${accountId}:`, err);
        }
      }
    });

    socket.ev.on("messages.update", async (updates) => {
      for (const { key, update } of updates) {
        const status = update.status != null ? RECEIPT_STATUS[update.status] : undefined;
        if (status && key.fromMe && key.id) await recordStatus(accountId, key.id, status).catch(() => null);
      }
    });
  }

  private async handleIncoming(accountId: string, orgId: string, socket: WASocket, msg: WAMessage) {
    if (!msg.key.id || !msg.message) return;
    const phone = chatPhone(msg.key);
    if (!phone) return;
    const d = describe(msg);
    if (!d) return;

    let media: Record<string, unknown> | undefined;
    if (d.mediaKind) {
      try {
        const data = await downloadMediaMessage(msg, "buffer", {}, { logger, reuploadRequest: socket.updateMediaMessage });
        const saved = await saveMedia(orgId, data, d.mimeType, d.fileName);
        media = { ...saved, mimeType: d.mimeType, fileName: d.fileName };
      } catch (err) {
        media = { error: `Media could not be downloaded: ${(err as Error).message}`, mimeType: d.mimeType, fileName: d.fileName };
      }
    }

    await recordIncoming({
      accountId,
      orgId,
      from: phone,
      profileName: msg.pushName ?? undefined,
      externalId: msg.key.id,
      timestamp: new Date(Number(msg.messageTimestamp ?? 0) * 1000 || Date.now()),
      type: d.type,
      body: d.body,
      media,
      payload: d.payload,
      replyToExternalId: d.replyToExternalId,
      fromMe: !!msg.key.fromMe,
    });
  }

  /** Stops a session; with `logout` the phone is unlinked and stored credentials are deleted */
  async stop(accountId: string, opts: { logout?: boolean } = {}) {
    const session = this.sessions.get(accountId);
    // Remove first so the close event doesn't schedule a reconnect
    this.sessions.delete(accountId);
    if (session) {
      try {
        if (opts.logout) await session.socket.logout();
      } catch {
        // already disconnected
      }
      try {
        session.socket.end(undefined);
      } catch {
        // ignore
      }
    }
    if (opts.logout) await db.baileysAuthKey.deleteMany({ where: { accountId } });
    const account = await db.whatsAppAccount.findUnique({ where: { id: accountId }, select: { orgId: true } });
    if (account) await this.setStatus(accountId, account.orgId, { status: opts.logout ? "LOGGED_OUT" : "DISCONNECTED", pendingQr: null });
  }

  async stopAll() {
    for (const [, s] of this.sessions) {
      try {
        s.socket.end(undefined);
      } catch {
        // ignore
      }
    }
    this.sessions.clear();
  }

  /**
   * Sends one message with human-like behaviour: per-number queue, "typing…" for a realistic
   * time, then the message. `gapMs` keeps the number idle afterwards (anti-ban pacing).
   */
  async send(accountId: string, toPhone: string, content: QrContent, gapMs: number): Promise<string> {
    return this.pacing.run(accountId, gapMs, async () => {
      const session = this.sessions.get(accountId);
      if (!session?.connected) throw new QrNotConnectedError();
      const jid = phoneToJid(toPhone);
      const textLength = content.text?.length ?? content.caption?.length ?? 0;
      await session.socket.presenceSubscribe(jid).catch(() => null);
      await session.socket.sendPresenceUpdate("composing", jid).catch(() => null);
      await sleep(typingMs(textLength));
      await session.socket.sendPresenceUpdate("paused", jid).catch(() => null);

      const quoted = content.quoted
        ? ({ key: { remoteJid: jid, id: content.quoted.externalId, fromMe: content.quoted.fromMe }, message: { conversation: content.quoted.body ?? "" } } as WAMessage)
        : undefined;

      let sent: WAMessage | undefined;
      if (content.kind === "text") {
        sent = await session.socket.sendMessage(jid, { text: content.text ?? "" }, { quoted });
      } else {
        const data = await readMedia(content.storageKey!);
        const mimetype = content.mimeType ?? "application/octet-stream";
        if (content.kind === "image") sent = await session.socket.sendMessage(jid, { image: data, caption: content.caption, mimetype }, { quoted });
        else if (content.kind === "video") sent = await session.socket.sendMessage(jid, { video: data, caption: content.caption, mimetype }, { quoted });
        else if (content.kind === "audio") sent = await session.socket.sendMessage(jid, { audio: data, mimetype }, { quoted });
        else sent = await session.socket.sendMessage(jid, { document: data, mimetype, fileName: content.fileName ?? "file", caption: content.caption }, { quoted });
      }
      if (!sent?.key.id) throw new Error("WhatsApp did not return a message id");
      return sent.key.id;
    });
  }
}

export class QrNotConnectedError extends Error {
  constructor() {
    super("This WhatsApp number is not connected. Reconnect it in Settings › WhatsApp numbers.");
  }
}

export interface QrContent {
  kind: "text" | "image" | "video" | "audio" | "document";
  text?: string;
  caption?: string;
  storageKey?: string;
  mimeType?: string;
  fileName?: string;
  quoted?: { externalId: string; fromMe: boolean; body?: string | null };
}
