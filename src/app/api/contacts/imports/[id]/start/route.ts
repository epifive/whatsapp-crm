import { assertLimit } from "@/lib/billing/entitlements";
import { NextResponse } from "next/server";
import { ApiError, clientIp, parseBody, requireApiOrg, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { fieldDefs } from "@/lib/crm/contacts";
import { importStartSchema, importView } from "@/lib/crm/imports";
import { orgDb } from "@/lib/tenancy";
import { enqueue, QUEUES } from "@/server/queue";

/** Step 2: confirm the column mapping and options; the worker does the rest */
export const POST = route<RouteContext<"/api/contacts/imports/[id]/start">>(async (req, ctx) => {
  const session = await requireApiOrg("ADMIN");
  const { id } = await ctx.params;
  const input = await parseBody(req, importStartSchema);
  const tdb = orgDb(session.org.id);
  const imp = await tdb.contactImport.findUnique({ where: { id } });
  if (!imp) throw new ApiError(404, "Import not found.");
  if (imp.status !== "DRAFT") throw new ApiError(409, "This import has already started.");
  // Room for at least one new contact (the import stops adding new ones at the limit)
  if (!input.options.updateExisting) await assertLimit(session.org.id, "contacts");

  const targets = input.mapping.filter((t) => t !== "ignore");
  if (targets.filter((t) => t === "phone").length !== 1) throw new ApiError(400, "Choose exactly one column for the phone number.");
  const single = targets.filter((t) => t !== "tags");
  if (new Set(single).size !== single.length) throw new ApiError(400, "Each field can only be filled from one column.");
  const keys = new Set((await fieldDefs(tdb)).map((d) => d.key));
  const unknown = targets.find((t) => t.startsWith("field:") && !keys.has(t.slice(6)));
  if (unknown) throw new ApiError(400, `The custom field "${unknown.slice(6)}" doesn't exist.`);

  // Only one start wins if the button is pressed twice
  const { count } = await tdb.contactImport.updateMany({ where: { id, status: "DRAFT" }, data: { status: "PENDING", mapping: input.mapping, options: input.options } });
  if (!count) throw new ApiError(409, "This import has already started.");
  await enqueue(QUEUES.contactImport, { importId: id }, { singletonKey: id });
  await audit({ action: "contacts.import_started", orgId: session.org.id, userId: session.user.id, targetType: "import", targetId: id, meta: { fileName: imp.fileName, markOptedIn: input.options.markOptedIn }, ip: clientIp(req) });
  return NextResponse.json({ import: importView({ ...imp, status: "PENDING" }) });
});
