import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { sendTemplateEmail } from "@/lib/email-templates";
import { publish } from "@/lib/realtime";

/**
 * Worker cron (every minute): reminds assignees of tasks that just fell due, in the app and by
 * email. Each task is claimed with one UPDATE, so two workers never remind twice. Tasks more
 * than a day overdue when first seen (e.g. the worker was down) are marked without a reminder.
 */
export async function processTaskReminders(now = new Date()) {
  const dayAgo = new Date(now.getTime() - 86_400_000);
  const due = await db.$queryRaw<{ id: string; orgId: string; title: string; assigneeId: string; dueAt: Date }[]>`
    UPDATE "Task" SET "reminderSentAt" = ${now}
    WHERE "completedAt" IS NULL AND "reminderSentAt" IS NULL AND "assigneeId" IS NOT NULL AND "dueAt" <= ${now}
    RETURNING id, "orgId", title, "assigneeId", "dueAt"`;

  for (const task of due) {
    if (task.dueAt < dayAgo) continue;
    try {
      await publish(`user:${task.assigneeId}`, "task.reminder", { taskId: task.id, orgId: task.orgId, title: task.title.slice(0, 200) });
      const user = await db.user.findUnique({ where: { id: task.assigneeId }, select: { email: true, name: true } });
      const org = await db.organization.findUnique({ where: { id: task.orgId }, select: { name: true } });
      if (user && org) {
        await sendTemplateEmail("task_due", {
          to: user.email,
          vars: { task: task.title.slice(0, 80), workspace: org.name },
          url: `${env().APP_URL}/app/tasks`,
          footer: "You get these reminders for tasks assigned to you.",
        });
      }
    } catch (err) {
      console.error(`[tasks] reminder for ${task.id} failed:`, err);
    }
  }
  return due.length;
}
