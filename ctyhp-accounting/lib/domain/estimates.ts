/**
 * Estimates: a price promised to a customer, outside the books.
 *
 * Pure. Which state an estimate is in, what may be done to it in that state,
 * the words the screens show, and how an estimate fills the New invoice form
 * are decided here so the list, the form, the invoice page and the tests all
 * read them from one place.
 *
 * Only Declined is stored (migration 0141). Converted and Expired are worked
 * out when read: Converted from the invoice made from the estimate, Expired
 * from the company's today, which depends on its time zone and so is never
 * the database's date.
 */
import { USD_DECIMAL_PLACES } from "@/lib/domain/currency";
import { computeInvoiceLine, sumInvoiceTotals, type InvoiceTotals } from "@/lib/domain/money";
import { addIsoDays } from "@/lib/domain/work-queue";
import { toMinorUnits } from "@/lib/format";

// --- State ------------------------------------------------------------------

export const ESTIMATE_STATES = ["open", "expired", "declined", "converted"] as const;
export type EstimateState = (typeof ESTIMATE_STATES)[number];

export const ESTIMATE_STATE_LABELS: Record<EstimateState, string> = {
  open: "Open",
  expired: "Expired",
  declined: "Declined",
  converted: "Converted",
};

/** How long an estimate is valid by default: "Valid until" is the date plus this many days. */
export const ESTIMATE_VALID_DAYS = 30;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day written YYYY-MM-DD; "2026-02-30" is not one. */
function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function requireIsoDate(value: string, label: string): void {
  if (!isIsoDate(value)) {
    throw new Error(`${label} must be a YYYY-MM-DD date, received "${value}"`);
  }
}

export interface EstimateStateInput {
  /** When it was marked declined; null when it is not. */
  declinedAt: string | null;
  /** "Valid until", YYYY-MM-DD. */
  expiryDate: string;
  /** An invoice that is not void has been made from it. */
  hasLiveInvoice: boolean;
}

/**
 * The state an estimate is in on the company's `today` (YYYY-MM-DD).
 *
 * Converted wins over everything, because the invoice made from it is the
 * fact that matters. Declined wins over Expired: the customer's answer says
 * more than the calendar. Expired starts the day after "Valid until"; the
 * expiry day itself is still Open. Dates are YYYY-MM-DD, so string order is
 * date order.
 */
export function estimateState(input: EstimateStateInput, today: string): EstimateState {
  requireIsoDate(today, "today");
  requireIsoDate(input.expiryDate, "expiryDate");
  if (input.hasLiveInvoice) return "converted";
  if (input.declinedAt) return "declined";
  if (input.expiryDate < today) return "expired";
  return "open";
}

/** The same, read straight off a list or detail row. */
export function estimateStateOf(
  row: { declined_at: string | null; expiry_date: string; live_invoice: object | null },
  today: string,
): EstimateState {
  return estimateState(
    { declinedAt: row.declined_at, expiryDate: row.expiry_date, hasLiveInvoice: row.live_invoice !== null },
    today,
  );
}

/** "Valid until" when nobody sets it: the estimate date plus 30 days. */
export function defaultExpiryDate(estimateDate: string): string {
  requireIsoDate(estimateDate, "estimateDate");
  return addIsoDays(estimateDate, ESTIMATE_VALID_DAYS);
}

// --- What each state allows -------------------------------------------------

export interface EstimateActions {
  edit: boolean;
  /** Turn into an invoice. */
  convert: boolean;
  /** Turning it into an invoice asks first, because the price has lapsed. */
  confirmConvert: boolean;
  /** Mark declined. */
  decline: boolean;
  reopen: boolean;
  /**
   * Offered whenever it is not converted. The database still refuses an
   * estimate that has ever had an invoice made from it, and the screen shows
   * its words.
   */
  delete: boolean;
  /** Download PDF: anyone who can see the estimate. */
  pdf: boolean;
}

const WRITE_ACTIONS: Record<EstimateState, Omit<EstimateActions, "pdf">> = {
  open: { edit: true, convert: true, confirmConvert: false, decline: true, reopen: false, delete: true },
  expired: { edit: true, convert: true, confirmConvert: true, decline: true, reopen: false, delete: true },
  declined: { edit: true, convert: false, confirmConvert: false, decline: false, reopen: true, delete: true },
  converted: { edit: false, convert: false, confirmConvert: false, decline: false, reopen: false, delete: false },
};

const NO_WRITES: Omit<EstimateActions, "pdf"> = {
  edit: false,
  convert: false,
  confirmConvert: false,
  decline: false,
  reopen: false,
  delete: false,
};

/**
 * The actions a state allows (the spec's table). Actions that change
 * something show only to people who can write; read-only roles keep the PDF.
 */
