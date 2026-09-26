/**
 * The eight checks a reviewer runs by hand.
 *
 * From the client's prototype: "None of these is proof of an error. Each is a
 * question worth answering." Nothing here accuses; each check raises a
 * question, and the value is that somebody looked and can say why.
 *
 * This module is pure. It receives data that has already been read and returns
 * an answer. It imports nothing from `@/lib/db` or `@/lib/services`, and a test
 * in `tests/unit/exceptions.test.ts` fails if that ever changes — because a
 * report that could write is a report nobody can safely run on live books.
 *
 * Money is integer minor units, base currency, throughout.
 */

import { naturalBalance, type AccountType } from "@/lib/domain/accounts";
import type { LedgerBalance } from "@/lib/domain/reports";
import type { TransactionListRow } from "@/lib/domain/transaction-list";

/** Re-exported so a caller needs one import to build the input, not three. */
export type { LedgerBalance, TransactionListRow };

/**
 * The eight, named once.
 *
 * The screen draws its section headings from here and the service names a
 * failed read from here, so a check cannot be called two different things in
 * two different places.
 */
export const CHECK_LABEL = {
  duplicates: "Entries recorded more than once",
  checkNumber: "A check number used twice on one account",
  undeposited: "Money received but not yet banked",
  wrongWay: "A balance pointing the wrong way",
  incomeNoCost: "A year with income and no costs",
  unreconciled: "Bank accounts not agreed to a statement",
  futureDated: "Entries dated in the future",
  holding: "Still sitting in a holding account",
} as const;

export type CheckKey = keyof typeof CHECK_LABEL;

/* ---------------------------------------------------------------- inputs */

/**
 * An account with its cumulative balance and the classification the checks need.
 *
 * Extends `LedgerBalance` rather than restating it: the report reads its
 * balances through `acc_ledger_balances`, and a second "account with a balance"
 * shape would be free to drift from the first.
 */
export interface ExceptionAccount extends LedgerBalance {
  /**
   * OneBook records that an account is contra rather than guessing from its
   * name: migration 0046 creates "Accumulated Depreciation" with
   * `detail_type = 'Contra fixed asset'`.
   */
  detailType: string | null;
}

export interface ExceptionBankAccount {
  bankAccountId: string;
  /** The general-ledger account behind the bank account. */
  accountId: string;
  accountName: string;
  /** The latest completed reconciliation's statement date, or null for never. */
  lastReconciledDate: string | null;
}

/** A payment carrying the reference a statement is reconciled by. */
export interface ExceptionPaymentRef {
  paymentId: string;
  kind: "customer" | "vendor";
  paymentNumber: string | null;
  paymentDate: string;
  reference: string;
  /** The bank or credit-card account the money moved through. */
  accountId: string;
  accountName: string;
  partyName: string;
  amountMinor: number;
}

/** How long money has been sitting in a holding account, and in how many pieces. */
export interface UndepositedDetail {
  entryCount: number;
  oldestEntryDate: string | null;
}

export interface YearTotals {
  year: string;
  incomeMinor: number;
  costMinor: number;
}

/* --------------------------------------------------------------- outputs */

export interface WrongWayRow {
  accountId: string;
  accountCode: string;
  name: string;
  accountType: AccountType;
  /** Debit-positive, so a credit balance reads negative. */
  balanceMinor: number;
}

const CONTRA = /^\s*contra\b/i;

/** Debit-positive, so a credit balance reads negative. */
function signedBalance(account: ExceptionAccount): number {
  return account.debitBase - account.creditBase;
}

/**
 * Largest question first.
 *
 * Every balance check orders its findings this way, so it is written once: a
 * reviewer works down from the figure most worth explaining.
 */
function byLargestFirst<T extends { balanceMinor: number }>(rows: T[]): T[] {
  return rows.sort((x, y) => Math.abs(y.balanceMinor) - Math.abs(x.balanceMinor));
}

/**
 * An asset in credit, or a liability in debit.
 *
 * Sometimes right — an overdrawn account, a supplier overpaid — and sometimes a
 * posting on the wrong side. Contra accounts are left out, because pointing the
 * other way is their whole purpose.
 */
