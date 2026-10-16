/**
 * The twelve checks a reviewer runs by hand.
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

import { ACCOUNT_TYPE_LABEL, naturalBalance, type AccountType } from "@/lib/domain/accounts";
import { entryDisplayName, sourceLabel } from "@/lib/domain/entry-detail";
import {
  byLeftStandingThenName,
  clearingItemNoun,
  describeClearing,
  LEFT_STANDING,
  type ClearingItemNoun,
  type ClearingStanding,
  type ClearingView,
  type Money,
} from "@/lib/domain/clearing-accounts";
import { formatMoney } from "@/lib/format";
import { fromMinor } from "@/lib/domain/money";
import { sanitizeExportFileName, type ReportExportSheet } from "@/lib/domain/report-export";
import type { BankStanding } from "@/lib/domain/bank-standing";
import { rangeText } from "@/lib/domain/report-presets";
import type { LedgerBalance } from "@/lib/domain/reports";
import {
  belowZeroRows,
  belowZeroSheetText,
  statementBalanceRows,
  statementBalanceSheetText,
  type BankAccountAlerts,
  type BelowZeroRow,
  type StatementBalanceRow,
} from "@/lib/domain/statement-alerts";
import type { TransactionListRow } from "@/lib/domain/transaction-list";
import {
  overrideDay,
  overrideMoment,
  overrideStatus,
  type NamedStatementOverride,
} from "@/lib/domain/statement-overrides";
import { shortDate } from "@/lib/domain/pdf-statement-view";

/** Re-exported so a caller needs one import to build the input, not three. */
export type { LedgerBalance, TransactionListRow };

/**
 * The twelve, named once.
 *
 * The screen draws its section headings from here and the service names a
 * failed read from here, so a check cannot be called two different things in
 * two different places.
 */
export const CHECK_LABEL = {
  duplicates: "Entries recorded more than once",
  checkNumber: "A check number used twice on one account",
  clearing: "Clearing accounts that have not emptied",
  wrongWay: "A balance pointing the wrong way",
  incomeNoCost: "A year with income and no costs",
  unreconciled: "Bank accounts not agreed to a statement",
  futureDated: "Entries dated in the future",
  holding: "Still sitting in a holding account",
  statementBalance: "Entries that look like a statement balance",
  belowZero: "Bank accounts below zero since their last statement",
  noLongerAgree: "Reconciliations that no longer agree",
  statementOverride: "Statements imported out of balance",
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
   * Said on the account (migration 0125) rather than guessed from its detail
   * type's wording: Accumulated Depreciation, Allowance for Doubtful Accounts,
   * Sales Returns, Owner's Draw.
   */
  isContra: boolean;
  /** Ticked as a clearing account (migration 0145): money that should pass through and empty. */
  isClearing: boolean;
  /** The account's detail type, which decides whether its items are called receipts or entries. */
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
  /**
   * The journal entry this payment posted, which is the only key that can join
   * a payment to a row of the transaction list. Document numbers cannot: a
   * payment's number and its entry's number come from separate sequences
   * (`PMT-`/`BP-` against `JE-`), so they are never equal.
   */
  journalEntryId: string | null;
  paymentDate: string;
  reference: string;
  /** The bank or credit-card account the money moved through. */
  accountId: string;
  accountName: string;
  partyName: string;
  amountMinor: number;
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

/** Debit-positive, so a credit balance reads negative. */
function signedBalance(account: ExceptionAccount): number {
  return account.debitBase - account.creditBase;
}

/**
 * Largest question first.
 *
 * `wrongWayBalances` and `holdingAccounts` order their
 * findings this way, so it is written once: a reviewer works down from the
 * figure most worth explaining. `unreconciledBankAccounts` is the one balance
 * check that does not — it sorts by account name instead.
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
    if (a.isContra) continue;
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

export interface ClearingRow {
  accountId: string;
  accountCode: string;
  name: string;
  /** Debit-positive, as `wrongWayBalances` and `holdingAccounts` show balances. */
  balanceMinor: number;
  leftStanding: boolean;
  /** What the database answered for this account; the sentences are worked out from it. */
  standing: ClearingStanding;
  itemNoun: ClearingItemNoun;
}

