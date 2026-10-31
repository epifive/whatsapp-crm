/**
 * Amounts are stored as integers in the currency's smallest unit (cents, paise; whole yen for
 * JPY). Shared by the server and the browser.
 */

export function currencyDecimals(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

export function isValidCurrency(code: string): boolean {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: code });
    return true;
  } catch {
    return false;
  }
}

/** "499.50" → 49950 (for INR/USD); null when it isn't a valid amount */
export function toMinor(value: string | number, currency: string): number | null {
  const text = String(value).trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const decimals = currencyDecimals(currency);
  const [whole, frac = ""] = text.split(".");
  if (frac.length > decimals) return null;
  return Number(whole) * 10 ** decimals + Number(frac.padEnd(decimals, "0") || 0);
}

/** 49950 → "499.50" (plain number for form inputs and gateway APIs) */
export function fromMinor(amount: number, currency: string): string {
  const decimals = currencyDecimals(currency);
  return decimals ? (amount / 10 ** decimals).toFixed(decimals) : String(amount);
}

/** 49950 → "₹499.50" */
export function formatMoney(amount: number, currency: string, locale = "en"): string {
  const decimals = currencyDecimals(currency);
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, minimumFractionDigits: amount % 10 ** decimals === 0 ? 0 : decimals }).format(amount / 10 ** decimals);
  } catch {
    return `${fromMinor(amount, currency)} ${currency}`;
  }
}
