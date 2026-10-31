import crypto from "node:crypto";
import http from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { handleInboundForFlows, keywordMatches, pauseForAgent, resumeAfterDelay } from "@/lib/flows/engine";
import { parseGraph, FlowGraphError } from "@/lib/flows/graph";
import { STARTERS } from "@/lib/flows/starters";
import { deliverWebhookJob, flowSigningSecret, signPayload } from "@/lib/webhooks";
import { recordIncoming } from "@/lib/whatsapp/ingest";

process.env.ALLOW_PRIVATE_NETWORK_REQUESTS = "true";

const enqueued: { queue: string; data: Record<string, unknown>; options?: Record<string, unknown> }[] = [];
const received: { headers: http.IncomingHttpHeaders; body: string }[] = [];
let hookStatus = 200;
let hookReply: unknown = {};
let server: http.Server;
let hookUrl: string;
let orgId: string, userA: string, userB: string, accountId: string;
let seq = 0;

/** A customer message arriving, then the flow worker handling it (as the FIFO job would) */
async function customerSays(phone: string, text: string, replyId?: string) {
  const r = await recordIncoming({
    accountId,
    orgId,
    from: phone,
    profileName: "Kiran Mehta",
    externalId: `in-${++seq}-${Date.now()}`,
    timestamp: new Date(Date.now() + seq), // distinct times
    type: replyId ? "INTERACTIVE" : "TEXT",
    body: text,
    payload: replyId ? { replyId } : undefined,
  });
  await handleInboundForFlows({ messageId: r!.message.id });
  return r!.conversation.id;
}

async function botMessages(conversationId: string) {
  return db.message.findMany({ where: { conversationId, direction: "OUTBOUND" }, orderBy: { createdAt: "asc" } });
}

async function session(conversationId: string) {
  return db.flowSession.findFirstOrThrow({ where: { conversationId }, orderBy: { createdAt: "desc" } });
}

