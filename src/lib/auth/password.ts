import crypto from "node:crypto";
import { safeEqual } from "@/lib/crypto";

// Stored format: scrypt$<salt hex>$<hash hex>, random salt per user
const KEYLEN = 64;
const OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEYLEN, OPTIONS);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  if (typeof password !== "string" || typeof stored !== "string") return false;
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length, OPTIONS);
  return safeEqual(actual, expected);
}

// Hash a fixed dummy so "unknown email" takes as long as "wrong password" (no user enumeration by timing)
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString("hex"));
export function burnPasswordCheck(password: string): void {
  verifyPassword(password, DUMMY_HASH);
}
