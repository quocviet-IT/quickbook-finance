/** Format a minor-unit amount as a currency string for display. */
export function formatMoney(minor: number, currencyCode: string, decimals: number): string {
  const value = minor / 10 ** decimals;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  } catch {
    return `${value.toFixed(decimals)} ${currencyCode}`;
  }
}

/** Convert a major-unit decimal (e.g. dollars) to integer minor units. */
export function toMinorUnits(amount: number, decimals: number): number {
  return Math.round(amount * 10 ** decimals);
}

/**
 * The time zones these books are kept in, as people say them. A fixed table
 * rather than Intl's names: client components render this on the server and
 * again in the browser, and two ICU builds disagreeing on a word is a
 * hydration mismatch.
 */
const TIME_ZONE_LABEL: Record<string, string> = {
  "America/New_York": "Eastern Time",
  "America/Detroit": "Eastern Time",
  "America/Indiana/Indianapolis": "Eastern Time",
  "America/Kentucky/Louisville": "Eastern Time",
  "America/Chicago": "Central Time",
  "America/Denver": "Mountain Time",
  "America/Boise": "Mountain Time",
  "America/Phoenix": "Arizona Time",
  "America/Los_Angeles": "Pacific Time",
  "America/Anchorage": "Alaska Time",
  "Pacific/Honolulu": "Hawaii Time",
  "Asia/Ho_Chi_Minh": "Vietnam Time",
  "Asia/Saigon": "Vietnam Time",
  UTC: "UTC",
  "Etc/UTC": "UTC",
};

/**
 * A stored time zone as a reader would say it: "America/New_York" → "Eastern
 * Time". One not in the table reads as its city, "America/Sao_Paulo" → "Sao
 * Paulo time", never as the raw identifier.
 */
export function timeZoneLabel(timeZone: string): string {
  const known = TIME_ZONE_LABEL[timeZone];
  if (known) return known;
  const city = timeZone.split("/").pop()?.replaceAll("_", " ").trim();
  return city ? `${city} time` : timeZone;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A calendar date as every screen shows it: `2026-10-16` → `10/16/2026`.
 *
 * One style for the whole app, the one American readers write. It works on the
 * string alone: a date is a day in the company's books, not a moment, so no
 * time zone may move it. A moment (`2026-10-16T23:07:00Z`) goes through
 * {@link formatDateInTimeZone} instead. Anything that is not a date comes back
 * as it was, and an empty value reads as a dash.
 */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const match = ISO_DATE.exec(value);
  return match ? `${match[2]}/${match[3]}/${match[1]}` : value;
}

/** The two ends of a period: `01/01/2026 – 01/31/2026`; with no start, `As of 01/31/2026`. */
export function formatDateRange(from: string | null | undefined, to: string): string {
  return from ? `${formatDate(from)} – ${formatDate(to)}` : `As of ${formatDate(to)}`;
}

/**
 * The calendar fields of a moment in a time zone, 24-hour. Built from parts
 * rather than Intl's finished string: ICU builds disagree on the space before
 * "PM", and a client component renders on the server and again in the browser.
 */
function clockParts(iso: string | Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(typeof iso === "string" ? new Date(iso) : iso);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    hour: Number(part("hour")) % 24,
    minute: part("minute"),
  };
}

/** The company's calendar day right now: `2026-10-16`, in its own time zone, never the server's or UTC. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  return clockParts(now, timeZone).date;
}

/** The calendar date of a moment in a time zone, as screens show it: `10/16/2026`. */
export function formatDateInTimeZone(iso: string | null | undefined, timeZone: string): string {
  return iso ? formatDate(clockParts(iso, timeZone).date) : "—";
}

/** The clock time of a moment in a time zone: `11:07 PM`. */
export function formatTime(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "—";
  const { hour, minute } = clockParts(iso, timeZone);
  return `${hour % 12 || 12}:${minute} ${hour < 12 ? "AM" : "PM"}`;
}

/** A moment in a time zone, as screens show it: `10/16/2026 11:07 PM`. */
export function formatDateTime(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "—";
  return `${formatDateInTimeZone(iso, timeZone)} ${formatTime(iso, timeZone)}`;
}

/**
 * A count with its noun: `1 record`, `2 records`, `1,204 records`.
 *
 * The noun agrees with the number, never "1 records" and never "record(s)".
 * Irregular plurals say so: `plural(n, "entry", "entries")`.
 */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString("en-US")} ${pluralWord(count, one, many)}`;
}

/** The word alone, when the number is shown elsewhere or for a verb: `pluralWord(n, "is", "are")`. */
export function pluralWord(count: number, one: string, many = `${one}s`): string {
  return count === 1 ? one : many;
}

/** Format a percentage that is already ×100 (e.g. `12.5` → `"12.5%"`). */
export function formatPercent(value: number): string {
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}
