"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarClock, ListTodo, Plus, Search, Settings2, User } from "lucide-react";
import { toast } from "sonner";
import { DealDialog } from "@/components/crm/deal-dialog";
import { formatMoney, formatMoneyCompact, initials } from "@/components/crm/format";
import { LocalTime } from "@/components/crm/local-time";
import type { DealItem, Member, PipelineItem, StageItem } from "@/components/crm/types";
import { NativeSelect } from "@/components/native-select";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/client/api-client";
import { debounce, useRealtime } from "@/lib/client/realtime";
import { cn } from "@/lib/utils";
import { DealSheet } from "./deal-sheet";

interface Board {
  pipeline: PipelineItem;
  deals: DealItem[];
  totals: Record<string, { count: number; value: number }>;
}

type Columns = Record<string, string[]>;

function columnsFor(board: Board): Columns {
  const cols: Columns = Object.fromEntries(board.pipeline.stages.map((s) => [s.id, [] as string[]]));
  for (const d of [...board.deals].sort((a, b) => a.position - b.position)) cols[d.stageId]?.push(d.id);
  return cols;
}

export function DealsBoard({
  pipelines: initialPipelines,
  members,
  meId,
  currency,
  isAdmin,
  initialPipelineId,
  initialDealId,
}: {
  pipelines: PipelineItem[];
  members: Member[];
  meId: string;
  currency: string;
  isAdmin: boolean;
  initialPipelineId: string;
  initialDealId: string | null;
}) {
  const t = useTranslations("deals");
  const tc = useTranslations("crm");
  const [pipelines] = useState(initialPipelines);
  const [pipelineId, setPipelineId] = useState(initialPipelineId);
  const [q, setQ] = useState("");
  const [owner, setOwner] = useState("");
  const [board, setBoard] = useState<Board | null>(null);
  const [columns, setColumns] = useState<Columns>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragStart, setDragStart] = useState<{ stageId: string; order: string[] } | null>(null);
  const [creating, setCreating] = useState<{ stageId?: string } | null>(null);
  const [openDealId, setOpenDealId] = useState<string | null>(initialDealId);
  const [now] = useState(() => Date.now());

  const params = useMemo(() => {
    const p = new URLSearchParams({ pipelineId });
    if (q.trim()) p.set("q", q.trim());
    if (owner) p.set("owner", owner);
    return p.toString();
  }, [pipelineId, q, owner]);

  const load = useCallback(async () => {
    const res = await apiFetch<Board>(`/api/deals?${params}`);
    if (!res.ok || !res.data) return toast.error(res.error);
    setBoard(res.data);
    setColumns(columnsFor(res.data));
  }, [params]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), q ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, q]);

  // Keep ?pipeline= / ?deal= shareable without navigating
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("pipeline", pipelineId);
    if (openDealId) url.searchParams.set("deal", openDealId);
    else url.searchParams.delete("deal");
    window.history.replaceState(null, "", url);
  }, [pipelineId, openDealId]);

  const refresh = useMemo(() => debounce(() => void load(), 400), [load]);
  useRealtime<{ pipelineId?: string }>("deals.changed", (ev) => {
    if (!activeId && (!ev.pipelineId || ev.pipelineId === pipelineId)) refresh();
  });

  const dealsById = useMemo(() => new Map((board?.deals ?? []).map((d) => [d.id, d])), [board]);
  const stages = board?.pipeline.stages ?? [];

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const columnOf = (id: string) => (id in columns ? id : Object.keys(columns).find((k) => columns[k]!.includes(id)));

  function onDragStart({ active }: DragStartEvent) {
    const id = String(active.id);
    const stageId = columnOf(id);
    setActiveId(id);
    if (stageId) setDragStart({ stageId, order: columns[stageId]! });
  }

  // Moving across columns while dragging (the card follows the pointer into the new column)
  function onDragOver({ active, over }: DragOverEvent) {
    if (!over) return;
    const id = String(active.id);
    const from = columnOf(id);
    const to = columnOf(String(over.id));
    if (!from || !to || from === to) return;
    setColumns((prev) => {
      const target = [...prev[to]!];
      const overIndex = target.indexOf(String(over.id));
      target.splice(overIndex >= 0 ? overIndex : target.length, 0, id);
      return { ...prev, [from]: prev[from]!.filter((x) => x !== id), [to]: target };
    });
  }

  async function onDragEnd({ active, over }: DragEndEvent) {
    const id = String(active.id);
    setActiveId(null);
    const stageId = columnOf(id);
    if (!over || !stageId || !board) {
      setColumns(columnsFor(board!));
      return;
    }
    let order = columns[stageId]!;
    const overId = String(over.id);
    if (columnOf(overId) === stageId && overId !== stageId) {
      const from = order.indexOf(id);
      const to = order.indexOf(overId);
      if (from !== to && to >= 0) order = arrayMove(order, from, to);
    }
    setColumns((prev) => ({ ...prev, [stageId]: order }));
    const unchanged = dragStart?.stageId === stageId && dragStart.order.join() === order.join();
    setDragStart(null);
    if (unchanged) return;

    const index = order.indexOf(id);
    const res = await apiFetch<{ deal: DealItem }>(`/api/deals/${id}/move`, {
      body: { stageId, beforeId: order[index - 1] ?? null, afterId: order[index + 1] ?? null },
    });
    if (!res.ok) {
      toast.error(res.error);
      return void load();
    }
    const moved = res.data!.deal;
    const stage = stages.find((s) => s.id === stageId);
    if (stage?.kind === "WON" && dealsById.get(id)?.status !== "WON") toast.success(t("wonToast", { title: moved.title }));
    setBoard((b) => (b ? { ...b, deals: b.deals.map((d) => (d.id === id ? moved : d)) } : b));
    refresh(); // column totals
  }

  const openDeals = (board?.deals ?? []).filter((d) => d.status === "OPEN");
  const openValue = openDeals.reduce((sum, d) => sum + d.value, 0);
  const forecast = openDeals.reduce((sum, d) => sum + (d.value * (stages.find((s) => s.id === d.stageId)?.probability ?? 0)) / 100, 0);
  const activeDeal = activeId ? dealsById.get(activeId) : null;

  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1 basis-56">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("summary", { count: openDeals.length, value: formatMoney(openValue, currency), forecast: formatMoney(Math.round(forecast), currency) })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isAdmin && (
            <Link href="/app/settings/pipelines" className={buttonVariants({ variant: "outline", size: "sm" })}>
              <Settings2 />
              {t("editPipelines")}
            </Link>
          )}
          <Button size="sm" onClick={() => setCreating({})}>
            <Plus />
            {tc("newDeal")}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {pipelines.length > 1 && (
          <NativeSelect aria-label={tc("pipeline")} value={pipelineId} onChange={(e) => setPipelineId(e.target.value)} className="max-w-56">
            {pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        )}
        <div className="relative min-w-48 flex-1 sm:max-w-xs">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} className="ps-8" aria-label={t("search")} />
        </div>
        <NativeSelect aria-label={tc("owner")} value={owner} onChange={(e) => setOwner(e.target.value)} className="max-w-48">
          <option value="">{t("allOwners")}</option>
          <option value="me">{t("myDeals")}</option>
          {members
            .filter((m) => m.id !== meId)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
        </NativeSelect>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => (setActiveId(null), board && setColumns(columnsFor(board)))}>
        {/* Columns scroll sideways; the page itself never does */}
        <div className="-mx-4 relative overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
          <div className="flex min-h-[60dvh] gap-3">
            {stages.map((stage) => (
              <Column
                key={stage.id}
                stage={stage}
                ids={columns[stage.id] ?? []}
                dealsById={dealsById}
                total={board?.totals[stage.id]}
                currency={currency}
                now={now}
                onOpen={setOpenDealId}
                onAdd={() => setCreating({ stageId: stage.id })}
              />
            ))}
            {!board && <div className="p-6 text-sm text-muted-foreground">{t("loading")}</div>}
          </div>
        </div>
        <DragOverlay>{activeDeal ? <DealCard deal={activeDeal} now={now} dragging /> : null}</DragOverlay>
      </DndContext>

      {creating && (
        <DealDialog
          open
          onOpenChange={(o) => !o && setCreating(null)}
          deal={null}
          pipelines={pipelines}
          members={members}
          meId={meId}
          currency={currency}
          defaultPipelineId={pipelineId}
          defaultStageId={creating.stageId}
          onSaved={() => void load()}
        />
      )}
      {openDealId && (
        <DealSheet
          key={openDealId}
          dealId={openDealId}
          pipelines={pipelines}
          members={members}
          meId={meId}
          currency={currency}
          isAdmin={isAdmin}
          onClose={() => setOpenDealId(null)}
          onChanged={() => void load()}
        />
      )}
    </div>
  );
}

