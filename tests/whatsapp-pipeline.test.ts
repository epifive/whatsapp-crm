import http from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { dayKey } from "@/lib/whatsapp/anti-ban";
import { recordIncoming, recordStatus } from "@/lib/whatsapp/ingest";
import { processOutbound } from "@/server/jobs/send-message";
import { processOfficialInbound } from "@/server/jobs/official-inbound";
import type { QrManager } from "@/server/qr/manager";

// ── Mock Meta Graph API ────────────────────────────────────────────────
const graphCalls: { method: string; path: string; body: unknown }[] = [];
let graphMode: "ok" | "bad_request" | "server_error" = "ok";
let wamidSeq = 0;
let server: http.Server;

// ── Jobs enqueued by the code under test are captured instead of hitting pg-boss ──
const enqueued: { queue: string; data: unknown }[] = [];

let orgId: string, officialId: string, qrId: string, userId: string;

async function newConversation(accountId: string, phone: string, lastInboundAt: Date | null) {
  const contact = await db.contact.create({ data: { orgId, phone } });
  return db.conversation.create({ data: { orgId, accountId, contactId: contact.id, lastInboundAt } });
}

async function queued(conversationId: string, accountId: string, body = "hello") {
  return db.message.create({ data: { orgId, conversationId, accountId, direction: "OUTBOUND", type: "TEXT", body, status: "QUEUED", sentById: userId } });
}

// Stand-in for the worker's QR manager
function fakeQr(opts: { connected: boolean; fail?: string }) {
  const sent: { to: string; text?: string; gapMs: number }[] = [];
  const qr = {
    isConnected: () => opts.connected,
    send: async (_id: string, to: string, content: { text?: string }, gapMs: number) => {
      if (opts.fail) throw new Error(opts.fail);
      sent.push({ to, text: content.text, gapMs });
      return `QR-${sent.length}-${Date.now()}`;
    },
  } as unknown as QrManager;
  return { qr, sent };
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      graphCalls.push({ method: req.method!, path: req.url!, body: raw ? JSON.parse(raw) : null });
      res.setHeader("Content-Type", "application/json");
      if (graphMode === "bad_request") {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: { message: "(#131030) Recipient phone number not in allowed list", code: 131030 } }));
      }
      if (graphMode === "server_error") {
        res.statusCode = 503;
        return res.end(JSON.stringify({ error: { message: "Service temporarily unavailable", code: 2 } }));
      }
      // Unique like real wamids, across tests
      res.end(JSON.stringify({ messages: [{ id: `wamid.${++wamidSeq}.${Date.now()}` }] }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  process.env.WHATSAPP_GRAPH_BASE = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  globalThis.__wacrmBoss = Promise.resolve({
    send: async (queue: string, data: unknown) => {
      enqueued.push({ queue, data });
      return "job";
    },
  } as never);

  const stamp = Date.now();
  userId = (await db.user.create({ data: { email: `pipe-${stamp}@test.local`, name: "Agent", passwordHash: "x" } })).id;
  orgId = (await db.organization.create({ data: { name: "Pipe Org", slug: `pipe-${stamp}` } })).id;
  officialId = (
    await db.whatsAppAccount.create({
      data: { orgId, name: "Cloud", channel: "OFFICIAL", status: "CONNECTED", phoneNumberId: `pn-${stamp}`, wabaId: "waba", accessTokenEnc: encrypt("token-123"), appSecretEnc: encrypt("secret") },
    })
  ).id;
  qrId = (
    await db.whatsAppAccount.create({
      data: { orgId, name: "QR", channel: "QR", status: "CONNECTED", dailyLimit: 300, warmupEnabled: true, connectedAt: new Date(Date.now() - 30 * 86_400_000) },
    })
  ).id;
});

afterAll(async () => {
  server.close();
  await db.organization.delete({ where: { id: orgId } });
  await db.user.delete({ where: { id: userId } });
  await db.$disconnect();
});

beforeEach(() => {
  graphCalls.length = 0;
  enqueued.length = 0;
  graphMode = "ok";
});

