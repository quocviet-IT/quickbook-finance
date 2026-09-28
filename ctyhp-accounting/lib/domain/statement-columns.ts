/**
 * The columns of a statement, from the prototype's Compare list (`COMPARE`,
 * `plCols`, `bsCols` in Accounting-System-v3.html).
 *
 * A range statement (Profit and Loss) has columns that are date ranges; a point
 * statement (Balance Sheet, Trial Balance) has columns that are dates. Pure:
 * dates in, columns out.
 */

import { fiscalYearForDate } from "@/lib/domain/fiscal";
import { periodColumnLabel } from "@/lib/domain/period-label";
import { previousMonthEnd, previousPeriodRange } from "@/lib/domain/reports";
import {
  MAX_TREND_COLUMNS,
  monthEnd,
  monthlyColumns,
  quarterlyColumns,
  sameDayLastYear,
  trendColumnLimitMessage,
  type RangeColumn,
} from "@/lib/domain/report-periods";
import { shortDate } from "@/lib/domain/report-presets";

export const COMPARE_OPTIONS = [
  { key: "none", label: "No comparison" },
  { key: "prev", label: "Previous period" },
  { key: "year", label: "Previous year" },
  { key: "years", label: "Column per year" },
  { key: "quarter", label: "Column per quarter" },
  { key: "month", label: "Column per month" },
] as const;

export type CompareMode = (typeof COMPARE_OPTIONS)[number]["key"];

/** One column: a range (Profit and Loss) or a date, with `from` null (Balance Sheet, Trial Balance). */
export interface StatementColumnSpec {
  key: string;
  label: string;
  /** A second line under the heading, e.g. "As of Mar 15, 2026". */
  sub: string;
  from: string | null;
  to: string;
  /** The last column of a per-period Profit and Loss: the whole range. */
  isTotal: boolean;
}

