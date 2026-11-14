/**
 * Words the Dashboard's charts print. Pure; month names come from the
 * Dashboard's own fixed table (lib/domain/dashboard-home/ranges.ts), never
 * from the browser's locale, so the server and the browser print the same.
 */
import { shortMonthName } from "@/lib/domain/dashboard-home/ranges";
import type { HomeMonth } from "@/lib/domain/dashboard-home/types";

/** A month in a tooltip or a table: "Oct 2026", and "Nov 2026, to date" for the month still running. */
export function monthName(month: Pick<HomeMonth, "label" | "year">, toDate: boolean): string {
  return `${month.label} ${month.year}${toDate ? ", to date" : ""}`;
}

/** A day under a chart, short: "2026-12-13" → "Dec 13". */
export function monthDayLabel(date: string): string {
  return `${shortMonthName(date.slice(0, 7))} ${Number(date.slice(8, 10))}`;
}
