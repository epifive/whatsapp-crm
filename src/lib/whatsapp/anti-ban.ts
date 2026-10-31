/**
 * Anti-ban engine for QR (WhatsApp Web) numbers, ported from an earlier WhatsApp SaaS:
 * spintax, human-like typing and jitter, warmup ramp-up, daily limits and opt-out detection.
 * Official Cloud API numbers don't need it (Meta enforces its own limits).
 */

/** "{Hi|Hello} there" -> one random option per group. Only groups with "|" are spun. */
export function spin(text: string): string {
  if (!text) return "";
  const re = /\{([^{}]*\|[^{}]*)\}/;
  let out = text;
  for (let guard = 0; guard < 100; guard++) {
    const m = re.exec(out);
    if (!m) break;
    const options = m[1].split("|");
    out = out.slice(0, m.index) + options[Math.floor(Math.random() * options.length)] + out.slice(m.index + m[0].length);
  }
  return out;
}

/** Replaces {{var}} placeholders (case-insensitive); values are inserted literally */
export function renderVariables(template: string, vars: Record<string, unknown>): string {
  let out = template ?? "";
  for (const [key, value] of Object.entries(vars)) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`{{\\s*${escaped}\\s*}}`, "gi"), () => String(value ?? ""));
  }
  return out;
}

/** Random delay between consecutive sends on one number, in ms (never below 5s) */
export function jitterMs(minSec: number, maxSec: number): number {
  const min = Math.max(5, Math.floor(minSec));
  const max = Math.max(min + 2, Math.floor(maxSec));
  return (Math.floor(Math.random() * (max - min + 1)) + min) * 1000;
}

/** How long to show "typing…" before a message of this length (1.5s – 7s) */
export function typingMs(textLength: number): number {
  return 1500 + Math.min(Math.max(0, textLength) * 45, 5500);
}

const OPT_OUT_EXACT = new Set([
  "stop",
  "unsubscribe",
  "cancel",
  "optout",
  "opt-out",
  "opt out",
  "block",
  "dont message",
  "stop all",
  "mat bhejo",
  "message mat bhejo",
  "band karo",
  "nahi chahiye",
  "नहीं चाहिए",
  "बंद करो",
  "मत भेजो",
]);
// Only unambiguous words may start a longer message ("cancel my order" is not an opt-out)
const OPT_OUT_PREFIX = ["stop", "unsubscribe"];

export function isOptOutMessage(text: string | null | undefined): boolean {
  if (!text) return false;
  const clean = text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s-]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return OPT_OUT_EXACT.has(clean) || OPT_OUT_PREFIX.some((w) => clean.startsWith(`${w} `));
}

// New-number ramp-up: day 1: 25, day 2: 50, day 3-4: 125, day 5-6: 250, day 7+: full limit
const WARMUP_CAPS = [25, 50, 125, 125, 250, 250];

export function warmupDay(connectedAt: Date, now = new Date()): number {
  const start = new Date(connectedAt);
  start.setHours(0, 0, 0, 0);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.round((today.getTime() - start.getTime()) / 86_400_000) + 1;
}

export function effectiveDailyLimit(a: { dailyLimit: number; warmupEnabled: boolean; connectedAt: Date | null }, now = new Date()): number {
  if (!a.warmupEnabled) return a.dailyLimit;
  // A number that has never connected starts warmup at day 1 once it does
  const day = a.connectedAt ? warmupDay(a.connectedAt, now) : 1;
  return day <= WARMUP_CAPS.length ? Math.min(a.dailyLimit, WARMUP_CAPS[day - 1]) : a.dailyLimit;
}

/** Server-local calendar day the per-number counter belongs to */
export function dayKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function sentTodayFor(a: { sentToday: number; sentTodayDate: string | null }, now = new Date()): number {
  return a.sentTodayDate === dayKey(now) ? a.sentToday : 0;
}

/**
 * Per-number send pacing: one message at a time, each slot covering the typing simulation plus a
 * jitter gap so the number stays idle between messages. Lives in the worker process.
 */
export class PacingQueue {
  private nextSlotAt = new Map<string, number>();
  private chains = new Map<string, Promise<void>>();

  waitMs(key: string): number {
    return Math.max(0, (this.nextSlotAt.get(key) ?? 0) - Date.now());
  }

  async run<T>(key: string, gapMs: number, fn: () => Promise<T>): Promise<T> {
    const slotAt = Date.now() + this.waitMs(key);
    this.nextSlotAt.set(key, slotAt + gapMs);

    const previous = this.chains.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    const tail = previous.then(() => mine);
    this.chains.set(key, tail);
    try {
      await previous;
      const wait = slotAt - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      return await fn();
    } finally {
      release();
      if (this.chains.get(key) === tail) this.chains.delete(key);
    }
  }
}
