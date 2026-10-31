"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Field, FormMessage } from "@/components/forms";
import { NativeSelect } from "@/components/native-select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/client/api-client";
import { ContactPicker, type PickedContact } from "./contact-picker";
import { fromLocalInput, toLocalInput } from "./format";
import type { Member, TaskItem } from "./types";

/** Create (task = null) or edit a task. Contact/deal can be preset and locked. */
export function TaskDialog({
  open,
  onOpenChange,
  task,
  members,
  meId,
  contact,
  deal,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: TaskItem | null;
  members: Member[];
  meId: string;
  contact?: PickedContact | null;
  deal?: { id: string; title: string } | null;
  onSaved: () => void;
}) {
  const t = useTranslations("crm");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const lockedContact = contact !== undefined;
  const [picked, setPicked] = useState<PickedContact | null>(task?.contact ? { id: task.contact.id, name: task.contact.name, phone: "" } : null);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      title: f.get("title"),
      description: f.get("description") || null,
      dueAt: fromLocalInput(f.get("dueAt")),
      assigneeId: f.get("assigneeId") || null,
      ...(task ? {} : { contactId: (lockedContact ? contact?.id : picked?.id) ?? null, dealId: deal?.id ?? null }),
      ...(task && !lockedContact ? { contactId: picked?.id ?? null } : {}),
    };
    setPending(true);
    const res = task ? await apiFetch(`/api/tasks/${task.id}`, { method: "PATCH", body }) : await apiFetch("/api/tasks", { body });
    setPending(false);
    if (!res.ok) return setError(res.error);
    toast.success(task ? t("taskSaved") : t("taskCreated"));
    setError(null);
    onOpenChange(false);
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4" key={task?.id ?? "new"}>
          <DialogHeader>
            <DialogTitle>{task ? t("editTask") : t("newTask")}</DialogTitle>
          </DialogHeader>
          <FormMessage type="error">{error}</FormMessage>
          <Field id="title" label={t("taskTitle")} defaultValue={task?.title} required maxLength={200} placeholder={t("taskTitlePlaceholder")} autoFocus />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="dueAt" label={t("due")} type="datetime-local" defaultValue={toLocalInput(task?.dueAt)} />
            <div className="grid gap-1.5">
              <Label htmlFor="assigneeId">{t("assignee")}</Label>
              <NativeSelect id="assigneeId" name="assigneeId" defaultValue={task ? (task.assignee?.id ?? "") : meId}>
                <option value="">{t("unassigned")}</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id === meId ? t("me", { name: m.name }) : m.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
          {!lockedContact && !deal && (
            <div className="grid gap-1.5">
              <Label>{t("contact")}</Label>
              <ContactPicker value={picked} onChange={setPicked} />
            </div>
          )}
          {(contact || deal) && (
            <p className="text-sm text-muted-foreground">
              {deal ? t("forDeal", { title: deal.title }) : t("forContact", { name: contact!.name })}
            </p>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="description">{t("details")}</Label>
            <Textarea id="description" name="description" rows={3} maxLength={2000} defaultValue={task?.description ?? ""} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {t("save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
