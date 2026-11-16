/**
 * Privacy on the Dashboard (3.0.39): with it on, every amount is masked, so
 * the page can be open on a screen others can see. Counts, dates, days,
 * percentages, names and statuses stay; charts keep their shapes.
 *
 * Pure. The screen formats its own amounts and masks them as it does; this
 * module also masks the sentences built on the server, which arrive with
 * their amounts already written in.
 */

/** An amount, hidden. */
export const PRIVATE_AMOUNT = "$••••••";

/** A short amount, hidden: a chart's axis labels and the figure in a ring's middle. */
export const PRIVATE_COMPACT = "•••";

/** A change in money, hidden; its arrow and its words stay. */
export const PRIVATE_CHANGE = "••••";

/**
 * A currency amount as `formatMoney`, `formatCompactMoney` and
 * `formatSignedMoney` write it: an optional sign, an optional prefix of
 * capitals ("CA$"), the symbol, the digits with their thousands commas (never
 * a comma that ends a clause), the decimals, and a compact suffix (K, M, B, T).
 */
const AMOUNT = /[-−+]?(?:\b[A-Z]{1,3})?[$€£¥]\d+(?:,\d{3})*(?:\.\d+)?(?:[KMBT](?![A-Za-z]))?/g;

/**
 * Every currency amount in a sentence replaced by `PRIVATE_AMOUNT`: "$1,234.56",
 * "-$1,234.56", "$20K", "$1.2M", and the same after €, £ or ¥. Counts, dates,
 * days and percentages are left as they are.
 */
export function maskAmounts(text: string): string {
  return text.replace(AMOUNT, PRIVATE_AMOUNT);
}