describe("inbound messages", () => {
  it("creates contact + conversation, dedupes, counts unread and reopens closed chats", async () => {
    const base = { accountId: qrId, orgId, from: "919811100001", profileName: "Ravi", type: "TEXT" as const };
    const first = await recordIncoming({ ...base, externalId: "in-1", timestamp: new Date(), body: "hi" });
    expect(first?.conversation.unreadCount).toBe(1);
    expect(await recordIncoming({ ...base, externalId: "in-1", timestamp: new Date(), body: "hi" })).toBeNull();

    await db.conversation.update({ where: { id: first!.conversation.id }, data: { status: "CLOSED" } });
    await recordIncoming({ ...base, externalId: "in-2", timestamp: new Date(), body: "again" });
    const conv = await db.conversation.findUniqueOrThrow({ where: { id: first!.conversation.id } });
    expect([conv.status, conv.unreadCount, conv.lastMessagePreview]).toEqual(["OPEN", 2, "again"]);
    expect((await db.contact.findUniqueOrThrow({ where: { id: first!.contact.id } })).waName).toBe("Ravi");
  });

  it("phone-sent messages are stored as outbound without unread", async () => {
    const r = await recordIncoming({ accountId: qrId, orgId, from: "919811100002", externalId: "me-1", timestamp: new Date(), type: "TEXT", body: "sent from phone", fromMe: true });
    expect([r?.message.direction, r?.conversation.unreadCount, r?.conversation.lastInboundAt]).toEqual(["OUTBOUND", 0, null]);
  });

  it("STOP opts the contact out", async () => {
    const r = await recordIncoming({ accountId: qrId, orgId, from: "919811100003", externalId: "stop-1", timestamp: new Date(), type: "TEXT", body: "Stop." });
    expect((await db.contact.findUniqueOrThrow({ where: { id: r!.contact.id } })).optedOut).toBe(true);
  });

  it("statuses only move forward, failures always apply", async () => {
    const conv = await newConversation(qrId, "919811100004", null);
    const m = await db.message.create({ data: { orgId, conversationId: conv.id, accountId: qrId, direction: "OUTBOUND", type: "TEXT", body: "x", status: "SENT", externalId: "st-1" } });
    await recordStatus(qrId, "st-1", "READ");
    await recordStatus(qrId, "st-1", "DELIVERED"); // late, older receipt
    expect((await db.message.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("READ");
    await recordStatus(qrId, "st-1", "FAILED", "boom");
    expect((await db.message.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("FAILED");
  });
});

describe("Cloud API sending", () => {
  it("sends a text inside the 24h window and stores the wamid", async () => {
    const conv = await newConversation(officialId, "919822200001", new Date());
    const m = await queued(conv.id, officialId, "Thanks for writing!");
    await processOutbound({ messageId: m.id }, 0, null);
    const after = await db.message.findUniqueOrThrow({ where: { id: m.id } });
    expect([after.status, after.externalId?.startsWith("wamid.")]).toEqual(["SENT", true]);
    expect(graphCalls[0].path).toMatch(/\/v\d+\.\d+\/pn-\d+\/messages$/);
    expect(graphCalls[0].body).toMatchObject({ messaging_product: "whatsapp", to: "919822200001", type: "text", text: { body: "Thanks for writing!" } });
    expect((await db.whatsAppAccount.findUniqueOrThrow({ where: { id: officialId } })).sentTodayDate).toBe(dayKey());
  });

  it("refuses free text outside the window without calling Meta", async () => {
    const conv = await newConversation(officialId, "919822200002", new Date(Date.now() - 25 * 3600_000));
    const m = await queued(conv.id, officialId);
    await processOutbound({ messageId: m.id }, 0, null);
    const after = await db.message.findUniqueOrThrow({ where: { id: m.id } });
    expect(after.status).toBe("FAILED");
    expect(after.error).toMatch(/24-hour/);
    expect(graphCalls.length).toBe(0);
  });

  it("templates go out even when the window is closed", async () => {
    const conv = await newConversation(officialId, "919822200003", null);
    const m = await db.message.create({
      data: { orgId, conversationId: conv.id, accountId: officialId, direction: "OUTBOUND", type: "TEMPLATE", body: "Hi", status: "QUEUED", payload: { template: { name: "hello_world", language: { code: "en_US" } } } },
    });
    await processOutbound({ messageId: m.id }, 0, null);
    expect((await db.message.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("SENT");
    expect(graphCalls[0].body).toMatchObject({ type: "template", template: { name: "hello_world" } });
  });

  it("Meta 4xx fails immediately; 5xx is retried, then fails on the last attempt", async () => {
    const conv = await newConversation(officialId, "919822200004", new Date());
    graphMode = "bad_request";
    const a = await queued(conv.id, officialId);
    await processOutbound({ messageId: a.id }, 0, null);
    expect((await db.message.findUniqueOrThrow({ where: { id: a.id } })).error).toMatch(/not in allowed list/);

    graphMode = "server_error";
    const b = await queued(conv.id, officialId);
    await expect(processOutbound({ messageId: b.id }, 0, null)).rejects.toThrow(/temporarily unavailable/);
    expect((await db.message.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("QUEUED");
    await processOutbound({ messageId: b.id }, 3, null);
    expect((await db.message.findUniqueOrThrow({ where: { id: b.id } })).status).toBe("FAILED");
  });

  it("processes a webhook: message stored, media queued, status applied, other numbers ignored", async () => {
    const account = await db.whatsAppAccount.findUniqueOrThrow({ where: { id: officialId } });
    const conv = await newConversation(officialId, "919822200005", new Date());
    await db.message.create({ data: { orgId, conversationId: conv.id, accountId: officialId, direction: "OUTBOUND", type: "TEXT", body: "x", status: "SENT", externalId: "wamid.out-1" } });
    await processOfficialInbound({
      accountId: officialId,
      payload: {
        entry: [
          {
            changes: [
              {
                field: "messages",
                value: {
                  metadata: { phone_number_id: account.phoneNumberId },
                  contacts: [{ wa_id: "919822200009", profile: { name: "Meena" } }],
                  messages: [{ id: "wamid.in-img", from: "919822200009", timestamp: String(Math.floor(Date.now() / 1000)), type: "image", image: { id: "media-1", mime_type: "image/jpeg" } }],
                  statuses: [{ id: "wamid.out-1", status: "read", timestamp: "1" }],
                },
              },
              { field: "messages", value: { metadata: { phone_number_id: "someone-else" }, messages: [{ id: "wamid.foreign", from: "1", type: "text", text: { body: "x" } }] } },
            ],
          },
        ],
      },
    });
    const img = await db.message.findUniqueOrThrow({ where: { accountId_externalId: { accountId: officialId, externalId: "wamid.in-img" } } });
    expect([img.type, img.direction]).toEqual(["IMAGE", "INBOUND"]);
    // The image is downloaded, and the message goes to the chatbot engine (its chat's FIFO lane)
    expect(enqueued.filter((j) => j.queue === "media.download")).toEqual([{ queue: "media.download", data: { messageId: img.id } }]);
    expect(enqueued.filter((j) => j.queue === "flow.inbound").map((j) => j.data)).toEqual([{ messageId: img.id }]);
    expect((await db.message.findUniqueOrThrow({ where: { accountId_externalId: { accountId: officialId, externalId: "wamid.out-1" } } })).status).toBe("READ");
    expect(await db.message.findFirst({ where: { externalId: "wamid.foreign" } })).toBeNull();
  });
});

describe("QR sending with the anti-ban engine", () => {
  it("sends through the QR manager with a short conversational gap", async () => {
    const conv = await newConversation(qrId, "919833300001", new Date());
    const m = await queued(conv.id, qrId, "Namaste!");
    const { qr, sent } = fakeQr({ connected: true });
    await processOutbound({ messageId: m.id, profile: "conversation" }, 0, qr);
    expect((await db.message.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("SENT");
    expect(sent[0]).toMatchObject({ to: "919833300001", text: "Namaste!" });
    expect(sent[0].gapMs).toBeLessThan(12_000); // typing + 2-4s, not the bulk jitter
  });

  it("bulk sends wait the number's full jitter range", async () => {
    const conv = await newConversation(qrId, "919833300002", new Date());
    const m = await queued(conv.id, qrId, "Offer");
    const { qr, sent } = fakeQr({ connected: true });
    await processOutbound({ messageId: m.id, profile: "bulk" }, 0, qr);
    expect(sent[0].gapMs).toBeGreaterThanOrEqual(12_000);
  });

  it("blocks opted-out contacts unless they wrote in the last 24h", async () => {
    const conv = await newConversation(qrId, "919833300003", new Date(Date.now() - 3 * 86_400_000));
    await db.contact.update({ where: { id: conv.contactId }, data: { optedOut: true } });
    const m = await queued(conv.id, qrId);
    const { qr, sent } = fakeQr({ connected: true });
    await processOutbound({ messageId: m.id }, 0, qr);
    expect((await db.message.findUniqueOrThrow({ where: { id: m.id } })).error).toMatch(/opted out/);
    expect(sent.length).toBe(0);
  });

  it("enforces the warmup / daily limit", async () => {
    await db.whatsAppAccount.update({ where: { id: qrId }, data: { connectedAt: new Date(), sentToday: 25, sentTodayDate: dayKey() } });
    const conv = await newConversation(qrId, "919833300004", new Date());
    const m = await queued(conv.id, qrId);
    const { qr, sent } = fakeQr({ connected: true });
    await processOutbound({ messageId: m.id }, 0, qr);
    expect((await db.message.findUniqueOrThrow({ where: { id: m.id } })).error).toMatch(/limit.*\(25 today, warmup\)/);
    expect(sent.length).toBe(0);
    await db.whatsAppAccount.update({ where: { id: qrId }, data: { connectedAt: new Date(Date.now() - 30 * 86_400_000), sentToday: 0 } });
  });

  it("retries while the number is reconnecting, then fails", async () => {
    const conv = await newConversation(qrId, "919833300005", new Date());
    const m = await queued(conv.id, qrId);
    const { qr } = fakeQr({ connected: false });
    await expect(processOutbound({ messageId: m.id }, 0, qr)).rejects.toThrow(/not connected/);
    await processOutbound({ messageId: m.id }, 3, qr);
    expect((await db.message.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("FAILED");
  });
});