export function estimateActions(state: EstimateState, canWrite: boolean): EstimateActions {
  return { ...(canWrite ? WRITE_ACTIONS[state] : NO_WRITES), pdf: true };
}

// --- The list's filter pills ------------------------------------------------

export type EstimateFilter = "all" | EstimateState;

export const ESTIMATE_FILTERS: ReadonlyArray<{ key: EstimateFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "open", label: ESTIMATE_STATE_LABELS.open },
  { key: "expired", label: ESTIMATE_STATE_LABELS.expired },
  { key: "declined", label: ESTIMATE_STATE_LABELS.declined },
  { key: "converted", label: ESTIMATE_STATE_LABELS.converted },
];

export function estimateInFilter(state: EstimateState, filter: EstimateFilter): boolean {
  return filter === "all" || filter === state;
}

/** The count on each pill. */
export function countEstimatesByFilter(states: Iterable<EstimateState>): Record<EstimateFilter, number> {
  const counts: Record<EstimateFilter, number> = {
    all: 0,
    open: 0,
    expired: 0,
    declined: 0,
    converted: 0,
  };
  for (const state of states) {
    counts.all += 1;
    counts[state] += 1;
  }
  return counts;
}

// --- Words ------------------------------------------------------------------

/**
 * What the screens say, given the estimate's number. Where the database says
 * the same thing (a refusal), the words are the database's own, letter for
 * letter, so a refusal reads the same whichever side catches it.
 */
export const estimateMessages = {
  deleteConfirm: (estimateNumber: string) =>
    `Delete ${estimateNumber}? It is not in the books, so nothing else changes.`,
  deleteRefused: (estimateNumber: string) =>
    `${estimateNumber} has had an invoice made from it. Mark it declined instead.`,
  /** `invoiceNumber` is null while the invoice is still a draft. */
  alreadyConverted: (estimateNumber: string, invoiceNumber: string | null) =>
    `${estimateNumber} has already been turned into an invoice (${invoiceNumber ?? "a draft invoice"}).`,
  declinedCannotConvert: (estimateNumber: string) =>
    `${estimateNumber} is marked declined. Reopen it before turning it into an invoice.`,
  declined: (estimateNumber: string) => `${estimateNumber} marked declined.`,
  reopened: (estimateNumber: string) => `${estimateNumber} reopened.`,
  /** `validUntil` is the estimate's "Valid until" date, as the screen shows dates. */
  expiredConfirm: (estimateNumber: string, validUntil: string) =>
    `${estimateNumber} expired on ${validUntil}. Turn it into an invoice anyway?`,
  /** Above the New invoice form, and on the invoice's detail. */
  fromEstimate: (estimateNumber: string) => `From estimate ${estimateNumber}`,
  invoiceCreated: (estimateNumber: string) =>
    `Draft invoice created from ${estimateNumber}. Check it over, then issue it.`,
} as const;

// --- Form lines -------------------------------------------------------------

/**
 * A line as the New invoice form and the estimate form hold it: the unit
 * price in major units, the way the money input shows it.
 */
export interface DocumentFormLine {
  item_id?: string | null;
  description?: string;
  quantity?: number;
  /** Major units (dollars), as typed. */
  unit_price?: number;
  income_account_id?: string;
  tax_code_id?: string | null;
}

/** A stored estimate line, as far as the forms need it. */
export interface EstimateLineValues {
  line_order: number;
  item_id: string | null;
  description: string;
  quantity: number;
  unit_price_minor: number;
  income_account_id: string;
  tax_code_id: string | null;
}

/** A filled-in form line: every field the invoice line carries. */
export interface FilledFormLine {
  item_id: string | null;
  description: string;
  quantity: number;
  /** Major units. */
  unit_price: number;
  income_account_id: string;
  tax_code_id: string | null;
}

/** What a line saves as: the invoice line's input, with the price in minor units. */
export interface DocumentLineInput {
  description: string;
  quantity: number;
  unit_price_minor: number;
  income_account_id: string;
  tax_code_id: string | null;
  item_id: string | null;
}

const MINOR_PER_MAJOR = 10 ** USD_DECIMAL_PLACES;

/** A stored line, in the form's terms. */
export function estimateLineToFormLine(line: EstimateLineValues): FilledFormLine {
  return {
    item_id: line.item_id ?? null,
    description: line.description,
    quantity: Number(line.quantity),
    unit_price: Number(line.unit_price_minor) / MINOR_PER_MAJOR,
    income_account_id: line.income_account_id,
    tax_code_id: line.tax_code_id ?? null,
  };
}

/**
 * A form line, in the terms the server takes. The same conversion the New
 * invoice form makes when it submits.
 */
