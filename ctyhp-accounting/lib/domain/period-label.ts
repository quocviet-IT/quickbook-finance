/**
 * What to call the period a report column covers.
 *
 * A reader asked for this in as many words: "show the year, not prior or
 * current". Columns headed *Current* and *Prior* say only which of the two came
 * first, so the reader has to hold the dates from the subtitle in their head
 * while they read the figures — and a printed page loses even that.
 *
 * The balance sheet had it right all along: its columns are headed with the
 * date they are struck at. This does the same for a range.
 *
 * Pure, and named by shape rather than by length: a range that is a whole year
 * is called by its year, a whole month by its month. Anything else is the two
 * dates, because inventing a name for an arbitrary range would be inventing a
 * fact.
 */

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** Last day of a month, so February keeps its leap day without a rule for it. */
function monthEnd(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

function parts(iso: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) };
}

/**
 * The heading for a column covering `from` to `to`, inclusive.
 *
 * Falls back to the plain range whenever the dates are not a whole calendar
 * period, which is also what happens if either date is unreadable — a heading
 * that guesses is worse than one that simply shows what it was given.
 */
export function periodColumnLabel(from: string, to: string): string {
  const a = parts(from);
  const b = parts(to);
  if (!a || !b) return `${from} – ${to}`;

  const startsPeriod = a.d === 1;
  const endsPeriod = b.d === monthEnd(b.y, b.m);
  if (startsPeriod && endsPeriod) {
    // A whole calendar year is called by its year, which is what an accountant
    // writes at the top of the page.
    if (a.m === 0 && b.m === 11 && a.y === b.y) return String(a.y);
    // One whole month.
    if (a.y === b.y && a.m === b.m) return `${MONTHS[a.m]} ${a.y}`;
    // A whole quarter, named the way a quarter is named.
    if (a.y === b.y && a.m % 3 === 0 && b.m === a.m + 2) return `Q${a.m / 3 + 1} ${a.y}`;
    // Whole months that are none of the above: say which months.
    if (a.y === b.y) return `${MONTHS[a.m]}–${MONTHS[b.m]} ${a.y}`;
    return `${MONTHS[a.m]} ${a.y} – ${MONTHS[b.m]} ${b.y}`;
  }

  return `${from} – ${to}`;
}

/** The heading for a column struck at one date, rather than covering a range. */
export function asOfColumnLabel(asOf: string): string {
  return asOf;
}
