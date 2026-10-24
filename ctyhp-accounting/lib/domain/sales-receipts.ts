/**
 * Sales receipts (2.53): a sale paid on the spot.
 *
 * The money goes straight to a deposit account and nothing is owed, so a
 * receipt never touches Accounts Receivable, aging or a customer statement.
 * Saving one posts it (migration 0164); a mistake is voided with a reason and
 * the sale entered again, as an issued invoice is. These are the rules and
 * words the screen and the printed receipt share.
 */
import type { AccountRow } from "@/lib/db/types";
import { USD_DECIMAL_PLACES } from "@/lib/domain/currency";
import {
  documentBillTo,
  documentLines,
  documentSeller,
  documentTotals,
  linesMatchingTotal,
  type DocumentCompany,
  type DocumentCustomer,
  type DocumentSourceLine,
  type PrintedDocument,
} from "@/lib/domain/invoice-document";
import { formatMoney } from "@/lib/format";

/** The ways a customer pays at the counter, as Receive payment offers them. */
export const SALES_RECEIPT_METHODS = ["cash", "check", "card", "bank_transfer"] as const;
export type SalesReceiptMethod = (typeof SALES_RECEIPT_METHODS)[number];

export const SALES_RECEIPT_METHOD_LABEL: Record<SalesReceiptMethod, string> = {
  cash: "Cash",
  check: "Check",
  card: "Card",
  bank_transfer: "Bank transfer",
};

export type SalesReceiptStatus = "posted" | "void";

/** One receipt as the list shows it. */
export interface SalesReceiptRow {
  id: string;
  receipt_number: string;
  receipt_date: string;
  customer_id: string;
  customer_name: string;
  deposit_account_id: string;
  deposit_account_label: string;
  payment_method: SalesReceiptMethod | null;
  reference: string | null;
  memo: string | null;
  subtotal_minor: number;
  tax_minor: number;
  total_minor: number;
  status: SalesReceiptStatus;
  journal_entry_id: string | null;
  void_reason: string | null;
  voided_at: string | null;
}

/** One stored line of a receipt. */
export interface SalesReceiptLineRow extends DocumentSourceLine {
  id: string;
  receipt_id: string;
  item_id: string | null;
  income_account_id: string;
  tax_code_id: string | null;
}

/**
 * Where a receipt's money may go: an active bank or cash account, or 1210
 * Undeposited Funds, the same choice Receive payment gives (0164 checks it
 * again). Ordered by code.
 */
export function depositAccountChoices(accounts: readonly AccountRow[]): AccountRow[] {
  return accounts
    .filter(
      (a) =>
        a.status === "active" &&
        a.is_posting_account &&
        (a.account_type === "bank" || a.detail_type === "undeposited_funds"),
    )
    .sort((a, b) => a.account_code.localeCompare(b.account_code));
}

/**
 * The deposit account a new receipt starts on: the first bank account, so the
 * deposit the bank later shows is matched to the receipt in Bank Transactions.
 * OneBook has no Bank Deposit to move money out of Undeposited Funds yet, so
 * that is offered but never the default. Cash on Hand comes after the banks.
 */
export function defaultDepositAccountId(choices: readonly AccountRow[]): string | null {
  const banks = choices.filter((a) => a.account_type === "bank" && a.detail_type !== "cash_on_hand");
  return (banks[0] ?? choices.find((a) => a.account_type === "bank") ?? choices[0])?.id ?? null;
}

/** "Cash · check 1042", "Card", or null when neither is known. */
export function paymentLine(method: SalesReceiptMethod | null, reference: string | null): string | null {
  const parts = [method ? SALES_RECEIPT_METHOD_LABEL[method] : null, reference?.trim() || null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

// --- The printed receipt -----------------------------------------------------

/** Printed at the foot of every receipt that is not void. */
export const SALES_RECEIPT_CLOSING_LINE = "Paid in full. Thank you for your business.";

export interface SalesReceiptDocumentSource {
  receipt: {
    receipt_number: string;
    receipt_date: string;
    currency_code: string;
    payment_method: SalesReceiptMethod | null;
    reference: string | null;
    subtotal_minor: number;
    tax_minor: number;
    total_minor: number;
    memo: string | null;
    status: SalesReceiptStatus;
  };
  lines: DocumentSourceLine[];
  customer: DocumentCustomer;
  company: DocumentCompany;
}

export interface SalesReceiptDocument extends PrintedDocument {
  footer: string;
  /** Nothing was billed: the customer is who it was sold to. */
  partyHeading: string;
  /** `Sales receipt SR-000001 <customer>.pdf`. */
  fileName: string;
}

/** Characters no file system takes in a name, and control characters. */
const UNSAFE_IN_FILE_NAME = /[\u0000-\u001f\u007f<>:"/\\|?*]+/g;

export function salesReceiptFileName(receiptNumber: string, customerName: string): string {
  const customer = customerName.replace(UNSAFE_IN_FILE_NAME, " ").replace(/\s+/g, " ").trim();
  return `${[`Sales receipt ${receiptNumber}`, customer].filter((part) => part.length > 0).join(" ")}.pdf`;
}

/**
 * The invoice's printed layout, titled Sales Receipt, its totals ending in
 * Paid, with how it was paid among the details. A void receipt carries a VOID
 * watermark and no "Paid in full".
 */
export function buildSalesReceiptDocument(source: SalesReceiptDocumentSource): SalesReceiptDocument {
  const { receipt, customer, company } = source;
  const money = (minor: number) => formatMoney(minor, receipt.currency_code, USD_DECIMAL_PLACES);
  const lines = linesMatchingTotal(source.lines, receipt.total_minor, "Sales receipt");
  const paidBy = paymentLine(receipt.payment_method, receipt.reference);
  const isVoid = receipt.status === "void";
  return {
    title: `Sales Receipt ${receipt.receipt_number}`,
    watermark: isVoid ? "VOID" : null,
    seller: documentSeller(company),
    billTo: documentBillTo(customer),
    meta: [
      { label: "Receipt date", value: receipt.receipt_date },
      ...(paidBy ? [{ label: "Paid by", value: paidBy }] : []),
    ],
    lines: documentLines(lines, money),
    totals: [
      ...documentTotals(
        { subtotalMinor: receipt.subtotal_minor, taxMinor: receipt.tax_minor, totalMinor: receipt.total_minor },
        money,
      ),
      ...(isVoid ? [] : [{ label: "Paid", amount: money(receipt.total_minor) }]),
    ],
    memo: receipt.memo?.trim() || null,
    footer: isVoid ? "This receipt was voided." : SALES_RECEIPT_CLOSING_LINE,
    partyHeading: "SOLD TO",
    fileName: salesReceiptFileName(receipt.receipt_number, customer.name),
  };
}
