import crypto from "node:crypto";
import { deriveKey, safeEqual } from "@/lib/crypto";

/**
 * Compact HS256 JWT. Kept dependency-free and runtime-agnostic (Next proxy, route handlers,
 * Socket.IO handshake and the worker all verify the same token).
 */

export const SESSION_COOKIE = "wacrm_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface SessionPayload {
  sub: string; // user id
  sv: number; // user.sessionVersion at sign-in
  org?: string; // active organization id
  imp?: string; // platform admin viewing the app as this user (impersonation)
  exp: number;
  iat: number;
}

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");

function sign(data: string): string {
  return crypto.createHmac("sha256", deriveKey("session")).update(data).digest("base64url");
}

export function signSession(payload: Omit<SessionPayload, "exp" | "iat">, ttlSeconds = SESSION_TTL_SECONDS): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ ...payload, iat: now, exp: now + ttlSeconds });
  return `${header}.${body}.${sign(`${header}.${body}`)}`;
}

/** Signature + expiry only; callers must still check `sv` against the user's sessionVersion */
export function verifySessionToken(token: string | undefined | null): SessionPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;
  try {
    // Throws before installation (no APP_KEY yet): treat the cookie as invalid
    if (!safeEqual(signature, sign(`${header}.${body}`))) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    if (typeof payload.sub !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
