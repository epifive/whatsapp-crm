"use client";

import { formatDate } from "./format";

/**
 * A date in the viewer's own locale and time zone. The server renders it in its time zone and
 * the browser corrects it, so the (expected) difference must not count as a hydration error.
 */
export function LocalTime({ iso, options, className }: { iso: string | null | undefined; options?: Intl.DateTimeFormatOptions; className?: string }) {
  if (!iso) return null;
  return (
    <time dateTime={iso} className={className} suppressHydrationWarning>
      {formatDate(iso, options)}
    </time>
  );
}
