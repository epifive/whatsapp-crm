"use client";

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
  code?: string;
}

/** JSON fetch for our own API routes; never throws, always returns a result */
export async function apiFetch<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: "same-origin",
    });
    const json = await res.json().catch(() => null);
    return {
      ok: res.ok,
      status: res.status,
      data: res.ok ? (json as T) : null,
      error: res.ok ? null : (json?.error ?? `Request failed (${res.status})`),
      code: json?.code,
    };
  } catch {
    return { ok: false, status: 0, data: null, error: "Network error. Check your connection and try again." };
  }
}

/** Only allow same-site relative redirects (prevents open redirects via ?next=) */
export function safeNextPath(next: string | null | undefined, fallback = "/app"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
