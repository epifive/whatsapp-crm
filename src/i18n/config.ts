/**
 * Languages shipped with the app. To add one: copy messages/en.json to messages/<code>.json,
 * translate it, and add the code here. Right-to-left languages also go in RTL_LOCALES.
 */
export const LOCALES = ["en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";
export const RTL_LOCALES: readonly string[] = ["ar", "he", "fa", "ur"];
export const LOCALE_COOKIE = "wacrm_locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}
