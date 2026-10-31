/** Date `days` days before now (request-time helper, keeps components free of Date.now()) */
export function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/** Minutes the time zone is ahead of UTC at `at` (e.g. Asia/Kolkata -> 330) */
export function zoneOffsetMinutes(timeZone: string, at: Date): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(at)
      .map((p) => [p.type, Number(p.value)]),
  );
  const asUtc = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** The last millisecond of `at`'s calendar day in the given time zone */
export function endOfDayIn(timeZone: string, at: Date): Date {
  const offset = zoneOffsetMinutes(timeZone, at);
  const local = new Date(at.getTime() + offset * 60_000);
  const nextMidnightLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1);
  return new Date(nextMidnightLocal - offset * 60_000 - 1);
}

/** Any IANA zone the runtime understands, including canonical names its list omits (Asia/Kolkata) */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}
