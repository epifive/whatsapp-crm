import type { OrgDb } from "@/lib/tenancy";
import { contactInclude, contactView } from "./contacts";
import { dealInclude, dealView } from "./pipelines";
import { taskInclude, taskView } from "./tasks";

/** Everything the contact page shows besides the timeline */
export async function contactDetail(tdb: OrgDb, id: string) {
  const contact = await tdb.contact.findUnique({ where: { id }, include: contactInclude });
  if (!contact) return null;
  const [conversations, deals, tasks] = await Promise.all([
    tdb.conversation.findMany({
      where: { contactId: id },
      select: { id: true, status: true, lastMessageAt: true, account: { select: { id: true, name: true, channel: true } } },
      orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
    }),
    tdb.deal.findMany({ where: { contactId: id }, include: dealInclude, orderBy: [{ status: "asc" }, { updatedAt: "desc" }], take: 50 }),
    tdb.task.findMany({ where: { contactId: id, completedAt: null }, include: taskInclude, orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }], take: 50 }),
  ]);
  return { contact: contactView(contact), conversations, deals: deals.map(dealView), tasks: tasks.map(taskView) };
}
