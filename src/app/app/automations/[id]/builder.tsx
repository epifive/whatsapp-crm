"use client";

import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  addEdge,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import { AlertTriangle, ArrowLeft, History, LayoutGrid, Play, Plus, Save, Settings2 } from "lucide-react";
import { toast } from "sonner";
import type { FieldDefItem, Member, PipelineItem } from "@/components/crm/types";
import { NativeSelect } from "@/components/native-select";
import { Button, buttonVariants } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/lib/client/api-client";
import { cn } from "@/lib/utils";
import { Inspector } from "./inspector";
import { nodeTypes, PALETTE, STEP_META, type StepData, type StepType } from "./nodes";
import { FlowSettingsDialog, HistorySheet, TestDialog, type FlowInfo } from "./panels";

interface RawGraph {
  nodes: { id: string; type: StepType; position: { x: number; y: number }; data: Record<string, unknown> }[];
  edges: { id: string; source: string; sourceHandle?: string | null; target: string }[];
}

export interface BuilderAccount {
  id: string;
  name: string;
  channel: "OFFICIAL" | "QR";
  phone: string | null;
  status: string;
}

/** Live result of a CSS media query (false while rendering on the server) */
function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

let idSeq = 0;
const newId = (type: string) => `${type}_${Date.now().toString(36)}${(idSeq++).toString(36)}`;

function defaultData(type: StepType, pipelines: PipelineItem[]): Record<string, unknown> {
  switch (type) {
    case "message":
      return { text: "" };
    case "menu":
      return { text: "", options: [{ id: newId("opt"), title: "" }, { id: newId("opt"), title: "" }], listButton: "Choose" };
    case "ask":
      return { text: "", saveAs: "answer", validation: "text" };
    case "condition":
      return { match: "all", rules: [{ variable: "last_message", op: "contains", value: "" }] };
    case "delay":
      return { amount: 1, unit: "hours" };
    case "assign":
      return { mode: "round_robin" };
    case "tags":
      return { add: [], remove: [] };
    case "setField":
      return { field: "name", value: "" };
    case "deal":
      return { pipelineId: pipelines[0]?.id ?? "", stageId: pipelines[0]?.stages[0]?.id ?? "", title: "{{name}}", value: "0" };
    case "webhook":
      return { url: "" };
    case "ai":
      return { instructions: "", keepChatting: true, maxTurns: 5 };
    case "end":
      return { text: "", close: false };
    default:
      return {};
  }
}

const serialize = (nodes: Node[], edges: Edge[]) =>
  JSON.stringify({
    nodes: nodes.map((n) => ({ id: n.id, type: n.type, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, data: n.data })),
    edges: edges.map((e) => ({ id: e.id, source: e.source, sourceHandle: e.sourceHandle ?? "next", target: e.target })),
  });

export function Builder(props: {
  initialFlow: FlowInfo;
  initialGraph: RawGraph;
  members: Member[];
  pipelines: PipelineItem[];
  tagNames: string[];
  fields: FieldDefItem[];
  accounts: BuilderAccount[];
  campaigns: { id: string; name: string }[];
}) {
  return (
    <ReactFlowProvider>
      <BuilderInner {...props} />
    </ReactFlowProvider>
  );
}

