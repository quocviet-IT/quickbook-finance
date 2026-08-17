/**
 * What a balance sheet is compared against.
 *
 * Pure date arithmetic, kept away from the screen because month ends are where
 * date code goes wrong: the prior month end of 31 March is 28 February, and a
 * year earlier than 29 February 2024 is 28 February 2023.
 */
import { periodColumnLabel } from "./period-label";

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

// --- Splitting a range into period columns (P&L "display columns by") ------

/**
 * One column of a range-based report: a slice of the requested date range,
 * plus the heading it reads under.
 */
export interface RangeColumn {
  from: string;
  to: string;
  label: string;
}

/** The calendar day after an ISO date, crossing month and year ends. */
function nextDay(date: string): string {
  const { year, month, day } = parts(date);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return iso(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

/**
 * Splits [from, to] into columns of `monthsPerUnit` calendar months.
 *
 * Columns snap to calendar boundaries — a "by quarter" split groups Apr-May-Jun
 * together whatever day the report happens to run on, the same grouping a
 * reader would draw by hand — rather than counting `monthsPerUnit` months
 * forward from `from`. Only the first and last columns are ever partial,
 * clipped to whatever range was actually asked for; every column in between
 * is a whole unit. A range that is not a whole number of units therefore
 * costs nothing extra: it just leaves the two end columns short, and
 * `periodColumnLabel` already says so by falling back to the literal dates
 * for whichever column that happens to.
 */
function splitByCalendarUnit(from: string, to: string, monthsPerUnit: number): RangeColumn[] {
  if (new Date(`${to}T00:00:00.000Z`).getTime() < new Date(`${from}T00:00:00.000Z`).getTime()) {
    throw new Error("Report end date must not be before its start date");
  }

  const columns: RangeColumn[] = [];
  let columnFrom = from;
  let cursor = (() => {
    const { year, month } = parts(from);
    return year * 12 + (month - 1);
  })();

  // A day can only ever belong to one column, so walking forward and clipping
  // each unit to `to` cannot skip or double-count a day even when `from` and
  // `to` land mid-unit.
  for (;;) {
    const unitStart = Math.floor(cursor / monthsPerUnit) * monthsPerUnit;
    const unitEndAbs = unitStart + monthsPerUnit - 1;
    const unitEndDate = monthEnd(Math.floor(unitEndAbs / 12), (unitEndAbs % 12) + 1);
    const columnTo = unitEndDate < to ? unitEndDate : to;
    columns.push({ from: columnFrom, to: columnTo, label: periodColumnLabel(columnFrom, columnTo) });
    if (columnTo === to) break;
    columnFrom = nextDay(columnTo);
    const { year, month } = parts(columnFrom);
    cursor = year * 12 + (month - 1);
  }
  return columns;
}

/** Splits a date range into one column per calendar month. */
export function monthlyColumns(from: string, to: string): RangeColumn[] {
  return splitByCalendarUnit(from, to, 1);
}

/** Splits a date range into one column per calendar quarter (Jan–Mar, Apr–Jun, …). */
export function quarterlyColumns(from: string, to: string): RangeColumn[] {
  return splitByCalendarUnit(from, to, 3);
}

/**
 * Above this many columns, a period-by-period P&L stops being something a
 * reader can scan and starts being a wall of numbers nobody reads column by
 * column anyway. The limit is about that, not about query cost — the queries
 * stay cheap into the hundreds of columns — which is why refusing outright
 * beats quietly running them anyway.
 */
export const MAX_TREND_COLUMNS = 24;

/**
 * The refusal message for a range that would need more than
 * `MAX_TREND_COLUMNS` columns at the requested granularity, or `null` when
 * the range fits and the report should just run.
 *
 * Names the fix instead of only the limit, and never picks one for the
 * reader: a "by month" request that quietly came back "by quarter" would be
 * a different report than the one that was asked for, read off a column
 * header that no longer tells the truth. So the quarter figure offered here
 * is a suggestion, computed fresh so it can be left out — when quarters
 * would *also* miss the limit, the only real fix is a narrower range.
 */
export function trendColumnLimitMessage(unit: "month" | "quarter", from: string, to: string): string | null {
  const columns = unit === "month" ? monthlyColumns(from, to) : quarterlyColumns(from, to);
  if (columns.length <= MAX_TREND_COLUMNS) return null;

  if (unit === "quarter") {
    return `That range is ${columns.length} quarterly columns. Narrow the range.`;
  }
  const quarters = quarterlyColumns(from, to);
  const alternative =
    quarters.length <= MAX_TREND_COLUMNS ? `, or show it by quarter (${quarters.length} columns)` : "";
  return `That range is ${columns.length} monthly columns. Narrow the range${alternative}.`;
}

/**
 * The plain range a period-by-period report spans: one label alone for a
 * single period, "first to last" once there is more than one.
 *
 * A single period's "range" is just itself — writing it as "X to X" states
 * the same period twice, as though a trend had started and ended on the same
 * day rather than never having a second point to span at all.
 */
export function trendPeriodRangeText(labels: readonly string[]): string {
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels[0]} to ${labels[labels.length - 1]}`;
}

/**
 * The heading for a period-by-period report: how many periods, and the range
 * they span. Grammar follows the count for the same reason the range itself
 * does not repeat a single period — "1 periods" reads as a typo, and reads
 * worse once it is followed by a range that repeats itself too.
 */
export function trendPeriodHeading(labels: readonly string[]): string {
  if (labels.length === 0) return "No periods";
  const count = labels.length === 1 ? "1 period" : `${labels.length} periods`;
  return `${count}, ${trendPeriodRangeText(labels)}`;
}