/**
 * The two sentences a clearing row is read by, "{amount} across {n} receipts,
 * oldest {date}" and "No movement for {d} days, since {date}".
 *
 * The one place they are written: the screen and the export both call this with
 * the same money formatter, so they cannot word a row differently.
 */
export function clearingSentences(row: ClearingRow, asOf: string, money: Money): ClearingView {
  return describeClearing(row.standing, asOf, row.itemNoun, money);
}

/**
 * A clearing account should empty. One row for each account ticked as one that
 * still holds a balance at `asOf`, the ones left standing first.
 *
 * The balance is the ledger's; the standing only says how old it is. An account
 * with a balance but no standing row is still listed, and as left standing,
 * because a figure that cannot be dated never looks healthy.
 */
export function clearingAccountsNotEmptied(
  accounts: readonly ExceptionAccount[],
  standing: readonly ClearingStanding[],
  asOf: string,
): ClearingRow[] {
  const standingById = new Map(standing.map((x) => [x.accountId, x]));
  const rows: ClearingRow[] = [];
  for (const a of accounts) {
    const balanceMinor = signedBalance(a);
    if (!a.isClearing || balanceMinor === 0) continue;
    const s: ClearingStanding = standingById.get(a.accountId) ?? {
      accountId: a.accountId,
      balanceMinor,
      lastMovementDate: null,
      openCount: 0,
      openOldestDate: null,
      openMinor: Math.abs(balanceMinor),
    };
    const itemNoun = clearingItemNoun(a.detailType);
    rows.push({
      accountId: a.accountId,
      accountCode: a.accountCode,
      name: a.name,
      balanceMinor,
      leftStanding: describeClearing(s, asOf, itemNoun, String).leftStanding,
      standing: s,
      itemNoun,
    });
  }
  return rows.sort(byLeftStandingThenName);
}

export interface UnreconciledRow {
  bankAccountId: string;
  accountId: string;
  accountName: string;
  balanceMinor: number;
  lastReconciledDate: string | null;
  /** Entries on the account not yet on a completed statement; null when the standing was not read. */
  sinceCount: number | null;
  /** Their net effect on the balance, in minor units; null when not read. */
  sinceNetMinor: number | null;
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
  standing: readonly BankStanding[] = [],
): UnreconciledRow[] {
  const standingById = new Map(standing.map((x) => [x.bankAccountId, x]));
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
      sinceCount: standingById.get(b.bankAccountId)?.sinceCount ?? null,
      sinceNetMinor: standingById.get(b.bankAccountId)?.sinceNetMinor ?? null,
    });
  }
  return rows.sort((x, y) => x.accountName.localeCompare(y.accountName));
}

export interface NoLongerAgreeRow {
  bankAccountId: string;
  accountName: string;
  /** Entries ticked on a completed reconciliation and voided since. */
  entryCount: number;
  amountMinor: number;
  /** The completed reconciliation they were ticked on. */
  reconciliationDate: string | null;
}

/**
 * Reconciliations whose ticked entries were voided afterwards.
 *
 * One row per bank account with at least one such entry, named from the bank
 * accounts it is joined to; a standing row for an account that is not in the
 * list has no name to show and is left out.
 */
export function reconciliationsNoLongerAgreeing(
  banks: readonly ExceptionBankAccount[],
  standing: readonly BankStanding[],
): NoLongerAgreeRow[] {
  const nameById = new Map(banks.map((b) => [b.bankAccountId, b.accountName]));
  const rows: NoLongerAgreeRow[] = [];
  for (const x of standing) {
    const accountName = nameById.get(x.bankAccountId);
    if (accountName === undefined || x.voidTickedCount <= 0) continue;
    rows.push({
      bankAccountId: x.bankAccountId,
      accountName,
      entryCount: x.voidTickedCount,
      amountMinor: x.voidTickedMinor,
      reconciliationDate: x.voidReconciliationDate,
    });
  }
  return rows.sort(
    (a, b) => a.accountName.localeCompare(b.accountName) || a.bankAccountId.localeCompare(b.bankAccountId),
  );
}

