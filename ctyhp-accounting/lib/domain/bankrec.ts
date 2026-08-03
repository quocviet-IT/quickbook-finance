/**
 * Pure bank-reconciliation math. The bank GL account is debit-normal, so a
 * cleared line's contribution is +amount_base when it debits the bank (a deposit)
 * and -amount_base when it credits it (a payment). Mirrors acc_recon_* in SQL.
 */
import { type JournalLineInput, assertBalanced } from "./posting";
import { type Minor } from "./money";

export interface ClearedLine {
  debitMinor: number;
  creditMinor: number;
  amountBaseMinor: number;
}

export function signedBaseMinor(line: ClearedLine): number {
  return line.debitMinor > 0 ? line.amountBaseMinor : -line.amountBaseMinor;
}

export function computeReconciliation(
  beginningMinor: number,
  cleared: ClearedLine[],
  statementEndingMinor: number,
): { clearedTotalMinor: number; reconciledBalanceMinor: number; differenceMinor: number; isBalanced: boolean } {
  const clearedTotalMinor = cleared.reduce((s, l) => s + signedBaseMinor(l), 0);
  const reconciledBalanceMinor = beginningMinor + clearedTotalMinor;
  const differenceMinor = statementEndingMinor - reconciledBalanceMinor;
  return { clearedTotalMinor, reconciledBalanceMinor, differenceMinor, isBalanced: differenceMinor === 0 };
}

/**
 * Adjustment for a residual difference. difference>0 → bank must increase (DR bank
 * / CR offset); difference<0 → bank must decrease (CR bank / DR offset).
 */
export function buildAdjustmentPosting(input: {
  bankAccountId: string;
  offsetAccountId: string;
  differenceMinor: number;
}): JournalLineInput[] {
  const amt: Minor = Math.abs(input.differenceMinor);
  if (amt === 0) throw new Error("No difference to adjust");
  const lines: JournalLineInput[] =
    input.differenceMinor > 0
      ? [
          { accountId: input.bankAccountId, debitMinor: amt, creditMinor: 0, memo: "Reconciliation adjustment" },
          { accountId: input.offsetAccountId, debitMinor: 0, creditMinor: amt, memo: "Reconciliation adjustment" },
        ]
      : [
          { accountId: input.bankAccountId, debitMinor: 0, creditMinor: amt, memo: "Reconciliation adjustment" },
          { accountId: input.offsetAccountId, debitMinor: amt, creditMinor: 0, memo: "Reconciliation adjustment" },
        ];
  assertBalanced(lines);
  return lines;
}

// --- Statement line review state ---------------------------------------------

export type StatementLineState = "matched" | "requires_review" | "unmatched" | "excluded";

export const STATEMENT_LINE_STATES: Record<StatementLineState, { label: string; color: string }> = {
  matched: { label: "Matched", color: "green" },
  requires_review: { label: "Requires review", color: "gold" },
  unmatched: { label: "Unmatched", color: "orange" },
  excluded: { label: "Excluded", color: "default" },
};

/**
 * Where a statement line stands in the reconciliation.
 *
 * The distinction that matters is between an approved link and a suggestion
 * nobody has accepted. `acc_reconciliation` holds both — `approved` sets the
 * bank line to `matched`, while `suggested` leaves it `unmatched` — and showing
 * them the same way tells an accountant a line is settled when a machine has
 * only guessed at it. In a reconciliation that is the one confusion that must
 * not happen.
 *
 * An unrecognised status falls to `unmatched`, so a state added later surfaces
 * as something to look at rather than quietly counting as done.
 */
export function statementLineState(status: string, hasSuggestion: boolean): StatementLineState {
  if (status === "matched") return "matched";
  if (status === "ignored") return "excluded";
  return hasSuggestion ? "requires_review" : "unmatched";
}

export interface StatementLineSummary {
  total: number;
  matched: number;
  requiresReview: number;
  unmatched: number;
  excluded: number;
  /** Lines neither settled nor deliberately excluded — the work still to do. */
  outstanding: number;
}

/** How much of the statement is done, and how much is still an exception. */
export function summariseStatementLines(
  lines: readonly { status: string; hasSuggestion: boolean }[],
): StatementLineSummary {
  const summary: StatementLineSummary = {
    total: lines.length,
    matched: 0,
    requiresReview: 0,
    unmatched: 0,
    excluded: 0,
    outstanding: 0,
  };
  for (const line of lines) {
    switch (statementLineState(line.status, line.hasSuggestion)) {
      case "matched":
        summary.matched += 1;
        break;
      case "requires_review":
        summary.requiresReview += 1;
        summary.outstanding += 1;
        break;
      case "unmatched":
        summary.unmatched += 1;
        summary.outstanding += 1;
        break;
      case "excluded":
        summary.excluded += 1;
        break;
    }
  }
  return summary;
}