export function wrongWayBalances(accounts: readonly ExceptionAccount[]): WrongWayRow[] {
  const rows: WrongWayRow[] = [];
  for (const a of accounts) {
    if (CONTRA.test(a.detailType ?? "")) continue;
    if (naturalBalance(a.accountType, a.debitBase, a.creditBase) >= 0) continue;
    rows.push({
      accountId: a.accountId,
      accountCode: a.accountCode,
      name: a.name,
      accountType: a.accountType,
      balanceMinor: signedBalance(a),
    });
  }
  return byLargestFirst(rows);
}

export interface HoldingRow {
  accountId: string;
  accountCode: string;
  name: string;
  balanceMinor: number;
}

/**
 * Both spellings of "uncategorised" are matched. The interface writes the
 * American one, but a chart imported from elsewhere may not.
 */
const HOLDING = /uncategori[sz]ed|suspense|ask my accountant/i;

/**
 * Anything left in a holding account has not been given a real account yet, so
 * it is in the wrong place on both statements.
 */
export function holdingAccounts(accounts: readonly ExceptionAccount[]): HoldingRow[] {
  const rows: HoldingRow[] = [];
  for (const a of accounts) {
    const balanceMinor = signedBalance(a);
    if (balanceMinor === 0 || !HOLDING.test(a.name)) continue;
    rows.push({ accountId: a.accountId, accountCode: a.accountCode, name: a.name, balanceMinor });
  }
  return byLargestFirst(rows);
}

export interface UndepositedRow {
  accountId: string;
  accountCode: string;
  name: string;
  balanceMinor: number;
  entryCount: number;
  oldestEntryDate: string | null;
}

const UNDEPOSITED_NAME = /undeposited/i;
/** The seeded chart's code for it; accepted alongside the name, never instead. */
const UNDEPOSITED_CODE = "1210";

/**
 * Undeposited funds should empty as takings reach the bank. A balance that
 * keeps growing means the sales are recorded but the deposits are not —
 * revenue is in the books, the cash is not.
 */
export function undepositedFunds(
  accounts: readonly ExceptionAccount[],
  details: ReadonlyMap<string, UndepositedDetail>,
): UndepositedRow[] {
  const rows: UndepositedRow[] = [];
  for (const a of accounts) {
    const balanceMinor = signedBalance(a);
    if (balanceMinor === 0) continue;
    if (!UNDEPOSITED_NAME.test(a.name) && a.accountCode !== UNDEPOSITED_CODE) continue;
    const detail = details.get(a.accountId);
    rows.push({
      accountId: a.accountId,
      accountCode: a.accountCode,
      name: a.name,
      balanceMinor,
      entryCount: detail?.entryCount ?? 0,
      oldestEntryDate: detail?.oldestEntryDate ?? null,
    });
  }
  return byLargestFirst(rows);
}

export interface UnreconciledRow {
  bankAccountId: string;
  accountId: string;
  accountName: string;
  balanceMinor: number;
  lastReconciledDate: string | null;
}

/**
 * A balance nobody has proved against the bank.
 *
 * An account with nothing in it is not asked about: there is no balance to
 * prove, and a closed account would otherwise stay on the list forever.
 */
export function unreconciledBankAccounts(
  banks: readonly ExceptionBankAccount[],
  balanceByAccountId: ReadonlyMap<string, number>,
  to: string,
): UnreconciledRow[] {
  const rows: UnreconciledRow[] = [];
  for (const b of banks) {
    const balanceMinor = balanceByAccountId.get(b.accountId) ?? 0;
    if (balanceMinor === 0) continue;
    if (b.lastReconciledDate !== null && b.lastReconciledDate >= to) continue;
    rows.push({
      bankAccountId: b.bankAccountId,
      accountId: b.accountId,
      accountName: b.accountName,
      balanceMinor,
      lastReconciledDate: b.lastReconciledDate,
    });
  }
  return rows.sort((x, y) => x.accountName.localeCompare(y.accountName));
}