const INCOME_TYPES: ReadonlySet<AccountType> = new Set<AccountType>(["income", "other_income"]);
const COST_TYPES: ReadonlySet<AccountType> = new Set<AccountType>([
  "cost_of_goods_sold",
  "expense",
  "other_expense",
]);

/**
 * Fold the monthly balance map into one row per calendar year.
 *
 * The map's keys are `YYYY-MM`, so the year is the first four characters. Both
 * sides are netted: a credit note against income and a refund against a cost
 * both belong in the total they reduce.
 */
export function yearTotalsFromMonthly(
  byMonth: ReadonlyMap<string, readonly LedgerBalance[]>,
): YearTotals[] {
  const years = new Map<string, YearTotals>();
  for (const [monthKey, balances] of byMonth) {
    const year = monthKey.slice(0, 4);
    const totals = years.get(year) ?? { year, incomeMinor: 0, costMinor: 0 };
    for (const b of balances) {
      if (INCOME_TYPES.has(b.accountType)) totals.incomeMinor += b.creditBase - b.debitBase;
      else if (COST_TYPES.has(b.accountType)) totals.costMinor += b.debitBase - b.creditBase;
    }
    years.set(year, totals);
  }
  return [...years.values()].sort((x, y) => x.year.localeCompare(y.year));
}

export interface IncomeNoCostRow {
  year: string;
  incomeMinor: number;
  costMinor: number;
  /**
   * Posted entries dated in the year, as the prototype shows beside it — a year
   * of income with three entries and a year with three hundred are different
   * questions. Null when the count could not be read; the check still stands.
   */
  entryCount: number | null;
}

/**
 * Revenue with nothing spent against it almost always means the period is only
 * part-entered. The profit shown for that year is not a profit.
 */
export function yearsWithIncomeAndNoCost(
  years: readonly YearTotals[],
  entryCountByYear: ReadonlyMap<string, number> = new Map(),
): IncomeNoCostRow[] {
  return years
    .filter((y) => y.incomeMinor > 0 && y.costMinor === 0)
    .map((y) => ({
      year: y.year,
      incomeMinor: y.incomeMinor,
      costMinor: y.costMinor,
      entryCount: entryCountByYear.get(y.year) ?? null,
    }));
}

export interface DuplicateGroup {
  /** Stable across renders, so the table can key rows by it. */
  key: string;
  entries: TransactionListRow[];
}

/**
 * Same date, same name, same reference, same accounts, same amount.
 *
 * The reference is the document's own — a check number, a wire reference —
 * never `entry_number`, which is unique by definition and would stop this check
 * ever firing.
 *
 * The name is the one the report shows: the customer or vendor, or else the
 * entry's description. A bank line has no customer or vendor, and its
 * description is the bank's own text of who paid — the prototype's payee. Keyed
 * on the party alone, every same-amount transfer on one day, from different
 * people, came out as one payment recorded several times.
 *
 * Repeated wages on one day are normal when several people are paid the same;
 * the same supplier paid twice usually is not.
 *
 * The key is JSON-encoded so a value containing the separator cannot make two
 * different entries look alike.
 */
export function duplicateEntries(
  rows: readonly TransactionListRow[],
  referenceByEntryId: ReadonlyMap<string, string>,
): DuplicateGroup[] {
  const groups = new Map<string, TransactionListRow[]>();
  for (const r of rows) {
    const key = JSON.stringify([
      r.entryDate,
      entryDisplayName(r),
      referenceByEntryId.get(r.entryId) ?? "",
      [...r.accountIds].sort(),
      r.amountMinor,
    ]);
    const bucket = groups.get(key);
    if (bucket) bucket.push(r);
    else groups.set(key, [r]);
  }
  return [...groups.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([key, entries]) => ({ key, entries }))
    .sort((x, y) => x.entries[0].entryDate.localeCompare(y.entries[0].entryDate));
}

