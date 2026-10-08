/**
 * What a report page asks its server action for, and what comes back. Shared by
 * the report pages built on `SimpleReport`, so each one's action and screen
 * agree on the shape without each page declaring its own copy.
 */

/** The dates a report is run for. `from` is null for an as-of report. */
export interface ReportWhen {
  from: string | null;
  to: string;
  /** Set for a report run by fiscal year. */
  fiscalYear: number | null;
}

export interface ReportRunResult<T> {
  ok: boolean;
  error?: string;
  data?: T;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * What a report action accepts from the browser: real calendar dates, a start
 * no later than the end, a fiscal year in range. Anything else is refused with
 * a reason, before any query runs.
 */
export function checkWhen(when: unknown, needs: "asOf" | "range" | "fiscalYear" | "none"): ReportWhen {
  const w = (when ?? {}) as Partial<ReportWhen>;
  const isDate = (value: unknown): value is string =>
    typeof value === "string" && ISO_DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
  if (needs === "fiscalYear") {
    const year = Number(w.fiscalYear);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error("Choose a fiscal year between 2000 and 2100.");
    return { from: null, to: "", fiscalYear: year };
  }
  if (needs === "none") return { from: null, to: isDate(w.to) ? w.to : "", fiscalYear: null };
  if (!isDate(w.to)) throw new Error("Choose the date the report runs to.");
  if (needs === "asOf") return { from: null, to: w.to, fiscalYear: null };
  if (!isDate(w.from)) throw new Error("Choose the date the report runs from.");
  if (w.from > w.to) throw new Error("The start date is after the end date.");
  return { from: w.from, to: w.to, fiscalYear: null };
}

/** The message a report action returns for a failure it did not expect. */
export function reportFailure(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "The report could not be produced.";
}
