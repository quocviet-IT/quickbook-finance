/**
 * Pure accounting-period calendar. Periods are monthly. `fiscalYear` is the
 * calendar year the fiscal year begins in; a non-January start spans two calendar
 * years. `periodMonth` is the 1..12 ordinal within the fiscal year (period 1 = the
 * start month). `label` is the ISO YYYY-MM of the period start.
 */
export interface PeriodRange {
  fiscalYear: number;
  periodMonth: number;
  periodStart: string;
  periodEnd: string;
  label: string;
}

function iso(y: number, m1: number, d: number): string {
  return `${y}-${String(m1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function lastDay(y: number, m1: number): number {
  // m1 is 1-based; Date.UTC(y, m1, 0) → last day of month m1.
  return new Date(Date.UTC(y, m1, 0)).getUTCDate();
}

export function computePeriods(fiscalYearStartMonth: number, fiscalYear: number): PeriodRange[] {
  const out: PeriodRange[] = [];
  for (let i = 0; i < 12; i++) {
    const offset = fiscalYearStartMonth - 1 + i;
    const calMonth = (offset % 12) + 1;
    const calYear = fiscalYear + Math.floor(offset / 12);
    out.push({
      fiscalYear,
      periodMonth: i + 1,
      periodStart: iso(calYear, calMonth, 1),
      periodEnd: iso(calYear, calMonth, lastDay(calYear, calMonth)),
      label: `${calYear}-${String(calMonth).padStart(2, "0")}`,
    });
  }
  return out;
}

export function periodLabelOf(dateIso: string, _fiscalYearStartMonth: number): string {
  // The display label is the calendar YYYY-MM of the date (independent of fiscal start).
  return dateIso.slice(0, 7);
}
