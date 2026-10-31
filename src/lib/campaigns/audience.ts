import type { Prisma } from "@/generated/prisma/client";
import { fieldDefs } from "@/lib/crm/contacts";
import { compileSegment, segmentFilterSchema, SegmentError } from "@/lib/crm/segments";
import type { OrgDb } from "@/lib/tenancy";
import type { Audience } from "./schema";

// Who the audience is about, before consent rules
async function targetFilter(tdb: OrgDb, audience: Audience): Promise<Prisma.ContactWhereInput> {
  if (audience.type === "segment") {
    if (!audience.segmentId) throw new SegmentError("Choose a segment.");
    const segment = await tdb.segment.findUnique({ where: { id: audience.segmentId } });
    if (!segment) throw new SegmentError("The segment no longer exists.");
    return compileSegment(segmentFilterSchema.parse(segment.filter), await fieldDefs(tdb));
  }
  if (audience.type === "tags") {
    if (!audience.tagIds.length) throw new SegmentError("Choose at least one tag.");
    return { tags: { some: { tagId: { in: audience.tagIds } } } };
  }
  return {};
}

/** Contacts a campaign goes to (org scope comes from orgDb). Opted-out contacts never are. */
export async function audienceWhere(tdb: OrgDb, audience: Audience): Promise<Prisma.ContactWhereInput> {
  const consent: Prisma.ContactWhereInput = audience.consent === "opted_in" ? { optedOut: false, optedInAt: { not: null } } : { optedOut: false };
  return { AND: [await targetFilter(tdb, audience), consent] };
}

/** Audience size, plus how many matching contacts are left out because they opted out / never opted in */
export async function audienceCounts(tdb: OrgDb, audience: Audience) {
  const target = await targetFilter(tdb, audience);
  const [count, optedOut, matching] = await Promise.all([
    tdb.contact.count({ where: await audienceWhere(tdb, audience) }),
    tdb.contact.count({ where: { AND: [target, { optedOut: true }] } }),
    tdb.contact.count({ where: target }),
  ]);
  return { count, optedOut, withoutConsent: matching - optedOut - count };
}
