import { describe, expect, it, vi } from "vitest";
import { decrypt, encrypt, hashToken, randomToken } from "@/lib/crypto";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { signSession, verifySessionToken } from "@/lib/auth/token";

describe("encryption", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encrypt("meta-access-token");
    const b = encrypt("meta-access-token");
    expect(a).not.toEqual(b);
    expect(decrypt(a)).toBe("meta-access-token");
  });

  it("rejects tampered ciphertext", () => {
    const payload = encrypt("secret");
    const raw = Buffer.from(payload.slice(3), "base64");
    raw[raw.length - 1] ^= 1;
    expect(() => decrypt("v1:" + raw.toString("base64"))).toThrow();
  });
});

describe("tokens", () => {
  it("random tokens are unique and hashing is stable", () => {
    const t = randomToken();
    expect(t).not.toEqual(randomToken());
    expect(hashToken(t)).toEqual(hashToken(t));
    expect(hashToken(t)).not.toEqual(t);
  });
});

describe("passwords", () => {
  it("verifies the right password only", () => {
    const stored = hashPassword("Correct horse 1");
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(verifyPassword("Correct horse 1", stored)).toBe(true);
    expect(verifyPassword("correct horse 1", stored)).toBe(false);
  });

  it("never accepts the stored hash as the password", () => {
    const stored = hashPassword("pw123456");
    expect(verifyPassword(stored, stored)).toBe(false);
  });

  it("salts every hash", () => {
    expect(hashPassword("same")).not.toEqual(hashPassword("same"));
  });
});

describe("session tokens", () => {
  it("verifies a fresh token", () => {
    const token = signSession({ sub: "user_1", sv: 3, org: "org_1" });
    expect(verifySessionToken(token)).toMatchObject({ sub: "user_1", sv: 3, org: "org_1" });
  });

  it("rejects a token with a modified payload", () => {
    const [h, , s] = signSession({ sub: "user_1", sv: 0 }).split(".");
    const forgedBody = Buffer.from(JSON.stringify({ sub: "admin", sv: 0, exp: 9999999999, iat: 0 })).toString("base64url");
    expect(verifySessionToken(`${h}.${forgedBody}.${s}`)).toBeNull();
  });

  it("rejects expired tokens and garbage", () => {
    vi.useFakeTimers();
    const token = signSession({ sub: "u", sv: 0 }, 60);
    vi.advanceTimersByTime(61_000);
    expect(verifySessionToken(token)).toBeNull();
    vi.useRealTimers();
    expect(verifySessionToken("not.a.token")).toBeNull();
    expect(verifySessionToken(undefined)).toBeNull();
  });
});
