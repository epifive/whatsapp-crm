/** Syntactic check for an http(s) URL; private/internal hosts are refused separately at request time */
export function isPublicHttpUrl(value: string): boolean {
  if (!value.startsWith("https://") && !value.startsWith("http://")) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}
