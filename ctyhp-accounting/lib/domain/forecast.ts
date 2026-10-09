/**
 * 13 Week Cash Forecast.
 *
 * Pure. Starts from the cash in the bank accounts today and lays what is
 * already committed onto thirteen seven-day blocks: open invoices and bills,
 * and the occurrences of active recurring templates. Nothing is invented; only
 * the timing of an open document can be estimated, and then only if the reader
 * asks for it ("As they usually pay").
 *
 * The weeks begin on the company's today, not on a Monday, so "This week" is
 * the seven days starting now.
 */

import { nextRecurringDate, type RecurringFrequency } from "./recurring";
import { daysBetween } from "./settlement";

export type CashSide = "receivable" | "payable";

/** Which dates put an open document in a week. */
export type ForecastMode = "due" | "usual";

export const FORECAST_WEEKS = 13;

/** A recurring template's name, cut for the narrow column under "Recurring". */
export const RECURRING_NAME_LIMIT = 40;

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

export interface RecurringTemplateInput {
  id: string;
  name: string;
  documentType: "invoice" | "bill" | "expense" | "journal";
  frequency: RecurringFrequency;
  intervalCount: number;
  startDate: string;
  nextRunDate: string;
  endDate: string | null;
  status: "active" | "paused" | "ended";
  /** Document total in minor units (journals: total debits). */
  totalMinor: number;
  /** The template's stored payload, read defensively: it is jsonb. */
  payload: Record<string, unknown>;
}

/** One cash movement a recurring template will cause. */
export interface RecurringOccurrence {
  templateId: string;
  name: string;
  /** The day the cash moves: the run date, plus due days for an invoice or bill. */
  date: string;
  /** Positive for money in, negative for money out. */
  amountMinor: number;
}

export interface RecurringExpansion {
  occurrences: RecurringOccurrence[];
  /** Active templates whose next run date has already passed. */
  behindCount: number;
  /** Occurrences left out because their payload names a currency other than the base. */
  foreignCurrencyCount: number;
}

export interface ForecastWeek {
  index: number;
  /** "This week" for the first, "w/c Oct 16" for the rest. */
  label: string;
  start: string;
  end: string;
  fromCustomersMinor: number;
  toSuppliersMinor: number;
  /** Signed: recurring money in less recurring money out. */
  recurringMinor: number;
  recurringInMinor: number;
  recurringOutMinor: number;
  /** Distinct template names behind the recurring figure, in run order. */
  recurringNames: string[];
  netMinor: number;
  /** Cash at the end of the week. */
  closingMinor: number;
}

export interface CashForecast {
  today: string;
  mode: ForecastMode;
  openingMinor: number;
  weeks: ForecastWeek[];
  /** Every dollar expected to arrive and to leave inside the horizon, recurring included. */
  dueInMinor: number;
  dueOutMinor: number;
  closingMinor: number;
  /** The lowest week-end cash, only when it is under the opening cash. */
  lowest: { label: string; start: string; minor: number } | null;
  /** The first week that ends under zero. */
  firstBelowZero: { start: string; minor: number } | null;
  overdueInMinor: number;
  overdueOutMinor: number;
  beyondHorizonInMinor: number;
  beyondHorizonOutMinor: number;
  /** Open items inside the horizon plus those beyond it: equal to all open items. */
  insideInMinor: number;
  insideOutMinor: number;
  totalOpenInMinor: number;
  totalOpenOutMinor: number;
  receivableLagDays: number | null;
  payableLagDays: number | null;
  lagSampleSize: { receivable: number; payable: number };
  templatesBehind: number;
  foreignCurrencyTemplates: number;
}

