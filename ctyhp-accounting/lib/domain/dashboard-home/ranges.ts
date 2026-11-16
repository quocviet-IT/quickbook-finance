/**
 * The Dashboard's calendar: its months, its four periods and the period each
 * one is compared with.
 *
 * Pure, and on the date strings alone: a date here is a day in the company's
 * books, so no time zone may move it. Month names come from a fixed table, not
 * from the runtime's locale, so the server and the browser always agree.
 */
import { fiscalYearForDate } from "@/lib/domain/fiscal";
import { addIsoDays, calendarDayDifference } from "@/lib/domain/work-queue";
import type { HomePeriodKey } from "./types";

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function isoDay(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
}

/** "2026-11-13" or "2026-11" → "2026-11". */
export function monthKeyOf(date: string): string {
  return date.slice(0, 7);
}

/** The month `by` months after (or before, when negative) a month key. */
export function shiftMonth(key: string, by: number): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + by, 1)).toISOString().slice(0, 7);
}

export function monthStartOf(key: string): string {
  return `${monthKeyOf(key)}-01`;
}

export function monthEndOf(key: string): string {
  const [year, month] = monthKeyOf(key).split("-").map(Number);
  return isoDay(year, month + 1, 0);
}

/** "2026-11" → "Nov". */
export function shortMonthName(key: string): string {
  return SHORT_MONTHS[Number(key.slice(5, 7)) - 1];
}

/** "2026-11" → "November". */
export function longMonthName(key: string): string {
  return LONG_MONTHS[Number(key.slice(5, 7)) - 1];
}

/** "2026-09-30" or "2026-09" → "September 2026". */
export function monthYearLabel(dateOrKey: string): string {
  const key = monthKeyOf(dateOrKey);
  return `${longMonthName(key)} ${key.slice(0, 4)}`;
}

export interface HomeMonthRange {
  key: string;
  label: string;
  year: number;
  from: string;
  to: string;
}

/**
 * `count` calendar months ending with asOf's month, oldest first. Each runs
 * from its first day to its last, except the last, which ends on asOf: the
 * month to date. The same ranges `trailingMonthRanges` gives, with the year.
 */
export function homeMonthRanges(asOf: string, count: number): HomeMonthRange[] {
  const current = monthKeyOf(asOf);
  return Array.from({ length: count }, (_, index) => {
    const key = shiftMonth(current, index - (count - 1));
    return {
      key,
      label: shortMonthName(key),
      year: Number(key.slice(0, 4)),
      from: monthStartOf(key),
      to: key === current ? asOf : monthEndOf(key),
    };
  });
}

/** Every month after `date`'s month through asOf's month, oldest first; none when `date` is null or not earlier. */
export function monthsAfter(date: string | null, asOf: string): string[] {
  if (date === null) return [];
  const last = monthKeyOf(asOf);
  const out: string[] = [];
  for (let key = shiftMonth(monthKeyOf(date), 1); key <= last; key = shiftMonth(key, 1)) out.push(key);
  return out;
}

/** The books are behind when the last posted day is before the first day of the previous month. */
export function booksBehind(postedThrough: string | null, asOf: string): boolean {
  return postedThrough !== null && postedThrough < monthStartOf(shiftMonth(monthKeyOf(asOf), -1));
}

/**
 * The same days of the previous month: its first day to the same day number,
 * held to that month's length (March 31 → February 1–28). The rule
 * `comparablePreviousMonthRange` in lib/services/dashboard.ts follows; a test
 * holds the two together.
 */
export function comparablePriorMonth(asOf: string): { from: string; to: string } {
  const previous = shiftMonth(monthKeyOf(asOf), -1);
  const end = monthEndOf(previous);
  const day = Math.min(Number(asOf.slice(8, 10)), Number(end.slice(8, 10)));
  return { from: monthStartOf(previous), to: `${previous}-${String(day).padStart(2, "0")}` };
}

/**
 * From `priorStart`, as many days as have passed from `start` to asOf, held to
 * the prior period's last day: "the same days" of a quarter or year whose
 * length differs.
 */
function sameElapsedDays(start: string, asOf: string, priorStart: string, priorEnd: string): string {
  const to = addIsoDays(priorStart, calendarDayDifference(asOf, start));
  return to > priorEnd ? priorEnd : to;
}

export interface HomePeriodRange {
  from: string;
  to: string;
  priorFrom: string;
  priorTo: string;
  label: string;
  compareLabel: string;
}

/**
 * The four periods the profit and expense widgets offer, each with the period
 * it is compared with:
 *
 * - month: the month to date, against the same days of the previous month;
 * - lastMonth: the whole previous month, against the whole month before it;
 * - quarter: the calendar quarter to date, against the previous quarter's
 *   first day through as many days as have passed, held to its length;
 * - year: the fiscal year to date, against the previous fiscal year the same way.
 */
export function homePeriodRanges(asOf: string, fiscalStartMonth: number): Record<HomePeriodKey, HomePeriodRange> {
  const current = monthKeyOf(asOf);
  const previous = shiftMonth(current, -1);
  const beforePrevious = shiftMonth(current, -2);
  const priorMonth = comparablePriorMonth(asOf);

  const month = Number(current.slice(5, 7));
  const quarterStartKey = shiftMonth(current, -((month - 1) % 3));
  const quarterStart = monthStartOf(quarterStartKey);
  const priorQuarterStart = monthStartOf(shiftMonth(quarterStartKey, -3));
  const priorQuarterEnd = monthEndOf(shiftMonth(quarterStartKey, -1));

  const fiscalYear = fiscalYearForDate(asOf, fiscalStartMonth);
  const yearStart = isoDay(fiscalYear, fiscalStartMonth, 1);
  const priorYearStart = isoDay(fiscalYear - 1, fiscalStartMonth, 1);
  const priorYearEnd = addIsoDays(yearStart, -1);

  return {
    month: {
      from: monthStartOf(current),
      to: asOf,
      priorFrom: priorMonth.from,
      priorTo: priorMonth.to,
      label: "This month",
      compareLabel: `vs same days in ${shortMonthName(previous)}`,
    },
    lastMonth: {
      from: monthStartOf(previous),
      to: monthEndOf(previous),
      priorFrom: monthStartOf(beforePrevious),
      priorTo: monthEndOf(beforePrevious),
      label: "Last month",
      compareLabel: `vs ${shortMonthName(beforePrevious)} ${beforePrevious.slice(0, 4)}`,
    },
    quarter: {
      from: quarterStart,
      to: asOf,
      priorFrom: priorQuarterStart,
      priorTo: sameElapsedDays(quarterStart, asOf, priorQuarterStart, priorQuarterEnd),
      label: "This quarter",
      compareLabel: "vs same days last quarter",
    },
    year: {
      from: yearStart,
      to: asOf,
      priorFrom: priorYearStart,
      priorTo: sameElapsedDays(yearStart, asOf, priorYearStart, priorYearEnd),
      label: "This year",
      compareLabel: "vs same days last year",
    },
  };
}
