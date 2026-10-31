"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { TaskDialog } from "@/components/crm/task-dialog";
import { TaskList } from "@/components/crm/task-list";
import type { Member, TaskItem } from "@/components/crm/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { apiFetch } from "@/lib/client/api-client";
import { debounce, useRealtime } from "@/lib/client/realtime";
import { cn } from "@/lib/utils";

type Status = "open" | "today" | "overdue" | "done";

export function TasksView({ members, meId }: { members: Member[]; meId: string }) {
  const t = useTranslations("tasks");
  const tc = useTranslations("crm");
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [status, setStatus] = useState<Status>("open");
  const [tasks, setTasks] = useState<TaskItem[] | null>(null);
  const [editing, setEditing] = useState<TaskItem | "new" | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    const res = await apiFetch<{ tasks: TaskItem[] }>(`/api/tasks?scope=${scope}&status=${status}`);
    if (res.ok && res.data) {
      setTasks(res.data.tasks);
      setNow(Date.now());
    }
  }, [scope, status]);

  useEffect(() => {
    // Fetch when the filters change; state is only set once the request resolves
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const refresh = useMemo(() => debounce(() => void load(), 400), [load]);
  useRealtime("tasks.changed", refresh);

  const tabs: Status[] = ["open", "today", "overdue", "done"];

  return (
    <div className="grid max-w-4xl gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <Button onClick={() => setEditing("new")}>
          <Plus />
          {tc("newTask")}
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 relative overflow-x-auto rounded-lg bg-muted p-1" role="tablist" aria-label={t("statusFilter")}>
          {tabs.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={status === s}
              onClick={() => setStatus(s)}
              className={cn(
                "rounded-md px-3 py-1 text-sm font-medium whitespace-nowrap transition-colors",
                status === s ? "bg-background shadow-xs" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(`status.${s}`)}
            </button>
          ))}
        </div>
        <div className="flex gap-1 rounded-lg bg-muted p-1" role="tablist" aria-label={t("scopeFilter")}>
          {(["mine", "all"] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={scope === s}
              onClick={() => setScope(s)}
              className={cn("rounded-md px-3 py-1 text-sm font-medium transition-colors", scope === s ? "bg-background shadow-xs" : "text-muted-foreground hover:text-foreground")}
            >
              {t(`scope.${s}`)}
            </button>
          ))}
        </div>
      </div>

      <Card>
        <CardContent>
          {tasks === null && <p className="py-6 text-center text-sm text-muted-foreground">{t("loading")}</p>}
          {tasks?.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">{t(`empty.${status}`)}</p>}
          {tasks && tasks.length > 0 && <TaskList tasks={tasks} now={now} onChanged={load} onEdit={setEditing} />}
        </CardContent>
      </Card>

      {editing && (
        <TaskDialog
          key={editing === "new" ? "new" : editing.id}
          open
          onOpenChange={(o) => !o && setEditing(null)}
          task={editing === "new" ? null : editing}
          members={members}
          meId={meId}
          onSaved={load}
        />
      )}
    </div>
  );
}