function Column({
  stage,
  ids,
  dealsById,
  total,
  currency,
  now,
  onOpen,
  onAdd,
}: {
  stage: StageItem;
  ids: string[];
  dealsById: Map<string, DealItem>;
  total?: { count: number; value: number };
  currency: string;
  now: number;
  onOpen: (id: string) => void;
  onAdd: () => void;
}) {
  const t = useTranslations("deals");
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <section className={cn("flex w-72 shrink-0 flex-col rounded-xl bg-muted/50", isOver && "ring-2 ring-primary/30")} aria-label={stage.name}>
      <header className="flex items-center gap-2 border-t-4 px-3 pt-2.5 pb-2" style={{ borderTopColor: stage.color, borderTopLeftRadius: "0.75rem", borderTopRightRadius: "0.75rem" }}>
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{stage.name}</h2>
        <span className="text-xs text-muted-foreground tabular-nums">{total?.count ?? ids.length}</span>
      </header>
      <div className="px-3 pb-2 text-xs text-muted-foreground tabular-nums">
        {formatMoneyCompact(total?.value ?? 0, currency)}
        {stage.kind === "OPEN" && stage.probability > 0 && ` · ${stage.probability}%`}
      </div>
      <SortableContext id={stage.id} items={ids} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2">
          {ids.map((id) => {
            const deal = dealsById.get(id);
            return deal ? <SortableDeal key={id} deal={deal} now={now} onOpen={() => onOpen(id)} /> : null;
          })}
          <button type="button" onClick={onAdd} className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-background hover:text-foreground">
            <Plus className="size-3.5" />
            {t("addDeal")}
          </button>
        </div>
      </SortableContext>
    </section>
  );
}

