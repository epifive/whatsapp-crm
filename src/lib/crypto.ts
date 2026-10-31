import crypto from "node:crypto";
import { env } from "./env";

/**
 * All application secrets derive from the single APP_KEY via HKDF, each with its own purpose
 * label, so a key used for one job (e.g. signing sessions) is never reused for another.
 */
const derived = new Map<string, Buffer>();

export function deriveKey(purpose: string): Buffer {
  let key = derived.get(purpose);
  if (!key) {
    const master = Buffer.from(env().APP_KEY, "base64");
    key = Buffer.from(crypto.hkdfSync("sha256", master, Buffer.alloc(0), `wa-crm:${purpose}`, 32));
    derived.set(purpose, key);
  }
  return key;
}

/** AES-256-GCM. Output: "v1:" + base64(iv | tag | ciphertext) */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deriveKey("encryption"), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return "v1:" + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

export function decrypt(payload: string): string {
  if (!payload.startsWith("v1:")) throw new Error("Unsupported encrypted payload");
  const raw = Buffer.from(payload.slice(3), "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey("encryption"), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

/** URL-safe random token for emails/invites; store only `hashToken(token)` */
export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function safeEqual(a: string | Buffer, b: string | Buffer): boolean {
  const ab = Buffer.isBuffer(a) ? a : Buffer.from(a);
  const bb = Buffer.isBuffer(b) ? b : Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}