function BuilderInner({
  initialFlow,
  initialGraph,
  members,
  pipelines,
  tagNames,
  fields,
  accounts,
  campaigns,
}: {
  initialFlow: FlowInfo;
  initialGraph: RawGraph;
  members: Member[];
  pipelines: PipelineItem[];
  tagNames: string[];
  fields: FieldDefItem[];
  accounts: BuilderAccount[];
  campaigns: { id: string; name: string }[];
}) {
  const t = useTranslations("flows");
  const rf = useReactFlow();
  const wrapper = useRef<HTMLDivElement>(null);
  const [flow, setFlow] = useState(initialFlow);
  const [nodes, setNodes, onNodesChangeRaw] = useNodesState<Node>(initialGraph.nodes.map((n) => ({ ...n, data: n.data ?? {} })));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialGraph.edges.map((e) => ({ ...e, sourceHandle: e.sourceHandle ?? "next" })));
  const [saved, setSaved] = useState(() => serialize(nodes, edges));
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<{ message: string; nodeId?: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const dirty = serialize(nodes, edges) !== saved;
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const selected = nodes.find((n) => n.selected) ?? null;

  // The Start step can't be deleted
  const onNodesChange = useCallback((changes: NodeChange[]) => onNodesChangeRaw(changes.filter((c) => !(c.type === "remove" && c.id === "start"))), [onNodesChangeRaw]);

  const onConnect = useCallback(
    (c: Connection) =>
      setEdges((eds) =>
        addEdge(
          { ...c, id: `e-${c.source}-${c.sourceHandle ?? "next"}-${c.target}`, sourceHandle: c.sourceHandle ?? "next" },
          // One connection per output: a new one replaces the old
          eds.filter((e) => !(e.source === c.source && (e.sourceHandle ?? "next") === (c.sourceHandle ?? "next"))),
        ),
      ),
    [setEdges],
  );

  const variables = useMemo(() => [...new Set(nodes.map((n) => n.data.saveAs).filter((v): v is string => typeof v === "string" && !!v))], [nodes]);
  const triggerLabel = useMemo(() => {
    if (flow.trigger === "KEYWORD") return flow.keywords.length ? t("triggerKeyword", { keywords: flow.keywords.join(", ") }) : t("triggerNoKeywords");
    return t(`trigger.${flow.trigger}`);
  }, [flow, t]);

  // Display-only extras for the cards (names, the error highlight)
  const decorated = useMemo(
    () =>
      nodes.map((n) => {
        const labels: Record<string, string> = {};
        if (n.type === "start") labels.trigger = triggerLabel;
        if (n.type === "assign") labels.user = members.find((m) => m.id === n.data.userId)?.name ?? "";
        if (n.type === "setField") {
          const f = String(n.data.field ?? "");
          labels.field = f.startsWith("field:") ? (fields.find((x) => `field:${x.key}` === f)?.label ?? f) : t(`field.${f}`);
        }
        return { ...n, data: { ...n.data, _labels: labels, _error: problem?.nodeId === n.id } as StepData };
      }),
    [nodes, triggerLabel, members, fields, problem, t],
  );

  function addStep(type: StepType, at?: { x: number; y: number }) {
    const box = wrapper.current?.getBoundingClientRect();
    const anchor = selected && !at ? { x: selected.position.x, y: selected.position.y + 220 } : null;
    const position = { ...(at ?? anchor ?? rf.screenToFlowPosition({ x: (box?.left ?? 0) + (box?.width ?? 600) / 2 - 128, y: (box?.top ?? 0) + (box?.height ?? 400) / 3 })) };
    // Move down until the new card doesn't land on top of another one
    const hits = (p: { x: number; y: number }) =>
      nodes.some((n) => p.x < n.position.x + (n.measured?.width ?? 256) && p.x + 256 > n.position.x && p.y < n.position.y + (n.measured?.height ?? 120) && p.y + 120 > n.position.y);
    for (let i = 0; i < 50 && hits(position); i++) position.y += 60;
    const id = newId(type);
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { id, type, position, data: defaultData(type, pipelines), selected: true }]);
    // Clicking a step in the palette while another is selected chains it below
    if (selected && !at && !["menu", "ask", "condition", "webhook", "ai", "end"].includes(String(selected.type)) && !edges.some((e) => e.source === selected.id)) {
      setEdges((eds) => [...eds, { id: `e-${selected.id}-next-${id}`, source: selected.id, sourceHandle: "next", target: id }]);
    }
  }

  /** Lays the steps out top-down by distance from Start, using each card's real size */
  function tidyUp() {
    const level = new Map<string, number>([["start", 0]]);
    const queue = ["start"];
    while (queue.length) {
      const id = queue.shift()!;
      for (const e of edges.filter((x) => x.source === id)) {
        if (!level.has(e.target)) {
          level.set(e.target, level.get(id)! + 1);
          queue.push(e.target);
        }
      }
    }
    const maxLevel = Math.max(0, ...level.values());
    // Steps not connected to anything go in a row at the bottom
    for (const n of nodes) if (!level.has(n.id)) level.set(n.id, maxLevel + 1);
    const rows = new Map<number, Node[]>();
    for (const n of nodes) rows.set(level.get(n.id)!, [...(rows.get(level.get(n.id)!) ?? []), n]);
    const GAP_X = 48;
    const GAP_Y = 72;
    const positions = new Map<string, { x: number; y: number }>();
    let y = 0;
    for (const lvl of [...rows.keys()].sort((a, b) => a - b)) {
      const row = rows.get(lvl)!.sort((a, b) => a.position.x - b.position.x);
      const widths = row.map((n) => n.measured?.width ?? 256);
      const total = widths.reduce((sum, w) => sum + w, 0) + GAP_X * (row.length - 1);
      let x = -total / 2;
      row.forEach((n, i) => {
        positions.set(n.id, { x, y });
        x += widths[i]! + GAP_X;
      });
      y += Math.max(...row.map((n) => n.measured?.height ?? 120)) + GAP_Y;
    }
    setNodes((ns) => ns.map((n) => ({ ...n, position: positions.get(n.id) ?? n.position })));
    requestAnimationFrame(() => rf.fitView({ padding: 0.2, maxZoom: 1, duration: 300 }));
  }

  function updateSelected(patch: Record<string, unknown>) {
    if (!selected) return;
    setNodes((ns) => ns.map((n) => (n.id === selected.id ? { ...n, data: { ...n.data, ...patch } } : n)));
    if (problem?.nodeId === selected.id) setProblem(null);
  }

  function deleteSelected() {
    if (!selected || selected.id === "start") return;
    setNodes((ns) => ns.filter((n) => n.id !== selected.id));
    setEdges((es) => es.filter((e) => e.source !== selected.id && e.target !== selected.id));
  }

  function duplicateSelected() {
    if (!selected || selected.id === "start") return;
    const id = newId(String(selected.type));
    const data = structuredClone(selected.data);
    if (Array.isArray(data.options)) data.options = (data.options as { id: string }[]).map((o) => ({ ...o, id: newId("opt") }));
    setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), { id, type: selected.type, position: { x: selected.position.x + 40, y: selected.position.y + 60 }, data, selected: true }]);
  }

  async function save(opts: { activate?: boolean; quiet?: boolean } = {}): Promise<boolean> {
    setSaving(true);
    const graph = JSON.parse(serialize(nodes, edges));
    const res = await apiFetch<{ flow: FlowInfo }>(`/api/flows/${flow.id}`, { method: "PATCH", body: { graph, ...(opts.activate !== undefined ? { isActive: opts.activate } : {}) } });
    setSaving(false);
    if (!res.ok) {
      // The error names the step; the validate endpoint tells us its id for highlighting
      const nodeId = await nodeOf(graph);
      setProblem({ message: res.error ?? t("saveFailed"), nodeId });
      if (nodeId) focusNode(nodeId);
      return false;
    }
    setProblem(null);
    setFlow(res.data!.flow);
    setSaved(serialize(nodes, edges));
    if (!opts.quiet) toast.success(opts.activate === true ? t("activated") : opts.activate === false ? t("deactivated") : t("saved"));
    return true;
  }

  // Ask the server which step is wrong (the validate endpoint returns its id)
  async function nodeOf(graph: unknown): Promise<string | undefined> {
    const r = await fetch(`/api/flows/${flow.id}/validate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ graph }), credentials: "same-origin" });
    const j = await r.json().catch(() => null);
    return j?.nodeId;
  }

  function focusNode(id: string) {
    const n = rf.getNode(id);
    if (!n) return;
    setNodes((ns) => ns.map((x) => ({ ...x, selected: x.id === id })));
    rf.setCenter(n.position.x + 128, n.position.y + 60, { zoom: 1, duration: 400 });
  }

  async function toggleActive(on: boolean) {
    if (on) {
      const graph = JSON.parse(serialize(nodes, edges));
      const r = await fetch(`/api/flows/${flow.id}/validate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ graph }), credentials: "same-origin" });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        setProblem({ message: j?.error ?? t("saveFailed"), nodeId: j?.nodeId });
        if (j?.nodeId) focusNode(j.nodeId);
        return;
      }
    }
    await save({ activate: on });
  }

  const inspector = selected ? (
    <Inspector
      key={selected.id}
      type={selected.type as StepType}
      data={selected.data}
      onChange={updateSelected}
      onDelete={deleteSelected}
      onDuplicate={duplicateSelected}
      ctx={{ members, pipelines, tagNames, fields, variables }}
    />
  ) : (
    <div className="grid gap-2 p-4 text-sm text-muted-foreground">
      <p className="font-medium text-foreground">{t("howTo")}</p>
      <ul className="list-disc space-y-1 ps-5">
        <li>{t("howTo1")}</li>
        <li>{t("howTo2")}</li>
        <li>{t("howTo3")}</li>
        <li>{t("howTo4")}</li>
      </ul>
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b bg-background px-3 py-2">
        <Link href="/app/automations" className={buttonVariants({ variant: "ghost", size: "icon-sm" })} aria-label={t("back")}>
          <ArrowLeft />
        </Link>
        <div className="min-w-0 flex-1 basis-40">
          <div className="truncate font-semibold">{flow.name}</div>
          <button type="button" onClick={() => setSettingsOpen(true)} className="max-w-full truncate text-left text-xs text-muted-foreground hover:text-foreground hover:underline">
            {triggerLabel}
          </button>
        </div>
        <NativeSelect size="sm" aria-label={t("addStep")} value="" onChange={(e) => e.target.value && addStep(e.target.value as StepType)} className="md:hidden">
          <option value="">{t("addStep")}</option>
          {PALETTE.map((p) => (
            <option key={p} value={p}>
              {t(`type.${p}`)}
            </option>
          ))}
        </NativeSelect>
        <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(true)}>
          <Settings2 />
          <span className="hidden sm:inline">{t("settings")}</span>
        </Button>
        <Button variant="ghost" size="sm" onClick={tidyUp} title={t("tidyUp")}>
          <LayoutGrid />
          <span className="hidden xl:inline">{t("tidyUp")}</span>
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
          <History />
          <span className="hidden sm:inline">{t("history")}</span>
        </Button>
        <Button variant="outline" size="sm" onClick={async () => (dirty ? (await save({ quiet: true })) && setTestOpen(true) : setTestOpen(true))}>
          <Play />
          {t("test")}
        </Button>
        <label className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm">
          <Switch checked={flow.isActive} onCheckedChange={(v) => void toggleActive(v)} aria-label={t("active")} />
          <span className={cn("font-medium", flow.isActive ? "text-primary" : "text-muted-foreground")}>{flow.isActive ? t("on") : t("off")}</span>
        </label>
        <Button size="sm" onClick={() => void save()} disabled={saving || !dirty}>
          <Save />
          {dirty ? t("save") : t("savedShort")}
        </Button>
      </header>

      {problem && (
        <div className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/5 px-4 py-2 text-sm text-destructive" role="alert">
          <AlertTriangle className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">{problem.message}</span>
          {problem.nodeId && (
            <Button variant="ghost" size="sm" onClick={() => focusNode(problem.nodeId!)}>
              {t("showStep")}
            </Button>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-44 shrink-0 overflow-y-auto border-e bg-background p-2 md:block" aria-label={t("palette")}>
          <p className="px-1 pb-2 text-xs font-medium text-muted-foreground">{t("dragOrClick")}</p>
          <div className="grid gap-1">
            {PALETTE.map((type) => {
              const Icon = STEP_META[type].icon;
              return (
                <button
                  key={type}
                  type="button"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("application/wacrm-step", type);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onClick={() => addStep(type)}
                  className="flex items-center gap-2 rounded-md border bg-card px-2 py-1.5 text-left text-sm hover:bg-muted"
                >
                  <span className="flex size-6 items-center justify-center rounded text-white" style={{ backgroundColor: STEP_META[type].color }}>
                    <Icon className="size-3.5" />
                  </span>
                  {t(`type.${type}`)}
                  <Plus className="ms-auto size-3.5 text-muted-foreground" />
                </button>
              );
            })}
          </div>
        </aside>

        <div
          ref={wrapper}
          className="relative min-w-0 flex-1"
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }}
          onDrop={(e) => {
            e.preventDefault();
            const type = e.dataTransfer.getData("application/wacrm-step") as StepType;
            if (type) addStep(type, rf.screenToFlowPosition({ x: e.clientX - 128, y: e.clientY - 30 }));
          }}
        >
          <ReactFlow
            nodes={decorated}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={(c) => c.source !== c.target && c.target !== "start"}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
            minZoom={0.2}
            deleteKeyCode={["Backspace", "Delete"]}
            defaultEdgeOptions={{ type: "smoothstep", animated: false, style: { strokeWidth: 2 } }}
          >
            <Background gap={20} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable className="!hidden lg:!block" nodeColor={(n) => STEP_META[n.type as StepType]?.color ?? "#999"} />
          </ReactFlow>
        </div>

        <aside className="hidden w-80 shrink-0 overflow-y-auto border-s bg-background lg:block">{inspector}</aside>
      </div>

      {/* Smaller screens: the inspector opens as a sheet */}
      <Sheet open={!!selected && !isDesktop} onOpenChange={(o) => !o && setNodes((ns) => ns.map((n) => ({ ...n, selected: false })))}>
        <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-sm lg:hidden">
          <SheetTitle className="sr-only">{t("stepSettings")}</SheetTitle>
          {inspector}
        </SheetContent>
      </Sheet>

      {settingsOpen && (
        <FlowSettingsDialog
          flow={flow}
          accounts={accounts}
          campaigns={campaigns}
          onClose={() => setSettingsOpen(false)}
          onSaved={(f) => {
            setFlow(f);
            setSettingsOpen(false);
          }}
        />
      )}
      {testOpen && <TestDialog flowId={flow.id} accounts={accounts} onClose={() => setTestOpen(false)} />}
      {historyOpen && <HistorySheet flowId={flow.id} onClose={() => setHistoryOpen(false)} />}
    </div>
  );
}
