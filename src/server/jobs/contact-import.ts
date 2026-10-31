import { getEntitlements, usageOf } from "@/lib/billing/entitlements";
import { UNLIMITED } from "@/lib/billing/plans";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/crm/activity";
import { ensureTags, fieldDefs } from "@/lib/crm/contacts";
import { MAX_IMPORT_ROWS, parseCsv, splitTags } from "@/lib/crm/csv";
import { coerceFieldValue, FieldValueError, type FieldValue } from "@/lib/crm/fields";
import { importStartSchema } from "@/lib/crm/imports";
import { publish } from "@/lib/realtime";
import { deleteMedia, readMedia } from "@/lib/storage";
import { orgDb } from "@/lib/tenancy";
import { isValidPhone, normalizePhone } from "@/lib/whatsapp/phone";
import type { Prisma } from "@/generated/prisma/client";

const BATCH = 500;
const MAX_ERRORS = 100;

interface Row {
  rowNo: number;
  phone: string;
  name?: string;
  email?: string;
  fields: Record<string, FieldValue>;
  tags: string[];
}

/**
 * Worker handler for QUEUES.contactImport. Contacts are matched by phone, so re-running an
 * import (worker restart, retry) never creates duplicates.
 */
export async function processContactImport(data: { importId: string }) {
  const imp = await db.contactImport.findUnique({ where: { id: data.importId } });
  if (!imp || !["PENDING", "PROCESSING"].includes(imp.status)) return;
  const orgId = imp.orgId;
  const tdb = orgDb(orgId);
  const errors: { row: number; error: string }[] = [];
  const counts = { created: 0, updated: 0, skipped: 0, failed: 0, processedRows: 0 };
  const fail = (row: number, error: string) => {
    counts.failed++;
    if (errors.length < MAX_ERRORS) errors.push({ row, error });
  };
  const progress = async (extra: Prisma.ContactImportUpdateInput = {}) => {
    await db.contactImport.update({ where: { id: imp.id }, data: { ...counts, errors, ...extra } });
    await publish(`org:${orgId}`, "import.updated", { importId: imp.id });
  };

  try {
    const { mapping, options } = importStartSchema.parse({ mapping: imp.mapping, options: imp.options });
    const rows = parseCsv(await readMedia(imp.storageKey)).rows.slice(0, MAX_IMPORT_ROWS);
    await db.contactImport.update({ where: { id: imp.id }, data: { status: "PROCESSING", startedAt: new Date(), totalRows: rows.length } });

    const defs = new Map((await fieldDefs(tdb)).map((d) => [d.key, d]));
    const extraTagNames = options.tags;
    const now = new Date();
    const seen = new Set<string>();
    // New contacts stop at the plan's contact limit; existing ones are still updated
    const ent = await getEntitlements(orgId);
    let room = ent.limits.contacts === UNLIMITED ? Infinity : Math.max(0, ent.limits.contacts - (await usageOf(orgId, "contacts")));

    for (let start = 0; start < rows.length; start += BATCH) {
      const batch: Row[] = [];
      rows.slice(start, start + BATCH).forEach((cells, i) => {
        const rowNo = start + i + 2; // +1 for the header, +1 for 1-based numbering
        counts.processedRows++;
        const rec: Row = { rowNo, phone: "", fields: {}, tags: [] };
        try {
          mapping.forEach((target, col) => {
            const cell = cells[col] ?? "";
            if (target === "ignore" || cell === "") return;
            if (target === "phone") rec.phone = normalizePhone(cell, options.defaultCountryCode);
            else if (target === "name") rec.name = cell.slice(0, 100);
            else if (target === "email") {
              const email = cell.toLowerCase();
              if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new FieldValueError(`"${cell}" is not a valid email.`);
              rec.email = email;
            } else if (target === "tags") rec.tags.push(...splitTags(cell));
            else {
              const def = defs.get(target.slice("field:".length));
              if (!def) return; // field deleted after the mapping was chosen
              const value = coerceFieldValue(def, cell);
              if (value !== null) rec.fields[def.key] = value;
            }
          });
        } catch (err) {
          if (err instanceof FieldValueError) return fail(rowNo, err.message);
          throw err;
        }
        if (!rec.phone || !isValidPhone(rec.phone)) return fail(rowNo, rec.phone ? `"${cells[mapping.indexOf("phone")]}" is not a valid phone number.` : "Phone number is missing.");
        if (seen.has(rec.phone)) {
          counts.skipped++; // same number earlier in the file
          return;
        }
        seen.add(rec.phone);
        batch.push(rec);
      });
      if (!batch.length) {
        await progress();
        continue;
      }

      const existing = await tdb.contact.findMany({ where: { phone: { in: batch.map((r) => r.phone) } }, select: { id: true, phone: true, fields: true, optedOut: true, optedInAt: true } });
      const existingByPhone = new Map(existing.map((c) => [c.phone, c]));
      const freshAll = batch.filter((r) => !existingByPhone.has(r.phone));
      const fresh = freshAll.slice(0, Math.min(freshAll.length, room));
      for (const r of freshAll.slice(fresh.length)) fail(r.rowNo, "Not added: your plan's contact limit is reached.");

      if (fresh.length) {
        const created = await tdb.contact.createManyAndReturn({
          data: fresh.map((r) => ({
            orgId,
            phone: r.phone,
            name: r.name ?? null,
            email: r.email ?? null,
            fields: r.fields,
            source: "import",
            ...(options.markOptedIn ? { optedInAt: now, optInSource: "import" } : {}),
          })),
          skipDuplicates: true,
          select: { id: true, phone: true },
        });
        counts.created += created.length;
        room -= created.length;
        counts.skipped += fresh.length - created.length; // created meanwhile by an incoming message
        await logActivity(created.map((c) => ({ orgId, contactId: c.id, actorId: imp.createdById, type: "contact.created" as const, data: { source: "import", file: imp.fileName } })));
      }

      const toUpdate = options.updateExisting ? batch.filter((r) => existingByPhone.has(r.phone)) : [];
      if (!options.updateExisting) counts.skipped += batch.length - freshAll.length;
      if (toUpdate.length) {
        await db.$transaction(
          toUpdate.map((r) => {
            const cur = existingByPhone.get(r.phone)!;
            return db.contact.update({
              where: { id: cur.id },
              data: {
                ...(r.name ? { name: r.name } : {}),
                ...(r.email ? { email: r.email } : {}),
                fields: { ...((cur.fields ?? {}) as Record<string, FieldValue>), ...r.fields },
                ...(options.markOptedIn && !cur.optedOut && !cur.optedInAt ? { optedInAt: now, optInSource: "import" } : {}),
              },
            });
          }),
        );
        counts.updated += toUpdate.length;
      }

      // Tags: per-row tag columns plus the tags chosen for the whole import
      const touched = [...fresh, ...toUpdate];
      const tagNames = [...new Set([...extraTagNames, ...touched.flatMap((r) => r.tags)])];
      if (tagNames.length && touched.length) {
        const tags = new Map((await ensureTags(tdb, orgId, tagNames)).map((t) => [t.name, t.id]));
        const ids = new Map((await tdb.contact.findMany({ where: { phone: { in: touched.map((r) => r.phone) } }, select: { id: true, phone: true } })).map((c) => [c.phone, c.id]));
        const links = touched.flatMap((r) => {
          const contactId = ids.get(r.phone);
          if (!contactId) return [];
          return [...new Set([...extraTagNames, ...r.tags])].flatMap((name) => (tags.has(name) ? [{ contactId, tagId: tags.get(name)! }] : []));
        });
        if (links.length) await db.contactTag.createMany({ data: links, skipDuplicates: true });
      }
      await progress();
    }

    await progress({ status: "COMPLETED", finishedAt: new Date() });
    await deleteMedia(imp.storageKey).catch(() => null);
  } catch (err) {
    console.error(`[import] ${imp.id} failed:`, err);
    errors.unshift({ row: 0, error: "The import stopped because of an unexpected error. Rows before it were imported." });
    await progress({ status: "FAILED", finishedAt: new Date() });
  }
}
