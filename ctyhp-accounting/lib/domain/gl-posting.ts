/**
 * Reading the general ledger posting report.
 *
 * Pure. The database reports what each subledger holds and which journal entry
 * each document points at; deciding what counts as an exception is a rule, and
 * rules live here where tests can hold them to account.
 *
 * The premise: in this system posting is atomic with the document, so a live
 * document without an entry should be impossible. This module exists to prove
 * that continuously rather than to assume it.
 */

export interface PostingRow {
  sourceType: string;
  documentId: string;
  documentNumber: string | null;
  documentDate: string;
  partyName: string;
  documentStatus: string;
  amountMinor: number;
  journalEntryId: string | null;
  entryNumber: string | null;
  entryDate: string | null;
  entryStatus: string | null;
  entryTotalMinor: number;
}

/**
 * What the ledger should hold for a document in this state.
 *
 * - `expected`  — it is a live document and must have a posted entry.
 * - `none`      — a draft has no place on the ledger, and a void document's
 *                 entry is deliberately left in a void state.
 */
export type PostingExpectation = "expected" | "none";

/** Statuses that mean "this document is not on the books, and should not be". */
const OFF_LEDGER_STATUSES = new Set(["draft", "void", "rejected", "cancelled"]);

export function expectationOf(documentStatus: string): PostingExpectation {
  return OFF_LEDGER_STATUSES.has(documentStatus) ? "none" : "expected";
}

export type PostingVerdict =
  /** Live document, posted entry, amounts agree. Nothing to do. */
  | "posted"
  /** Live document with no journal entry at all — the serious one. */
  | "missing_entry"
  /** Live document whose entry exists but is not posted. */
  | "entry_not_posted"
  /** Live document whose entry does not carry the document's own total. */
  | "amount_mismatch"
  /** Draft or void — correctly absent from the ledger. */
  | "off_ledger"
  /** Draft or void that nonetheless carries a posted entry. */
  | "posted_in_error";

export interface PostingCheck extends PostingRow {
  verdict: PostingVerdict;
  /** True for anything a person needs to look at. */
  isException: boolean;
}

/**
 * A document's own total should appear on one side of its entry. Payments,
 * credits and invoices all debit or credit the full amount somewhere, so the
 * entry's debit total is the figure to compare — except where the document
 * total is zero, which carries no information either way.
 */
function amountsAgree(row: PostingRow): boolean {
  if (row.amountMinor === 0) return true;
  return row.entryTotalMinor >= Math.abs(row.amountMinor);
}

export function checkPosting(row: PostingRow): PostingCheck {
  const expectation = expectationOf(row.documentStatus);

  if (expectation === "none") {
    const verdict: PostingVerdict =
      row.journalEntryId && row.entryStatus === "posted" ? "posted_in_error" : "off_ledger";
    return { ...row, verdict, isException: verdict === "posted_in_error" };
  }

  if (!row.journalEntryId) return { ...row, verdict: "missing_entry", isException: true };
  if (row.entryStatus !== "posted") {
    return { ...row, verdict: "entry_not_posted", isException: true };
  }
  if (!amountsAgree(row)) return { ...row, verdict: "amount_mismatch", isException: true };
  return { ...row, verdict: "posted", isException: false };
}

export interface PostingSummary {
  documents: number;
  posted: number;
  offLedger: number;
  exceptions: number;
  /** Total of every live document, whether or not it posted. */
  liveTotalMinor: number;
}

export interface PostingReport {
  rows: PostingCheck[];
  /** Exceptions first, so nobody has to scroll to find them. */
  exceptions: PostingCheck[];
  summary: PostingSummary;
}

export function buildPostingReport(rows: readonly PostingRow[]): PostingReport {
  const checked = rows.map(checkPosting);
  const exceptions = checked.filter((row) => row.isException);
  const live = checked.filter((row) => expectationOf(row.documentStatus) === "expected");

  return {
    rows: checked,
    exceptions,
    summary: {
      documents: checked.length,
      posted: checked.filter((row) => row.verdict === "posted").length,
      offLedger: checked.filter((row) => row.verdict === "off_ledger").length,
      exceptions: exceptions.length,
      liveTotalMinor: live.reduce((sum, row) => sum + row.amountMinor, 0),
    },
  };
}

