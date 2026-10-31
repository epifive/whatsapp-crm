import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, parseBody, requireApiOrg, route } from "@/lib/api";
import { roleAtLeast } from "@/lib/auth/session";
import { logActivity } from "@/lib/crm/activity";
import { assertContact, assertDeal, assertMember } from "@/lib/crm/guards";
import { taskBodySchema, taskInclude, taskView } from "@/lib/crm/tasks";
import { publish } from "@/lib/realtime";
import { orgDb } from "@/lib/tenancy";
import type { Prisma } from "@/generated/prisma/client";

type Ctx = RouteContext<"/api/tasks/[id]">;

const patchBody = taskBodySchema.partial().extend({ completed: z.boolean().optional() });

export const PATCH = route<Ctx>(async (req, ctx) => {
  const session = await requireApiOrg("AGENT");
  const { id } = await ctx.params;
  const input = await parseBody(req, patchBody);
  const tdb = orgDb(session.org.id);
  const task = await tdb.task.findUnique({ where: { id } });
  if (!task) throw new ApiError(404, "Task not found.");
  if (input.assigneeId) await assertMember(tdb, input.assigneeId);
  if (input.contactId) await assertContact(tdb, input.contactId);
  if (input.dealId) await assertDeal(tdb, input.dealId);

  const data: Prisma.TaskUncheckedUpdateInput = {
    title: input.title,
    description: input.description,
    assigneeId: input.assigneeId,
    contactId: input.contactId,
    dealId: input.dealId,
  };
  if (input.dueAt !== undefined) {
    data.dueAt = input.dueAt;
    // A new due date gets a new reminder
    if (input.dueAt?.getTime() !== task.dueAt?.getTime()) data.reminderSentAt = null;
  }
  if (input.completed !== undefined && input.completed !== !!task.completedAt) data.completedAt = input.completed ? new Date() : null;

  const updated = await tdb.task.update({ where: { id }, data, include: taskInclude });
  if (input.completed && !task.completedAt) {
    await logActivity({ orgId: session.org.id, contactId: updated.contactId, dealId: updated.dealId, actorId: session.user.id, type: "task.completed", data: { title: updated.title } });
  }
  if (input.assigneeId && input.assigneeId !== task.assigneeId && input.assigneeId !== session.user.id) {
    await publish(`user:${input.assigneeId}`, "task.assigned", { taskId: id, orgId: session.org.id, title: updated.title.slice(0, 200), by: session.user.name });
  }
  await publish(`org:${session.org.id}`, "tasks.changed", { taskId: id });
  return NextResponse.json({ task: taskView(updated) });
});

/** The creator, the assignee or an admin can delete a task */
export const DELETE = route<Ctx>(async (_req, ctx) => {
  const session = await requireApiOrg("AGENT");
  const { id } = await ctx.params;
  const tdb = orgDb(session.org.id);
  const task = await tdb.task.findUnique({ where: { id } });
  if (!task) throw new ApiError(404, "Task not found.");
  if (![task.createdById, task.assigneeId].includes(session.user.id) && !roleAtLeast(session.role, "ADMIN")) {
    throw new ApiError(403, "Only the creator, the assignee or an admin can delete this task.");
  }
  await tdb.task.delete({ where: { id } });
  await publish(`org:${session.org.id}`, "tasks.changed", { taskId: id });
  return NextResponse.json({ ok: true });
});
