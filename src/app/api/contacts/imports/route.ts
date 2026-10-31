import { NextResponse } from "next/server";
import { ApiError, clientIp, requireApiOrg, route } from "@/lib/api";
import { audit } from "@/lib/audit";
import { fieldDefs } from "@/lib/crm/contacts";
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, parseCsv } from "@/lib/crm/csv";
import { guessMapping, importView } from "@/lib/crm/imports";
import { saveMedia } from "@/lib/storage";
import { orgDb } from "@/lib/tenancy";

/** Recent imports */
export const GET = route(async () => {
  const session = await requireApiOrg("ADMIN");
  const imports = await orgDb(session.org.id).contactImport.findMany({ where: { status: { not: "DRAFT" } }, orderBy: { createdAt: "desc" }, take: 20 });
  return NextResponse.json({ imports: imports.map(importView) });
});

/** Step 1: upload a CSV. Returns its columns, a preview and a suggested mapping. */
export const POST = route(async (req) => {
  const session = await requireApiOrg("ADMIN");
  const form = await req.formData().catch(() => {
    throw new ApiError(400, "Upload a CSV file.");
  });
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw new ApiError(400, "Upload a CSV file.");
  if (file.size > MAX_IMPORT_BYTES) throw new ApiError(400, "The file is larger than 10 MB. Split it into smaller files.");
  if (!/\.(csv|txt)$/i.test(file.name)) throw new ApiError(400, "Upload a .csv file (in Excel: File › Save As › CSV UTF-8).");

  const data = Buffer.from(await file.arrayBuffer());
  const { header, rows } = parseCsv(data);
  if (!header.length || !rows.length) throw new ApiError(400, "The file has no rows. The first row should contain column names.");
  if (rows.length > MAX_IMPORT_ROWS) throw new ApiError(400, `The file has more than ${MAX_IMPORT_ROWS.toLocaleString("en")} rows. Split it into smaller files.`);
  if (header.length > 200) throw new ApiError(400, "The file has too many columns.");

  const tdb = orgDb(session.org.id);
  const { storageKey } = await saveMedia(session.org.id, data, "text/csv", "import.csv");
  const fileName = file.name.slice(0, 200);
  const defs = await fieldDefs(tdb);
  const mapping = guessMapping(header, defs);
  const imp = await tdb.contactImport.create({
    data: { orgId: session.org.id, createdById: session.user.id, fileName, storageKey, mapping, options: {}, totalRows: rows.length },
  });
  await audit({ action: "contacts.import_uploaded", orgId: session.org.id, userId: session.user.id, targetType: "import", targetId: imp.id, meta: { fileName, rows: rows.length }, ip: clientIp(req) });
  return NextResponse.json({ import: importView(imp), header, preview: rows.slice(0, 5), mapping, fields: defs }, { status: 201 });
});
