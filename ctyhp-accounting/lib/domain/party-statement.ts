/**
 * The words of the Customer and Vendor Statements (2.81): what each line is,
 * and how the balances read.
 *
 * Since 0178 the opening is the same activity as the lines, dated before the
 * period, so the opening plus the lines is what was owed on the last day, and
 * one period's closing is the next one's opening.
 */
import { humanizeStatus } from "./status-label";

const DOC_TYPES: Record<string, string> = {
  invoice: "Invoice",
  payment: "Payment",
  credit_memo: "Credit memo",
  refund: "Refund",
  write_off: "Write-off",
  bill: "Bill",
  bill_payment: "Bill payment",
  vendor_credit: "Vendor credit",
  discount: "Early payment discount",
};

/** A line's kind as the statement names it; a kind not named here still reads as words. */
export function statementDocType(docType: string): string {
  return DOC_TYPES[docType] ?? humanizeStatus(docType);
}

/**
 * How to pay, from the company's settings (2.83), on a customer's statement
 * that closes owing something (2.87); never on a vendor's, which is what the
 * company owes, nor on one that asks for nothing, as a paid invoice does not.
 */
export function statementPayNote(kind: "customer" | "vendor", closingMinor: number, payNote: string | null | undefined): string | null {
  if (kind !== "customer" || closingMinor <= 0) return null;
  return payNote?.trim() || null;
}

/** The footnote under the lines. */
export function statementFootnote(kind: "customer" | "vendor"): string {
  const moves =
    kind === "customer"
      ? "invoices and refunds, less payments, credit memos and write-offs"
      : "bills, less bill payments, vendor credits, early payment discounts and write-offs";
  return (
    `The opening balance is everything dated before the first day: ${moves}. Nothing dated later changes it. ` +
    "Each line moves it, and the closing balance is what was owed on the last day. " +
    "Drafts and voided documents are left out."
  );
}
