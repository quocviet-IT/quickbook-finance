/**
 * A stored moment as the company reads it: `2026-10-08 11:47`, in the
 * company's own time zone — the clock its people kept when they did the thing —
 * not the server's and not UTC.
 */
export function stampInTimeZone(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`;
}

/** The calendar date of a moment in a time zone: `2026-10-08`. */
export function dateInTimeZone(iso: string, timeZone: string): string {
  return stampInTimeZone(iso, timeZone).slice(0, 10);
}
