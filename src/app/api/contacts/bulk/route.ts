import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, clientIp, parseBody, requireApiOrg, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { roleAtLeast } from "@/lib/auth/session";
import { logActivity } from "@/lib/crm/activity";
import { contactQuerySchema, contactWhere, ensureTags } from "@/lib/crm/contacts";
import { assertMember } from "@/lib/crm/guards";
import { db } from "@/lib/db";
import { publish } from "@/lib/realtime";
import { orgDb } from "@/lib/tenancy";
import type { Prisma } from "@/generated/prisma/client";

const body = z
  .object({
    // Either explicit ids (selected rows) or every contact matching the list filters
    ids: z.array(z.string().min(1)).min(1).max(1000).optional(),
    query: contactQuerySchema.optional(),
    action: z.enum(["add_tag", "remove_tag", "set_owner", "opt_in", "opt_out", "delete"]),
    tag: z.string().trim().min(1).max(30).optional(),
    ownerId: z.string().min(1).nullable().optional(),
  })
  .refine((b) => b.ids || b.query, "Select contacts first.");

const ADMIN_ACTIONS = new Set(["opt_in", "delete"]);
const CHUNK = 2000;

/** Bulk actions on selected contacts or on everything matching the current filters */
export const POST = route(async (req) => {
  const session = await requireApiOrg("AGENT");
  const input = await parseBody(req, body);
  if (ADMIN_ACTIONS.has(input.action) && !roleAtLeast(session.role, "ADMIN")) throw new ApiError(403, "Only admins can do that.");
  const tdb = orgDb(session.org.id);
  const orgId = session.org.id;
  const where: Prisma.ContactWhereInput = input.ids ? { id: { in: input.ids } } : await contactWhere(tdb, input.query!);

  let affected = 0;
  if (input.action === "add_tag" || input.action === "remove_tag") {
    if (!input.tag) throw new ApiError(400, "Choose a tag.");
    const tag =
      input.action === "add_tag" ? (await ensureTags(tdb, orgId, [input.tag]))[0]! : await tdb.tag.findFirst({ where: { name: input.tag }, select: { id: true, name: true } });
    if (!tag) throw new ApiError(404, "Tag not found.");
    // Walk the matching ids in chunks so "all 50,000 contacts" stays within memory and query limits
    let cursor: string | undefined;
    for (;;) {
      const ids = (
        await tdb.contact.findMany({ where, select: { id: true }, orderBy: { id: "asc" }, take: CHUNK, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) })
      ).map((c) => c.id);
      if (!ids.length) break;
      cursor = ids[ids.length - 1];
      const res =
        input.action === "add_tag"
          ? await db.contactTag.createMany({ data: ids.map((contactId) => ({ contactId, tagId: tag.id })), skipDuplicates: true })
          : await db.contactTag.deleteMany({ where: { tagId: tag.id, contactId: { in: ids } } });
      affected += res.count;
      if (ids.length < CHUNK) break;
    }
  } else if (input.action === "set_owner") {
    await assertMember(tdb, input.ownerId);
    affected = (await tdb.contact.updateMany({ where, data: { ownerId: input.ownerId ?? null } })).count;
  } else if (input.action === "opt_out") {
    affected = (await tdb.contact.updateMany({ where: { AND: [where, { optedOut: false }] }, data: { optedOut: true, optedOutAt: new Date() } })).count;
  } else if (input.action === "opt_in") {
    // Records consent for contacts that haven't opted out; opted-out contacts stay opted out
    affected = (await tdb.contact.updateMany({ where: { AND: [where, { optedOut: false, optedInAt: null }] }, data: { optedInAt: new Date(), optInSource: "bulk" } })).count;
  } else if (input.action === "delete") {
    affected = (await tdb.contact.deleteMany({ where })).count;
    await audit({ action: "contacts.bulk_deleted", orgId, userId: session.user.id, meta: { count: affected, filter: input.query ?? null }, ip: clientIp(req) });
  }

  // Per-contact timeline entries for small selections; bulk runs over a filter skip them
  if (input.ids && affected && input.action !== "delete" && input.action !== "set_owner") {
    const type = input.action === "add_tag" ? "tag.added" : input.action === "remove_tag" ? "tag.removed" : input.action === "opt_in" ? "contact.opted_in" : "contact.opted_out";
    const ownIds = (await tdb.contact.findMany({ where: { id: { in: input.ids } }, select: { id: true } })).map((c) => c.id);
    await logActivity(ownIds.map((contactId) => ({ orgId, contactId, actorId: session.user.id, type, data: input.tag ? { tag: input.tag, bulk: true } : { via: "bulk" } })));
  }
  await publish(`org:${orgId}`, "contacts.changed");
  return NextResponse.json({ affected });
});
