import { NextResponse } from "next/server";
import { ApiError, parseBody, requireApiOrg, route } from "@/lib/api";
import { cannedSchema } from "@/lib/canned";
import { orgDb } from "@/lib/tenancy";

export const GET = route(async () => {
  const session = await requireApiOrg("AGENT");
  const items = await orgDb(session.org.id).cannedResponse.findMany({ orderBy: { shortcut: "asc" } });
  return NextResponse.json({ items: items.map(({ id, shortcut, title, body }) => ({ id, shortcut, title, body })) });
});

export const POST = route(async (req) => {
  const session = await requireApiOrg("ADMIN");
  const input = await parseBody(req, cannedSchema);
  try {
    const item = await orgDb(session.org.id).cannedResponse.create({ data: { orgId: session.org.id, ...input } });
    return NextResponse.json({ item }, { status: 201 });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") throw new ApiError(409, `The shortcut /${input.shortcut} already exists.`);
    throw err;
  }
});