export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 16" from an ISO date. */
export function monthDay(iso: string): string {
  const [, month, day] = iso.split("-").map(Number);
  return `${MONTHS[month - 1]} ${day}`;
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

/** A name cut to the limit, with an ellipsis inside it. */
export function cutName(name: string, limit = RECURRING_NAME_LIMIT): string {
  return name.length <= limit ? name : `${name.slice(0, limit - 1).trimEnd()}…`;
}

/** Guards a template whose next run date is years back from looping for long. */
const MAX_STEPS = 5000;

function payloadDueDays(payload: Record<string, unknown>): number {
  const days = Number(payload.due_days);
  return Number.isFinite(days) && days >= 0 ? Math.trunc(days) : 30;
}

/**
 * The cash movements active recurring templates will cause between today and
 * the horizon's last day.
 *
 * Occurrences run from `next_run_date` forward, by frequency and interval, up
 * to `end_date`. A run date before today is not counted, which is also why a
 * run that already happened is never counted twice: its document, once issued,
 * is an open item. A template whose `next_run_date` has passed is "behind",
 * and is counted so a missing payment is not silent.
 *
 * Amounts are in the base currency. A template's payload has no currency of its
 * own (generation always issues in the base currency), but if one names a
 * different currency its occurrences are left out and counted rather than
 * added at the wrong value.
 */
export function expandRecurring(input: {
  templates: readonly RecurringTemplateInput[];
  today: string;
  horizonEnd: string;
  bankAccountIds: ReadonlySet<string>;
  baseCurrency: string;
}): RecurringExpansion {
  const occurrences: RecurringOccurrence[] = [];
  let behindCount = 0;
  let foreignCurrencyCount = 0;

  for (const template of input.templates) {
    if (template.status !== "active") continue;
    if (template.nextRunDate < input.today) behindCount += 1;

    const currency = template.payload.currency_code;
    if (typeof currency === "string" && currency !== "" && currency !== input.baseCurrency) {
      foreignCurrencyCount += 1;
      continue;
    }

    let run = template.nextRunDate;
    for (let step = 0; step < MAX_STEPS; step += 1) {
      if (run > input.horizonEnd) break;
      if (template.endDate && run > template.endDate) break;
      if (run >= input.today) {
        const movement = occurrenceFor(template, run, input.bankAccountIds);
        if (movement && movement.date >= input.today && movement.date <= input.horizonEnd) {
          occurrences.push(movement);
        }
      }
      const next = nextRecurringDate(run, template.startDate, template.frequency, template.intervalCount);
      if (next <= run) break;
      run = next;
    }
  }

  occurrences.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  return { occurrences, behindCount, foreignCurrencyCount };
}

function occurrenceFor(
  template: RecurringTemplateInput,
  run: string,
  bankAccountIds: ReadonlySet<string>,
): RecurringOccurrence | null {
  const make = (date: string, amountMinor: number): RecurringOccurrence | null =>
    amountMinor === 0 ? null : { templateId: template.id, name: template.name, date, amountMinor };

  switch (template.documentType) {
    case "invoice":
      return make(addDays(run, payloadDueDays(template.payload)), template.totalMinor);
    case "bill":
      return make(addDays(run, payloadDueDays(template.payload)), -template.totalMinor);
    case "expense": {
      // Paid by card, the cash leaves when the card is paid, not now.
      const paidFrom = template.payload.payment_account_id;
      return typeof paidFrom === "string" && bankAccountIds.has(paidFrom)
        ? make(run, -template.totalMinor)
        : null;
    }
    case "journal": {
      const lines = Array.isArray(template.payload.lines) ? (template.payload.lines as Record<string, unknown>[]) : [];
      const net = lines.reduce((sum, line) => {
        if (typeof line.account_id !== "string" || !bankAccountIds.has(line.account_id)) return sum;
        return sum + (Number(line.debit_minor) || 0) - (Number(line.credit_minor) || 0);
      }, 0);
      return make(run, net);
    }
  }
}

/**
 * Build the forecast.
 *
 * An open item already past due lands in the first week, in either mode: the
 * money has not arrived, so the only honest place for it is "now". Otherwise it
 * falls on its due date, or — in "usual" mode — on its due date moved by the
 * median days late learned from settled documents of the same side. An item
 * beyond the last week is summed apart rather than crammed into it.
 */
export function buildCashForecast(input: {
  today: string;
  mode: ForecastMode;
  openingMinor: number;
  openItems: readonly OpenItem[];
  lagSamples?: readonly SettlementLagSample[];
  recurring?: RecurringExpansion;
  weeks?: number;
}): CashForecast {
  const { today, mode } = input;
  const count = Math.max(1, input.weeks ?? FORECAST_WEEKS);
  const samples = input.lagSamples ?? [];
  const receivableLagDays = medianLagDays(samples.filter((s) => s.side === "receivable"));
  const payableLagDays = medianLagDays(samples.filter((s) => s.side === "payable"));
  const recurring = input.recurring ?? { occurrences: [], behindCount: 0, foreignCurrencyCount: 0 };

  const weeks: ForecastWeek[] = Array.from({ length: count }, (_, index) => {
    const start = addDays(today, index * 7);
    return {
      index,
      label: index === 0 ? "This week" : `w/c ${monthDay(start)}`,
      start,
      end: addDays(start, 6),
      fromCustomersMinor: 0,
      toSuppliersMinor: 0,
      recurringMinor: 0,
      recurringInMinor: 0,
      recurringOutMinor: 0,
      recurringNames: [],
      netMinor: 0,
      closingMinor: 0,
    };
  });
  const horizonEnd = weeks[count - 1].end;

  /** The week a day falls in; a day before today belongs to the first. */
  const weekOf = (date: string): number | null => {
    if (date > horizonEnd) return null;
    if (date <= today) return 0;
    return Math.floor(daysBetween(today, date) / 7);
  };

  let overdueIn = 0;
  let overdueOut = 0;
  let beyondIn = 0;
  let beyondOut = 0;
  let insideIn = 0;
  let insideOut = 0;
  let totalIn = 0;
  let totalOut = 0;

  for (const item of input.openItems) {
    const isIn = item.side === "receivable";
    if (isIn) totalIn += item.balanceMinor;
    else totalOut += item.balanceMinor;

    const overdue = item.dueDate < today;
    if (overdue) {
      if (isIn) overdueIn += item.balanceMinor;
      else overdueOut += item.balanceMinor;
    }

    let index: number | null;
    if (overdue) {
      index = 0;
    } else {
      const lag = mode === "usual" ? ((isIn ? receivableLagDays : payableLagDays) ?? 0) : 0;
      index = weekOf(addDays(item.dueDate, lag));
    }

    if (index === null) {
      if (isIn) beyondIn += item.balanceMinor;
      else beyondOut += item.balanceMinor;
      continue;
    }
    if (isIn) {
      weeks[index].fromCustomersMinor += item.balanceMinor;
      insideIn += item.balanceMinor;
    } else {
      weeks[index].toSuppliersMinor += item.balanceMinor;
      insideOut += item.balanceMinor;
    }
  }

  for (const occurrence of recurring.occurrences) {
    const index = weekOf(occurrence.date);
    if (index === null) continue;
    const week = weeks[index];
    if (occurrence.amountMinor > 0) week.recurringInMinor += occurrence.amountMinor;
    else week.recurringOutMinor += -occurrence.amountMinor;
    if (!week.recurringNames.includes(occurrence.name)) week.recurringNames.push(occurrence.name);
  }

  let running = input.openingMinor;
  let dueIn = 0;
  let dueOut = 0;
  for (const week of weeks) {
    week.recurringMinor = week.recurringInMinor - week.recurringOutMinor;
    week.netMinor = week.fromCustomersMinor - week.toSuppliersMinor + week.recurringMinor;
    running += week.netMinor;
    week.closingMinor = running;
    dueIn += week.fromCustomersMinor + week.recurringInMinor;
    dueOut += week.toSuppliersMinor + week.recurringOutMinor;
  }

  const low = weeks.reduce((worst, week) => (week.closingMinor < worst.closingMinor ? week : worst), weeks[0]);
  const firstNegative = weeks.find((week) => week.closingMinor < 0);

  return {
    today,
    mode,
    openingMinor: input.openingMinor,
    weeks,
    dueInMinor: dueIn,
    dueOutMinor: dueOut,
    closingMinor: running,
    lowest: low.closingMinor < input.openingMinor ? { label: low.label, start: low.start, minor: low.closingMinor } : null,
    firstBelowZero: firstNegative ? { start: firstNegative.start, minor: firstNegative.closingMinor } : null,
    overdueInMinor: overdueIn,
    overdueOutMinor: overdueOut,
    beyondHorizonInMinor: beyondIn,
    beyondHorizonOutMinor: beyondOut,
    insideInMinor: insideIn,
    insideOutMinor: insideOut,
    totalOpenInMinor: totalIn,
    totalOpenOutMinor: totalOut,
    receivableLagDays,
    payableLagDays,
    lagSampleSize: {
      receivable: samples.filter((s) => s.side === "receivable").length,
      payable: samples.filter((s) => s.side === "payable").length,
    },
    templatesBehind: recurring.behindCount,
    foreignCurrencyTemplates: recurring.foreignCurrencyCount,
  };
}

/** One sentence on how "As they usually pay" was arrived at. */
export function describeForecastBasis(forecast: CashForecast): string {
  const parts: string[] = [];
  if (forecast.receivableLagDays === null) {
    parts.push("no settled invoice to learn a collection lag from, so receipts stay on their due dates");
  } else {
    parts.push(
      `customers settle a median ${Math.abs(forecast.receivableLagDays)} day${Math.abs(forecast.receivableLagDays) === 1 ? "" : "s"} ` +
        `${forecast.receivableLagDays < 0 ? "early" : "late"} (${forecast.lagSampleSize.receivable} paid invoices)`,
    );
  }
  if (forecast.payableLagDays !== null) {
    parts.push(
      `bills are paid a median ${Math.abs(forecast.payableLagDays)} day${Math.abs(forecast.payableLagDays) === 1 ? "" : "s"} ` +
        `${forecast.payableLagDays < 0 ? "early" : "late"} (${forecast.lagSampleSize.payable} paid bills)`,
    );
  }
  return `As they usually pay: ${parts.join("; ")}, learned from the last 365 days.`;
}

/** The week-by-week figures as the cash chart plots them. */
export function chartPoints(forecast: CashForecast): { label: string; inMinor: number; outMinor: number; closingMinor: number }[] {
  return forecast.weeks.map((week) => ({
    label: week.index === 0 ? "Now" : monthDay(week.start),
    inMinor: week.fromCustomersMinor + week.recurringInMinor,
    outMinor: week.toSuppliersMinor + week.recurringOutMinor,
    closingMinor: week.closingMinor,
  }));
}
