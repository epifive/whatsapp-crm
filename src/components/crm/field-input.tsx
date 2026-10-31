"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/native-select";
import type { FieldDefItem } from "./types";

/** Form control for one custom field; the value is submitted under `field:<key>` */
export function FieldInput({ def, value, disabled }: { def: FieldDefItem; value: string | number | boolean | undefined; disabled?: boolean }) {
  const t = useTranslations("crm");
  const name = `field:${def.key}`;
  const id = `field-${def.key}`;
  switch (def.type) {
    case "BOOLEAN":
      return (
        <NativeSelect id={id} name={name} defaultValue={value === undefined ? "" : value ? "yes" : "no"} disabled={disabled}>
          <option value="">—</option>
          <option value="yes">{t("yes")}</option>
          <option value="no">{t("no")}</option>
        </NativeSelect>
      );
    case "SELECT":
      return (
        <NativeSelect id={id} name={name} defaultValue={value === undefined ? "" : String(value)} disabled={disabled}>
          <option value="">—</option>
          {def.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </NativeSelect>
      );
    case "NUMBER":
      return <Input id={id} name={name} type="number" step="any" defaultValue={value === undefined ? "" : String(value)} disabled={disabled} />;
    case "DATE":
      return <Input id={id} name={name} type="date" defaultValue={value === undefined ? "" : String(value)} disabled={disabled} />;
    case "EMAIL":
      return <Input id={id} name={name} type="email" defaultValue={value === undefined ? "" : String(value)} disabled={disabled} />;
    case "URL":
      return <Input id={id} name={name} type="url" placeholder="https://" defaultValue={value === undefined ? "" : String(value)} disabled={disabled} />;
    default:
      return <Input id={id} name={name} defaultValue={value === undefined ? "" : String(value)} maxLength={1000} disabled={disabled} />;
  }
}

/** Custom field values from a submitted form (empty strings clear a value) */
export function fieldValuesFromForm(form: FormData, defs: FieldDefItem[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const d of defs) {
    const v = form.get(`field:${d.key}`);
    if (v !== null) out[d.key] = typeof v === "string" && v.trim() !== "" ? v : null;
  }
  return out;
}

/** How a stored value reads on screen */
export function displayFieldValue(def: FieldDefItem, value: string | number | boolean | undefined, yes: string, no: string): string {
  if (value === undefined || value === "") return "";
  if (def.type === "BOOLEAN") return value ? yes : no;
  if (def.type === "DATE") {
    const [y, m, d] = String(value).split("-").map(Number);
    return y && m && d ? new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, { timeZone: "UTC", dateStyle: "medium" }) : String(value);
  }
  if (def.type === "NUMBER") return Number(value).toLocaleString();
  return String(value);
}
