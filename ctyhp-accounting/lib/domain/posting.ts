/**
 * Pure double-entry posting rules: turn a business document into a set of
 * balanced journal lines. These builders guarantee debit == credit by
 * construction; the same invariant is independently enforced at the database
 * level by a deferred constraint trigger (see supabase migration 0001).
 */

import type { Minor } from "./money";

export interface JournalLineInput {
  accountId: string;
  debitMinor: Minor;
  creditMinor: Minor;
  memo?: string;
}

export function totalDebit(lines: JournalLineInput[]): Minor {
  return lines.reduce((s, l) => s + l.debitMinor, 0);
}

export function totalCredit(lines: JournalLineInput[]): Minor {
  return lines.reduce((s, l) => s + l.creditMinor, 0);
}

export function isBalanced(lines: JournalLineInput[]): boolean {
  return totalDebit(lines) === totalCredit(lines);
}

export function assertBalanced(lines: JournalLineInput[]): void {
  for (const l of lines) {
    const positives = (l.debitMinor > 0 ? 1 : 0) + (l.creditMinor > 0 ? 1 : 0);
    if (positives !== 1 || l.debitMinor < 0 || l.creditMinor < 0) {
      throw new Error(
        `Journal line for account ${l.accountId} must have exactly one positive side ` +
          `(debit=${l.debitMinor}, credit=${l.creditMinor})`,
      );
    }
  }
  if (!isBalanced(lines)) {
    throw new Error(
      `Journal entry not balanced: debit=${totalDebit(lines)} credit=${totalCredit(lines)}`,
    );
  }
}

export interface InvoicePostingLine {
  incomeAccountId: string;
  subtotalMinor: Minor;
  taxMinor: Minor;
}

export interface InvoicePostingInput {
  arAccountId: string;
  taxPayableAccountId: string | null;
  lines: InvoicePostingLine[];
}

/**
 * Invoice issued:
 *   DR Accounts Receivable  = total (subtotal + tax)
 *   CR Income               = subtotal, grouped per income account
 *   CR Tax Payable          = total tax (if any)
 */
export function buildInvoicePosting(input: InvoicePostingInput): JournalLineInput[] {
  const totalMinor = input.lines.reduce((s, l) => s + l.subtotalMinor + l.taxMinor, 0);
  const taxTotalMinor = input.lines.reduce((s, l) => s + l.taxMinor, 0);

  const lines: JournalLineInput[] = [
    { accountId: input.arAccountId, debitMinor: totalMinor, creditMinor: 0, memo: "Accounts receivable" },
  ];

  const byIncome = new Map<string, Minor>();
  for (const l of input.lines) {
    byIncome.set(l.incomeAccountId, (byIncome.get(l.incomeAccountId) ?? 0) + l.subtotalMinor);
  }
  for (const [accountId, amount] of byIncome) {
    if (amount !== 0) lines.push({ accountId, debitMinor: 0, creditMinor: amount, memo: "Income" });
  }

  if (taxTotalMinor > 0) {
    if (!input.taxPayableAccountId) {
      throw new Error("Invoice has tax but no tax payable account was provided");
    }
    lines.push({
      accountId: input.taxPayableAccountId,
      debitMinor: 0,
      creditMinor: taxTotalMinor,
      memo: "Tax payable",
    });
  }

  assertBalanced(lines);
  return lines;
}

export interface PaymentPostingInput {
  depositAccountId: string;
  arAccountId: string;
  amountMinor: Minor;
}

/**
 * Payment received:
 *   DR Deposit bank account = amount
 *   CR Accounts Receivable  = amount
 */
export function buildPaymentPosting(input: PaymentPostingInput): JournalLineInput[] {
  const lines: JournalLineInput[] = [
    { accountId: input.depositAccountId, debitMinor: input.amountMinor, creditMinor: 0, memo: "Bank deposit" },
    { accountId: input.arAccountId, debitMinor: 0, creditMinor: input.amountMinor, memo: "Clear receivable" },
  ];
  assertBalanced(lines);
  return lines;
}

/** Reverse an existing set of lines (used to void a posted document). */
export function reverse(lines: JournalLineInput[]): JournalLineInput[] {
  return lines.map((l) => ({
    accountId: l.accountId,
    debitMinor: l.creditMinor,
    creditMinor: l.debitMinor,
    memo: l.memo ? `Reversal: ${l.memo}` : "Reversal",
  }));
}