/**
 * Dated after today. Usually a typing slip in the year.
 *
 * Re-filtered here even though the read is already windowed, so the check
 * stands on its own and cannot be widened by a change to its caller.
 */
export function futureDatedEntries(
  rows: readonly TransactionListRow[],
  today: string,
): TransactionListRow[] {
  return rows
    .filter((r) => r.entryDate > today)
    .sort((x, y) => x.entryDate.localeCompare(y.entryDate));
}

export interface CheckNumberClash {
  accountId: string;
  accountName: string;
  reference: string;
  payments: ExceptionPaymentRef[];
}

/**
 * Counted per bank account on purpose, so the same number in two different
 * check books is not flagged. Two entries against one number on one account
 * means one of them is miscoded, or the check was reissued.
 */
export function duplicateCheckNumbers(
  payments: readonly ExceptionPaymentRef[],
): CheckNumberClash[] {
  const groups = new Map<string, ExceptionPaymentRef[]>();
  for (const p of payments) {
    const reference = p.reference.trim();
    if (reference === "") continue;
    const key = JSON.stringify([p.accountId, reference]);
    const bucket = groups.get(key);
    if (bucket) bucket.push(p);
    else groups.set(key, [p]);
  }
  return [...groups.values()]
    .filter((ps) => ps.length > 1)
    .map((ps) => ({
      accountId: ps[0].accountId,
      accountName: ps[0].accountName,
      reference: ps[0].reference.trim(),
      payments: [...ps].sort((x, y) => x.paymentDate.localeCompare(y.paymentDate)),
    }))
    .sort(
      (x, y) =>
        x.accountName.localeCompare(y.accountName) || x.reference.localeCompare(y.reference),
    );
}

/* ------------------------------------------------ statements out of balance */

/** An override still open: no completed reconciliation has reached its last line. */
export interface StatementOverrideRow {
  batchId: string;
  bankAccountId: string;
  accountName: string;
  filename: string;
  /** The day it was imported in the company's time zone, `2026-10-08`. */
  importedDay: string;
  /** That day as the screen prints it, `Oct 8, 2026`. */
  importedDate: string;
  /** The time of day in the company's time zone, `11:47`. */
  importedTime: string;
  byName: string;
  outByMinor: number;
  reason: string;
  /** The day it became a question: the import's day. */
  openSince: string;
}

/**
 * One row for each open override, oldest first. Settled ones are the database's
 * answer (a completed reconciliation reached the last line) and are not listed.
 * An account missing from the bank accounts is named "Unknown account" rather
 * than dropped: an override must not vanish.
 */
export function openStatementOverrides(
  overrides: readonly NamedStatementOverride[],
  bankAccounts: readonly ExceptionBankAccount[],
  timeZone: string,
): StatementOverrideRow[] {
  const names = new Map(bankAccounts.map((b) => [b.bankAccountId, b.accountName]));
  return overrides
    .filter((o) => overrideStatus(o) === "open")
    .map((o) => {
      const moment = overrideMoment(o.importedAt, timeZone);
      const importedDay = overrideDay(o.importedAt, timeZone);
      return {
        batchId: o.batchId,
        bankAccountId: o.bankAccountId,
        accountName: names.get(o.bankAccountId) ?? "Unknown account",
        filename: o.filename,
        importedDay,
        importedDate: moment.date,
        importedTime: moment.time,
        byName: o.overriddenByName,
        outByMinor: o.outByMinor,
        reason: o.reason,
        openSince: importedDay,
      };
    })
    .sort((x, y) => x.importedDay.localeCompare(y.importedDay) || x.batchId.localeCompare(y.batchId));
}

/**
 * The sentence a row is read by, on the screen and in the export:
 * "bank-june.csv, imported Oct 8, 2026 at 11:47 by Dana Reyes, out by $12.00: “reason”. Open since Oct 8, 2026."
 */
export function statementOverrideSentence(row: StatementOverrideRow, money: Money): string {
  return (
    `${row.filename}, imported ${row.importedDate} at ${row.importedTime} by ${row.byName}, ` +
    `out by ${money(row.outByMinor)}: “${row.reason}”. Open since ${shortDate(row.openSince, true)}.`
  );
}

