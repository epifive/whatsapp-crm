import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, clientIp, parseBody, requireApiOrg, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { roleAtLeast } from "@/lib/auth/session";
import { logActivity, type ActivityInput } from "@/lib/crm/activity";
import { contactDetail } from "@/lib/crm/contact-detail";
import { contactBodySchema, fieldDefs } from "@/lib/crm/contacts";
import { mergeFieldValues } from "@/lib/crm/fields";
import { assertMember, isUniqueViolation } from "@/lib/crm/guards";
import { publish } from "@/lib/realtime";
import { orgDb } from "@/lib/tenancy";
import { isValidPhone, normalizePhone } from "@/lib/whatsapp/phone";
import type { Prisma } from "@/generated/prisma/client";

type Ctx = RouteContext<"/api/contacts/[id]">;

export const GET = route<Ctx>(async (_req, ctx) => {
  const session = await requireApiOrg("AGENT");
  const { id } = await ctx.params;
  const detail = await contactDetail(orgDb(session.org.id), id);
  if (!detail) throw new ApiError(404, "Contact not found.");
  return NextResponse.json(detail);
});

const patchBody = contactBodySchema.omit({ tags: true, optedIn: true }).partial().extend({
  optedIn: z.boolean().optional(),
  optedOut: z.boolean().optional(),
});

export const PATCH = route<Ctx>(async (req, ctx) => {
  const session = await requireApiOrg("AGENT");
  const { id } = await ctx.params;
  const input = await parseBody(req, patchBody);
  const tdb = orgDb(session.org.id);
  const current = await tdb.contact.findUnique({ where: { id } });
  if (!current) throw new ApiError(404, "Contact not found.");

  const data: Prisma.ContactUpdateInput = {};
  const changed: string[] = [];
  const activities: ActivityInput[] = [];
  const base = { orgId: session.org.id, contactId: id, actorId: session.user.id };

  if (input.name !== undefined && (input.name || null) !== current.name) {
    data.name = input.name || null;
    changed.push("name");
  }
  if (input.email !== undefined && (input.email || null) !== current.email) {
    data.email = input.email || null;
    changed.push("email");
  }
  if (input.phone !== undefined) {
    const phone = normalizePhone(input.phone);
    if (!isValidPhone(phone)) throw new ApiError(400, "Enter the phone number with country code, e.g. +91 90000 12345.");
    if (phone !== current.phone) {
      data.phone = phone;
      changed.push("phone");
    }
  }
  if (input.fields) {
    data.fields = mergeFieldValues(await fieldDefs(tdb), current.fields, input.fields);
    changed.push(...Object.keys(input.fields));
  }
  if (input.ownerId !== undefined && input.ownerId !== current.ownerId) {
    await assertMember(tdb, input.ownerId);
    data.owner = input.ownerId ? { connect: { id: input.ownerId } } : { disconnect: true };
    activities.push({ ...base, type: "contact.owner_changed", data: { ownerId: input.ownerId } });
  }
  if (input.optedIn !== undefined && input.optedIn !== !!current.optedInAt) {
    data.optedInAt = input.optedIn ? new Date() : null;
    data.optInSource = input.optedIn ? "manual" : null;
    if (input.optedIn) activities.push({ ...base, type: "contact.opted_in", data: { via: "manual" } });
  }
  if (input.optedOut !== undefined && input.optedOut !== current.optedOut) {
    // Re-subscribing someone who said STOP is a consent decision: admins only
    if (!input.optedOut && !roleAtLeast(session.role, "ADMIN")) throw new ApiError(403, "Only admins can re-subscribe an opted-out contact.");
    data.optedOut = input.optedOut;
    data.optedOutAt = input.optedOut ? new Date() : null;
    activities.push({ ...base, type: input.optedOut ? "contact.opted_out" : "contact.opted_in", data: { via: "manual" } });
  }
  if (changed.length) activities.push({ ...base, type: "contact.updated", data: { fields: changed } });

  try {
    await tdb.contact.update({ where: { id }, data });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApiError(409, "Another contact already has this phone number.");
    throw err;
  }
  await logActivity(activities);
  await publish(`org:${session.org.id}`, "contact.updated", { contactId: id });
  return NextResponse.json(await contactDetail(tdb, id));
});

export const DELETE = route<Ctx>(async (req, ctx) => {
  const session = await requireApiOrg("ADMIN");
  const { id } = await ctx.params;
  const tdb = orgDb(session.org.id);
  const contact = await tdb.contact.findUnique({ where: { id }, select: { id: true, phone: true } });
  if (!contact) throw new ApiError(404, "Contact not found.");
  // Conversations, messages, notes and tasks go with the contact; deals stay without a contact
  await tdb.contact.delete({ where: { id } });
  await audit({ action: "contact.deleted", orgId: session.org.id, userId: session.user.id, targetType: "contact", targetId: id, meta: { phone: contact.phone }, ip: clientIp(req) });
  await publish(`org:${session.org.id}`, "contacts.changed");
  return NextResponse.json({ ok: true });
});