export type ColumnPlan =
  | { ok: true; columns: StatementColumnSpec[]; change: boolean }
  | { ok: false; message: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (n: number) => String(n).padStart(2, "0");

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** The first day of the fiscal year a date falls in. */
export function fiscalYearStartOf(date: string, fiscalStartMonth: number): string {
  return `${fiscalYearForDate(date, fiscalStartMonth)}-${pad(fiscalStartMonth)}-01`;
}

function fiscalYearEndOf(date: string, fiscalStartMonth: number): string {
  const lastMonth = fiscalStartMonth - 1 + 11; // months after January of the fiscal year's first calendar year
  const year = fiscalYearForDate(date, fiscalStartMonth) + Math.floor(lastMonth / 12);
  return monthEnd(year, (lastMonth % 12) + 1);
}

function fiscalYearLabel(date: string, fiscalStartMonth: number): string {
  const year = fiscalYearForDate(date, fiscalStartMonth);
  return fiscalStartMonth === 1 ? String(year) : `FY ${year}–${String(year + 1).slice(-2)}`;
}

/** A range split at fiscal-year ends, the first and last clipped to it. */
function fiscalYearColumns(from: string, to: string, fiscalStartMonth: number): RangeColumn[] {
  const columns: RangeColumn[] = [];
  for (let start = from; start <= to; ) {
    const end = fiscalYearEndOf(start, fiscalStartMonth);
    const columnTo = end < to ? end : to;
    columns.push({ from: start, to: columnTo, label: fiscalYearLabel(start, fiscalStartMonth) });
    start = nextDay(columnTo);
  }
  return columns;
}

/** A range named by its period when it is a whole one ("Q2 2026"), otherwise by its dates. */
export function rangeLabel(from: string, to: string): string {
  const label = periodColumnLabel(from, to);
  return /\d{4}-\d{2}-\d{2}/.test(label) ? `${shortDate(from)} – ${shortDate(to)}` : label;
}

const monthName = (date: string) => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
const quarterName = (date: string) => `Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1} ${date.slice(0, 4)}`;

/** A range column, with its dates in small text under a heading that names a period instead. */
function rangeColumn(key: string, from: string, to: string, label = rangeLabel(from, to)): StatementColumnSpec {
  const dates = `${shortDate(from)} – ${shortDate(to)}`;
  return { key, label, sub: label === dates ? "" : dates, from, to, isTotal: false };
}

function perPeriod(columns: RangeColumn[], from: string, to: string, name: (c: RangeColumn) => string): ColumnPlan {
  const out = columns.map((c, i) => rangeColumn(`p${i}`, c.from, c.to, name(c)));
  if (out.length > 1) out.push({ ...rangeColumn("total", from, to, "Total"), isTotal: true });
  return { ok: true, columns: out, change: false };
}

/** The columns of a range statement. */
export function rangeColumns(mode: CompareMode, from: string, to: string, fiscalStartMonth: number): ColumnPlan {
  if (to < from) return { ok: false, message: "The start date is after the end date." };
  const current = rangeColumn("current", from, to);
  switch (mode) {
    case "none":
      return { ok: true, columns: [current], change: false };
    case "prev": {
      const prior = previousPeriodRange(from, to);
      return { ok: true, columns: [current, rangeColumn("prior", prior.from, prior.to)], change: true };
    }
    case "year":
      return {
        ok: true,
        columns: [current, rangeColumn("prior", sameDayLastYear(from), sameDayLastYear(to))],
        change: true,
      };
    case "month":
    case "quarter": {
      const message = trendColumnLimitMessage(mode, from, to);
      if (message) return { ok: false, message };
      const split = mode === "month" ? monthlyColumns(from, to) : quarterlyColumns(from, to);
      return perPeriod(split, from, to, (c) => rangeLabel(c.from, c.to));
    }
    case "years": {
      const split = fiscalYearColumns(from, to, fiscalStartMonth);
      if (split.length > MAX_TREND_COLUMNS) {
        return { ok: false, message: `That range is ${split.length} fiscal years. Narrow the range.` };
      }
      return perPeriod(split, from, to, (c) => c.label);
    }
  }
}

function pointColumn(key: string, date: string, label?: string): StatementColumnSpec {
  return {
    key,
    label: label ?? shortDate(date),
    sub: label ? `As of ${shortDate(date)}` : "",
    from: null,
    to: date,
    isTotal: false,
  };
}

/** The columns of a point statement. `columnsFrom` matters only for a column per month, quarter or year. */
export function pointColumns(
  mode: CompareMode,
  asOf: string,
  columnsFrom: string,
  fiscalStartMonth: number,
): ColumnPlan {
  const current = pointColumn("current", asOf);
  switch (mode) {
    case "none":
      return { ok: true, columns: [current], change: false };
    case "prev":
      return { ok: true, columns: [current, pointColumn("prior", previousMonthEnd(asOf))], change: true };
    case "year":
      return { ok: true, columns: [current, pointColumn("prior", sameDayLastYear(asOf))], change: true };
    case "month":
    case "quarter": {
      if (columnsFrom > asOf) return { ok: false, message: "Columns from is after As of." };
      const message = trendColumnLimitMessage(mode, columnsFrom, asOf);
      if (message) return { ok: false, message };
      const split = mode === "month" ? monthlyColumns(columnsFrom, asOf) : quarterlyColumns(columnsFrom, asOf);
      const name = mode === "month" ? monthName : quarterName;
      return { ok: true, columns: split.map((c, i) => pointColumn(`p${i}`, c.to, name(c.to))), change: false };
    }
    case "years": {
      if (columnsFrom > asOf) return { ok: false, message: "Columns from is after As of." };
      const split = fiscalYearColumns(columnsFrom, asOf, fiscalStartMonth);
      if (split.length > MAX_TREND_COLUMNS) {
        return { ok: false, message: `That range is ${split.length} fiscal years. Narrow the range.` };
      }
      return {
        ok: true,
        columns: split.map((c, i) => pointColumn(`p${i}`, c.to, fiscalYearLabel(c.to, fiscalStartMonth))),
        change: false,
      };
    }
  }
}
