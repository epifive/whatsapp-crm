import type { Metadata } from "next";
import { requireOrg } from "@/lib/auth/session";
import { orgDb } from "@/lib/tenancy";
import { TasksView } from "./tasks-view";

export const metadata: Metadata = { title: "Tasks" };

export default async function TasksPage() {
  const session = await requireOrg();
  const members = await orgDb(session.org.id).membership.findMany({ include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } });
  return <TasksView members={members.map((m) => m.user)} meId={session.user.id} />;
}
