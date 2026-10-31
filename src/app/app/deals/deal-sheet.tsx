"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pencil, Plus, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import { DealDialog } from "@/components/crm/deal-dialog";
import { formatMoney } from "@/components/crm/format";
import { LocalTime } from "@/components/crm/local-time";
import { TaskDialog } from "@/components/crm/task-dialog";
import { TaskList } from "@/components/crm/task-list";
import { Timeline } from "@/components/crm/timeline";
import type { DealItem, Member, PipelineItem, TaskItem, TimelineEntry } from "@/components/crm/types";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { apiFetch } from "@/lib/client/api-client";

interface DealDetail {
  deal: DealItem;
  tasks: TaskItem[];
  timeline: TimelineEntry[];
}

export function DealSheet({
  dealId,
  pipelines,
  members,
  meId,
  currency,
  isAdmin,
  onClose,
  onChanged,
}: {
  dealId: string;
  pipelines: PipelineItem[];
  members: Member[];
  meId: string;
  currency: string;
  isAdmin: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations("deals");
  const tc = useTranslations("crm");
  const [detail, setDetail] = useState<DealDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [task, setTask] = useState<TaskItem | "new" | null>(null);
  const [now] = useState(() => Date.now());
  // The board passes a new callback on every render; the latest one is enough here
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  const load = useCallback(async () => {
    const res = await apiFetch<DealDetail>(`/api/deals/${dealId}`);
    if (res.status === 404) {
      toast.error(t("notFound"));
      return closeRef.current();
    }
    if (res.ok && res.data) setDetail(res.data);
  }, [dealId, t]);

  useEffect(() => {
    // Fetch on open; state is only set once the request resolves
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const changed = () => {
    void load();
    onChanged();
  };

  async function moveTo(stageId: string) {
    const res = await apiFetch(`/api/deals/${dealId}/move`, { body: { stageId } });
    if (!res.ok) return toast.error(res.error);
    changed();
  }

  async function remove() {
    if (!detail || !confirm(t("confirmDelete", { title: detail.deal.title }))) return;
    const res = await apiFetch(`/api/deals/${dealId}`, { method: "DELETE", body: {} });
    if (!res.ok) return toast.error(res.error);
    toast.success(t("deleted"));
    onChanged();
    onClose();
  }

  const deal = detail?.deal;
  const pipeline = pipelines.find((p) => p.id === deal?.pipelineId);
  const canDelete = deal && (isAdmin || deal.owner?.id === meId);

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <SheetHeader className="border-b p-4 pe-12">
          <SheetTitle className="break-words">{deal?.title ?? "…"}</SheetTitle>
          <SheetDescription>{deal ? formatMoney(deal.value, deal.currency) : ""}</SheetDescription>
        </SheetHeader>
        {deal && (
          <div className="grid gap-6 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <NativeSelect aria-label={tc("stage")} value={deal.stageId} onChange={(e) => void moveTo(e.target.value)} className="min-w-40 flex-1">
                {pipeline?.stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Pencil />
                {t("edit")}
              </Button>
              {canDelete && (
                <Button variant="ghost" size="icon-sm" onClick={remove} aria-label={t("delete")}>
                  <Trash2 className="text-muted-foreground" />
                </Button>
              )}
            </div>

            <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted-foreground">{t("status")}</dt>
              <dd>
                {t(`statuses.${deal.status}`)}
                {deal.closedAt && (
                  <span className="text-muted-foreground">
                    {" "}
                    · <LocalTime iso={deal.closedAt} />
                  </span>
                )}
              </dd>
              {deal.lostReason && (
                <>
                  <dt className="text-muted-foreground">{tc("lostReason")}</dt>
                  <dd>{deal.lostReason}</dd>
                </>
              )}
              <dt className="text-muted-foreground">{tc("contact")}</dt>
              <dd>
                {deal.contact ? (
                  <Link href={`/app/contacts/${deal.contact.id}`} className="inline-flex items-center gap-1 font-medium hover:underline">
                    <User className="size-3.5" />
                    {deal.contact.name}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </dd>
              <dt className="text-muted-foreground">{tc("owner")}</dt>
              <dd>{deal.owner?.name ?? <span className="text-muted-foreground">—</span>}</dd>
              <dt className="text-muted-foreground">{tc("expectedClose")}</dt>
              <dd>{deal.expectedCloseAt ? <LocalTime iso={deal.expectedCloseAt} /> : <span className="text-muted-foreground">—</span>}</dd>
              <dt className="text-muted-foreground">{t("created")}</dt>
              <dd>
                <LocalTime iso={deal.createdAt} />
              </dd>
            </dl>

            <section className="grid gap-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">{tc("tasks")}</h3>
                <Button variant="ghost" size="sm" onClick={() => setTask("new")}>
                  <Plus />
                  {tc("newTask")}
                </Button>
              </div>
              {detail.tasks.length === 0 ? (
                <p className="text-sm text-muted-foreground">{tc("noTasks")}</p>
              ) : (
                <TaskList tasks={detail.tasks} now={now} onChanged={changed} onEdit={setTask} compact />
              )}
            </section>

            <section className="grid gap-2">
              <h3 className="text-sm font-semibold">{t("history")}</h3>
              <Timeline entries={detail.timeline} notePath={`/api/deals/${dealId}/notes`} onNoteAdded={changed} />
            </section>
          </div>
        )}
      </SheetContent>

      {editing && deal && (
        <DealDialog open onOpenChange={setEditing} deal={deal} pipelines={pipelines} members={members} meId={meId} currency={currency} onSaved={changed} />
      )}
      {task && deal && (
        <TaskDialog
          key={task === "new" ? "new" : task.id}
          open
          onOpenChange={(o) => !o && setTask(null)}
          task={task === "new" ? null : task}
          members={members}
          meId={meId}
          deal={{ id: deal.id, title: deal.title }}
          onSaved={changed}
        />
      )}
    </Sheet>
  );
}
