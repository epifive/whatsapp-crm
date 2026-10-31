import { assertLimit } from "@/lib/billing/entitlements";
import { NextResponse } from "next/server";
import { ApiError, parseBody, requireApiOrg, route } from "@/lib/api";
import { logActivity } from "@/lib/crm/activity";
import { contactBodySchema, contactInclude, contactView, contactWhere, ensureTags, fieldDefs, parseContactQuery } from "@/lib/crm/contacts";
import { mergeFieldValues } from "@/lib/crm/fields";
import { assertMember, isUniqueViolation } from "@/lib/crm/guards";
import { db } from "@/lib/db";
import { publish } from "@/lib/realtime";
import { emitEvent } from "@/lib/webhooks";
import { orgDb } from "@/lib/tenancy";
import { isValidPhone, normalizePhone } from "@/lib/whatsapp/phone";

const PAGE = 50;

/** Contact list: filters (q, tagId, segmentId, ownerId, consent), newest first, cursor paging */
export const GET = route(async (req) => {
  const session = await requireApiOrg("AGENT");
  const tdb = orgDb(session.org.id);
  const params = req.nextUrl.searchParams;
  const where = await contactWhere(tdb, parseContactQuery(params));
  const cursor = params.get("cursor");
  const [rows, total] = await Promise.all([
    tdb.contact.findMany({
      where,
      include: contactInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAGE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    }),
    tdb.contact.count({ where }),
  ]);
  const page = rows.slice(0, PAGE);
  return NextResponse.json({ contacts: page.map(contactView), total, nextCursor: rows.length > PAGE ? page[page.length - 1]!.id : null });
});

export const POST = route(async (req) => {
  const session = await requireApiOrg("AGENT");
  const input = await parseBody(req, contactBodySchema);
  const tdb = orgDb(session.org.id);
  const phone = normalizePhone(input.phone);
  if (!isValidPhone(phone)) throw new ApiError(400, "Enter the phone number with country code, e.g. +91 90000 12345.");
  await assertMember(tdb, input.ownerId);
  const fields = input.fields ? mergeFieldValues(await fieldDefs(tdb), {}, input.fields) : {};

  const existing = await tdb.contact.findUnique({ where: { orgId_phone: { orgId: session.org.id, phone } }, select: { id: true } });
  if (existing) throw new ApiError(409, "A contact with this phone number already exists.", "duplicate");
  await assertLimit(session.org.id, "contacts");

  let contact;
  try {
    contact = await tdb.contact.create({
      data: {
        orgId: session.org.id,
        phone,
        name: input.name || null,
        email: input.email || null,
        ownerId: input.ownerId ?? null,
        fields,
        source: "manual",
        ...(input.optedIn ? { optedInAt: new Date(), optInSource: "manual" } : {}),
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApiError(409, "A contact with this phone number already exists.");
    throw err;
  }
  if (input.tags?.length) {
    const tags = await ensureTags(tdb, session.org.id, input.tags);
    await db.contactTag.createMany({ data: tags.map((t) => ({ contactId: contact.id, tagId: t.id })), skipDuplicates: true });
  }
  await logActivity({ orgId: session.org.id, contactId: contact.id, actorId: session.user.id, type: "contact.created", data: { source: "manual" } });
  await emitEvent(session.org.id, "contact.created", { contact: { id: contact.id, phone: contact.phone, name: contact.name, source: "manual" } });
  await publish(`org:${session.org.id}`, "contacts.changed");
  const full = await tdb.contact.findUniqueOrThrow({ where: { id: contact.id }, include: contactInclude });
  return NextResponse.json({ contact: contactView(full) }, { status: 201 });
});
