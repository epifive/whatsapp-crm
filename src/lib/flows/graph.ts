import { z } from "zod";
import { campaignMediaSchema } from "@/lib/campaigns/schema";
import { UserInputError } from "@/lib/errors";

/**
 * A flow is a graph drawn in the builder (React Flow format): nodes with typed `data` and
 * edges from a node's output handle to another node. Every node type and its outputs:
 *
 *   start      → next                       entry point (exactly one)
 *   message    → next                       text and/or media
 *   menu       → <option id> | noMatch      buttons (≤3) or a list (≤10); numbered text on QR numbers
 *   ask        → next | noMatch             question; the answer is validated and saved
 *   condition  → true | false               compare variables / contact data
 *   delay      → next                       wait minutes, hours or days
 *   assign     → next                       assign the chat to a teammate (or round-robin)
 *   tags       → next                       add / remove contact tags
 *   setField   → next                       set a contact field, name, email or consent
 *   deal       → next                       create a deal in a pipeline stage
 *   webhook    → success | error            POST the conversation data to a URL
 *   ai         → next | handoff             AI answers from the knowledge base, or hands over
 *   end        (no outputs)                 optional closing message, close the chat
 */

export const VAR_NAME = /^[a-z][a-z0-9_]{0,39}$/;
const varName = z.string().trim().regex(VAR_NAME, "Variable names: lowercase letters, digits and _ (start with a letter).");
const text = (max = 4096) => z.string().trim().max(max);

const optionSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  title: z.string().trim().min(1, "Every option needs a title.").max(24, "Option titles: up to 24 characters."),
  description: z.string().trim().max(72).optional(),
});

const ruleSchema = z.object({
  variable: z.string().trim().min(1).max(60),
  op: z.enum(["eq", "neq", "contains", "starts_with", "empty", "not_empty", "gt", "lt"]),
  value: z.string().max(500).default(""),
});

export const nodeDataSchemas = {
  start: z.object({}).passthrough(),
  message: z.object({ text: text().default(""), media: campaignMediaSchema.nullable().optional() }),
  menu: z.object({
    text: text(1024).min(1, "Write the menu message."),
    options: z.array(optionSchema).min(1, "Add at least one option.").max(10, "A menu can have up to 10 options."),
    listButton: z.string().trim().max(20).default("Choose"),
    saveAs: varName.nullable().optional(),
    errorText: text(500).optional(),
  }),
  ask: z.object({
    text: text(1024).min(1, "Write the question."),
    saveAs: varName,
    validation: z.enum(["text", "number", "email", "phone", "date", "yesno", "any"]).default("text"),
    saveToField: z
      .string()
      .regex(/^(name|email|field:[a-z][a-z0-9_]{0,39})$/)
      .nullable()
      .optional(),
    errorText: text(500).optional(),
  }),
  condition: z.object({ match: z.enum(["all", "any"]).default("all"), rules: z.array(ruleSchema).min(1, "Add at least one rule.").max(10) }),
  delay: z.object({ amount: z.coerce.number().int().min(1).max(10_000), unit: z.enum(["minutes", "hours", "days"]) }),
  assign: z.object({ mode: z.enum(["user", "round_robin", "unassign"]), userId: z.string().nullable().optional() }),
  tags: z.object({ add: z.array(z.string().trim().min(1).max(30)).max(10).default([]), remove: z.array(z.string().trim().min(1).max(30)).max(10).default([]) }),
  setField: z.object({ field: z.string().regex(/^(name|email|opt_in|opt_out|field:[a-z][a-z0-9_]{0,39})$/), value: text(1000).default("") }),
  deal: z.object({ pipelineId: z.string().min(1, "Choose a pipeline."), stageId: z.string().min(1, "Choose a stage."), title: text(120).min(1, "Give the deal a title."), value: text(40).default("0") }),
  webhook: z.object({ url: z.string().trim().url("Enter the full URL, e.g. https://example.com/hook").max(2000), saveAs: varName.nullable().optional() }),
  end: z.object({ text: text().default(""), close: z.boolean().default(false) }),
  ai: z.object({
    instructions: text(1000).default(""),
    // Keep answering the customer's follow-up messages, up to maxTurns answers
    keepChatting: z.boolean().default(false),
    maxTurns: z.coerce.number().int().min(1).max(20).default(5),
  }),
} as const;

export type NodeType = keyof typeof nodeDataSchemas;
export const NODE_TYPES = Object.keys(nodeDataSchemas) as NodeType[];

export type NodeData<T extends NodeType> = z.infer<(typeof nodeDataSchemas)[T]>;

