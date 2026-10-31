import http from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { autoReply } from "@/lib/ai/features";
import { runAi } from "@/lib/ai/engine";
import { chunkArticle, rankChunks } from "@/lib/ai/knowledge";
import { AiError, chat } from "@/lib/ai/providers";
import { handleInboundForFlows } from "@/lib/flows/engine";
import { parseGraph } from "@/lib/flows/graph";
import { recordIncoming } from "@/lib/whatsapp/ingest";

// ── Mock AI provider: answers like OpenAI, Gemini or Anthropic depending on the path ──
const calls: { path: string; headers: http.IncomingHttpHeaders; body: Record<string, unknown> }[] = [];
let failNext = 0;
let server: http.Server;

function lastUserText(body: Record<string, unknown>): string {
  if (Array.isArray(body.messages)) {
    const users = (body.messages as { role: string; content: string }[]).filter((m) => m.role === "user");
    return users.at(-1)?.content ?? "";
  }
  const contents = (body.contents as { role: string; parts: { text: string }[] }[]) ?? [];
  return contents.filter((c) => c.role === "user").at(-1)?.parts[0]?.text ?? "";
}

function systemText(body: Record<string, unknown>): string {
  if (typeof body.system === "string") return body.system;
  if (body.systemInstruction) return (body.systemInstruction as { parts: { text: string }[] }).parts[0]!.text;
  return ((body.messages as { role: string; content: string }[]).find((m) => m.role === "system")?.content ?? "") as string;
}

