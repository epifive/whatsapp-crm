import { NextResponse } from "next/server";
import { z } from "zod";
import { parseBody, requireApiOrg, route } from "@/lib/api";
import { contactInclude, contactView, fieldDefs } from "@/lib/crm/contacts";
import { compileSegment, segmentFilterSchema } from "@/lib/crm/segments";
import { orgDb } from "@/lib/tenancy";

/** Live count and a few sample contacts while editing segment rules */
export const POST = route(async (req) => {
  const session = await requireApiOrg("AGENT");
  const { filter } = await parseBody(req, z.object({ filter: segmentFilterSchema }));
  const tdb = orgDb(session.org.id);
  const where = compileSegment(filter, await fieldDefs(tdb));
  const [count, sample] = await Promise.all([
    tdb.contact.count({ where }),
    tdb.contact.findMany({ where, include: contactInclude, orderBy: { createdAt: "desc" }, take: 5 }),
  ]);
  return NextResponse.json({ count, sample: sample.map((c) => ({ id: c.id, name: contactView(c).name, phone: c.phone })) });
});