/** One sentence for the banner. Null when there is nothing to say. */
export function describePostingExceptions(report: PostingReport): string | null {
  if (report.exceptions.length === 0) return null;
  const missing = report.exceptions.filter((r) => r.verdict === "missing_entry").length;
  const unposted = report.exceptions.filter((r) => r.verdict === "entry_not_posted").length;
  const mismatched = report.exceptions.filter((r) => r.verdict === "amount_mismatch").length;
  const inError = report.exceptions.filter((r) => r.verdict === "posted_in_error").length;

  const parts: string[] = [];
  if (missing) parts.push(`${missing} with no journal entry`);
  if (unposted) parts.push(`${unposted} whose entry is not posted`);
  if (mismatched) parts.push(`${mismatched} whose entry does not carry the document total`);
  if (inError) parts.push(`${inError} posted that should not be`);
  return `${report.exceptions.length} document(s) need attention: ${parts.join(", ")}.`;
}

export const POSTING_VERDICT_LABEL: Record<PostingVerdict, string> = {
  posted: "Posted",
  missing_entry: "No journal entry",
  entry_not_posted: "Entry not posted",
  amount_mismatch: "Amount differs",
  off_ledger: "Not on the ledger",
  posted_in_error: "Posted in error",
};

export const SOURCE_TYPE_LABEL: Record<string, string> = {
  invoice: "Invoice",
  bill: "Bill",
  customer_payment: "Customer payment",
  vendor_payment: "Vendor payment",
  expense: "Expense",
  credit_memo: "Credit memo",
  vendor_credit: "Vendor credit",
  tax_payment: "Sales tax payment",
};

// --- Control account reconciliation -----------------------------------------

export interface ControlRow {
  controlKey: string;
  label: string;
  accountCodes: string | null;
  hasSubledger: boolean;
  subledgerMinor: number;
  controlMinor: number;
}

export interface ControlCheck extends ControlRow {
  varianceMinor: number;
  /** True when a subledger exists and it agrees with the ledger to the cent. */
  tiesOut: boolean;
  /** True for a row a person must look at before closing a period. */
  isException: boolean;
}

/**
 * An account with no subledger behind it cannot tie out to anything, so a
 * variance is meaningless there — but a balance is not. Money sitting in a
 * control account nothing feeds got there by manual journal, and that is worth
 * flagging rather than reporting as "fine".
 */
export function checkControl(row: ControlRow): ControlCheck {
  if (!row.hasSubledger) {
    return {
      ...row,
      varianceMinor: row.controlMinor,
      tiesOut: row.controlMinor === 0,
      isException: row.controlMinor !== 0,
    };
  }
  const varianceMinor = row.subledgerMinor - row.controlMinor;
  return { ...row, varianceMinor, tiesOut: varianceMinor === 0, isException: varianceMinor !== 0 };
}

export interface ControlReconciliation {
  asOf: string;
  rows: ControlCheck[];
  exceptions: ControlCheck[];
  /** True only when every control account agrees with what stands behind it. */
  allTieOut: boolean;
}

export function buildControlReconciliation(
  asOf: string,
  rows: readonly ControlRow[],
): ControlReconciliation {
  const checked = rows.map(checkControl);
  const exceptions = checked.filter((row) => row.isException);
  return { asOf, rows: checked, exceptions, allTieOut: exceptions.length === 0 };
}

/** What to put on the banner, and in the period-close refusal. */
export function describeControlExceptions(recon: ControlReconciliation): string | null {
  if (recon.allTieOut) return null;
  const named = recon.exceptions
    .map((row) => {
      const amount = (Math.abs(row.varianceMinor) / 100).toLocaleString("en-US", {
        minimumFractionDigits: 2,
      });
      return row.hasSubledger
        ? `${row.label} is out by ${amount}`
        : `${row.label} holds ${amount} with no subledger behind it`;
    })
    .join("; ");
  return `${recon.exceptions.length} control account(s) do not tie out as of ${recon.asOf}: ${named}.`;
}