async function makeFlow(data: { graph: unknown; [key: string]: unknown }) {
  return db.flow.create({ data: { orgId, name: "Flow", isActive: true, trigger: "KEYWORD", keywords: [], ...data, graph: parseGraph(data.graph) as never } as never });
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({ headers: req.headers, body });
      res.statusCode = hookStatus;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(hookReply));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  hookUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/hook`;
  globalThis.__wacrmBoss = Promise.resolve({
    send: async (queue: string, data: Record<string, unknown>, options?: Record<string, unknown>) => {
      enqueued.push({ queue, data, options });
      return "job";
    },
  } as never);
  const stamp = Date.now();
  userA = (await db.user.create({ data: { email: `fa-${stamp}@test.local`, name: "Agent A", passwordHash: "x" } })).id;
  userB = (await db.user.create({ data: { email: `fb-${stamp}@test.local`, name: "Agent B", passwordHash: "x" } })).id;
  orgId = (await db.organization.create({ data: { name: "Flow Org", slug: `flow-${stamp}`, currency: "INR" } })).id;
  await db.membership.createMany({ data: [{ orgId, userId: userA, role: "OWNER" }, { orgId, userId: userB, role: "AGENT" }] });
  accountId = (await db.whatsAppAccount.create({ data: { orgId, name: "Cloud", channel: "OFFICIAL", status: "CONNECTED", phoneNumberId: `pn-flow-${stamp}`, wabaId: "w", accessTokenEnc: encrypt("t"), appSecretEnc: encrypt("s") } })).id;
});

beforeEach(async () => {
  enqueued.length = 0;
  received.length = 0;
  hookStatus = 200;
  hookReply = {};
  await db.flow.deleteMany({ where: { orgId } });
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { id: orgId } });
  await db.user.deleteMany({ where: { id: { in: [userA, userB] } } });
  await db.$disconnect();
  server.close();
});

describe("graph & matching", () => {
  it("matches keywords on whole words", () => {
    const f = { keywords: ["hi", "price list"], match: "CONTAINS" as const };
    expect(keywordMatches(f, "Hi there!")).toBe(true);
    expect(keywordMatches(f, "this is it")).toBe(false);
    expect(keywordMatches(f, "send the PRICE-LIST please")).toBe(true);
    expect(keywordMatches({ keywords: ["menu"], match: "EXACT" }, "menu please")).toBe(false);
    expect(keywordMatches({ keywords: ["order"], match: "STARTS_WITH" }, "Order 123")).toBe(true);
  });

  it("explains which step is wrong", () => {
    const g = STARTERS.welcome_menu!.graph();
    (g.nodes.find((n) => n.id === "ask_order")!.data as Record<string, unknown>).saveAs = "Order ID";
    expect(() => parseGraph(g)).toThrow(FlowGraphError);
    try {
      parseGraph(g);
    } catch (err) {
      expect((err as FlowGraphError).nodeId).toBe("ask_order");
    }
    expect(() => parseGraph({ nodes: [{ id: "s", type: "start", position: { x: 0, y: 0 }, data: {} }], edges: [] })).toThrow(/Connect the Start/);
    // Dangling / duplicate connections are dropped
    const ok = parseGraph({ ...STARTERS.blank!.graph(), edges: [...STARTERS.blank!.graph().edges, { id: "x", source: "start", sourceHandle: "next", target: "gone" }] });
    expect(ok.edges).toHaveLength(1);
  });
});

describe("welcome menu flow", () => {
  it("menu → question → tag → reply, then completes", async () => {
    await makeFlow({ name: "Welcome", trigger: "FIRST_MESSAGE", graph: STARTERS.welcome_menu!.graph() });
    const conv = await customerSays("919100000001", "hello");
    let out = await botMessages(conv);
    expect(out).toHaveLength(1);
    expect(out[0]!.type).toBe("INTERACTIVE");
    const interactive = (out[0]!.payload as { interactive: { type: string; action: { buttons: { reply: { id: string } }[] } } }).interactive;
    expect([interactive.type, interactive.action.buttons.map((b) => b.reply.id)]).toEqual(["button", ["prices", "order", "human"]]);
    expect(out[0]!.body).toContain("1. Prices & plans"); // numbered fallback for QR / inbox

    await customerSays("919100000001", "Track my order", "order"); // button tap
    out = await botMessages(conv);
    expect(out.at(-1)!.body).toBe("Please send your order number.");
    await customerSays("919100000001", "A-123");
    out = await botMessages(conv);
    expect(out.at(-1)!.body).toBe("Thanks! We're checking order A-123 and will reply shortly.");
    const s = await session(conv);
    expect([s.status, s.variables]).toEqual(["COMPLETED", { topic: "Track my order", order_id: "A-123" }]);
    const contact = await db.contact.findFirstOrThrow({ where: { orgId, phone: "919100000001" }, include: { tags: { include: { tag: true } } } });
    expect(contact.tags.map((t) => t.tag.name)).toEqual(["Order enquiry"]);
    expect((await db.flow.findFirstOrThrow({ where: { orgId } })).completions).toBe(1);
    // Not a first message any more: the welcome flow doesn't run again
    await customerSays("919100000001", "hello again");
    expect(await botMessages(conv)).toHaveLength(out.length);
  });

  it("answers by number, assigns round-robin and hands over", async () => {
    await makeFlow({ name: "Welcome", trigger: "FIRST_MESSAGE", graph: STARTERS.welcome_menu!.graph() });
    // Agent A already has an open chat, so B gets the next one
    const busy = await db.contact.create({ data: { orgId, phone: "919100009999" } });
    await db.conversation.create({ data: { orgId, accountId, contactId: busy.id, status: "OPEN", assigneeId: userA } });
    const conv = await customerSays("919100000002", "hi");
    await customerSays("919100000002", "3");
    const c = await db.conversation.findUniqueOrThrow({ where: { id: conv } });
    expect([c.assigneeId, c.status]).toEqual([userB, "OPEN"]);
    expect((await botMessages(conv)).at(-1)!.body).toContain("Connecting you to our team");
    expect((await session(conv)).status).toBe("COMPLETED");
  });
});

describe("questions", () => {
  it("validates answers, saves to the contact and gives up after 3 tries", async () => {
    await makeFlow({ name: "Lead", keywords: ["demo"], graph: STARTERS.lead_capture!.graph() });
    const conv = await customerSays("919100000003", "I want a DEMO");
    await customerSays("919100000003", "Kiran Mehta");
    await customerSays("919100000003", "not-an-email");
    expect((await botMessages(conv)).at(-1)!.body).toBe("Please reply with a valid email address.");
    await customerSays("919100000003", "kiran@Example.com");
    const contact = await db.contact.findFirstOrThrow({ where: { orgId, phone: "919100000003" } });
    expect([contact.name, contact.email, !!contact.optedInAt, contact.optInSource]).toEqual(["Kiran Mehta", "kiran@example.com", true, "flow"]);
    expect((await botMessages(conv)).at(-1)!.body).toBe("Got it, Kiran Mehta! Our team will contact you within one working day.");

    const conv2 = await customerSays("919100000004", "demo");
    await customerSays("919100000004", "Asha");
    for (const bad of ["x", "y", "z"]) await customerSays("919100000004", bad);
    const s = await session(conv2);
    expect([s.status, s.endReason]).toEqual(["FAILED", "Too many invalid answers."]);
    expect((await botMessages(conv2)).at(-1)!.body).toContain("A teammate will help you shortly");
  });

  it("leaves the flow on 'exit'", async () => {
    await makeFlow({ name: "Lead", keywords: ["demo"], graph: STARTERS.lead_capture!.graph() });
    const conv = await customerSays("919100000005", "demo");
    await customerSays("919100000005", "Exit");
    expect((await session(conv)).status).toBe("STOPPED");
  });
});

describe("conditions, actions and delays", () => {
  const graph = () => ({
    nodes: [
      { id: "start", type: "start", position: { x: 0, y: 0 }, data: {} },
      { id: "ask", type: "ask", position: { x: 0, y: 0 }, data: { text: "Budget in ₹?", saveAs: "budget", validation: "number" } },
      { id: "cond", type: "condition", position: { x: 0, y: 0 }, data: { match: "all", rules: [{ variable: "budget", op: "gt", value: "50000" }] } },
      { id: "deal", type: "deal", position: { x: 0, y: 0 }, data: { pipelineId: "P", stageId: "S", title: "{{first_name}} – big order", value: "{{budget}}" } },
      { id: "wait", type: "delay", position: { x: 0, y: 0 }, data: { amount: 2, unit: "hours" } },
      { id: "follow", type: "message", position: { x: 0, y: 0 }, data: { text: "Following up on your ₹{{budget}} enquiry!" } },
      { id: "small", type: "message", position: { x: 0, y: 0 }, data: { text: "We'll send our starter plans." } },
    ],
    edges: [
      { id: "1", source: "start", target: "ask" },
      { id: "2", source: "ask", sourceHandle: "next", target: "cond" },
      { id: "3", source: "cond", sourceHandle: "true", target: "deal" },
      { id: "4", source: "cond", sourceHandle: "false", target: "small" },
      { id: "5", source: "deal", target: "wait" },
      { id: "6", source: "wait", target: "follow" },
    ],
  });

  it("branches, creates a deal, waits and resumes", async () => {
    const pipeline = await db.pipeline.create({ data: { orgId, name: `P${Date.now()}`, stages: { create: [{ orgId, name: "New", position: 0 }] } }, include: { stages: true } });
    const g = graph();
    Object.assign(g.nodes.find((n) => n.id === "deal")!.data, { pipelineId: pipeline.id, stageId: pipeline.stages[0]!.id });
    await makeFlow({ name: "Budget", keywords: ["budget"], graph: g });

    const conv = await customerSays("919100000006", "budget");
    await customerSays("919100000006", "1,20,000");
    const deal = await db.deal.findFirstOrThrow({ where: { orgId, pipelineId: pipeline.id } });
    expect([deal.title, deal.value.toNumber(), deal.currency]).toEqual(["Kiran – big order", 120000, "INR"]);
    let s = await session(conv);
    expect([s.status, s.nodeId, !!s.resumeAt]).toEqual(["ACTIVE", "wait", true]);
    const resume = enqueued.find((j) => j.queue === "flow.resume")!;
    expect(resume.data).toEqual({ sessionId: s.id, nodeId: "wait" });

    // A message during the delay doesn't disturb it; an early resume is ignored
    await customerSays("919100000006", "hello?");
    await resumeAfterDelay(resume.data as { sessionId: string; nodeId: string });
    expect((await session(conv)).nodeId).toBe("wait");

    await db.flowSession.update({ where: { id: s.id }, data: { resumeAt: new Date(Date.now() - 1000) } });
    await resumeAfterDelay(resume.data as { sessionId: string; nodeId: string });
    expect((await botMessages(conv)).at(-1)!.body).toBe("Following up on your ₹120000 enquiry!");
    s = await session(conv);
    expect(s.status).toBe("COMPLETED");

    const conv2 = await customerSays("919100000007", "budget");
    await customerSays("919100000007", "5000");
    expect((await botMessages(conv2)).at(-1)!.body).toBe("We'll send our starter plans.");
  });

  it("stops a flow that loops without waiting", async () => {
    await makeFlow({
      name: "Loop",
      keywords: ["loop"],
      graph: {
        nodes: [
          { id: "start", type: "start", position: { x: 0, y: 0 }, data: {} },
          { id: "a", type: "message", position: { x: 0, y: 0 }, data: { text: "A" } },
          { id: "b", type: "message", position: { x: 0, y: 0 }, data: { text: "B" } },
        ],
        edges: [
          { id: "1", source: "start", target: "a" },
          { id: "2", source: "a", target: "b" },
          { id: "3", source: "b", target: "a" },
        ],
      },
    });
    const conv = await customerSays("919100000008", "loop");
    const s = await session(conv);
    expect(s.status).toBe("FAILED");
    expect(s.endReason).toMatch(/without waiting|loop guard/);
    expect((await botMessages(conv)).length).toBeLessThanOrEqual(30);
  });
});

describe("takeover & guards", () => {
  it("a teammate's reply stops the bot and keeps it quiet", async () => {
    await makeFlow({ name: "Lead", keywords: ["demo"], graph: STARTERS.lead_capture!.graph() });
    const conv = await customerSays("919100000009", "demo");
    await pauseForAgent(conv);
    expect((await session(conv)).status).toBe("STOPPED");
    const before = (await botMessages(conv)).length;
    await customerSays("919100000009", "demo");
    expect((await botMessages(conv)).length).toBe(before);
  });

  it("never messages contacts who opted out", async () => {
    await makeFlow({ name: "Any", trigger: "ANY_MESSAGE", graph: STARTERS.blank!.graph() });
    await customerSays("919100000010", "STOP"); // opts out, and must not get a reply
    const conv = await db.conversation.findFirstOrThrow({ where: { orgId, contact: { phone: "919100000010" } } });
    expect(await botMessages(conv.id)).toHaveLength(0);
  });
});

describe("webhook step", () => {
  const graph = () => ({
    nodes: [
      { id: "start", type: "start", position: { x: 0, y: 0 }, data: {} },
      { id: "hook", type: "webhook", position: { x: 0, y: 0 }, data: { url: hookUrl } },
      { id: "ok", type: "message", position: { x: 0, y: 0 }, data: { text: "Your plan: {{plan}}" } },
      { id: "err", type: "message", position: { x: 0, y: 0 }, data: { text: "Lookup failed" } },
    ],
    edges: [
      { id: "1", source: "start", target: "hook" },
      { id: "2", source: "hook", sourceHandle: "success", target: "ok" },
      { id: "3", source: "hook", sourceHandle: "error", target: "err" },
    ],
  });

  it("posts signed data and uses the response", async () => {
    await makeFlow({ name: "Lookup", keywords: ["plan"], graph: graph() });
    hookReply = { variables: { plan: "Gold" }, reply: "Checking…" };
    const conv = await customerSays("919100000011", "my plan?");
    const req = received[0]!;
    const sig = signPayload(flowSigningSecret(orgId), String(req.headers["x-wacrm-timestamp"]), req.body);
    expect(req.headers["x-wacrm-signature"]).toBe(sig);
    expect(JSON.parse(req.body).data.contact.phone).toBe("919100000011");
    expect((await botMessages(conv)).map((m) => m.body)).toEqual(["Checking…", "Your plan: Gold"]);

    hookStatus = 500;
    const conv2 = await customerSays("919100000012", "plan");
    expect((await botMessages(conv2)).map((m) => m.body)).toEqual(["Lookup failed"]);
  });
});

describe("outbound webhooks", () => {
  it("queues subscribed events and delivers them signed", async () => {
    const secret = "whsec_test_secret";
    const ep = await db.webhookEndpoint.create({ data: { orgId, url: hookUrl, secretEnc: encrypt(secret), events: ["message.received", "contact.created"] } });
    await customerSays("919100000013", "Hello from a new number");
    const jobs = enqueued.filter((j) => j.queue === "webhook.deliver");
    expect(jobs.map((j) => j.data.event).sort()).toEqual(["contact.created", "message.received"]);
    const job = jobs.find((j) => j.data.event === "message.received")!;
    await deliverWebhookJob(job.data as never, 0);
    const req = received.at(-1)!;
    expect(req.headers["x-wacrm-signature"]).toBe("sha256=" + crypto.createHmac("sha256", secret).update(`${req.headers["x-wacrm-timestamp"]}.${req.body}`).digest("hex"));
    expect(JSON.parse(req.body)).toMatchObject({ event: "message.received", data: { message: { text: "Hello from a new number" }, contact: { phone: "919100000013" } } });
    expect(await db.webhookDelivery.count({ where: { endpointId: ep.id, ok: true } })).toBe(1);

    hookStatus = 503;
    await expect(deliverWebhookJob(job.data as never, 1)).rejects.toThrow(/HTTP 503/);
    expect((await db.webhookEndpoint.findUniqueOrThrow({ where: { id: ep.id } })).failureCount).toBe(1);
  });
});
