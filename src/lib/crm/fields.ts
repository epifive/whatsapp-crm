import { z } from "zod";
import type { CustomFieldType } from "@/generated/prisma/client";
import { UserInputError } from "@/lib/errors";

export const FIELD_TYPES = ["TEXT", "NUMBER", "DATE", "BOOLEAN", "SELECT", "EMAIL", "URL"] as const satisfies readonly CustomFieldType[];

// Built-in contact attributes and template variables; custom fields can't shadow them
const RESERVED_KEYS = new Set(["id", "name", "first_name", "phone", "email", "tags", "owner", "wa_name", "created_at", "opted_in", "opted_out"]);

export const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

/** "Order #ID / Ref" -> "order_id_ref" */
export function fieldKeyFromLabel(label: string): string {
  const key = label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "f_$1")
    .slice(0, 40);
  return key || "field";
}

export const customFieldSchema = z
  .object({
    label: z.string().trim().min(1, "Enter a label.").max(60),
    key: z
      .string()
      .trim()
      .regex(FIELD_KEY_PATTERN, "Key: lowercase letters, digits and _ (start with a letter).")
      .refine((k) => !RESERVED_KEYS.has(k), "That key is reserved.")
      .optional(),
    type: z.enum(FIELD_TYPES),
    options: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
  })
  .refine((f) => f.type !== "SELECT" || f.options.length > 0, { message: "Add at least one choice.", path: ["options"] });

export function isReservedKey(key: string) {
  return RESERVED_KEYS.has(key);
}

export interface FieldDef {
  key: string;
  label: string;
  type: CustomFieldType;
  options: string[];
}

export type FieldValue = string | number | boolean;

export class FieldValueError extends UserInputError {}

const TRUE_WORDS = new Set(["true", "yes", "y", "1", "on"]);
const FALSE_WORDS = new Set(["false", "no", "n", "0", "off"]);

function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Turns user input (form, CSV cell, API) into the stored value for a field.
 * Returns null for "no value"; throws FieldValueError when the input doesn't fit the type.
 * Dates are stored as "YYYY-MM-DD" so they sort and compare as strings.
 */
export function coerceFieldValue(def: FieldDef, raw: unknown): FieldValue | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string" && raw.trim() === "") return null;
  const text = String(raw).trim();
  switch (def.type) {
    case "TEXT":
      return text.slice(0, 1000);
    case "NUMBER": {
      const n = typeof raw === "number" ? raw : Number(text.replace(/[,\s]/g, ""));
      if (!Number.isFinite(n)) throw new FieldValueError(`${def.label}: "${text}" is not a number.`);
      return n;
    }
    case "DATE": {
      const invalid = () => new FieldValueError(`${def.label}: "${text}" is not a valid date (use YYYY-MM-DD).`);
      const ymd = (y: number, mo: number, d: number) => {
        const date = new Date(Date.UTC(y, mo - 1, d));
        if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) throw invalid();
        return isoDate(date);
      };
      const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
      if (iso) return ymd(+iso[1]!, +iso[2]!, +iso[3]!);
      // 15/10/2026, 15.10.2026, 15-10-2026: day first (as in most of the world) unless that can't be
      const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
      if (dmy) {
        const [a, b, y] = [+dmy[1]!, +dmy[2]!, +dmy[3]!];
        return a <= 12 && b > 12 ? ymd(y, a, b) : ymd(y, b, a);
      }
      // "March 3, 2026", "3 Mar 2026": parsed in local time, so read it back the same way
      const d = new Date(text);
      if (Number.isNaN(d.getTime())) throw invalid();
      return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
    }
    case "BOOLEAN": {
      if (typeof raw === "boolean") return raw;
      const w = text.toLowerCase();
      if (TRUE_WORDS.has(w)) return true;
      if (FALSE_WORDS.has(w)) return false;
      throw new FieldValueError(`${def.label}: use yes or no.`);
    }
    case "SELECT": {
      const match = def.options.find((o) => o.toLowerCase() === text.toLowerCase());
      if (!match) throw new FieldValueError(`${def.label}: "${text}" is not one of the choices.`);
      return match;
    }
    case "EMAIL":
      if (!z.email().safeParse(text).success) throw new FieldValueError(`${def.label}: "${text}" is not a valid email.`);
      return text.toLowerCase().slice(0, 254);
    case "URL": {
      try {
        const u = new URL(text);
        if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
        return u.toString().slice(0, 1000);
      } catch {
        throw new FieldValueError(`${def.label}: "${text}" is not a valid web address.`);
      }
    }
  }
}

/**
 * Applies a partial update of custom field values to the stored object. Unknown keys are
 * rejected; null/empty clears a value.
 */
export function mergeFieldValues(defs: FieldDef[], current: unknown, patch: Record<string, unknown>): Record<string, FieldValue> {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const next: Record<string, FieldValue> = { ...((current && typeof current === "object" ? current : {}) as Record<string, FieldValue>) };
  for (const [key, raw] of Object.entries(patch)) {
    const def = byKey.get(key);
    if (!def) throw new FieldValueError(`Unknown field "${key}".`);
    const value = coerceFieldValue(def, raw);
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next;
}
