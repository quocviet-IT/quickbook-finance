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
