import { db } from "@/lib/db";
import { autoReply } from "@/lib/ai/features";
import { canRun, getEntitlements } from "@/lib/billing/entitlements";
import { AiError } from "@/lib/ai/providers";
import { contactVariables, renderCampaignText } from "@/lib/campaigns/render";
import { campaignMediaSchema } from "@/lib/campaigns/schema";
import { logActivity } from "@/lib/crm/activity";
import { ensureTags, fieldDefs } from "@/lib/crm/contacts";
import { mergeFieldValues, FieldValueError } from "@/lib/crm/fields";
import { publish } from "@/lib/realtime";
import { orgDb } from "@/lib/tenancy";
import { emitEvent, flowSigningSecret, postSigned } from "@/lib/webhooks";
import { queueOutbound } from "@/lib/whatsapp/outbound";
import { normalizePhone, isValidPhone } from "@/lib/whatsapp/phone";
import { CAMPAIGN_MEDIA_TYPES } from "@/lib/campaigns/schema";
import type { Flow, FlowSession, Message, Prisma } from "@/generated/prisma/client";
import { enqueue, QUEUES } from "@/server/queue";
import { nextNodeId, parseGraph, startNode, type FlowGraph, type FlowNode, type NodeData } from "./graph";

/**
 * Runs chatbot flows. Called from the worker, one message per conversation at a time
 * (flow.inbound is a FIFO queue keyed by conversation), so a chat's state never races.
 *
 * Guards ported from an earlier WhatsApp SaaS bot engine: a session waits at most
 * `flow.timeoutMinutes` for an answer, 3 invalid answers end it (or follow "noMatch"),
 * 25 steps per run without waiting stops runaway loops, and 30 bot messages per chat per hour
 * stop two bots from talking to each other forever. "exit" / "stop bot" leaves a flow.
 */
const MAX_STEPS_PER_RUN = 25;
const MAX_BOT_MESSAGES_PER_HOUR = 30;
const MAX_INVALID_ANSWERS = 3;
const EXIT_WORDS = new Set(["exit", "quit", "stop bot", "cancel bot"]);
const FIRST_MESSAGE_WINDOW = 1; // the chat's first customer message

type Conv = Prisma.ConversationGetPayload<{ include: { contact: true; account: true } }>;

interface Run {
  flow: Flow;
  graph: FlowGraph;
  session: FlowSession;
  conv: Conv;
  vars: Record<string, string>;
  lastMessage: string;
}

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();
}

/** Keyword match on whole words: "hi" doesn't fire on "this" */
export function keywordMatches(flow: Pick<Flow, "keywords" | "match">, text: string): boolean {
  const said = normalizeText(text);
  if (!said) return false;
  return flow.keywords.some((raw) => {
    const kw = normalizeText(raw);
    if (!kw) return false;
    if (flow.match === "EXACT") return said === kw;
    if (flow.match === "STARTS_WITH") return said === kw || said.startsWith(`${kw} `);
    return ` ${said} `.includes(` ${kw} `);
  });
}

function messageText(m: Pick<Message, "body" | "type">): string {
  return m.body ?? "";
}

// ───────────── Sending ─────────────

