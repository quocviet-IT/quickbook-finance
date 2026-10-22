/**
 * "Make it recurring": a schedule built from a document that already exists,
 * so what recurs is something somebody has already looked at once (the
 * approved design's `recurFrom`).
 *
 * The schedule is monthly, on the document's day of the month (the month's
 * last day for a document dated on a month end), and first falls due on the
 * first such day after today: a month after a recent document, and never in
 * the past, so an old document does not set off a run of catch-up drafts. It
 * is named for whom it is with and what it comes to, as the design names it,
 * and it remembers the document it came from, so the same document is not
 * made to recur twice.
 */
import { daysBetween } from "./payment-terms";
import { nextRecurringDate, type RecurringDocumentType, type RecurringTemplateCreateInput } from "./recurring";

export interface RecurringSource {
  type: RecurringDocumentType;
  id: string;
}

/** The longest name a schedule takes. */
const NAME_MAX = 160;
/** A bill or invoice with no due date is given the usual 30 days. */
const DEFAULT_DUE_DAYS = 30;

/** The first day after `today` on the document's day of the month. */
export function firstDueAfter(documentDate: string, today: string): string {
  let next = nextRecurringDate(documentDate, documentDate, "monthly", 1);
  while (next <= today) next = nextRecurringDate(next, documentDate, "monthly", 1);
  return next;
}

function schedule(date: string, who: string, total: string, today: string) {
  const name = `${who.trim() || "Recurring"} · ${total}`;
  return {
    name: name.length > NAME_MAX ? `${name.slice(0, NAME_MAX - 1)}…` : name,
    frequency: "monthly" as const,
    interval_count: 1,
    start_date: firstDueAfter(date, today),
    end_date: null,
  };
}

function dueDays(from: string, due: string | null): number {
  if (!due) return DEFAULT_DUE_DAYS;
  return Math.min(365, Math.max(0, daysBetween(from, due)));
}

export function recurringFromInvoice(
  invoice: {
    id: string;
    issue_date: string;
    due_date: string | null;
    customer_id: string;
    memo: string | null;
    lines: readonly {
      description: string;
      quantity: number;
      unit_price_minor: number;
      income_account_id: string;
      tax_code_id: string | null;
      item_id: string | null;
    }[];
  },
  who: string,
  total: string,
  today: string,
): RecurringTemplateCreateInput {
  return {
    ...schedule(invoice.issue_date, who, total, today),
    document_type: "invoice",
    payload: {
      customer_id: invoice.customer_id,
      due_days: dueDays(invoice.issue_date, invoice.due_date),
      memo: invoice.memo,
      lines: invoice.lines.map((line) => ({
        description: line.description ?? "",
        quantity: line.quantity,
        unit_price_minor: line.unit_price_minor,
        income_account_id: line.income_account_id,
        tax_code_id: line.tax_code_id,
        item_id: line.item_id,
      })),
      source: { type: "invoice", id: invoice.id },
    },
  };
}

export function recurringFromBill(
  bill: {
    id: string;
    bill_date: string;
    due_date: string | null;
    vendor_id: string;
    vendor_ref: string | null;
    memo: string | null;
    lines: readonly { description: string; expense_account_id: string; amount_minor: number; item_id: string | null }[];
  },
  who: string,
  total: string,
  today: string,
): RecurringTemplateCreateInput {
  return {
    ...schedule(bill.bill_date, who, total, today),
    document_type: "bill",
    payload: {
      vendor_id: bill.vendor_id,
      // A vendor's reference names one bill; the next one will have its own.
      vendor_ref: null,
      due_days: dueDays(bill.bill_date, bill.due_date),
      memo: bill.memo,
      lines: bill.lines.map((line) => ({
        description: line.description ?? "",
        expense_account_id: line.expense_account_id,
        amount_minor: line.amount_minor,
        item_id: line.item_id,
      })),
      source: { type: "bill", id: bill.id },
    },
  };
}

export function recurringFromExpense(
  expense: {
    id: string;
    expense_date: string;
    vendor_id: string | null;
    payment_account_id: string;
    memo: string | null;
    lines: readonly { description: string; expense_account_id: string; amount_minor: number }[];
  },
  who: string,
  total: string,
  today: string,
): RecurringTemplateCreateInput {
  return {
    ...schedule(expense.expense_date, who, total, today),
    document_type: "expense",
    payload: {
      vendor_id: expense.vendor_id,
      payment_account_id: expense.payment_account_id,
      memo: expense.memo,
      lines: expense.lines.map((line) => ({
        description: line.description ?? "",
        expense_account_id: line.expense_account_id,
        amount_minor: line.amount_minor,
      })),
      source: { type: "expense", id: expense.id },
    },
  };
}

export function recurringFromJournal(
  entry: {
    id: string;
    entryNumber: string;
    entryDate: string;
    description: string | null;
    lines: readonly { accountId: string; debitMinor: number; creditMinor: number }[];
  },
  total: string,
  today: string,
): RecurringTemplateCreateInput {
  const description = entry.description?.trim() || `As ${entry.entryNumber}`;
  return {
    ...schedule(entry.entryDate, description, total, today),
    document_type: "journal",
    payload: {
      description,
      source_ref: null,
      lines: entry.lines
        .filter((line) => line.debitMinor > 0 || line.creditMinor > 0)
        .map((line) => ({ account_id: line.accountId, debit_minor: line.debitMinor, credit_minor: line.creditMinor })),
      source: { type: "journal", id: entry.id },
    },
  };
}

export const ALREADY_RECURRING = "That entry is already set to recur.";
