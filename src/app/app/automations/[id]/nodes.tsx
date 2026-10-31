"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useTranslations } from "next-intl";
import { memo } from "react";
import {
  Briefcase,
  Clock,
  Flag,
  GitBranch,
  HelpCircle,
  List,
  MessageSquare,
  PenLine,
  Play,
  Sparkles,
  Tag,
  UserCheck,
  Webhook,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type StepType = "start" | "message" | "menu" | "ask" | "condition" | "delay" | "assign" | "tags" | "setField" | "deal" | "webhook" | "ai" | "end";

export const STEP_META: Record<StepType, { icon: LucideIcon; color: string }> = {
  start: { icon: Play, color: "#16a34a" },
  message: { icon: MessageSquare, color: "#2563eb" },
  menu: { icon: List, color: "#7c3aed" },
  ask: { icon: HelpCircle, color: "#db2777" },
  condition: { icon: GitBranch, color: "#ea580c" },
  delay: { icon: Clock, color: "#0891b2" },
  assign: { icon: UserCheck, color: "#4f46e5" },
  tags: { icon: Tag, color: "#ca8a04" },
  setField: { icon: PenLine, color: "#0d9488" },
  deal: { icon: Briefcase, color: "#9333ea" },
  webhook: { icon: Webhook, color: "#475569" },
  ai: { icon: Sparkles, color: "#c026d3" },
  end: { icon: Flag, color: "#dc2626" },
};

/** Steps offered in the palette, in order */
export const PALETTE: StepType[] = ["message", "menu", "ask", "ai", "condition", "delay", "assign", "tags", "setField", "deal", "webhook", "end"];

export interface StepData extends Record<string, unknown> {
  // Filled in by the builder for display (names of teammates etc.)
  _labels?: Record<string, string>;
  _error?: boolean;
}

function short(text: unknown, n = 90): string {
  const s = typeof text === "string" ? text : "";
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function Row({ id, label, tone }: { id: string; label: string; tone?: "muted" | "good" | "bad" }) {
  return (
    <div className="relative flex items-center justify-end border-t py-1.5 pe-3 ps-3 text-xs">
      <span className={cn("truncate", tone === "muted" && "text-muted-foreground", tone === "good" && "text-green-700 dark:text-green-400", tone === "bad" && "text-red-600")}>{label}</span>
      <Handle type="source" position={Position.Right} id={id} className="!size-2.5 !border-2 !border-background !bg-foreground/60" />
    </div>
  );
}

/** One card on the canvas; outputs with more than one branch get a labelled handle each */
function StepCardImpl({ type, data, selected }: NodeProps & { type: string; data: StepData }) {
  const t = useTranslations("flows");
  const kind = type as StepType;
  const meta = STEP_META[kind];
  const Icon = meta.icon;
  const labels = data._labels ?? {};

  let body: React.ReactNode = null;
  let rows: React.ReactNode = null;
  let single = kind !== "end";

  switch (kind) {
    case "start":
      body = <p className="text-xs text-muted-foreground">{labels.trigger}</p>;
      break;
    case "message":
      body = (
        <p className="text-xs whitespace-pre-wrap">
          {data.media ? "📎 " : ""}
          {short(data.text) || (data.media ? (data.media as { fileName?: string }).fileName : t("empty_card"))}
        </p>
      );
      break;
    case "menu": {
      single = false;
      const options = (data.options as { id: string; title: string }[] | undefined) ?? [];
      body = <p className="text-xs whitespace-pre-wrap">{short(data.text) || t("empty_card")}</p>;
      rows = (
        <>
          {options.map((o, i) => (
            <Row key={o.id} id={o.id} label={`${i + 1}. ${o.title || "…"}`} />
          ))}
          <Row id="noMatch" label={t("noMatch")} tone="muted" />
        </>
      );
      break;
    }
    case "ask":
      single = false;
      body = (
        <>
          <p className="text-xs whitespace-pre-wrap">{short(data.text) || t("empty_card")}</p>
          {typeof data.saveAs === "string" && data.saveAs && <p className="mt-1 font-mono text-[11px] text-muted-foreground">→ {`{{${data.saveAs}}}`}</p>}
        </>
      );
      rows = (
        <>
          <Row id="next" label={t("answered")} tone="good" />
          <Row id="noMatch" label={t("noMatch")} tone="muted" />
        </>
      );
      break;
    case "condition": {
      single = false;
      const rules = (data.rules as { variable: string; op: string; value: string }[] | undefined) ?? [];
      body = (
        <p className="text-xs">
          {rules.length ? rules.map((r) => `${r.variable} ${t(`op.${r.op}`)} ${r.value}`.trim()).join(data.match === "any" ? ` ${t("or")} ` : ` ${t("and")} `) : t("empty_card")}
        </p>
      );
      rows = (
        <>
          <Row id="true" label={t("yes")} tone="good" />
          <Row id="false" label={t("no")} tone="bad" />
        </>
      );
      break;
    }
    case "delay":
      body = <p className="text-xs">{t("waitFor", { amount: Number(data.amount ?? 0), unit: t(`unit.${String(data.unit ?? "minutes")}`) })}</p>;
      break;
    case "assign":
      body = <p className="text-xs">{data.mode === "round_robin" ? t("roundRobin") : data.mode === "unassign" ? t("unassign") : (labels.user ?? t("chooseTeammate"))}</p>;
      break;
    case "tags": {
      const add = (data.add as string[] | undefined) ?? [];
      const remove = (data.remove as string[] | undefined) ?? [];
      body = <p className="text-xs">{[...add.map((x) => `+ ${x}`), ...remove.map((x) => `− ${x}`)].join(", ") || t("empty_card")}</p>;
      break;
    }
    case "setField":
      body = (
        <p className="text-xs">
          {labels.field ?? String(data.field ?? "")} = {short(data.value, 40)}
        </p>
      );
      break;
    case "deal":
      body = <p className="text-xs">{short(data.title) || t("empty_card")}</p>;
      break;
    case "webhook": {
      single = false;
      let host = "";
      try {
        host = new URL(String(data.url ?? "")).host;
      } catch {
        host = t("empty_card");
      }
      body = <p className="truncate text-xs">POST {host}</p>;
      rows = (
        <>
          <Row id="success" label={t("success")} tone="good" />
          <Row id="error" label={t("failed")} tone="bad" />
        </>
      );
      break;
    }
    case "ai":
      single = false;
      body = (
        <p className="text-xs">
          {data.keepChatting ? t("aiChatting", { turns: Number(data.maxTurns ?? 5) }) : t("aiOnce")}
          {typeof data.instructions === "string" && data.instructions ? <span className="block text-muted-foreground">{short(data.instructions, 60)}</span> : null}
        </p>
      );
      rows = (
        <>
          <Row id="next" label={t("answered")} tone="good" />
          <Row id="handoff" label={t("handoff")} tone="muted" />
        </>
      );
      break;
    case "end":
      body = <p className="text-xs">{short(data.text) || (data.close ? t("closeChat") : t("endFlow"))}</p>;
      break;
  }

  return (
    <div
      className={cn(
        "w-64 overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm transition-shadow",
        selected && "ring-2 ring-primary",
        data._error && "ring-2 ring-destructive",
      )}
    >
      {kind !== "start" && <Handle type="target" position={Position.Top} className="!size-3 !border-2 !border-background !bg-primary" />}
      <div className="flex items-center gap-2 px-3 py-2" style={{ backgroundColor: `${meta.color}14` }}>
        <span className="flex size-6 items-center justify-center rounded-md text-white" style={{ backgroundColor: meta.color }}>
          <Icon className="size-3.5" />
        </span>
        <span className="text-xs font-semibold">{t(`type.${kind}`)}</span>
      </div>
      <div className="px-3 py-2">{body}</div>
      {rows}
      {single && <Handle type="source" position={Position.Bottom} id="next" className="!size-3 !border-2 !border-background !bg-primary" />}
    </div>
  );
}

export const StepCard = memo(StepCardImpl);

export const nodeTypes = Object.fromEntries(Object.keys(STEP_META).map((k) => [k, StepCard]));
