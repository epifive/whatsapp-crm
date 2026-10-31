import { NextResponse } from "next/server";
import { ApiError, requireApiOrg, route } from "@/lib/api";
import { timeline } from "@/lib/crm/timeline";
import { orgDb } from "@/lib/tenancy";

/** GET ?before=<ISO date>: messages, notes and activity for one contact, newest first */
export const GET = route<RouteContext<"/api/contacts/[id]/timeline">>(async (req, ctx) => {
  const session = await requireApiOrg("AGENT");
  const { id } = await ctx.params;
  const tdb = orgDb(session.org.id);
  if (!(await tdb.contact.findUnique({ where: { id }, select: { id: true } }))) throw new ApiError(404, "Contact not found.");
  const before = req.nextUrl.searchParams.get("before");
  const beforeDate = before ? new Date(before) : undefined;
  if (beforeDate && Number.isNaN(beforeDate.getTime())) throw new ApiError(400, "Invalid cursor.");
  return NextResponse.json(await timeline(tdb, { contactId: id }, { before: beforeDate }));
});
