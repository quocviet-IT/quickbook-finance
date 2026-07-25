export interface FiscalMonth {
  period: number;
  start: string;
  end: string;
  label: string;
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function fiscalMonths(fiscalYear: number, fiscalStartMonth: number): FiscalMonth[] {
  if (!Number.isInteger(fiscalYear) || fiscalYear < 2000 || fiscalYear > 2100) {
    throw new Error("Fiscal year must be between 2000 and 2100");
  }
  if (!Number.isInteger(fiscalStartMonth) || fiscalStartMonth < 1 || fiscalStartMonth > 12) {
    throw new Error("Fiscal start month must be between 1 and 12");
  }
  return Array.from({ length: 12 }, (_, index) => {
    const start = new Date(Date.UTC(fiscalYear, fiscalStartMonth - 1 + index, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    return {
      period: index + 1,
      start: iso(start),
      end: iso(end),
      label: start.toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }),
    };
  });
}

export function fiscalYearForDate(date: string, fiscalStartMonth: number): number {
  const [year, month] = date.split("-").map(Number);
  if (!year || !month) throw new Error("Date must use YYYY-MM-DD format");
  return month >= fiscalStartMonth ? year : year - 1;
}

export function dayBefore(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return iso(value);
}