export function formLineToLineInput(line: DocumentFormLine): DocumentLineInput {
  return {
    description: line.description ?? "",
    quantity: Number(line.quantity),
    unit_price_minor: toMinorUnits(Number(line.unit_price ?? 0), USD_DECIMAL_PLACES),
    income_account_id: line.income_account_id ?? "",
    tax_code_id: line.tax_code_id || null,
    item_id: line.item_id || null,
  };
}

/**
 * Subtotal, sales tax and total for a form's live display, worked out exactly
 * as the New invoice form works out its own: a line counts once it has a
 * quantity above zero and a price of zero or more, and each line is rounded
 * by the invoice's own rule before the lines are added up. The server's
 * figures are the ones saved.
 */
export function formLinesTotals(
  lines: ReadonlyArray<DocumentFormLine | null | undefined>,
  taxRatePercentOf: (taxCodeId: string | null | undefined) => number,
): InvoiceTotals {
  const computed = lines
    .filter(
      (line): line is DocumentFormLine =>
        line != null && (line.quantity ?? 0) > 0 && (line.unit_price ?? 0) >= 0,
    )
    .map((line) =>
      computeInvoiceLine({
        quantity: Number(line.quantity ?? 0),
        unitPriceMinor: toMinorUnits(Number(line.unit_price ?? 0), USD_DECIMAL_PLACES),
        taxRatePercent: taxRatePercentOf(line.tax_code_id),
      }),
    );
  return sumInvoiceTotals(computed);
}

// --- Turning an estimate into an invoice ------------------------------------

export interface EstimatePrefillSource {
  id: string;
  estimate_number: string;
  customer_id: string;
  declined_at: string | null;
  /** The invoice made from it that is not void, if there is one. */
  live_invoice: { invoice_number: string | null } | null;
}

/** What the New invoice form opens with when it is opened from an estimate. */
export interface EstimateInvoicePrefill {
  estimateId: string;
  estimateNumber: string;
  /** Initial values for the New invoice form: the customer and the lines. */
  values: {
    customer_id: string;
    lines: FilledFormLine[];
  };
  /**
   * Set when the estimate cannot be turned into an invoice now: the words to
   * show instead of opening the form. The database refuses the same cases.
   */
  blocked: string | null;
}

/**
 * The New invoice form's initial values, from an estimate and its lines: the
 * customer, and every line with its item, description, quantity, unit price,
 * income account and tax code, in the estimate's order. The issue and due
 * dates are left to the form, which sets them as it always does.
 */
export function estimateToInvoicePrefill(
  estimate: EstimatePrefillSource,
  lines: readonly EstimateLineValues[],
): EstimateInvoicePrefill {
  const ordered = [...lines].sort((a, b) => a.line_order - b.line_order);
  let blocked: string | null = null;
  if (estimate.live_invoice) {
    blocked = estimateMessages.alreadyConverted(
      estimate.estimate_number,
      estimate.live_invoice.invoice_number,
    );
  } else if (estimate.declined_at) {
    blocked = estimateMessages.declinedCannotConvert(estimate.estimate_number);
  }
  return {
    estimateId: estimate.id,
    estimateNumber: estimate.estimate_number,
    values: {
      customer_id: estimate.customer_id,
      lines: ordered.map(estimateLineToFormLine),
    },
    blocked,
  };
}

/**
 * Where "Turn into an invoice" goes: the Invoices screen, which opens New
 * invoice filled in from this estimate.
 */
export function estimateConversionHref(estimateId: string): string {
  return `/invoices?new=1&estimate=${encodeURIComponent(estimateId)}`;
}

/** What the New invoice form opens with from an estimate, before its dates become pickers. */
export interface InvoiceFormFromEstimate {
  currency_code: string;
  customer_id: string;
  lines: FilledFormLine[];
  /** Days from the issue date to the due date: the customer's terms, else the company's. */
  dueInDays: number;
}

/**
 * The New invoice form's values when it opens from an estimate.
 *
 * Picking a customer by hand does two things to the form: it sets the due
 * date from the customer's terms, and it fills the tax rate of the customer's
 * state into every line that has none. Opening from an estimate does only the
 * first. The estimate's lines were priced and taxed when it was written, and
 * a line left untaxed on purpose (a service, an exempt sale) must not gain
 * tax on the way to the invoice: the customer accepted the estimate's total.
 * So each line keeps its own tax code exactly, including none.
 */
export function invoiceFormFromEstimate(
  prefill: EstimateInvoicePrefill,
  terms: {
    currencyCode: string;
    /** The customer's own terms in days; null or undefined when they have none. */
    customerTermsDays: number | null | undefined;
    /** The company's default payment terms. */
    defaultTermsDays: number;
  },
): InvoiceFormFromEstimate {
  return {
    currency_code: terms.currencyCode,
    customer_id: prefill.values.customer_id,
    lines: prefill.values.lines.map((line) => ({ ...line })),
    dueInDays: terms.customerTermsDays ?? terms.defaultTermsDays,
  };
}