function answer(body: Record<string, unknown>): string {
  const q = lastUserText(body).toLowerCase();
  if (q.includes("refund") || q.includes("human")) return "HANDOFF";
  if (q.includes("hours") && systemText(body).includes("Open 9am to 7pm")) return "We're open 9am to 7pm, Monday to Saturday.";
  return `Answer: ${lastUserText(body)}`;
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      calls.push({ path: req.url!, headers: req.headers, body });
      res.setHeader("Content-Type", "application/json");
      if (failNext > 0) {
        failNext--;
        res.statusCode = 500;
        return res.end(JSON.stringify({ error: { message: "upstream exploded" } }));
      }
      const auth = req.headers.authorization ?? req.headers["x-api-key"] ?? req.headers["x-goog-api-key"];
      if (String(auth).includes("bad-key")) {
        res.statusCode = 401;
        return res.end(JSON.stringify({ error: { message: "Incorrect API key" } }));
      }
      const text = answer(body);
      if (req.url!.startsWith("/v1/chat/completions")) return res.end(JSON.stringify({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 50, completion_tokens: 10 } }));
      if (req.url!.includes(":generateContent")) return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 8 } }));
      return res.end(JSON.stringify({ content: [{ type: "text", text }], usage: { input_tokens: 30, output_tokens: 6 } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  process.env.OPENAI_BASE_URL = url;
  process.env.GEMINI_BASE_URL = url;
  process.env.ANTHROPIC_BASE_URL = url;
});

afterAll(() => server.close());
beforeEach(() => {
  calls.length = 0;
  failNext = 0;
});

describe("providers", () => {
  it("speaks each provider's API", async () => {
    const messages = [{ role: "user" as const, content: "Hi" }, { role: "assistant" as const, content: "Hello!" }, { role: "user" as const, content: "Price?" }];
    const o = await chat({ provider: "openai", model: "gpt-4o-mini", apiKey: "k1", system: "SYS", messages });
    expect([o.text, o.tokensIn, calls[0]!.headers.authorization, (calls[0]!.body.messages as { role: string }[])[0]!.role]).toEqual(["Answer: Price?", 50, "Bearer k1", "system"]);
    const g = await chat({ provider: "gemini", model: "gemini-2.5-flash", apiKey: "k2", system: "SYS", messages });
    expect([g.text, calls[1]!.path, calls[1]!.headers["x-goog-api-key"], (calls[1]!.body.contents as { role: string }[]).map((c) => c.role)]).toEqual([
      "Answer: Price?",
      "/v1beta/models/gemini-2.5-flash:generateContent",
      "k2",
      ["user", "model", "user"],
    ]);
    // Anthropic needs alternating turns that start with the user
    const a = await chat({ provider: "anthropic", model: "claude-haiku-5-5", apiKey: "k3", system: "SYS", messages: [{ role: "assistant", content: "Welcome!" }, ...messages] });
    expect([a.text, calls[2]!.headers["x-api-key"], (calls[2]!.body.messages as { role: string }[]).map((m) => m.role)]).toEqual(["Answer: Price?", "k3", ["user", "assistant", "user", "assistant", "user"]]);
  });

  it("explains provider errors", async () => {
    await expect(chat({ provider: "openai", model: "m", apiKey: "bad-key", system: "", messages: [{ role: "user", content: "x" }] })).rejects.toMatchObject({ code: "auth" });
  });
});

describe("knowledge", () => {
  it("picks the relevant passages", () => {
    const chunks = [
      ...chunkArticle("Shipping", "We ship across India in 3-5 days. Free shipping above ₹999."),
      ...chunkArticle("Returns", "Returns are accepted within 7 days if the product is unused."),
      ...chunkArticle("Payment", "We accept UPI, cards and cash on delivery."),
    ];
    expect(rankChunks(chunks, "How many days for returns?", 200)[0]).toContain("Returns");
    expect(rankChunks(chunks, "do you take UPI", 200)[0]).toContain("Payment");
    expect(rankChunks(chunks, "hello", 200)).toEqual([]);
  });
});

describe("workspace AI account", () => {
  let orgId: string;
  beforeAll(async () => {
    orgId = (await db.organization.create({ data: { name: "AI Org", slug: `ai-${Date.now()}` } })).id;
  });
  afterAll(async () => {
    await db.organization.deleteMany({ where: { id: orgId } });
  });

  it("needs the workspace's own key", async () => {
    await expect(runAi(orgId, "test", { system: "", messages: [{ role: "user", content: "x" }] })).rejects.toMatchObject({ code: "not_configured" });
    expect(calls.length).toBe(0);
  });

  it("uses the workspace's provider and key, and logs every request", async () => {
    await db.aiConfig.create({ data: { orgId, provider: "anthropic", model: "claude-haiku-5-5", apiKeyEnc: encrypt("own-key") } });
    const ask = () => runAi(orgId, "suggest", { system: "S", messages: [{ role: "user", content: "hi" }] });
    const r = await ask();
    expect([r.text, calls.at(-1)!.headers["x-api-key"], (calls.at(-1)!.body as { model: string }).model]).toEqual(["Answer: hi", "own-key", "claude-haiku-5-5"]);
    failNext = 1;
    await expect(ask()).rejects.toBeInstanceOf(AiError);
    const usage = await db.aiUsage.findMany({ where: { orgId }, orderBy: { createdAt: "asc" } });
    expect(usage.map((u) => [u.feature, u.ok, u.tokensIn])).toEqual([
      ["suggest", true, 30],
      ["suggest", false, 0],
    ]);
  });
});

describe("AI in conversations", () => {
  let orgId: string, accountId: string, agentId: string;
  const enqueued: { queue: string }[] = [];
  let seq = 0;

  async function customerSays(phone: string, text: string) {
    const r = await recordIncoming({ accountId, orgId, from: phone, profileName: "Anil", externalId: `ai-${++seq}-${Date.now()}`, timestamp: new Date(Date.now() + seq), type: "TEXT", body: text });
    await handleInboundForFlows({ messageId: r!.message.id });
    return r!.conversation.id;
  }
  const out = async (conversationId: string) =>
    (await db.message.findMany({ where: { conversationId, direction: "OUTBOUND" }, orderBy: { createdAt: "asc" } })).map((m) => m.body);

  beforeAll(async () => {
    globalThis.__wacrmBoss = Promise.resolve({ send: async (queue: string) => (enqueued.push({ queue }), "job") } as never);
    const stamp = Date.now();
    agentId = (await db.user.create({ data: { email: `ai-agent-${stamp}@test.local`, name: "Agent", passwordHash: "x" } })).id;
    orgId = (await db.organization.create({ data: { name: "Shop", slug: `ai-shop-${stamp}` } })).id;
    await db.aiConfig.create({ data: { orgId, provider: "gemini", model: "gemini-2.5-flash", apiKeyEnc: encrypt("shop-key") } });
    await db.membership.create({ data: { orgId, userId: agentId, role: "OWNER" } });
    accountId = (await db.whatsAppAccount.create({ data: { orgId, name: "QR", channel: "QR", status: "CONNECTED", connectedAt: new Date() } })).id;
    await db.knowledgeArticle.create({ data: { orgId, title: "Timings", content: "Open 9am to 7pm, Monday to Saturday. Closed on Sunday." } });
  });
  afterAll(async () => {
    await db.organization.deleteMany({ where: { id: orgId } });
    await db.user.deleteMany({ where: { id: agentId } });
    await db.$disconnect();
  });

  it("answers from the knowledge base and detects handoff", async () => {
    const conv = await db.conversation.create({ data: { orgId, accountId, contactId: (await db.contact.create({ data: { orgId, phone: "919800000001" } })).id } });
    await db.message.create({ data: { orgId, conversationId: conv.id, accountId, direction: "INBOUND", type: "TEXT", body: "What are your hours?", status: "RECEIVED" } });
    expect(await autoReply(orgId, conv.id)).toEqual({ handoff: false, text: "We're open 9am to 7pm, Monday to Saturday." });
    expect(systemText(calls.at(-1)!.body)).toContain("Knowledge base");
    expect(calls.at(-1)!.headers["x-goog-api-key"]).toBe("shop-key");
    await db.message.create({ data: { orgId, conversationId: conv.id, accountId, direction: "INBOUND", type: "TEXT", body: "I want a refund now", status: "RECEIVED" } });
    expect(await autoReply(orgId, conv.id)).toEqual({ handoff: true, text: "" });
  });

  it("flow AI step keeps chatting, then hands over", async () => {
    await db.flow.create({
      data: {
        orgId,
        name: "AI agent",
        isActive: true,
        trigger: "KEYWORD",
        keywords: ["help"],
        graph: parseGraph({
          nodes: [
            { id: "start", type: "start", position: { x: 0, y: 0 }, data: {} },
            { id: "ai", type: "ai", position: { x: 0, y: 0 }, data: { keepChatting: true, maxTurns: 3 } },
            { id: "done", type: "end", position: { x: 0, y: 0 }, data: { text: "Glad I could help!" } },
            { id: "human", type: "assign", position: { x: 0, y: 0 }, data: { mode: "round_robin" } },
          ],
          edges: [
            { id: "1", source: "start", target: "ai" },
            { id: "2", source: "ai", sourceHandle: "next", target: "done" },
            { id: "3", source: "ai", sourceHandle: "handoff", target: "human" },
          ],
        }) as never,
      },
    });
    const conv = await customerSays("919800000002", "help: what are your hours?");
    expect(await out(conv)).toEqual(["We're open 9am to 7pm, Monday to Saturday."]);
    await customerSays("919800000002", "and on Sunday?");
    expect((await out(conv)).at(-1)).toBe("Answer: and on Sunday?");
    await customerSays("919800000002", "I need a human");
    const c = await db.conversation.findUniqueOrThrow({ where: { id: conv } });
    expect([c.assigneeId, (await db.flowSession.findFirstOrThrow({ where: { conversationId: conv } })).status]).toEqual([agentId, "COMPLETED"]);
    expect((await out(conv)).length).toBe(2); // no AI answer on handoff
  });

  it("workspace auto-reply: answers unassigned chats, hands over and goes quiet", async () => {
    await db.aiConfig.update({ where: { orgId }, data: { autoReply: true, handoffMessage: "A teammate will reply shortly." } });
    const conv = await customerSays("919800000003", "what are your hours?");
    expect(await out(conv)).toEqual(["We're open 9am to 7pm, Monday to Saturday."]);
    await customerSays("919800000003", "refund please");
    const c = await db.conversation.findUniqueOrThrow({ where: { id: conv } });
    expect([c.assigneeId, !!c.botPausedUntil, (await out(conv)).at(-1)]).toEqual([agentId, true, "A teammate will reply shortly."]);
    await customerSays("919800000003", "hello?");
    expect((await out(conv)).length).toBe(2);

    // Assigned chats are left to the team in "unassigned only" mode
    const conv2 = await customerSays("919800000004", "hi");
    await db.conversation.update({ where: { id: conv2 }, data: { assigneeId: agentId } });
    const before = (await out(conv2)).length;
    await customerSays("919800000004", "anyone?");
    expect((await out(conv2)).length).toBe(before);
  });
});
