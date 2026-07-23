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

export interface ExpenseAllocationLine {
  expenseAccountId: string;
  amountMinor: Minor;
}

function groupExpenseLines(lines: ExpenseAllocationLine[]): Map<string, Minor> {
  const byAccount = new Map<string, Minor>();
  for (const l of lines) {
    byAccount.set(l.expenseAccountId, (byAccount.get(l.expenseAccountId) ?? 0) + l.amountMinor);
  }
  return byAccount;
}

export interface BillPostingInput {
  apAccountId: string;
  lines: ExpenseAllocationLine[];
}

/**
 * Bill posted (open):
 *   DR Expense (grouped per account) = each line amount (tax-inclusive, US model)
 *   CR Accounts Payable             = total
 */
export function buildBillPosting(input: BillPostingInput): JournalLineInput[] {
  const lines: JournalLineInput[] = [];
  let total: Minor = 0;
  for (const [accountId, amount] of groupExpenseLines(input.lines)) {
    if (amount !== 0) {
      lines.push({ accountId, debitMinor: amount, creditMinor: 0, memo: "Expense" });
      total += amount;
    }
  }
  lines.push({ accountId: input.apAccountId, debitMinor: 0, creditMinor: total, memo: "Accounts payable" });
  assertBalanced(lines);
  return lines;
}

export interface ExpensePostingInput {
  paymentAccountId: string;
  lines: ExpenseAllocationLine[];
}

/**
 * Expense (paid immediately):
 *   DR Expense (grouped per account)
 *   CR Bank / Credit Card = total
 */
export function buildExpensePosting(input: ExpensePostingInput): JournalLineInput[] {
  const lines: JournalLineInput[] = [];
  let total: Minor = 0;
  for (const [accountId, amount] of groupExpenseLines(input.lines)) {
    if (amount !== 0) {
      lines.push({ accountId, debitMinor: amount, creditMinor: 0, memo: "Expense" });
      total += amount;
    }
  }
  lines.push({ accountId: input.paymentAccountId, debitMinor: 0, creditMinor: total, memo: "Payment" });
  assertBalanced(lines);
  return lines;
}

export interface BillPaymentPostingInput {
  apAccountId: string;
  paymentAccountId: string;
  amountMinor: Minor;
}

/**
 * Bill payment:
 *   DR Accounts Payable   = amount
 *   CR Bank / Credit Card = amount
 */
export function buildBillPaymentPosting(input: BillPaymentPostingInput): JournalLineInput[] {
  const lines: JournalLineInput[] = [
    { accountId: input.apAccountId, debitMinor: input.amountMinor, creditMinor: 0, memo: "Pay accounts payable" },
    { accountId: input.paymentAccountId, debitMinor: 0, creditMinor: input.amountMinor, memo: "Bank/credit payment" },
  ];
  assertBalanced(lines);
  return lines;
}

export interface OpeningLine {
  accountId: string;
  debitMinor: Minor;
  creditMinor: Minor;
}

/**
 * Opening balances: caller-supplied per-account lines, with the net difference
 * booked to Opening Balance Equity so the entry balances. Mirrors the SQL in
 * acc_post_opening_balances; kept pure for testing and client-side preview.
 */
export function buildOpeningBalancePosting(
  lines: OpeningLine[],
  equityAccountId: string,
): JournalLineInput[] {
  const out: JournalLineInput[] = lines
    .filter((l) => l.debitMinor !== 0 || l.creditMinor !== 0)
    .map((l) => ({ accountId: l.accountId, debitMinor: l.debitMinor, creditMinor: l.creditMinor }));
  const net = out.reduce((s, l) => s + l.debitMinor - l.creditMinor, 0);
  if (net !== 0) {
    out.push({
      accountId: equityAccountId,
      debitMinor: net < 0 ? -net : 0,
      creditMinor: net > 0 ? net : 0,
      memo: "Opening balance equity",
    });
  }
  assertBalanced(out);
  return out;
}

