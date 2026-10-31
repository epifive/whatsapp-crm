import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, parseBody, requireApiOrg, route } from "@/lib/api";
import { publish } from "@/lib/realtime";
import { orgDb } from "@/lib/tenancy";

const body = z.object({ body: z.string().trim().min(1, "Write a note.").max(4000) });

/** Internal note on a contact's timeline */
export const POST = route<RouteContext<"/api/contacts/[id]/notes">>(async (req, ctx) => {
  const session = await requireApiOrg("AGENT");
  const { id } = await ctx.params;
  const input = await parseBody(req, body);
  const tdb = orgDb(session.org.id);
  if (!(await tdb.contact.findUnique({ where: { id }, select: { id: true } }))) throw new ApiError(404, "Contact not found.");
  const note = await tdb.note.create({ data: { orgId: session.org.id, contactId: id, authorId: session.user.id, body: input.body } });
  await publish(`org:${session.org.id}`, "contact.updated", { contactId: id });
  return NextResponse.json({ note: { id: note.id, body: note.body, createdAt: note.createdAt, author: session.user.name } }, { status: 201 });
});