/* ---------------------------------------------------------------- report */

export interface ExceptionReportInput {
  /** The as-of date every balance check reads at. */
  to: string;
  /** Supplied, never read from the clock, so the checks are deterministic. */
  today: string;
  accounts: readonly ExceptionAccount[];
  /** The clearing accounts' standing at `to`. Left out (or empty), a ticked account with a balance reads as left standing. */
  clearingStanding?: readonly ClearingStanding[];
  bankAccounts: readonly ExceptionBankAccount[];
  yearTotals: readonly YearTotals[];
  /** Posted entries per calendar year, for the years the income check flags. */
  entryCountByYear?: ReadonlyMap<string, number>;
  entriesInRange: readonly TransactionListRow[];
  entriesAfterToday: readonly TransactionListRow[];
  paymentReferences: readonly ExceptionPaymentRef[];
  /**
   * Each bank account's two statement alerts, found by the detectors in
   * `statement-alerts.ts`. Left out, the two statement checks find nothing.
   */
  statementAlerts?: readonly BankAccountAlerts[];
  /**
   * Each bank account's standing at `to`. Left out (or empty), the "not agreed"
   * rows carry no since figures and the voided-tick check finds nothing.
   */
  bankStanding?: readonly BankStanding[];
  /**
   * Every statement imported out of balance and not undone, open and settled,
   * as `acc_statement_overrides()` returns them. Only the open ones are listed.
   */
  statementOverrides?: readonly NamedStatementOverride[];
  /** The company's time zone, in which an override's date and time are printed. Left out, UTC. */
  timeZone?: string;
  /**
   * Checks whose data could not be read. They are reported as unavailable
   * rather than as "nothing found", because a check that could not run and a
   * check that found nothing are opposite answers.
   */
  unavailable: readonly CheckKey[];
}

export interface ExceptionReport {
  entriesExamined: number;
  questionsRaised: number;
  checksRun: 12;
  unavailable: CheckKey[];
  duplicates: DuplicateGroup[];
  checkNumberClashes: CheckNumberClash[];
  clearing: ClearingRow[];
  wrongWay: WrongWayRow[];
  incomeNoCost: IncomeNoCostRow[];
  unreconciled: UnreconciledRow[];
  futureDated: TransactionListRow[];
  holding: HoldingRow[];
  statementBalance: StatementBalanceRow[];
  belowZero: BelowZeroRow[];
  noLongerAgree: NoLongerAgreeRow[];
  statementOverride: StatementOverrideRow[];
}

/**
 * The reference a duplicate is judged by, keyed on the entry that produced it.
 *
 * Joined on the journal entry's own id, which a payment records directly.
 *
 * **Not** joined on document numbers. A payment's number and its entry's number
 * come from separate sequences — `PMT-` and `BP-` against `JE-` — so matching
 * those two strings finds nothing at all. The failure would be silent and
 * expensive: every payment's reference would fall back to blank, and two
 * unrelated payments alike in date, party, accounts and amount would be reported
 * as a double posting.
 */
function referencesByEntry(
  payments: readonly ExceptionPaymentRef[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const p of payments) {
    const reference = p.reference.trim();
    if (p.journalEntryId !== null && reference !== "") out.set(p.journalEntryId, reference);
  }
  return out;
}

