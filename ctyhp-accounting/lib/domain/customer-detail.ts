/**
 * What a customer's page says about them: the facts strip and the list of
 * every document. Pure (3.0.12, docs/superpowers/specs/2026-11-10-customer-detail-page-design.md).
 *
 * Owed and overdue are summed from the open invoices the page lists, so the
 * strip and the table under it can never disagree. "Overdue" is
 * invoiceAttention's rule. Limit, availability and DSO come from the credit
 * row, because they depend on more than the open invoices.
 */
import { invoiceAttention, type AttentionInvoice } from "@/lib/domain/invoice-attention";
import type { CustomerCreditRow } from "@/lib/services/credit";

export interface CustomerFactsInput {
  creditTermsDays: number | null;
  defaultTermsDays: number;
  /** Null when the credit status could not be read. */
  credit: CustomerCreditRow | null;
  openInvoices: readonly AttentionInvoice[];
  today: string;
}

export interface CustomerFacts {
  owedMinor: number;
  openCount: number;
  overdueMinor: number;
  /** Days past due of the latest open invoice; null when none is overdue. */
  oldestLateDays: number | null;
  availableMinor: number | null;
  limitMinor: number | null;
  termsDays: number;
  termsAreDefault: boolean;
  dsoDays: number | null;
  creditKnown: boolean;
}

export function customerFacts(input: CustomerFactsInput): CustomerFacts {
  let owedMinor = 0;
  let overdueMinor = 0;
  let oldestLateDays: number | null = null;
  for (const invoice of input.openInvoices) {
    owedMinor += invoice.balance_due_minor;
    const attention = invoiceAttention(invoice, input.today);
    if (attention.kind === "overdue") {
      overdueMinor += invoice.balance_due_minor;
      oldestLateDays = Math.max(oldestLateDays ?? 0, attention.days);
    }
  }
  return {
    owedMinor,
    openCount: input.openInvoices.length,
    overdueMinor,
    oldestLateDays,
    availableMinor: input.credit?.status.availableMinor ?? null,
    limitMinor: input.credit?.creditLimitMinor ?? null,
    termsDays: input.creditTermsDays ?? input.defaultTermsDays,
    termsAreDefault: input.creditTermsDays === null,
    dsoDays: input.credit?.status.daysSalesOutstanding ?? null,
    creditKnown: input.credit !== null,
  };
}

export const CUSTOMER_TRANSACTION_TYPES = ["invoice", "payment", "credit_memo", "sales_receipt"] as const;
export type CustomerTransactionType = (typeof CUSTOMER_TRANSACTION_TYPES)[number];

const TYPE_LABELS: Record<CustomerTransactionType, string> = {
  invoice: "Invoice",
  payment: "Payment",
  credit_memo: "Credit memo",
  sales_receipt: "Sales receipt",
};

export function transactionTypeLabel(type: CustomerTransactionType): string {
  return TYPE_LABELS[type];
}

export interface CustomerTransaction {
  id: string;
  type: CustomerTransactionType;
  date: string;
  number: string | null;
  reference: string | null;
  amountMinor: number;
  currencyCode: string;
  status: string;
}

export interface CustomerTransactionParts {
  invoices: { id: string; invoice_number: string | null; issue_date: string; total_minor: number; currency_code: string; status: string; memo: string | null }[];
  payments: { id: string; payment_number: string | null; payment_date: string; amount_minor: number; currency_code: string; status: string; memo: string | null }[];
  creditMemos: { id: string; credit_memo_number: string | null; memo_date: string; total_minor: number; currency_code: string; status: string; memo: string | null }[];
  salesReceipts: { id: string; receipt_number: string; receipt_date: string; total_minor: number; currency_code: string; status: string; reference: string | null }[];
}

/** Newest first; on one date, payments and credits before the invoices they settle. */
export function mergeCustomerTransactions(parts: CustomerTransactionParts): CustomerTransaction[] {
  const rank: Record<CustomerTransactionType, number> = { payment: 0, credit_memo: 1, sales_receipt: 2, invoice: 3 };
  const rows: CustomerTransaction[] = [
    ...parts.invoices.map((r) => ({ id: r.id, type: "invoice" as const, date: r.issue_date, number: r.invoice_number, reference: r.memo, amountMinor: r.total_minor, currencyCode: r.currency_code, status: r.status })),
    ...parts.payments.map((r) => ({ id: r.id, type: "payment" as const, date: r.payment_date, number: r.payment_number, reference: r.memo, amountMinor: r.amount_minor, currencyCode: r.currency_code, status: r.status })),
    ...parts.creditMemos.map((r) => ({ id: r.id, type: "credit_memo" as const, date: r.memo_date, number: r.credit_memo_number, reference: r.memo, amountMinor: r.total_minor, currencyCode: r.currency_code, status: r.status })),
    ...parts.salesReceipts.map((r) => ({ id: r.id, type: "sales_receipt" as const, date: r.receipt_date, number: r.receipt_number, reference: r.reference, amountMinor: r.total_minor, currencyCode: r.currency_code, status: r.status })),
  ];
  return rows.sort((a, b) => b.date.localeCompare(a.date) || rank[a.type] - rank[b.type] || (b.number ?? "").localeCompare(a.number ?? ""));
}
