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

/** Format a percentage that is already ×100 (e.g. `12.5` → `"12.5%"`). */
export function formatPercent(value: number): string {
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}