/** Run all twelve. Nothing here reads a clock, a database or a file. */
export function buildExceptionReport(input: ExceptionReportInput): ExceptionReport {
  const balanceByAccountId = new Map<string, number>(
    input.accounts.map((a) => [a.accountId, signedBalance(a)]),
  );

  const duplicates = duplicateEntries(
    input.entriesInRange,
    referencesByEntry(input.paymentReferences),
  );
  const checkNumberClashes = duplicateCheckNumbers(input.paymentReferences);
  // Without the standing nothing can be said about how old a balance is, and a
  // balance listed on a guess would count as a question the check never asked.
  const clearing = input.unavailable.includes("clearing")
    ? []
    : clearingAccountsNotEmptied(input.accounts, input.clearingStanding ?? [], input.to);
  const wrongWay = wrongWayBalances(input.accounts);
  const incomeNoCost = yearsWithIncomeAndNoCost(input.yearTotals, input.entryCountByYear);
  const unreconciled = unreconciledBankAccounts(input.bankAccounts, balanceByAccountId, input.to, input.bankStanding ?? []);
  const futureDated = futureDatedEntries(input.entriesAfterToday, input.today);
  const holding = holdingAccounts(input.accounts);
  const statementBalance = statementBalanceRows(input.statementAlerts ?? []);
  const belowZero = belowZeroRows(input.statementAlerts ?? []);
  const noLongerAgree = reconciliationsNoLongerAgreeing(input.bankAccounts, input.bankStanding ?? []);
  const statementOverride = input.unavailable.includes("statementOverride")
    ? []
    : openStatementOverrides(input.statementOverrides ?? [], input.bankAccounts, input.timeZone ?? "UTC");

  return {
    entriesExamined: input.entriesInRange.length,
    questionsRaised:
      duplicates.length +
      checkNumberClashes.length +
      clearing.length +
      wrongWay.length +
      incomeNoCost.length +
      unreconciled.length +
      futureDated.length +
      holding.length +
      statementBalance.length +
      belowZero.length +
      noLongerAgree.length +
      statementOverride.length,
    checksRun: 12,
    unavailable: [...input.unavailable],
    duplicates,
    checkNumberClashes,
    clearing,
    wrongWay,
    incomeNoCost,
    unreconciled,
    futureDated,
    holding,
    statementBalance,
    belowZero,
    noLongerAgree,
    statementOverride,
  };
}

/* ---------------------------------------------------------------- export */

export interface ExceptionSheetMeta {
  companyName: string;
  currencyCode: string;
  decimals: number;
  from: string;
  to: string;
}

type SheetRow = ReportExportSheet["rows"][number];

/**
 * The report as one table, for PDF, Excel and CSV.
 *
 * Every check appears, including the ones with nothing to say. A printed
 * Exception Report is the record that somebody looked, so "Nothing found" and
 * "Could not run" are rows of it — and they must stay two different rows,
 * because the second one means the books still need a look.
 */
