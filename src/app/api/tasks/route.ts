import { NextResponse } from "next/server";
import { parseBody, requireApiOrg, route } from "@/lib/api";
import { logActivity } from "@/lib/crm/activity";
import { assertContact, assertDeal, assertMember } from "@/lib/crm/guards";
import { taskBodySchema, taskInclude, taskQuerySchema, taskView, taskWhere } from "@/lib/crm/tasks";
import { publish } from "@/lib/realtime";
import { orgDb } from "@/lib/tenancy";

/** GET ?scope=mine|all&status=open|overdue|today|done[&contactId=|&dealId=] */
export const GET = route(async (req) => {
  const session = await requireApiOrg("AGENT");
  const params = Object.fromEntries(req.nextUrl.searchParams);
  const query = taskQuerySchema.parse(params);
  const tdb = orgDb(session.org.id);
  const where = taskWhere(query, session.user.id, session.org.timezone);
  const tasks = await tdb.task.findMany({
    where,
    include: taskInclude,
    orderBy:
      query.status === "done" ? [{ completedAt: "desc" }] : [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
    take: 200,
  });
  return NextResponse.json({ tasks: tasks.map(taskView) });
});

export const POST = route(async (req) => {
  const session = await requireApiOrg("AGENT");
  const input = await parseBody(req, taskBodySchema);
  const tdb = orgDb(session.org.id);
  const assigneeId = input.assigneeId === undefined ? session.user.id : input.assigneeId;
  await assertMember(tdb, assigneeId);
  await assertContact(tdb, input.contactId);
  const deal = await assertDeal(tdb, input.dealId);
  // A task on a deal also shows on the deal's contact
  const contactId = input.contactId ?? deal?.contactId ?? null;

  const task = await tdb.task.create({
    data: {
      orgId: session.org.id,
      title: input.title,
      description: input.description || null,
      dueAt: input.dueAt ?? null,
      assigneeId,
      createdById: session.user.id,
      contactId,
      dealId: input.dealId ?? null,
    },
    include: taskInclude,
  });
  await logActivity({ orgId: session.org.id, contactId, dealId: task.dealId, actorId: session.user.id, type: "task.created", data: { title: task.title } });
  if (assigneeId && assigneeId !== session.user.id) {
    await publish(`user:${assigneeId}`, "task.assigned", { taskId: task.id, orgId: session.org.id, title: task.title.slice(0, 200), by: session.user.name });
  }
  await publish(`org:${session.org.id}`, "tasks.changed", { taskId: task.id });
  return NextResponse.json({ task: taskView(task) }, { status: 201 });
});
