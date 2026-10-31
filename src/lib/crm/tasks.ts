import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { contactDisplayName } from "@/lib/inbox";
import { endOfDayIn } from "@/lib/time";

export const taskInclude = {
  assignee: { select: { id: true, name: true } },
  contact: { select: { id: true, phone: true, name: true, waName: true } },
  deal: { select: { id: true, title: true } },
} satisfies Prisma.TaskInclude;

type TaskRow = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

export function taskView(t: TaskRow) {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    dueAt: t.dueAt,
    completedAt: t.completedAt,
    assignee: t.assignee,
    contact: t.contact ? { id: t.contact.id, name: contactDisplayName(t.contact) } : null,
    deal: t.deal,
    createdAt: t.createdAt,
  };
}

export type TaskView = ReturnType<typeof taskView>;

export const taskBodySchema = z.object({
  title: z.string().trim().min(1, "Enter a title.").max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  dueAt: z.coerce.date().nullable().optional(),
  assigneeId: z.string().min(1).nullable().optional(),
  contactId: z.string().min(1).nullable().optional(),
  dealId: z.string().min(1).nullable().optional(),
});

export const taskQuerySchema = z.object({
  scope: z.enum(["mine", "all"]).default("mine"),
  status: z.enum(["open", "overdue", "today", "done"]).default("open"),
  contactId: z.string().optional(),
  dealId: z.string().optional(),
});

/** Filters for the task list; "today" ends at midnight in the workspace's time zone */
export function taskWhere(q: z.infer<typeof taskQuerySchema>, userId: string, timeZone: string, now = new Date()): Prisma.TaskWhereInput {
  const where: Prisma.TaskWhereInput = {};
  if (q.contactId) where.contactId = q.contactId;
  if (q.dealId) where.dealId = q.dealId;
  if (q.scope === "mine" && !q.contactId && !q.dealId) where.assigneeId = userId;
  if (q.status === "done") where.completedAt = { not: null };
  else where.completedAt = null;
  if (q.status === "overdue") where.dueAt = { lt: now };
  if (q.status === "today") {
    where.dueAt = { lte: endOfDayIn(timeZone, now) };
  }
  return where;
}