function SortableDeal({ deal, now, onOpen }: { deal: DealItem; now: number; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: deal.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && "opacity-40")}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e);
        if (e.key === "Enter" && !e.defaultPrevented) onOpen();
      }}
    >
      <DealCard deal={deal} now={now} />
    </div>
  );
}

function DealCard({ deal, now, dragging }: { deal: DealItem; now: number; dragging?: boolean }) {
  const t = useTranslations("deals");
  const late = deal.status === "OPEN" && deal.expectedCloseAt && new Date(deal.expectedCloseAt).getTime() < now;
  return (
    <article className={cn("cursor-grab rounded-lg border bg-background p-3 text-sm shadow-xs transition-shadow hover:shadow-sm", dragging && "rotate-2 cursor-grabbing shadow-lg")}>
      <div className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1 font-medium break-words">{deal.title}</h3>
        {deal.owner && (
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary" title={deal.owner.name}>
            {initials(deal.owner.name)}
          </span>
        )}
      </div>
      {deal.contact && (
        <div className="mt-1 flex items-center gap-1 truncate text-xs text-muted-foreground">
          <User className="size-3 shrink-0" />
          {deal.contact.name}
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span className="font-semibold tabular-nums">{formatMoney(deal.value, deal.currency)}</span>
        {deal.expectedCloseAt && (
          <span className={cn("inline-flex items-center gap-1 text-muted-foreground", late && "text-destructive")}>
            <CalendarClock className="size-3" />
            <LocalTime iso={deal.expectedCloseAt} options={{ day: "numeric", month: "short" }} />
          </span>
        )}
        {deal.openTasks > 0 && (
          <span className="inline-flex items-center gap-1 text-muted-foreground" title={t("openTasks", { count: deal.openTasks })}>
            <ListTodo className="size-3" />
            {deal.openTasks}
          </span>
        )}
      </div>
    </article>
  );
}
