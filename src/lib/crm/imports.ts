import { z } from "zod";
import type { ContactImport } from "@/generated/prisma/client";

/**
 * Column mapping for a CSV import: one target per column. Targets are the built-in
 * attributes, "tags" (comma/semicolon separated), a custom field ("field:<key>") or "ignore".
 */
export const importTargetSchema = z.union([z.enum(["ignore", "phone", "name", "email", "tags"]), z.string().regex(/^field:[a-z][a-z0-9_]{0,39}$/)]);

export const importStartSchema = z.object({
  mapping: z.array(importTargetSchema).max(200),
  options: z.object({
    // Country code added to numbers written without one (e.g. 90000 12345 -> 91...)
    defaultCountryCode: z
      .string()
      .trim()
      .regex(/^\d{0,4}$/, "Country code: digits only, e.g. 91")
      .default(""),
    updateExisting: z.boolean().default(true),
    tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
    // Only tick when the people in the file agreed to receive WhatsApp messages
    markOptedIn: z.boolean().default(false),
  }),
});

export type ImportStart = z.infer<typeof importStartSchema>;

export function importView(i: ContactImport) {
  return {
    id: i.id,
    fileName: i.fileName,
    status: i.status,
    totalRows: i.totalRows,
    processedRows: i.processedRows,
    created: i.created,
    updated: i.updated,
    skipped: i.skipped,
    failed: i.failed,
    errors: i.errors as { row: number; error: string }[],
    createdAt: i.createdAt,
    finishedAt: i.finishedAt,
  };
}

/** Guesses the mapping from header names ("Mobile", "Full name", "E-mail", "Labels", custom field labels) */
export function guessMapping(header: string[], fields: { key: string; label: string }[]): string[] {
  const used = new Set<string>();
  return header.map((h) => {
    const n = h.toLowerCase().replace(/[^a-z0-9]/g, "");
    let target = "ignore";
    if (/^(phone|mobile|whatsapp|number|phonenumber|mobilenumber|whatsappnumber|contact|contactnumber|cell|msisdn)$/.test(n)) target = "phone";
    else if (/^(name|fullname|contactname|customername|firstname|customer)$/.test(n)) target = "name";
    else if (/^(email|emailaddress|mail)$/.test(n)) target = "email";
    else if (/^(tags|tag|labels|label|groups|group)$/.test(n)) target = "tags";
    else {
      const f = fields.find((x) => x.key.replace(/_/g, "") === n || x.label.toLowerCase().replace(/[^a-z0-9]/g, "") === n);
      if (f) target = `field:${f.key}`;
    }
    if (target !== "ignore" && target !== "tags" && used.has(target)) target = "ignore";
    used.add(target);
    return target;
  });
}