export interface CreditMemoPostingInput {
  arAccountId: string;
  taxPayableAccountId: string | null;
  lines: InvoicePostingLine[];
}

/** Credit memo issued: DR income (per account), DR tax payable, CR AR = total. */
export function buildCreditMemoPosting(input: CreditMemoPostingInput): JournalLineInput[] {
  const totalMinor = input.lines.reduce((s, l) => s + l.subtotalMinor + l.taxMinor, 0);
  const taxTotalMinor = input.lines.reduce((s, l) => s + l.taxMinor, 0);
  const lines: JournalLineInput[] = [];
  const byIncome = new Map<string, Minor>();
  for (const l of input.lines) {
    byIncome.set(l.incomeAccountId, (byIncome.get(l.incomeAccountId) ?? 0) + l.subtotalMinor);
  }
  for (const [accountId, amount] of byIncome) {
    if (amount !== 0) lines.push({ accountId, debitMinor: amount, creditMinor: 0, memo: "Credit memo income" });
  }
  if (taxTotalMinor > 0) {
    if (!input.taxPayableAccountId) throw new Error("Credit memo has tax but no tax payable account was provided");
    lines.push({ accountId: input.taxPayableAccountId, debitMinor: taxTotalMinor, creditMinor: 0, memo: "Credit memo tax" });
  }
  lines.push({ accountId: input.arAccountId, debitMinor: 0, creditMinor: totalMinor, memo: "Accounts receivable credit" });
  assertBalanced(lines);
  return lines;
}

export interface VendorCreditPostingInput {
  apAccountId: string;
  lines: ExpenseAllocationLine[];
}

/** Vendor credit issued: DR AP = total, CR expense (grouped per account). */
export function buildVendorCreditPosting(input: VendorCreditPostingInput): JournalLineInput[] {
  const byAccount = new Map<string, Minor>();
  for (const l of input.lines) byAccount.set(l.expenseAccountId, (byAccount.get(l.expenseAccountId) ?? 0) + l.amountMinor);
  let total: Minor = 0;
  const credits: JournalLineInput[] = [];
  for (const [accountId, amount] of byAccount) {
    if (amount !== 0) { credits.push({ accountId, debitMinor: 0, creditMinor: amount, memo: "Vendor credit expense" }); total += amount; }
  }
  const lines: JournalLineInput[] = [
    { accountId: input.apAccountId, debitMinor: total, creditMinor: 0, memo: "Accounts payable credit" },
    ...credits,
  ];
  assertBalanced(lines);
  return lines;
}

/** Customer refund: DR AR / CR bank. */
export function buildRefundPosting(input: { arAccountId: string; bankAccountId: string; amountMinor: Minor }): JournalLineInput[] {
  const lines: JournalLineInput[] = [
    { accountId: input.arAccountId, debitMinor: input.amountMinor, creditMinor: 0, memo: "Refund to customer" },
    { accountId: input.bankAccountId, debitMinor: 0, creditMinor: input.amountMinor, memo: "Bank payment" },
  ];
  assertBalanced(lines);
  return lines;
}

/** Write-off. AR: DR offset expense / CR AR. AP: DR AP / CR offset income. */
export function buildWriteOffPosting(input: {
  side: "ar" | "ap"; controlAccountId: string; offsetAccountId: string; amountMinor: Minor;
}): JournalLineInput[] {
  const lines: JournalLineInput[] =
    input.side === "ar"
      ? [
          { accountId: input.offsetAccountId, debitMinor: input.amountMinor, creditMinor: 0, memo: "Bad debt write-off" },
          { accountId: input.controlAccountId, debitMinor: 0, creditMinor: input.amountMinor, memo: "Write off receivable" },
        ]
      : [
          { accountId: input.controlAccountId, debitMinor: input.amountMinor, creditMinor: 0, memo: "Write off payable" },
          { accountId: input.offsetAccountId, debitMinor: 0, creditMinor: input.amountMinor, memo: "Payable write-off income" },
        ];
  assertBalanced(lines);
  return lines;
}
