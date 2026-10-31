import { NextResponse } from "next/server";
import { requireApiOrg, route } from "@/lib/api";
import { orgDb } from "@/lib/tenancy";

/** All tags with the number of contacts carrying each */
export const GET = route(async () => {
  const session = await requireApiOrg("AGENT");
  const tags = await orgDb(session.org.id).tag.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { contacts: true } } } });
  return NextResponse.json({ tags: tags.map((t) => ({ id: t.id, name: t.name, color: t.color, contacts: t._count.contacts })) });
});