async function botMessagesLastHour(conversationId: string) {
  const rows = await db.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM "Message"
    WHERE "conversationId" = ${conversationId} AND direction = 'OUTBOUND' AND "createdAt" > now() - interval '1 hour'
      AND (payload ? 'flowSessionId' OR payload ? 'aiAutoReply')`;
  return Number(rows[0]?.n ?? 0);
}

class StopRun extends Error {}

async function send(run: Run, content: { type: Message["type"]; body: string | null; media?: unknown; payload?: Record<string, unknown> }) {
  if ((await botMessagesLastHour(run.conv.id)) >= MAX_BOT_MESSAGES_PER_HOUR) {
    await finish(run, "FAILED", `Stopped: more than ${MAX_BOT_MESSAGES_PER_HOUR} bot messages in an hour (loop guard).`);
    throw new StopRun();
  }
  await queueOutbound({
    orgId: run.conv.orgId,
    conversationId: run.conv.id,
    accountId: run.conv.accountId,
    type: content.type,
    body: content.body,
    media: (content.media as Record<string, unknown>) ?? null,
    payload: { ...(content.payload ?? {}), flowId: run.flow.id, flowSessionId: run.session.id },
    profile: "conversation",
  });
}

function render(run: Run, text: string): string {
  return renderCampaignText(text, templateVars(run));
}

function templateVars(run: Run): Record<string, string> {
  return { ...contactVariables(run.conv.contact), ...run.vars, last_message: run.lastMessage };
}

/** Menu as WhatsApp interactive message (Cloud API) with a numbered-text fallback (QR, inbox preview) */
function menuMessage(run: Run, data: NodeData<"menu">, prefix?: string) {
  const text = render(run, data.text);
  const fallback = `${prefix ? `${prefix}\n\n` : ""}${text}\n\n${data.options.map((o, i) => `${i + 1}. ${o.title}`).join("\n")}`;
  const buttons = data.options.length <= 3 && data.options.every((o) => o.title.length <= 20 && !o.description);
  const interactive = buttons
    ? { type: "button", body: { text: prefix ? `${prefix}\n\n${text}` : text }, action: { buttons: data.options.map((o) => ({ type: "reply", reply: { id: o.id, title: o.title } })) } }
    : {
        type: "list",
        body: { text: prefix ? `${prefix}\n\n${text}` : text },
        action: { button: data.listButton || "Choose", sections: [{ title: "Options", rows: data.options.map((o) => ({ id: o.id, title: o.title, ...(o.description ? { description: o.description } : {}) })) }] },
      };
  return { type: "INTERACTIVE" as const, body: fallback, payload: { interactive, fallbackText: fallback } };
}

// ───────────── Session lifecycle ─────────────

async function saveSession(run: Run, data: Prisma.FlowSessionUpdateInput) {
  run.session = await db.flowSession.update({ where: { id: run.session.id }, data: { variables: run.vars, ...data } });
}

async function finish(run: Run, status: "COMPLETED" | "EXPIRED" | "STOPPED" | "FAILED", reason: string) {
  if (run.session.status !== "ACTIVE") return;
  await saveSession(run, { status, endReason: reason, endedAt: new Date(), nodeId: null, resumeAt: null, expiresAt: null });
  if (status === "COMPLETED") {
    await db.flow.update({ where: { id: run.flow.id }, data: { completions: { increment: 1 } } });
    await emitEvent(run.conv.orgId, "flow.completed", {
      flow: { id: run.flow.id, name: run.flow.name },
      conversation_id: run.conv.id,
      contact: { id: run.conv.contact.id, phone: run.conv.contact.phone, name: run.conv.contact.name ?? run.conv.contact.waName },
      variables: run.vars,
    });
  }
  await publish(`org:${run.conv.orgId}`, "conversation.updated", { conversationId: run.conv.id });
}

async function loadRun(session: FlowSession, lastMessage = ""): Promise<Run | null> {
  const [flow, conv] = await Promise.all([
    db.flow.findUnique({ where: { id: session.flowId } }),
    db.conversation.findUnique({ where: { id: session.conversationId }, include: { contact: true, account: true } }),
  ]);
  if (!flow || !conv) return null;
  let graph: FlowGraph;
  try {
    graph = parseGraph(flow.graph);
  } catch {
    return null;
  }
  return { flow, graph, session, conv, vars: (session.variables ?? {}) as Record<string, string>, lastMessage };
}

/** Starts `flow` in a conversation (any running flow there is stopped first) */
export async function startFlow(flow: Flow, conversationId: string, opts: { variables?: Record<string, string>; lastMessage?: string } = {}) {
  await db.flowSession.updateMany({
    where: { conversationId, status: "ACTIVE" },
    data: { status: "STOPPED", endReason: "Another flow started.", endedAt: new Date(), nodeId: null, resumeAt: null },
  });
  const session = await db.flowSession.create({ data: { orgId: flow.orgId, flowId: flow.id, conversationId, variables: opts.variables ?? {} } });
  await db.flow.update({ where: { id: flow.id }, data: { runs: { increment: 1 } } });
  const run = await loadRun(session, opts.lastMessage);
  if (!run) return session;
  await runFrom(run, nextNodeId(run.graph, startNode(run.graph).id));
  return run.session;
}

// ───────────── Steps ─────────────

async function runFrom(run: Run, nodeId: string | null) {
  try {
    let current = nodeId;
    for (let steps = 0; steps < MAX_STEPS_PER_RUN; steps++) {
      if (!current) return finish(run, "COMPLETED", "Reached the end of the flow.");
      const node = run.graph.nodes.find((n) => n.id === current);
      if (!node) return finish(run, "FAILED", "A step of the flow was deleted.");
      const next = await step(run, node);
      if (next === WAIT) return;
      current = next;
    }
    await finish(run, "FAILED", `Stopped after ${MAX_STEPS_PER_RUN} steps without waiting for the customer (check the flow for loops).`);
  } catch (err) {
    if (err instanceof StopRun) return;
    console.error(`[flows] ${run.flow.id} session ${run.session.id} failed`, err);
    await finish(run, "FAILED", (err as Error).message.slice(0, 300));
  }
}

const WAIT = Symbol("wait");

async function waitForAnswer(run: Run, node: FlowNode, retries = 0) {
  await saveSession(run, { nodeId: node.id, retries, expiresAt: new Date(Date.now() + run.flow.timeoutMinutes * 60_000) });
}

/** Executes one node; returns the next node id, null to end, or WAIT */
async function step(run: Run, node: FlowNode): Promise<string | null | typeof WAIT> {
  const go = (handle = "next") => nextNodeId(run.graph, node.id, handle);
  const orgId = run.conv.orgId;
  const tdb = orgDb(orgId);
  switch (node.type) {
    case "start":
      return go();
    case "message": {
      const d = node.data as NodeData<"message">;
      const media = d.media ? campaignMediaSchema.parse(d.media) : null;
      await send(run, { type: media ? (CAMPAIGN_MEDIA_TYPES[media.mimeType] ?? "DOCUMENT") : "TEXT", body: d.text ? render(run, d.text) : null, media });
      return go();
    }
    case "menu":
      await send(run, menuMessage(run, node.data as NodeData<"menu">));
      await waitForAnswer(run, node);
      return WAIT;
    case "ask":
      await send(run, { type: "TEXT", body: render(run, (node.data as NodeData<"ask">).text) });
      await waitForAnswer(run, node);
      return WAIT;
    case "condition":
      return go(evaluate(run, node.data as NodeData<"condition">) ? "true" : "false");
    case "delay": {
      const d = node.data as NodeData<"delay">;
      const ms = d.amount * { minutes: 60_000, hours: 3_600_000, days: 86_400_000 }[d.unit];
      const resumeAt = new Date(Date.now() + ms);
      await saveSession(run, { nodeId: node.id, resumeAt, expiresAt: new Date(resumeAt.getTime() + run.flow.timeoutMinutes * 60_000) });
      await enqueue(QUEUES.flowResume, { sessionId: run.session.id, nodeId: node.id }, { startAfter: resumeAt });
      return WAIT;
    }
    case "assign": {
      const d = node.data as NodeData<"assign">;
      let assigneeId: string | null = null;
      if (d.mode === "user" && d.userId && (await tdb.membership.findFirst({ where: { userId: d.userId }, select: { id: true } }))) assigneeId = d.userId;
      if (d.mode === "round_robin") assigneeId = await roundRobinAgent(orgId);
      await db.conversation.update({ where: { id: run.conv.id }, data: { assigneeId, status: "OPEN" } });
      return go();
    }
    case "tags": {
      const d = node.data as NodeData<"tags">;
      const add = await ensureTags(tdb, orgId, d.add.map((t) => render(run, t)).filter(Boolean));
      if (add.length) await db.contactTag.createMany({ data: add.map((t) => ({ contactId: run.conv.contactId, tagId: t.id })), skipDuplicates: true });
      if (d.remove.length) {
        const remove = await tdb.tag.findMany({ where: { name: { in: d.remove } }, select: { id: true } });
        await db.contactTag.deleteMany({ where: { contactId: run.conv.contactId, tagId: { in: remove.map((t) => t.id) } } });
      }
      await logActivity(add.map((t) => ({ orgId, contactId: run.conv.contactId, type: "tag.added" as const, data: { tag: t.name, via: run.flow.name } })));
      return go();
    }
    case "setField": {
      const d = node.data as NodeData<"setField">;
      await setContactField(run, d.field, render(run, d.value));
      return go();
    }
    case "deal": {
      const d = node.data as NodeData<"deal">;
      const stage = await tdb.stage.findUnique({ where: { id: d.stageId } });
      if (stage && stage.pipelineId === d.pipelineId) {
        const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { currency: true } });
        const value = Number(render(run, d.value).replace(/[^\d.]/g, "")) || 0;
        const first = await tdb.deal.findFirst({ where: { stageId: stage.id }, orderBy: { position: "asc" }, select: { position: true } });
        const deal = await tdb.deal.create({
          data: {
            orgId,
            pipelineId: stage.pipelineId,
            stageId: stage.id,
            contactId: run.conv.contactId,
            ownerId: run.conv.assigneeId,
            title: render(run, d.title).slice(0, 120) || run.flow.name,
            value,
            currency: org.currency,
            status: stage.kind === "WON" ? "WON" : stage.kind === "LOST" ? "LOST" : "OPEN",
            position: (first?.position ?? 2048) - 1024,
          },
        });
        await logActivity({ orgId, dealId: deal.id, contactId: run.conv.contactId, type: "deal.created", data: { title: deal.title, stage: stage.name, via: run.flow.name } });
        await publish(`org:${orgId}`, "deals.changed", { pipelineId: stage.pipelineId });
      }
      return go();
    }
    case "webhook": {
      const d = node.data as NodeData<"webhook">;
      const res = await postSigned(d.url, flowSigningSecret(orgId), "flow.step", {
        flow: { id: run.flow.id, name: run.flow.name },
        step_id: node.id,
        conversation_id: run.conv.id,
        contact: { id: run.conv.contact.id, phone: run.conv.contact.phone, name: run.conv.contact.name ?? run.conv.contact.waName, email: run.conv.contact.email },
        variables: run.vars,
        last_message: run.lastMessage,
      });
      if (!res.ok) return go("error");
      // The response may set variables ({"variables": {...}}) and/or a reply ({"reply": "text"})
      try {
        const body = JSON.parse(res.body || "{}") as { variables?: Record<string, unknown>; reply?: unknown };
        if (body.variables && typeof body.variables === "object") {
          for (const [k, v] of Object.entries(body.variables).slice(0, 50)) if (/^[a-z][a-z0-9_]{0,39}$/.test(k) && v !== null && typeof v !== "object") run.vars[k] = String(v).slice(0, 1000);
        }
        if (d.saveAs) run.vars[d.saveAs] = res.body.slice(0, 1000);
        if (typeof body.reply === "string" && body.reply.trim()) await send(run, { type: "TEXT", body: body.reply.slice(0, 4096) });
      } catch {
        if (d.saveAs) run.vars[d.saveAs] = res.body.slice(0, 1000);
      }
      await saveSession(run, {});
      return go("success");
    }
    case "ai":
      return aiTurn(run, node, 0);
    case "end": {
      const d = node.data as NodeData<"end">;
      if (d.text) await send(run, { type: "TEXT", body: render(run, d.text) });
      if (d.close) await db.conversation.update({ where: { id: run.conv.id }, data: { status: "CLOSED" } });
      await finish(run, "COMPLETED", "Reached an End step.");
      return WAIT;
    }
  }
}

/** One AI answer; with keepChatting the session waits on this step for the next message */
async function aiTurn(run: Run, node: FlowNode, turnsSoFar: number): Promise<string | null | typeof WAIT> {
  const d = node.data as NodeData<"ai">;
  const go = (handle: string) => nextNodeId(run.graph, node.id, handle);
  let answer;
  try {
    answer = await autoReply(run.conv.orgId, run.conv.id, { instructions: d.instructions, feature: "flow" });
  } catch (err) {
    // No credits, AI not set up, provider down: let a person take over instead of going silent
    if (err instanceof AiError) {
      run.vars.ai_error = err.message.slice(0, 200);
      return go("handoff");
    }
    throw err;
  }
  if (answer.handoff) return go("handoff");
  await send(run, { type: "TEXT", body: answer.text, payload: { ai: true } });
  const turns = turnsSoFar + 1;
  if (d.keepChatting && turns < d.maxTurns) {
    // `retries` counts the AI's answers while it waits on this step
    await waitForAnswer(run, node, turns);
    return WAIT;
  }
  return go("next");
}

async function roundRobinAgent(orgId: string): Promise<string | null> {
  // The member with the fewest open chats right now
  const members = await db.membership.findMany({ where: { orgId }, select: { userId: true }, orderBy: { createdAt: "asc" } });
  if (!members.length) return null;
  const counts = await db.conversation.groupBy({ by: ["assigneeId"], where: { orgId, status: "OPEN", assigneeId: { in: members.map((m) => m.userId) } }, _count: { _all: true } });
  const load = new Map(counts.map((c) => [c.assigneeId, c._count._all]));
  return members.reduce((best, m) => ((load.get(m.userId) ?? 0) < (load.get(best.userId) ?? 0) ? m : best)).userId;
}

async function setContactField(run: Run, field: string, value: string) {
  const contact = run.conv.contact;
  const orgId = run.conv.orgId;
  const data: Prisma.ContactUpdateInput = {};
  if (field === "name") data.name = value.slice(0, 100) || null;
  else if (field === "email") {
    if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return;
    data.email = value.toLowerCase() || null;
  } else if (field === "opt_in") {
    if (contact.optedOut || contact.optedInAt) return;
    data.optedInAt = new Date();
    data.optInSource = "flow";
  } else if (field === "opt_out") {
    data.optedOut = true;
    data.optedOutAt = new Date();
  } else if (field.startsWith("field:")) {
    try {
      data.fields = mergeFieldValues(await fieldDefs(orgDb(orgId)), contact.fields, { [field.slice(6)]: value });
    } catch (err) {
      if (err instanceof FieldValueError) return; // a value that doesn't fit the field type is skipped
      throw err;
    }
  }
  run.conv.contact = await db.contact.update({ where: { id: contact.id }, data });
  await publish(`org:${orgId}`, "contact.updated", { contactId: contact.id });
}

function evaluate(run: Run, d: NodeData<"condition">): boolean {
  const vars = templateVars(run);
  const test = (r: NodeData<"condition">["rules"][number]) => {
    const left = (vars[r.variable.replace(/^field:/, "")] ?? "").trim();
    const right = render(run, r.value).trim();
    const num = (s: string) => Number(s.replace(/[,\s]/g, ""));
    switch (r.op) {
      case "eq":
        return left.toLowerCase() === right.toLowerCase();
      case "neq":
        return left.toLowerCase() !== right.toLowerCase();
      case "contains":
        return left.toLowerCase().includes(right.toLowerCase());
      case "starts_with":
        return left.toLowerCase().startsWith(right.toLowerCase());
      case "empty":
        return !left;
      case "not_empty":
        return !!left;
      case "gt":
        return left !== "" && num(left) > num(right);
      case "lt":
        return left !== "" && num(left) < num(right);
    }
  };
  return d.match === "any" ? d.rules.some(test) : d.rules.every(test);
}

// ───────────── Answers ─────────────

const DEFAULT_ERRORS: Record<string, string> = {
  text: "Please type your answer.",
  number: "Please reply with a number.",
  email: "Please reply with a valid email address.",
  phone: "Please reply with a phone number including the country code.",
  date: "Please reply with a date, e.g. 25/12/2026.",
  yesno: "Please reply yes or no.",
  any: "Please send your answer.",
  menu: "Please choose one of the options.",
};

function validateAnswer(validation: NodeData<"ask">["validation"], msg: Message): string | null {
  const answer = messageText(msg).trim();
  switch (validation) {
    case "any":
      return answer || (msg.type !== "TEXT" ? `[${msg.type.toLowerCase()}]` : null);
    case "text":
      return answer ? answer.slice(0, 1000) : null;
    case "number": {
      const n = answer.replace(/[,\s]/g, "");
      return /^-?\d+(\.\d+)?$/.test(n) ? n : null;
    }
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(answer) ? answer.toLowerCase() : null;
    case "phone": {
      const p = normalizePhone(answer);
      return isValidPhone(p) ? p : null;
    }
    case "date": {
      const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(answer);
      const d = m ? new Date(Date.UTC(+m[3]!, +m[2]! - 1, +m[1]!)) : new Date(answer);
      return Number.isNaN(d.getTime()) || !answer ? null : d.toISOString().slice(0, 10);
    }
    case "yesno": {
      const w = normalizeText(answer);
      if (["yes", "y", "haan", "ha", "han", "ok", "okay", "sure", "1"].includes(w)) return "yes";
      if (["no", "n", "nahi", "nhi", "na", "2"].includes(w)) return "no";
      return null;
    }
  }
}

function pickOption(d: NodeData<"menu">, msg: Message) {
  const replyId = (msg.payload as { replyId?: string } | null)?.replyId;
  if (replyId) {
    const byId = d.options.find((o) => o.id === replyId);
    if (byId) return byId;
  }
  const text = messageText(msg).trim();
  if (/^\D*\d+\D*$/.test(text)) {
    const n = Number(text.replace(/\D/g, ""));
    if (n >= 1 && n <= d.options.length) return d.options[n - 1];
  }
  const said = normalizeText(text);
  return d.options.find((o) => normalizeText(o.title) === said);
}

async function handleAnswer(run: Run, msg: Message) {
  const node = run.graph.nodes.find((n) => n.id === run.session.nodeId);
  if (node?.type === "ai") {
    // Ongoing AI chat: answer this message too
    const turns = run.session.retries;
    await saveSession(run, { nodeId: null, expiresAt: null, retries: 0 });
    try {
      const next = await aiTurn(run, node, turns);
      if (next !== WAIT) return runFrom(run, next);
    } catch (err) {
      if (err instanceof StopRun) return;
      console.error(`[flows] AI step in ${run.session.id} failed`, err);
      return finish(run, "FAILED", (err as Error).message.slice(0, 300));
    }
    return;
  }
  if (!node || (node.type !== "menu" && node.type !== "ask")) return finish(run, "FAILED", "The flow changed while waiting for an answer.");

  let handle: string | null = null;
  if (node.type === "menu") {
    const d = node.data as NodeData<"menu">;
    const choice = pickOption(d, msg);
    if (choice) {
      if (d.saveAs) run.vars[d.saveAs] = choice.title;
      handle = choice.id;
    }
  } else {
    const d = node.data as NodeData<"ask">;
    const value = validateAnswer(d.validation, msg);
    if (value !== null) {
      run.vars[d.saveAs] = value;
      if (d.saveToField) await setContactField(run, d.saveToField, value);
      handle = "next";
    }
  }

  if (handle === null) {
    const retries = run.session.retries + 1;
    if (retries >= MAX_INVALID_ANSWERS) {
      const fallback = nextNodeId(run.graph, node.id, "noMatch");
      if (fallback) {
        await saveSession(run, { retries: 0, nodeId: null, expiresAt: null });
        return runFrom(run, fallback);
      }
      await send(run, { type: "TEXT", body: "Sorry, I didn't understand. A teammate will help you shortly." }).catch(() => null);
      return finish(run, "FAILED", "Too many invalid answers.");
    }
    try {
      if (node.type === "menu") {
        const d = node.data as NodeData<"menu">;
        await send(run, menuMessage(run, d, d.errorText ? render(run, d.errorText) : DEFAULT_ERRORS.menu));
      } else {
        const d = node.data as NodeData<"ask">;
        await send(run, { type: "TEXT", body: d.errorText ? render(run, d.errorText) : DEFAULT_ERRORS[d.validation]! });
      }
    } catch (err) {
      if (err instanceof StopRun) return;
      throw err;
    }
    return waitForAnswer(run, node, retries);
  }

  await saveSession(run, { retries: 0, nodeId: null, expiresAt: null });
  return runFrom(run, nextNodeId(run.graph, node.id, handle));
}

// ───────────── Entry points (worker jobs) ─────────────

async function activeSession(conversationId: string) {
  const session = await db.flowSession.findFirst({ where: { conversationId, status: "ACTIVE" }, orderBy: { createdAt: "desc" } });
  if (session?.expiresAt && session.expiresAt < new Date()) {
    await db.flowSession.update({ where: { id: session.id }, data: { status: "EXPIRED", endReason: "No answer in time.", endedAt: new Date(), nodeId: null } });
    return null;
  }
  return session;
}

/** Picks the flow a message starts: keywords (by priority), campaign replies, first message, any message */
export async function pickFlow(conv: Conv, msg: Message): Promise<Flow | null> {
  const flows = (await db.flow.findMany({ where: { orgId: conv.orgId, isActive: true }, orderBy: [{ priority: "desc" }, { createdAt: "asc" }] })).filter(
    (f) => !f.accountIds.length || f.accountIds.includes(conv.accountId),
  );
  if (!flows.length) return null;
  const text = messageText(msg);
  const keyword = flows.find((f) => f.trigger === "KEYWORD" && keywordMatches(f, text));
  if (keyword) return keyword;

  const replyFlows = flows.filter((f) => f.trigger === "CAMPAIGN_REPLY");
  if (replyFlows.length) {
    // trackReply stamps the campaign recipient with this message's time when it is a reply
    const replied = await db.campaignRecipient.findMany({ where: { contactId: conv.contactId, repliedAt: msg.createdAt, campaign: { accountId: conv.accountId } }, select: { campaignId: true } });
    const flow = replyFlows.find((f) => replied.some((r) => !f.campaignId || f.campaignId === r.campaignId));
    if (flow) return flow;
  }

  const first = flows.find((f) => f.trigger === "FIRST_MESSAGE");
  if (first && (await db.message.count({ where: { conversationId: conv.id, direction: "INBOUND" } })) <= FIRST_MESSAGE_WINDOW) return first;
  return flows.find((f) => f.trigger === "ANY_MESSAGE") ?? null;
}

/** Worker handler for QUEUES.flowInbound. Never throws (a failed job would block the chat's FIFO queue). */
export async function handleInboundForFlows(data: { messageId: string }) {
  try {
    const msg = await db.message.findUnique({ where: { id: data.messageId } });
    if (!msg || msg.direction !== "INBOUND" || msg.type === "REACTION") return;
    const conv = await db.conversation.findUnique({ where: { id: msg.conversationId }, include: { contact: true, account: true } });
    if (!conv) return;
    // Read-only workspace: messages still arrive in the inbox, automations wait
    const ent = await getEntitlements(conv.orgId);
    if (ent.locked) return;
    const session = ent.features.flows ? await activeSession(conv.id) : null;

    if (conv.contact.optedOut) {
      if (session) await db.flowSession.update({ where: { id: session.id }, data: { status: "STOPPED", endReason: "The contact opted out.", endedAt: new Date(), nodeId: null, resumeAt: null } });
      return;
    }
    if (session) {
      if (session.resumeAt) return; // waiting on a delay, not on the customer
      const run = await loadRun(session, messageText(msg));
      if (!run) return;
      if (EXIT_WORDS.has(normalizeText(messageText(msg)))) return finish(run, "STOPPED", "The customer left the flow.");
      return handleAnswer(run, msg);
    }
    if (conv.botPausedUntil && conv.botPausedUntil > new Date()) return;
    const flow = ent.features.flows ? await pickFlow(conv, msg) : null;
    if (flow) await startFlow(flow, conv.id, { lastMessage: messageText(msg) });
    else if (ent.features.ai) await aiAutoReply(conv);
  } catch (err) {
    console.error(`[flows] inbound ${data.messageId} failed`, err);
  }
}

/**
 * Workspace AI auto-reply (Settings › AI): answers messages no flow handles. When the AI can't
 * answer, the chat goes to a teammate and the AI stays quiet in it for 24 hours.
 */
async function aiAutoReply(conv: Conv) {
  const cfg = await db.aiConfig.findUnique({ where: { orgId: conv.orgId } });
  if (!cfg?.autoReply) return;
  if (cfg.autoReplyWhen === "unassigned" && conv.assigneeId) return;
  if ((await botMessagesLastHour(conv.id)) >= MAX_BOT_MESSAGES_PER_HOUR) return;
  let answer;
  try {
    answer = await autoReply(conv.orgId, conv.id);
  } catch (err) {
    if (err instanceof AiError) {
      console.warn(`[ai] auto-reply skipped in ${conv.id}: ${err.message}`);
      return;
    }
    throw err;
  }
  const base = { orgId: conv.orgId, conversationId: conv.id, accountId: conv.accountId, profile: "conversation" as const };
  if (!answer.handoff) {
    await queueOutbound({ ...base, type: "TEXT", body: answer.text, payload: { aiAutoReply: true, ai: true } });
    return;
  }
  await db.conversation.update({
    where: { id: conv.id },
    data: { status: "OPEN", botPausedUntil: new Date(Date.now() + AGENT_TAKEOVER_MS), ...(conv.assigneeId ? {} : { assigneeId: await roundRobinAgent(conv.orgId) }) },
  });
  if (cfg.handoffMessage?.trim()) await queueOutbound({ ...base, type: "TEXT", body: cfg.handoffMessage.trim(), payload: { aiAutoReply: true, ai: true } });
  await publish(`org:${conv.orgId}`, "conversation.updated", { conversationId: conv.id });
}

/** Worker handler for QUEUES.flowResume: continue after a delay step */
export async function resumeAfterDelay(data: { sessionId: string; nodeId: string }) {
  const s = await db.flowSession.findUnique({ where: { id: data.sessionId }, select: { orgId: true, status: true } });
  if (s?.status === "ACTIVE" && !(await canRun(s.orgId, "flows"))) {
    await db.flowSession.updateMany({
      where: { id: data.sessionId, status: "ACTIVE" },
      data: { status: "STOPPED", endReason: "The workspace's plan isn't active.", endedAt: new Date(), nodeId: null, resumeAt: null, expiresAt: null },
    });
    return;
  }
  const { count } = await db.flowSession.updateMany({
    where: { id: data.sessionId, status: "ACTIVE", nodeId: data.nodeId, resumeAt: { lte: new Date(Date.now() + 5_000) } },
    data: { resumeAt: null, nodeId: null },
  });
  if (!count) return; // stopped, restarted or already resumed
  const session = await db.flowSession.findUniqueOrThrow({ where: { id: data.sessionId } });
  const run = await loadRun(session);
  if (run) await runFrom(run, nextNodeId(run.graph, data.nodeId));
}

/** Worker handler for QUEUES.flowStart (manual / API) */
export async function startFlowJob(data: { flowId: string; conversationId: string; variables?: Record<string, string> }) {
  const flow = await db.flow.findUnique({ where: { id: data.flowId } });
  if (flow && (await canRun(flow.orgId, "flows"))) await startFlow(flow, data.conversationId, { variables: data.variables });
}

/** Ends the running flow when a teammate takes over (or from the inbox "stop" button) */
export async function stopFlowsInConversation(conversationId: string, reason: string) {
  const { count } = await db.flowSession.updateMany({
    where: { conversationId, status: "ACTIVE" },
    data: { status: "STOPPED", endReason: reason, endedAt: new Date(), nodeId: null, resumeAt: null, expiresAt: null },
  });
  return count;
}

export const AGENT_TAKEOVER_MS = 24 * 60 * 60 * 1000;

/** A teammate replied: stop the running flow and keep automations quiet in this chat for 24 hours */
export async function pauseForAgent(conversationId: string) {
  await stopFlowsInConversation(conversationId, "A teammate replied.");
  await db.conversation.update({ where: { id: conversationId }, data: { botPausedUntil: new Date(Date.now() + AGENT_TAKEOVER_MS) } });
}

/** What the inbox shows about automations in a chat */
export async function automationState(conversationId: string) {
  const [conv, session] = await Promise.all([
    db.conversation.findUnique({ where: { id: conversationId }, select: { botPausedUntil: true } }),
    db.flowSession.findFirst({ where: { conversationId, status: "ACTIVE" }, include: { flow: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" } }),
  ]);
  const paused = conv?.botPausedUntil && conv.botPausedUntil > new Date() ? conv.botPausedUntil : null;
  return {
    pausedUntil: paused,
    session: session ? { id: session.id, flow: session.flow, startedAt: session.createdAt, waiting: session.resumeAt ? "delay" : session.nodeId ? "answer" : null } : null,
  };
}

/** Cron: mark sessions whose answer never came as expired */
export async function expireSessions(now = new Date()) {
  return (
    await db.flowSession.updateMany({
      where: { status: "ACTIVE", expiresAt: { lt: now }, resumeAt: null },
      data: { status: "EXPIRED", endReason: "No answer in time.", endedAt: now, nodeId: null },
    })
  ).count;
}
