/**
 * Cash-flow forecast.
 *
 * Pure. Projects the money still owed to the company and by it onto the weeks
 * ahead, twice: once on the dates the documents say, and once shifted by how
 * late similar documents were actually settled. The gap between the two lines
 * is the point of the report — a business that is paid eleven days late does
 * not get the cash the due dates promise.
 *
 * Nothing here invents money. Every dollar in the projection is an open
 * balance that already exists in the ledger; only its *timing* is estimated.
 */

import { daysBetween } from "./settlement";

export type CashSide = "receivable" | "payable";

export interface OpenItem {
  side: CashSide;
  documentId: string;
  documentNumber: string | null;
  partyName: string;
  dueDate: string;
  balanceMinor: number;
}

export interface SettlementLagSample {
  side: CashSide;
  dueDate: string;
  settledOn: string;
  amountMinor: number;
}

export interface ForecastBucket {
  /** ISO date of the Monday that opens the week. */
  weekStart: string;
  weekEnd: string;
  /** Money in and out if every document settles on its due date. */
  scheduledInMinor: number;
  scheduledOutMinor: number;
  /** The same money, shifted by the observed lag. */
  expectedInMinor: number;
  expectedOutMinor: number;
  expectedNetMinor: number;
  /** Running total of expectedNet across the horizon. */
  cumulativeMinor: number;
  /** Open items already past due, all of which land in the first bucket. */
  overdueInMinor: number;
  overdueOutMinor: number;
}

export interface CashFlowForecast {
  asOf: string;
  weeks: number;
  buckets: ForecastBucket[];
  /** Median days late, per side; null when nothing has settled to learn from. */
  receivableLagDays: number | null;
  payableLagDays: number | null;
  lagSampleSize: { receivable: number; payable: number };
  /** Open money whose expected date falls beyond the horizon. */
  beyondHorizonInMinor: number;
  beyondHorizonOutMinor: number;
  totalOpenInMinor: number;
  totalOpenOutMinor: number;
}