export interface FlowNode {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface FlowEdge {
  id: string;
  source: string;
  sourceHandle?: string | null;
  target: string;
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

const graphShape = z.object({
  nodes: z
    .array(
      z.object({
        id: z.string().min(1).max(60),
        type: z.enum(NODE_TYPES as [NodeType, ...NodeType[]]),
        position: z.object({ x: z.number(), y: z.number() }),
        data: z.record(z.string(), z.unknown()).default({}),
      }),
    )
    .max(200, "A flow can have up to 200 steps."),
  edges: z
    .array(z.object({ id: z.string().min(1).max(120), source: z.string(), sourceHandle: z.string().nullable().optional(), target: z.string() }))
    .max(400),
});

/** Output handles a node offers (menus: one per option) */
export function outputsOf(node: FlowNode): string[] {
  switch (node.type) {
    case "menu":
      return [...((node.data.options as { id: string }[] | undefined) ?? []).map((o) => o.id), "noMatch"];
    case "ask":
      return ["next", "noMatch"];
    case "condition":
      return ["true", "false"];
    case "webhook":
      return ["success", "error"];
    case "ai":
      return ["next", "handoff"];
    case "end":
      return [];
    default:
      return ["next"];
  }
}

export class FlowGraphError extends UserInputError {
  constructor(
    message: string,
    public nodeId?: string,
  ) {
    super(message);
    if (nodeId) this.details = { nodeId };
  }
}

const LABEL: Record<NodeType, string> = {
  start: "Start",
  message: "Message",
  menu: "Menu",
  ask: "Question",
  condition: "Condition",
  delay: "Delay",
  assign: "Assign",
  tags: "Tags",
  setField: "Set field",
  deal: "Create deal",
  webhook: "Webhook",
  end: "End",
  ai: "AI reply",
};

/**
 * Validates and normalises a graph from the builder. Throws a FlowGraphError naming the node
 * when something is wrong; dangling edges are dropped silently.
 */
export function parseGraph(raw: unknown): FlowGraph {
  const g = graphShape.parse(raw);
  const starts = g.nodes.filter((n) => n.type === "start");
  if (starts.length !== 1) throw new FlowGraphError("A flow needs exactly one Start step.");
  const ids = new Set<string>();
  const nodes: FlowNode[] = g.nodes.map((n) => {
    if (ids.has(n.id)) throw new FlowGraphError("Two steps share the same id.", n.id);
    ids.add(n.id);
    const parsed = nodeDataSchemas[n.type].safeParse(n.data);
    if (!parsed.success) throw new FlowGraphError(`${LABEL[n.type]}: ${parsed.error.issues[0]?.message ?? "invalid settings"}`, n.id);
    const data = parsed.data as Record<string, unknown>;
    if (n.type === "message" && !data.text && !data.media) throw new FlowGraphError("Message: write a text or attach a file.", n.id);
    if (n.type === "menu") {
      const opts = data.options as { id: string }[];
      if (new Set(opts.map((o) => o.id)).size !== opts.length) throw new FlowGraphError("Menu: options must be different.", n.id);
    }
    if (n.type === "assign" && data.mode === "user" && !data.userId) throw new FlowGraphError("Assign: choose a teammate.", n.id);
    if (n.type === "tags" && !(data.add as string[]).length && !(data.remove as string[]).length) throw new FlowGraphError("Tags: add or remove at least one tag.", n.id);
    return { id: n.id, type: n.type, position: n.position, data };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));

  // One connection per output; edges to deleted steps or unknown outputs are dropped
  const seen = new Set<string>();
  const edges: FlowEdge[] = [];
  for (const e of g.edges) {
    const source = byId.get(e.source);
    if (!source || !byId.has(e.target) || e.source === e.target) continue;
    const handle = e.sourceHandle ?? "next";
    if (!outputsOf(source).includes(handle)) continue;
    const key = `${e.source}:${handle}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ id: e.id, source: e.source, sourceHandle: handle, target: e.target });
  }
  if (!edges.some((e) => e.source === starts[0]!.id)) throw new FlowGraphError("Connect the Start step to the first step of the flow.", starts[0]!.id);
  return { nodes, edges };
}

/** Where an output leads (null = the flow ends there) */
export function nextNodeId(graph: FlowGraph, nodeId: string, handle = "next"): string | null {
  return graph.edges.find((e) => e.source === nodeId && (e.sourceHandle ?? "next") === handle)?.target ?? null;
}

export function startNode(graph: FlowGraph): FlowNode {
  return graph.nodes.find((n) => n.type === "start")!;
}

/** Variables a flow defines (ask / menu "save as", webhook results) for the builder's pickers */
export function flowVariables(graph: FlowGraph): string[] {
  const out = new Set<string>();
  for (const n of graph.nodes) if (typeof n.data.saveAs === "string" && n.data.saveAs) out.add(n.data.saveAs);
  return [...out];
}

/** A new flow: Start connected to a welcome message */
export function emptyGraph(): FlowGraph {
  return {
    nodes: [
      { id: "start", type: "start", position: { x: 0, y: 0 }, data: {} },
      { id: "welcome", type: "message", position: { x: 0, y: 140 }, data: { text: "Hi {{first_name|there}}! 👋" } },
    ],
    edges: [{ id: "e-start-welcome", source: "start", sourceHandle: "next", target: "welcome" }],
  };
}
