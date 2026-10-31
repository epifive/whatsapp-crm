import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { UserInputError } from "@/lib/errors";
import { coerceFieldValue, FieldValueError, type FieldDef } from "./fields";

/**
 * Segment rules: a list of conditions combined with "all" (AND) or "any" (OR). Segments are
 * evaluated live, so a contact enters or leaves a segment as its data changes.
 */
const days = z.coerce.number().int().min(0).max(3650);

export const conditionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("tag"), op: z.enum(["has", "not_has"]), tagId: z.string().min(1) }),
  z.object({
    type: z.literal("field"),
    key: z.string().min(1),
    op: z.enum(["eq", "neq", "contains", "empty", "not_empty", "gt", "lt"]),
    value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  }),
  z.object({
    type: z.literal("attr"),
    attr: z.enum(["name", "phone", "email"]),
    op: z.enum(["contains", "starts_with", "empty", "not_empty"]),
    value: z.string().trim().max(100).optional(),
  }),
  z.object({ type: z.literal("opted_out"), value: z.boolean() }),
  z.object({ type: z.literal("opted_in"), value: z.boolean() }),
  z.object({ type: z.literal("created"), op: z.enum(["within_days", "older_than_days"]), days }),
  z.object({ type: z.literal("last_message"), op: z.enum(["within_days", "older_than_days", "never"]), days: days.optional() }),
  z.object({ type: z.literal("owner"), op: z.enum(["is", "unassigned"]), userId: z.string().optional() }),
  z.object({ type: z.literal("deal"), op: z.enum(["open", "won", "lost", "none"]) }),
]);

export const segmentFilterSchema = z.object({
  match: z.enum(["all", "any"]).default("all"),
  conditions: z.array(conditionSchema).max(20, "A segment can have up to 20 conditions.").default([]),
});

export type SegmentCondition = z.infer<typeof conditionSchema>;
export type SegmentFilter = z.infer<typeof segmentFilterSchema>;

export const segmentSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(80),
  description: z.string().trim().max(300).nullable().optional(),
  filter: segmentFilterSchema,
});

export class SegmentError extends UserInputError {}

const ago = (now: Date, d: number) => new Date(now.getTime() - d * 86_400_000);

// A JSON value that is missing, null or an empty string
function fieldEmpty(key: string): Prisma.ContactWhereInput {
  return { OR: [{ fields: { path: [key], equals: Prisma.AnyNull } }, { fields: { path: [key], equals: "" } }] };
}

function compileCondition(c: SegmentCondition, fields: Map<string, FieldDef>, now: Date): Prisma.ContactWhereInput {
  switch (c.type) {
    case "tag":
      return c.op === "has" ? { tags: { some: { tagId: c.tagId } } } : { tags: { none: { tagId: c.tagId } } };
    case "field": {
      const def = fields.get(c.key);
      if (!def) throw new SegmentError(`The field "${c.key}" no longer exists.`);
      if (c.op === "empty") return fieldEmpty(c.key);
      if (c.op === "not_empty") return { NOT: fieldEmpty(c.key) };
      let value;
      try {
        value = coerceFieldValue(def, c.value);
      } catch (err) {
        if (err instanceof FieldValueError) throw new SegmentError(err.message);
        throw err;
      }
      if (value === null) throw new SegmentError(`Enter a value for "${def.label}".`);
      const path = [c.key];
      if (c.op === "eq") return { fields: { path, equals: value } };
      // Contacts without the field also count as "not equal"
      if (c.op === "neq") return { OR: [{ NOT: { fields: { path, equals: value } } }, { fields: { path, equals: Prisma.AnyNull } }] };
      if (c.op === "contains") return { fields: { path, string_contains: String(value) } };
      if (def.type !== "NUMBER" && def.type !== "DATE") throw new SegmentError(`"${def.label}" can't be compared with greater/less than.`);
      return c.op === "gt" ? { fields: { path, gt: value } } : { fields: { path, lt: value } };
    }
    case "attr": {
      if (c.op === "empty") return c.attr === "phone" ? { phone: "" } : { OR: [{ [c.attr]: null }, { [c.attr]: "" }] };
      if (c.op === "not_empty") return c.attr === "phone" ? { NOT: { phone: "" } } : { AND: [{ NOT: { [c.attr]: null } }, { NOT: { [c.attr]: "" } }] };
      if (!c.value) throw new SegmentError("Enter a value to compare with.");
      const value = c.attr === "phone" ? c.value.replace(/\D/g, "") : c.value;
      return c.op === "contains"
        ? { [c.attr]: { contains: value, mode: "insensitive" } }
        : { [c.attr]: { startsWith: value, mode: "insensitive" } };
    }
    case "opted_out":
      return { optedOut: c.value };
    case "opted_in":
      return c.value ? { optedInAt: { not: null } } : { optedInAt: null };
    case "created":
      return c.op === "within_days" ? { createdAt: { gte: ago(now, c.days) } } : { createdAt: { lt: ago(now, c.days) } };
    case "last_message": {
      if (c.op === "never") return { conversations: { none: { lastInboundAt: { not: null } } } };
      const since = ago(now, c.days ?? 0);
      return c.op === "within_days"
        ? { conversations: { some: { lastInboundAt: { gte: since } } } }
        : { conversations: { none: { lastInboundAt: { gte: since } } } };
    }
    case "owner":
      if (c.op === "unassigned") return { ownerId: null };
      if (!c.userId) throw new SegmentError("Choose a team member.");
      return { ownerId: c.userId };
    case "deal":
      if (c.op === "none") return { deals: { none: {} } };
      return { deals: { some: { status: c.op === "open" ? "OPEN" : c.op === "won" ? "WON" : "LOST" } } };
  }
}

/** Prisma filter for a segment; combine it with the org scope (orgDb adds orgId) */
export function compileSegment(filter: SegmentFilter, fieldDefs: FieldDef[], now = new Date()): Prisma.ContactWhereInput {
  const fields = new Map(fieldDefs.map((f) => [f.key, f]));
  const parts = filter.conditions.map((c) => compileCondition(c, fields, now));
  if (parts.length === 0) return {};
  return filter.match === "any" ? { OR: parts } : { AND: parts };
}
