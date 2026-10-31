import { NextResponse } from "next/server";
import { ApiError, parseBody, requireApiOrg, route } from "@/lib/api";
import { fieldDefs } from "@/lib/crm/contacts";
import { isUniqueViolation } from "@/lib/crm/guards";
import { compileSegment, segmentFilterSchema, segmentSchema, SegmentError } from "@/lib/crm/segments";
import { orgDb } from "@/lib/tenancy";

const MAX_SEGMENTS = 100;

/** Segments with their current number of contacts */
export const GET = route(async () => {
  const session = await requireApiOrg("AGENT");
  const tdb = orgDb(session.org.id);
  const [segments, defs] = await Promise.all([tdb.segment.findMany({ orderBy: { name: "asc" } }), fieldDefs(tdb)]);
  const withCounts = await Promise.all(
    segments.map(async (s) => {
      let count: number | null = null;
      let error: string | null = null;
      try {
        count = await tdb.contact.count({ where: compileSegment(segmentFilterSchema.parse(s.filter), defs) });
      } catch (err) {
        if (!(err instanceof SegmentError)) throw err;
        error = err.message; // e.g. a field used by the segment was deleted
      }
      return { id: s.id, name: s.name, description: s.description, filter: s.filter, count, error, updatedAt: s.updatedAt };
    }),
  );
  return NextResponse.json({ segments: withCounts });
});

export const POST = route(async (req) => {
  const session = await requireApiOrg("ADMIN");
  const input = await parseBody(req, segmentSchema);
  const tdb = orgDb(session.org.id);
  if ((await tdb.segment.count()) >= MAX_SEGMENTS) throw new ApiError(400, `You can have up to ${MAX_SEGMENTS} segments.`);
  compileSegment(input.filter, await fieldDefs(tdb)); // validates values against the field types
  try {
    const segment = await tdb.segment.create({ data: { orgId: session.org.id, name: input.name, description: input.description ?? null, filter: input.filter } });
    return NextResponse.json({ segment: { id: segment.id, name: segment.name } }, { status: 201 });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApiError(409, "A segment with this name already exists.");
    throw err;
  }
});