/** Monday of the week containing an ISO date, as an ISO date. */
export function weekStart(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  const day = date.getUTCDay(); // 0 = Sunday
  const shift = day === 0 ? 6 : day - 1;
  date.setUTCDate(date.getUTCDate() - shift);
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * The median number of days late, weighted by nothing: one document, one vote.
 * A median rather than a mean because a single ancient invoice paid a year late
 * would otherwise move the whole forecast.
 *
 * Early payments count as negative lag and are kept — a business paid early is
 * entitled to see that in its forecast.
 */
export function medianLagDays(samples: readonly SettlementLagSample[]): number | null {
  if (samples.length === 0) return null;
  const lags = samples
    .map((sample) => daysBetween(sample.dueDate, sample.settledOn))
    .sort((a, b) => a - b);
  const middle = Math.floor(lags.length / 2);
  return lags.length % 2 === 1 ? lags[middle] : Math.round((lags[middle - 1] + lags[middle]) / 2);
}

/**
 * Build the projection.
 *
 * An item already past due is expected in the first week, not in the past: the
 * money has not arrived, so the only honest place for it is "now". Its lag is
 * still applied, so a document a week overdue with an eleven-day collection lag
 * is not promised tomorrow either — it lands in the first bucket at the
 * earliest.
 */
export function buildCashFlowForecast(input: {
  asOf: string;
  weeks?: number;
  openItems: readonly OpenItem[];
  lagSamples?: readonly SettlementLagSample[];
}): CashFlowForecast {
  const asOf = input.asOf;
  const weeks = Math.max(1, input.weeks ?? 13);
  const samples = input.lagSamples ?? [];

  const receivableLagDays = medianLagDays(samples.filter((s) => s.side === "receivable"));
  const payableLagDays = medianLagDays(samples.filter((s) => s.side === "payable"));

  const firstWeek = weekStart(asOf);
  const buckets: ForecastBucket[] = Array.from({ length: weeks }, (_, index) => {
    const start = addDays(firstWeek, index * 7);
    return {
      weekStart: start,
      weekEnd: addDays(start, 6),
      scheduledInMinor: 0,
      scheduledOutMinor: 0,
      expectedInMinor: 0,
      expectedOutMinor: 0,
      expectedNetMinor: 0,
      cumulativeMinor: 0,
      overdueInMinor: 0,
      overdueOutMinor: 0,
    };
  });

  const horizonEnd = buckets[buckets.length - 1].weekEnd;
  let beyondIn = 0;
  let beyondOut = 0;
  let totalIn = 0;
  let totalOut = 0;

  const indexFor = (date: string): number | null => {
    if (date > horizonEnd) return null;
    const start = weekStart(date < asOf ? asOf : date);
    const offset = Math.floor(daysBetween(firstWeek, start) / 7);
    return Math.min(Math.max(offset, 0), buckets.length - 1);
  };

  for (const item of input.openItems) {
    const isIn = item.side === "receivable";
    if (isIn) totalIn += item.balanceMinor;
    else totalOut += item.balanceMinor;

    const lag = (isIn ? receivableLagDays : payableLagDays) ?? 0;
    const expectedDate = addDays(item.dueDate, lag);
    const overdue = item.dueDate < asOf;

    const scheduledIndex = indexFor(item.dueDate);
    if (scheduledIndex !== null) {
      if (isIn) buckets[scheduledIndex].scheduledInMinor += item.balanceMinor;
      else buckets[scheduledIndex].scheduledOutMinor += item.balanceMinor;
    }

    const expectedIndex = indexFor(expectedDate);
    if (expectedIndex === null) {
      if (isIn) beyondIn += item.balanceMinor;
      else beyondOut += item.balanceMinor;
      continue;
    }
    if (isIn) {
      buckets[expectedIndex].expectedInMinor += item.balanceMinor;
      if (overdue) buckets[expectedIndex].overdueInMinor += item.balanceMinor;
    } else {
      buckets[expectedIndex].expectedOutMinor += item.balanceMinor;
      if (overdue) buckets[expectedIndex].overdueOutMinor += item.balanceMinor;
    }
  }

  let cumulative = 0;
  for (const bucket of buckets) {
    bucket.expectedNetMinor = bucket.expectedInMinor - bucket.expectedOutMinor;
    cumulative += bucket.expectedNetMinor;
    bucket.cumulativeMinor = cumulative;
  }

  return {
    asOf,
    weeks,
    buckets,
    receivableLagDays,
    payableLagDays,
    lagSampleSize: {
      receivable: samples.filter((s) => s.side === "receivable").length,
      payable: samples.filter((s) => s.side === "payable").length,
    },
    beyondHorizonInMinor: beyondIn,
    beyondHorizonOutMinor: beyondOut,
    totalOpenInMinor: totalIn,
    totalOpenOutMinor: totalOut,
  };
}

/** One sentence on how the expected line was arrived at, for the report header. */
export function describeForecastBasis(forecast: CashFlowForecast): string {
  const parts: string[] = [];
  if (forecast.receivableLagDays === null) {
    parts.push("no settled invoice to learn a collection lag from, so receipts are shown on their due dates");
  } else {
    parts.push(
      `customers settle a median ${forecast.receivableLagDays} day${Math.abs(forecast.receivableLagDays) === 1 ? "" : "s"} ` +
        `${forecast.receivableLagDays < 0 ? "early" : "late"} (${forecast.lagSampleSize.receivable} paid invoices)`,
    );
  }
  if (forecast.payableLagDays !== null) {
    parts.push(
      `bills are paid a median ${forecast.payableLagDays} day${Math.abs(forecast.payableLagDays) === 1 ? "" : "s"} ` +
        `${forecast.payableLagDays < 0 ? "early" : "late"} (${forecast.lagSampleSize.payable} paid bills)`,
    );
  }
  return `Expected timing: ${parts.join("; ")}.`;
}
