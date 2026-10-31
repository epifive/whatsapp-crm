import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { contactDisplayName } from "@/lib/inbox";
import type { OrgDb } from "@/lib/tenancy";
import { compileSegment, segmentFilterSchema, SegmentError } from "./segments";
import type { FieldDef } from "./fields";

export const contactInclude = {
  tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
  owner: { select: { id: true, name: true } },
} satisfies Prisma.ContactInclude;

type ContactRow = Prisma.ContactGetPayload<{ include: typeof contactInclude }>;

export function contactView(c: ContactRow) {
  return {
    id: c.id,
    phone: c.phone,
    name: contactDisplayName(c),
    savedName: c.name,
    waName: c.waName,
    email: c.email,
    optedOut: c.optedOut,
    optedOutAt: c.optedOutAt,
    optedInAt: c.optedInAt,
    optInSource: c.optInSource,
    source: c.source,
    owner: c.owner,
    fields: (c.fields ?? {}) as Record<string, string | number | boolean>,
    tags: c.tags.map((t) => t.tag),
    createdAt: c.createdAt,
  };
}

export type ContactView = ReturnType<typeof contactView>;

export const contactBodySchema = z.object({
  name: z.string().trim().max(100).nullable().optional(),
  phone: z.string().trim().min(1, "Enter a phone number.").max(30),
  email: z.union([z.email("Enter a valid email address.").trim().toLowerCase().max(254), z.literal(""), z.null()]).optional(),
  ownerId: z.string().min(1).nullable().optional(),
  fields: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(50).optional(),
  optedIn: z.boolean().optional(),
});

/** Query-string filters shared by the contact list, bulk actions and CSV export */
export const contactQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  tagId: z.string().optional(),
  segmentId: z.string().optional(),
  ownerId: z.string().optional(), // a user id, or "none"
  consent: z.enum(["opted_in", "opted_out", "unknown"]).optional(),
});

export type ContactQuery = z.infer<typeof contactQuerySchema>;

export function parseContactQuery(params: URLSearchParams): ContactQuery {
  const raw: Record<string, string> = {};
  for (const key of ["q", "tagId", "segmentId", "ownerId", "consent"]) {
    const v = params.get(key);
    if (v) raw[key] = v;
  }
  return contactQuerySchema.parse(raw);
}

/** Prisma filter for the contact list filters (orgDb adds the workspace scope) */
export async function contactWhere(tdb: OrgDb, query: ContactQuery): Promise<Prisma.ContactWhereInput> {
  const and: Prisma.ContactWhereInput[] = [];
  if (query.q) {
    const digits = query.q.replace(/\D/g, "");
    and.push({
      OR: [
        { name: { contains: query.q, mode: "insensitive" } },
        { waName: { contains: query.q, mode: "insensitive" } },
        { email: { contains: query.q, mode: "insensitive" } },
        ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
      ],
    });
  }
  if (query.tagId) and.push({ tags: { some: { tagId: query.tagId } } });
  if (query.ownerId) and.push({ ownerId: query.ownerId === "none" ? null : query.ownerId });
  if (query.consent === "opted_out") and.push({ optedOut: true });
  if (query.consent === "opted_in") and.push({ optedOut: false, optedInAt: { not: null } });
  if (query.consent === "unknown") and.push({ optedOut: false, optedInAt: null });
  if (query.segmentId) {
    const segment = await tdb.segment.findUnique({ where: { id: query.segmentId } });
    if (!segment) throw new SegmentError("Segment not found.");
    and.push(compileSegment(segmentFilterSchema.parse(segment.filter), await fieldDefs(tdb)));
  }
  return and.length ? { AND: and } : {};
}

export async function fieldDefs(tdb: OrgDb): Promise<FieldDef[]> {
  return tdb.customField.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { key: true, label: true, type: true, options: true } });
}

const TAG_COLORS = ["#16a34a", "#2563eb", "#9333ea", "#db2777", "#ea580c", "#ca8a04", "#0891b2", "#4b5563"];

/** Finds or creates tags by name (case-sensitive names, unique per workspace) */
export async function ensureTags(tdb: OrgDb, orgId: string, names: string[]): Promise<{ id: string; name: string; color: string }[]> {
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (!unique.length) return [];
  const existing = await tdb.tag.findMany({ where: { name: { in: unique } } });
  const missing = unique.filter((n) => !existing.some((t) => t.name === n));
  if (missing.length) {
    const count = await tdb.tag.count();
    await tdb.tag.createMany({
      data: missing.map((name, i) => ({ orgId, name, color: TAG_COLORS[(count + i) % TAG_COLORS.length]! })),
      skipDuplicates: true,
    });
  }
  return tdb.tag.findMany({ where: { name: { in: unique } }, select: { id: true, name: true, color: true } });
}

export function tagColor(index: number) {
  return TAG_COLORS[index % TAG_COLORS.length]!;
}
