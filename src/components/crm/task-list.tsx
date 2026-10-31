"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Briefcase, Clock, Pencil, Trash2, User } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { apiFetch } from "@/lib/client/api-client";
import { cn } from "@/lib/utils";
import { LocalTime } from "./local-time";
import type { TaskItem } from "./types";

/** Task rows with a done checkbox; shows links to the contact/deal unless `compact` */
export function TaskList({
  tasks,
  now,
  onChanged,
  onEdit,
  compact,
}: {
  tasks: TaskItem[];
  now: number;
  onChanged: () => void;
  onEdit?: (task: TaskItem) => void;
  compact?: boolean;
}) {
  const t = useTranslations("crm");

  async function toggle(task: TaskItem, done: boolean) {
    const res = await apiFetch(`/api/tasks/${task.id}`, { method: "PATCH", body: { completed: done } });
    if (!res.ok) return toast.error(res.error);
    if (done) toast.success(t("taskDone"));
    onChanged();
  }

  async function remove(task: TaskItem) {
    if (!confirm(t("confirmDeleteTask", { title: task.title }))) return;
    const res = await apiFetch(`/api/tasks/${task.id}`, { method: "DELETE", body: {} });
    if (!res.ok) return toast.error(res.error);
    onChanged();
  }

  return (
    <ul className="divide-y">
      {tasks.map((task) => {
        const overdue = !task.completedAt && task.dueAt && new Date(task.dueAt).getTime() < now;
        return (
          <li key={task.id} className="flex items-start gap-3 py-2.5">
            <Checkbox className="mt-0.5" checked={!!task.completedAt} onCheckedChange={(v) => void toggle(task, !!v)} aria-label={t("markDone", { title: task.title })} />
            <div className="min-w-0 flex-1">
              <div className={cn("text-sm font-medium break-words", task.completedAt && "text-muted-foreground line-through")}>{task.title}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                {task.dueAt && (
                  <span className={cn("inline-flex items-center gap-1", overdue && "font-medium text-destructive")}>
                    <Clock className="size-3" />
                    <LocalTime iso={task.dueAt} options={{ dateStyle: "medium", timeStyle: "short" }} />
                    {overdue && ` · ${t("overdue")}`}
                  </span>
                )}
                {task.assignee && <span>{task.assignee.name}</span>}
                {!compact && task.contact && (
                  <Link href={`/app/contacts/${task.contact.id}`} className="inline-flex items-center gap-1 hover:text-foreground hover:underline">
                    <User className="size-3" />
                    {task.contact.name}
                  </Link>
                )}
                {!compact && task.deal && (
                  <Link href={`/app/deals?deal=${task.deal.id}`} className="inline-flex items-center gap-1 hover:text-foreground hover:underline">
                    <Briefcase className="size-3" />
                    {task.deal.title}
                  </Link>
                )}
              </div>
              {task.description && !compact && <p className="mt-1 text-xs whitespace-pre-wrap text-muted-foreground">{task.description}</p>}
            </div>
            <div className="flex shrink-0">
              {onEdit && (
                <Button variant="ghost" size="icon-sm" aria-label={t("editTask")} onClick={() => onEdit(task)}>
                  <Pencil />
                </Button>
              )}
              <Button variant="ghost" size="icon-sm" aria-label={t("deleteTask")} onClick={() => void remove(task)}>
                <Trash2 className="text-muted-foreground" />
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
