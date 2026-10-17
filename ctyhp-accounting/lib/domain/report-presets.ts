/**
 * The period picker the client's prototype puts on every report, and the way
 * it writes a date range at the head of one.
 *
 * From `Accounting-System-v3.html` (`PRESETS`, `applyPreset`; the range line
 * under a report is `formatDateRange` in lib/format.ts). One deliberate difference: a period that has not ended yet runs
 * to today, not to its last day. A report whose "To" date is still in the
 * future asks questions nobody could have answered yet — every bank account is
 * "not agreed to a statement" as of December 31 while it is still September —
 * and OneBook's own reports already read "this year" as the year to date.
 *
 * Pure: dates in, dates out. "Today" is always passed in.
 */

export type PeriodPreset = "month" | "quarter" | "year" | "last3" | "last5" | "all" | "custom";

export const PERIOD_PRESETS: ReadonlyArray<{ key: PeriodPreset; label: string }> = [
  { key: "month", label: "This month" },
  { key: "quarter", label: "This quarter" },
  { key: "year", label: "This year" },
  { key: "last3", label: "Last 3 years" },
  { key: "last5", label: "Last 5 years" },
  { key: "all", label: "All dates" },
  { key: "custom", label: "Custom" },
];

export interface PresetContext {
  /** YYYY-MM-DD. */
  today: string;
  /** 1–12. "This year" and the multi-year presets follow the company's fiscal year. */
  fiscalStartMonth: number;
  /** The first and last posted entry, or null for an empty book. */
  firstEntryDate: string | null;
  lastEntryDate: string | null;
}

export interface DateRange {
  from: string;
  to: string;
}

/** The last day of a month; `month` is 1–12 and may run past 12. */
function monthEnd(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month, 0));
  return d.toISOString().slice(0, 10);
}

function firstOfMonth(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month - 1, 1));
  return d.toISOString().slice(0, 10);
}

function earlier(a: string, b: string): string {
  return a < b ? a : b;
}

/** The fiscal year a date falls in, named by the calendar year it starts in. */
function fiscalYearOf(date: string, fiscalStartMonth: number): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return month >= fiscalStartMonth ? year : year - 1;
}

function fiscalYearStart(fiscalYear: number, fiscalStartMonth: number): string {
  return firstOfMonth(fiscalYear, fiscalStartMonth);
}

function fiscalYearEnd(fiscalYear: number, fiscalStartMonth: number): string {
  return monthEnd(fiscalYear, fiscalStartMonth + 11);
}

/** The dates a preset stands for. "Custom" has none; the reader types them. */
export function presetRange(preset: Exclude<PeriodPreset, "custom">, ctx: PresetContext): DateRange {
  const { today, fiscalStartMonth: fm } = ctx;
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));

  switch (preset) {
    case "month":
      return { from: firstOfMonth(year, month), to: earlier(monthEnd(year, month), today) };
    case "quarter": {
      const first = Math.floor((month - 1) / 3) * 3 + 1;
      return { from: firstOfMonth(year, first), to: earlier(monthEnd(year, first + 2), today) };
    }
    case "year": {
      const fy = fiscalYearOf(today, fm);
      return { from: fiscalYearStart(fy, fm), to: earlier(fiscalYearEnd(fy, fm), today) };
    }
    case "last3":
    case "last5": {
      // Anchored on the latest year with entries, not on today, as the
      // prototype does: a book being brought up to date is historical, and
      // "the last three years" of it are the three it has.
      const span = preset === "last3" ? 3 : 5;
      const anchor = fiscalYearOf(earlier(ctx.lastEntryDate ?? today, today), fm);
      return {
        from: fiscalYearStart(anchor - span + 1, fm),
        to: earlier(fiscalYearEnd(anchor, fm), today),
      };
    }
    case "all":
      return {
        from: ctx.firstEntryDate && ctx.firstEntryDate < today ? ctx.firstEntryDate : today,
        to: earlier(ctx.lastEntryDate ?? today, today),
      };
  }
}
