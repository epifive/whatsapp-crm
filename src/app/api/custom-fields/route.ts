import { NextResponse } from "next/server";
import { ApiError, parseBody, requireApiOrg, route } from "@/lib/api";
import { fieldDefs } from "@/lib/crm/contacts";
import { customFieldSchema, fieldKeyFromLabel, isReservedKey } from "@/lib/crm/fields";
import { isUniqueViolation } from "@/lib/crm/guards";
import { orgDb } from "@/lib/tenancy";

const MAX_FIELDS = 50;

export const GET = route(async () => {
  const session = await requireApiOrg("AGENT");
  const tdb = orgDb(session.org.id);
  const fields = await tdb.customField.findMany({ orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
  return NextResponse.json({ fields: fields.map(({ id, key, label, type, options }) => ({ id, key, label, type, options })) });
});

export const POST = route(async (req) => {
  const session = await requireApiOrg("ADMIN");
  const input = await parseBody(req, customFieldSchema);
  const tdb = orgDb(session.org.id);
  const existing = await fieldDefs(tdb);
  if (existing.length >= MAX_FIELDS) throw new ApiError(400, `You can have up to ${MAX_FIELDS} custom fields.`);

  let key = input.key;
  if (!key) {
    // Derive a free key from the label: "City" -> city, city_2, ...
    const base = fieldKeyFromLabel(input.label);
    const start = isReservedKey(base) ? `${base}_1` : base;
    key = start;
    for (let n = 2; existing.some((f) => f.key === key); n++) key = `${base}_${n}`;
  }
  try {
    const field = await tdb.customField.create({
      data: { orgId: session.org.id, key, label: input.label, type: input.type, options: input.type === "SELECT" ? input.options : [], position: existing.length },
    });
    return NextResponse.json({ field: { id: field.id, key: field.key, label: field.label, type: field.type, options: field.options } }, { status: 201 });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApiError(409, `The key "${key}" is already used by another field.`);
    throw err;
  }
});
