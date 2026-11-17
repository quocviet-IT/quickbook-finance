/**
 * The Dashboard's calendar: its months, its seven periods and the period each
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

/**
 * A run of whole months, by its first and last: "May – Jul 2026", or, when
 * the two are in different years, each with its own: "Nov 2025 – Jan 2026".
 */
export function monthSpanLabel(first: string, last: string): string {
  const from = monthKeyOf(first);
  const to = monthKeyOf(last);
  const fromYear = from.slice(0, 4);
  const toYear = to.slice(0, 4);
  return fromYear === toYear
    ? `${shortMonthName(from)} – ${shortMonthName(to)} ${toYear}`
    : `${shortMonthName(from)} ${fromYear} – ${shortMonthName(to)} ${toYear}`;
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
 * `count` whole months ending `endsBefore` months before the current one:
 * (current, 3, 1) is the three months before the current month.
 */
function wholeMonths(current: string, count: number, endsBefore: number): { from: string; to: string; first: string; last: string } {
  const last = shiftMonth(current, -endsBefore);
  const first = shiftMonth(last, -(count - 1));
  return { from: monthStartOf(first), to: monthEndOf(last), first, last };
}

/**
 * The seven periods the profit, expense and sales widgets offer, each with
 * the period it is compared with:
 *
 * - month: the month to date, against the same days of the previous month;
 * - lastMonth: the whole previous month, against the whole month before it;
 * - last3: the three whole months before the current one, against the three
 *   whole months before those;
 * - quarter: the calendar quarter to date, against the previous quarter's
 *   first day through as many days as have passed, held to its length;
 * - year: the fiscal year to date, against the previous fiscal year the same way;
 * - last12: the twelve whole months before the current one, against the
 *   twelve before those;
 * - lastYear: the whole previous fiscal year, against the fiscal year before it.
 *
 * The last three are whole months only: the current month to date is never
 * part of them, nor of what they are compared with.
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
  const yearBeforeStart = isoDay(fiscalYear - 2, fiscalStartMonth, 1);
  const yearBeforeEnd = addIsoDays(priorYearStart, -1);

  const last3 = wholeMonths(current, 3, 1);
  const last3Prior = wholeMonths(current, 3, 4);
  const last12 = wholeMonths(current, 12, 1);
  const last12Prior = wholeMonths(current, 12, 13);

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
    last3: {
      from: last3.from,
      to: last3.to,
      priorFrom: last3Prior.from,
      priorTo: last3Prior.to,
      label: "Last 3 months",
      compareLabel: `vs ${monthSpanLabel(last3Prior.first, last3Prior.last)}`,
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
    last12: {
      from: last12.from,
      to: last12.to,
      priorFrom: last12Prior.from,
      priorTo: last12Prior.to,
      label: "Last 12 months",
      compareLabel: `vs ${monthSpanLabel(last12Prior.first, last12Prior.last)}`,
    },
    lastYear: {
      from: priorYearStart,
      to: priorYearEnd,
      priorFrom: yearBeforeStart,
      priorTo: yearBeforeEnd,
      label: "Last year",
      // A calendar fiscal year is named by its year; any other by its first and last months.
      compareLabel: fiscalStartMonth === 1 ? `vs ${yearBeforeStart.slice(0, 4)}` : `vs FY ${monthSpanLabel(yearBeforeStart, yearBeforeEnd)}`,
    },
  };
}
