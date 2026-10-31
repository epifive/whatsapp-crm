/** 125000 INR -> "₹1,25,000" (locale-aware grouping; whole numbers unless there are paise/cents) */
export function formatMoney(value: number, currency: string, locale?: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: value % 1 ? 2 : 0 }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString(locale)}`;
  }
}

/** Short money for column headers: ₹1.2L / $12K */
export function formatMoneyCompact(value: number, currency: string, locale?: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(value);
  } catch {
    return formatMoney(value, currency, locale);
  }
}

export function formatDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" }): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat(undefined, opts).format(new Date(iso));
}

export function formatDateTime(iso: string | null | undefined): string {
  return formatDate(iso, { dateStyle: "medium", timeStyle: "short" });
}

/** Value for <input type="datetime-local"> in the browser's time zone */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local value (browser time) -> ISO string, or null when empty */
export function fromLocalInput(value: FormDataEntryValue | null): string | null {
  if (!value || typeof value !== "string") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function initials(name: string): string {
  const letters = name
    .replace(/^\+/, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
  return letters || "?";
}
