/**
 * Phone numbers are stored as digits with country code and no "+", e.g. 919000012345.
 * A national number (with or without trunk "0") gets the organization's default country code.
 */
export function normalizePhone(raw: string | null | undefined, defaultCountryCode = ""): string {
  let digits = String(raw ?? "").replace(/\D/g, "");
  const hadPlus = /^\s*\+/.test(String(raw ?? ""));
  if (!hadPlus) {
    // International dialing prefix (00) or national trunk prefix (0)
    if (digits.startsWith("00")) digits = digits.slice(2);
    else if (digits.startsWith("0") && defaultCountryCode) digits = defaultCountryCode + digits.replace(/^0+/, "");
    else if (defaultCountryCode && digits.length === 10) digits = defaultCountryCode + digits;
  }
  return digits.replace(/^0+/, "");
}

/** Plausible E.164 length check (country code + subscriber number) */
export function isValidPhone(digits: string): boolean {
  return /^\d{8,15}$/.test(digits);
}

export function formatPhone(digits: string): string {
  return digits ? `+${digits}` : "";
}

/** WhatsApp user JID for Baileys */
export function phoneToJid(digits: string): string {
  return `${digits}@s.whatsapp.net`;
}