export function exceptionReportSheet(report: ExceptionReport, meta: ExceptionSheetMeta): ReportExportSheet {
  const money = (minor: number) => fromMinor(minor, meta.decimals);
  // The screen formats its sentences the same way, so the two read alike.
  const sentenceMoney: Money = (minor) => formatMoney(minor, meta.currencyCode, meta.decimals);
  const rows: SheetRow[] = [];
  const entryRow = (check: CheckKey, e: TransactionListRow): SheetRow => ({
    check: CHECK_LABEL[check],
    date: e.entryDate,
    type: `${sourceLabel(e.sourceType)} ${e.entryNumber}`,
    name: entryDisplayName(e),
    account: e.categoryLabel ?? "",
    amount: money(e.amountMinor),
  });

  const add = (check: CheckKey, found: SheetRow[]) => {
    if (report.unavailable.includes(check)) {
      rows.push({ check: CHECK_LABEL[check], date: "", type: "", name: "Could not run", account: "", amount: null });
    } else if (found.length === 0) {
      rows.push({ check: CHECK_LABEL[check], date: "", type: "", name: "Nothing found", account: "", amount: null });
    } else {
      rows.push(...found);
    }
  };

  add("duplicates", report.duplicates.flatMap((g) => g.entries.map((e) => entryRow("duplicates", e))));
  add(
    "checkNumber",
    report.checkNumberClashes.flatMap((c) =>
      c.payments.map((p) => ({
        check: CHECK_LABEL.checkNumber,
        date: p.paymentDate,
        type: `${p.kind === "customer" ? "Payment" : "Bill payment"} ${p.paymentNumber ?? ""}`.trim(),
        name: p.partyName,
        account: `${c.accountName}, number ${c.reference}`,
        amount: money(p.amountMinor),
      })),
    ),
  );
  add(
    "clearing",
    report.clearing.map((c) => {
      const view = clearingSentences(c, meta.to, sentenceMoney);
      return {
        check: CHECK_LABEL.clearing,
        date: c.standing.openOldestDate ?? "",
        type: c.leftStanding ? LEFT_STANDING : "Clearing",
        // Both sentences the screen shows, Open items then Last movement.
        name: [view.composition, view.idle].filter(Boolean).join(" · "),
        account: `${c.accountCode} ${c.name}`,
        amount: money(c.balanceMinor),
      };
    }),
  );
  add(
    "wrongWay",
    report.wrongWay.map((w) => ({
      check: CHECK_LABEL.wrongWay,
      date: meta.to,
      type: ACCOUNT_TYPE_LABEL[w.accountType],
      name: "",
      account: `${w.accountCode} ${w.name}`,
      amount: money(w.balanceMinor),
    })),
  );
  add(
    "incomeNoCost",
    report.incomeNoCost.map((y) => ({
      check: CHECK_LABEL.incomeNoCost,
      date: y.year,
      type: "Income",
      name: y.entryCount === null ? "" : `${y.entryCount} entries`,
      account: "",
      amount: money(y.incomeMinor),
    })),
  );
  add(
    "unreconciled",
    report.unreconciled.map((u) => ({
      check: CHECK_LABEL.unreconciled,
      date: u.lastReconciledDate ?? "never",
      type: "Last reconciled",
      name:
        u.sinceCount === null
          ? ""
          : u.sinceCount === 0
            ? "Nothing since"
            : `${u.sinceCount === 1 ? "1 entry" : `${u.sinceCount} entries`} since`,
      account: u.accountName,
      amount: money(u.balanceMinor),
    })),
  );
  add("futureDated", report.futureDated.map((e) => entryRow("futureDated", e)));
  add(
    "holding",
    report.holding.map((h) => ({
      check: CHECK_LABEL.holding,
      date: meta.to,
      type: "Balance",
      name: "",
      account: `${h.accountCode} ${h.name}`,
      amount: money(h.balanceMinor),
    })),
  );
  add(
    "statementBalance",
    report.statementBalance.map((r) => ({
      check: CHECK_LABEL.statementBalance,
      date: "",
      ...statementBalanceSheetText(r),
      account: r.accountName,
      amount: money(r.totalMinor),
    })),
  );
  add(
    "belowZero",
    report.belowZero.map((r) => ({
      check: CHECK_LABEL.belowZero,
      date: r.worstDate ?? "",
      ...belowZeroSheetText(r, (minor) => money(minor).toFixed(meta.decimals)),
      account: r.accountName,
      amount: money(r.nowMinor),
    })),
  );
  add(
    "noLongerAgree",
    report.noLongerAgree.map((r) => ({
      check: CHECK_LABEL.noLongerAgree,
      date: r.reconciliationDate ?? "",
      type: "Voided after reconciliation",
      name: r.entryCount === 1 ? "1 entry" : `${r.entryCount} entries`,
      account: r.accountName,
      amount: money(r.amountMinor),
    })),
  );

  add(
    "statementOverride",
    report.statementOverride.map((r) => ({
      check: CHECK_LABEL.statementOverride,
      date: r.importedDay,
      type: "Imported out of balance",
      name: statementOverrideSentence(r, sentenceMoney),
      account: r.accountName,
      amount: money(r.outByMinor),
    })),
  );

  return {
    fileName: sanitizeExportFileName(`exception-report-${meta.from}-to-${meta.to}`),
    companyName: meta.companyName,
    title: "Exception Report",
    subtitle: `${rangeText(meta.from, meta.to)} · Accrual basis`,
    currencyCode: meta.currencyCode,
    columns: [
      { key: "check", header: "Check", width: 34 },
      { key: "date", header: "Date", width: 12 },
      { key: "type", header: "Type", width: 20 },
      { key: "name", header: "Name", width: 30 },
      { key: "account", header: "Account", width: 30 },
      { key: "amount", header: "Amount", kind: "money", width: 14 },
    ],
    rows,
  };
}
