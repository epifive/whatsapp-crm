"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRealtime } from "@/lib/client/realtime";

interface TaskEvent {
  taskId: string;
  orgId: string;
  title: string;
  by?: string;
}

/** In-app pop-ups for task reminders and tasks a teammate assigned to you (current workspace only) */
export function CrmNotifications({ orgId }: { orgId: string }) {
  const t = useTranslations("crm");
  const router = useRouter();
  const open = { label: t("open"), onClick: () => router.push("/app/tasks") };

  useRealtime<TaskEvent>("task.reminder", (ev) => {
    if (ev.orgId !== orgId) return;
    toast(t("reminderToast"), { description: ev.title, action: open, duration: 15_000 });
  });
  useRealtime<TaskEvent>("task.assigned", (ev) => {
    if (ev.orgId !== orgId) return;
    toast(t("assignedToast", { name: ev.by ?? "" }), { description: ev.title, action: open });
  });
  return null;
}
