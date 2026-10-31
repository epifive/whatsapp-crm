import type { Metadata } from "next";
import { requireOrg } from "@/lib/auth/session";
import { orgDb } from "@/lib/tenancy";
import { Inbox } from "./inbox";

export const metadata: Metadata = { title: "Inbox" };

export default async function InboxPage({ searchParams }: PageProps<"/app/inbox">) {
  const session = await requireOrg();
  const tdb = orgDb(session.org.id);
  const [members, accounts, canned] = await Promise.all([
    tdb.membership.findMany({ include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } }),
    tdb.whatsAppAccount.findMany({ select: { id: true, name: true, channel: true, phone: true, status: true }, orderBy: { createdAt: "asc" } }),
    tdb.cannedResponse.findMany({ select: { id: true, shortcut: true, title: true, body: true }, orderBy: { shortcut: "asc" } }),
  ]);
  const { c } = await searchParams;
  return (
    <Inbox
      ctx={{ me: { id: session.user.id, name: session.user.name }, members: members.map((m) => m.user), accounts, canned }}
      initialConversationId={typeof c === "string" ? c : null}
    />
  );
}
