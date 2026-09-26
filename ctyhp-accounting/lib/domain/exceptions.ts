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
      balanceMinor: a.debitBase - a.creditBase,
    });
  }
  return rows.sort((x, y) => Math.abs(y.balanceMinor) - Math.abs(x.balanceMinor));
}
