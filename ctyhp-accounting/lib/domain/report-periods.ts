/**
 * What a balance sheet is compared against.
 *
 * Pure date arithmetic, kept away from the screen because month ends are where
 * date code goes wrong: the prior month end of 31 March is 28 February, and a
 * year earlier than 29 February 2024 is 28 February 2023.
 */

export const COMPARISON_BASES = [
  "prior_month",
  "prior_quarter",
  "prior_year_end",
  "same_month_last_year",
] as const;

export type ComparisonBasis = (typeof COMPARISON_BASES)[number];

const BASIS_LABELS: Record<ComparisonBasis, string> = {
  prior_month: "Prior month end",
  prior_quarter: "Prior quarter end",
  prior_year_end: "Prior year end",
  same_month_last_year: "Same month, last year",
};

export function comparisonBasisLabel(basis: ComparisonBasis): string {
  return BASIS_LABELS[basis];
}

function parts(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split("-").map(Number);
  return { year, month, day };
}

function iso(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Last day of the given month, leap years included. */
export function monthEnd(year: number, month: number): string {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return iso(year, month, days);
}

/** The end of the month before the one this date falls in. */
export function priorMonthEnd(asOf: string): string {
  const { year, month } = parts(asOf);
  return month === 1 ? monthEnd(year - 1, 12) : monthEnd(year, month - 1);
}

/** The end of the calendar quarter before the one this date falls in. */
export function priorQuarterEnd(asOf: string): string {
  const { year, month } = parts(asOf);
  const quarterStartMonth = Math.floor((month - 1) / 3) * 3 + 1;
  return quarterStartMonth === 1 ? monthEnd(year - 1, 12) : monthEnd(year, quarterStartMonth - 1);
}

/** 31 December of the year before this date. */
export function priorYearEnd(asOf: string): string {
  return monthEnd(parts(asOf).year - 1, 12);
}

/**
 * The same day, one year earlier — clamped to the month's length, so a
 * 29 February comparison lands on 28 February rather than 1 March.
 */
export function sameDayLastYear(asOf: string): string {
  const { year, month, day } = parts(asOf);
  const lastYear = year - 1;
  const lastDay = Number(monthEnd(lastYear, month).slice(-2));
  return iso(lastYear, month, Math.min(day, lastDay));
}

export function comparisonDate(asOf: string, basis: ComparisonBasis): string {
  switch (basis) {
    case "prior_month":
      return priorMonthEnd(asOf);
    case "prior_quarter":
      return priorQuarterEnd(asOf);
    case "prior_year_end":
      return priorYearEnd(asOf);
    case "same_month_last_year":
      return sameDayLastYear(asOf);
  }
}

export interface TrendColumn {
  /** Balance sheet date for the column. */
  date: string;
  /** `Jun 2026`, the way a column header reads. */
  label: string;
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Month-end columns ending at `asOf`, oldest first. The last column is the
 * as-of date itself rather than its month end: a balance sheet run mid-month
 * has to show the position it was run for, not a date in the future.
 */
export function trailingMonthEnds(asOf: string, count: number): TrendColumn[] {
  const { year, month } = parts(asOf);
  const columns: TrendColumn[] = [];
  for (let back = count - 1; back >= 0; back--) {
    const totalMonths = year * 12 + (month - 1) - back;
    const columnYear = Math.floor(totalMonths / 12);
    const columnMonth = (totalMonths % 12) + 1;
    const date = back === 0 ? asOf : monthEnd(columnYear, columnMonth);
    columns.push({ date, label: `${MONTH_NAMES[columnMonth - 1]} ${columnYear}` });
  }
  return columns;
}

/** Year-end columns ending at `asOf`, oldest first: `2024`, `2025`, then today. */
export function trailingYearEnds(asOf: string, count: number): TrendColumn[] {
  const { year } = parts(asOf);
  const columns: TrendColumn[] = [];
  for (let back = count - 1; back >= 0; back--) {
    const columnYear = year - back;
    const date = back === 0 ? asOf : monthEnd(columnYear, 12);
    columns.push({ date, label: back === 0 ? `${asOf}` : String(columnYear) });
  }
  return columns;
}
