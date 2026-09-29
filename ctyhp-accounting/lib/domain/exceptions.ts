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

import { ACCOUNT_TYPE_LABEL, naturalBalance, type AccountType } from "@/lib/domain/accounts";
import { entryDisplayName, sourceLabel } from "@/lib/domain/entry-detail";
import { fromMinor } from "@/lib/domain/money";
import { sanitizeExportFileName, type ReportExportSheet } from "@/lib/domain/report-export";
import { rangeText } from "@/lib/domain/report-presets";
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
   * Said on the account (migration 0125) rather than guessed from its detail
   * type's wording: Accumulated Depreciation, Allowance for Doubtful Accounts,
   * Sales Returns, Owner's Draw.
   */
  isContra: boolean;
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

/** Debit-positive, so a credit balance reads negative. */
function signedBalance(account: ExceptionAccount): number {
  return account.debitBase - account.creditBase;
}

/**
 * Largest question first.
 *
 * `wrongWayBalances`, `holdingAccounts` and `undepositedFunds` all order their
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

export interface UndepositedRow {
  accountId: string;
  accountCode: string;
  name: string;
  balanceMinor: number;
  /**
   * `null` when the detail read could not name a figure for this account —
   * distinct from `0`, which says the read ran and found nothing. The balance
   * above is still known and shown either way; only the count is absent.
   */
  entryCount: number | null;
  oldestEntryDate: string | null;
}

/** Exported: the service reads this too, to decide which accounts to fetch detail for. */
export const UNDEPOSITED_NAME = /undeposited/i;
/**
 * The seeded chart's code for it; accepted alongside the name, never instead.
 * Exported: the service reads this too, so the two layers cannot disagree about
 * which account is a holding account.
 */
export const UNDEPOSITED_CODE = "1210";

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
      entryCount: detail?.entryCount ?? null,
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

/* ---------------------------------------------------------------- report */

export interface ExceptionReportInput {
  /** The as-of date every balance check reads at. */
  to: string;
  /** Supplied, never read from the clock, so the checks are deterministic. */
  today: string;
  accounts: readonly ExceptionAccount[];
  undepositedDetails: ReadonlyMap<string, UndepositedDetail>;
  bankAccounts: readonly ExceptionBankAccount[];
  yearTotals: readonly YearTotals[];
  /** Posted entries per calendar year, for the years the income check flags. */
  entryCountByYear?: ReadonlyMap<string, number>;
  entriesInRange: readonly TransactionListRow[];
  entriesAfterToday: readonly TransactionListRow[];
  paymentReferences: readonly ExceptionPaymentRef[];
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
  checksRun: 8;
  unavailable: CheckKey[];
  duplicates: DuplicateGroup[];
  checkNumberClashes: CheckNumberClash[];
  undeposited: UndepositedRow[];
  wrongWay: WrongWayRow[];
  incomeNoCost: IncomeNoCostRow[];
  unreconciled: UnreconciledRow[];
  futureDated: TransactionListRow[];
  holding: HoldingRow[];
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

/** Run all eight. Nothing here reads a clock, a database or a file. */
export function buildExceptionReport(input: ExceptionReportInput): ExceptionReport {
  const balanceByAccountId = new Map<string, number>(
    input.accounts.map((a) => [a.accountId, signedBalance(a)]),
  );

  const duplicates = duplicateEntries(
    input.entriesInRange,
    referencesByEntry(input.paymentReferences),
  );
  const checkNumberClashes = duplicateCheckNumbers(input.paymentReferences);
  const undeposited = undepositedFunds(input.accounts, input.undepositedDetails);
  const wrongWay = wrongWayBalances(input.accounts);
  const incomeNoCost = yearsWithIncomeAndNoCost(input.yearTotals, input.entryCountByYear);
  const unreconciled = unreconciledBankAccounts(input.bankAccounts, balanceByAccountId, input.to);
  const futureDated = futureDatedEntries(input.entriesAfterToday, input.today);
  const holding = holdingAccounts(input.accounts);

  return {
    entriesExamined: input.entriesInRange.length,
    questionsRaised:
      duplicates.length +
      checkNumberClashes.length +
      undeposited.length +
      wrongWay.length +
      incomeNoCost.length +
      unreconciled.length +
      futureDated.length +
      holding.length,
    checksRun: 8,
    unavailable: [...input.unavailable],
    duplicates,
    checkNumberClashes,
    undeposited,
    wrongWay,
    incomeNoCost,
    unreconciled,
    futureDated,
    holding,
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
    "undeposited",
    report.undeposited.map((u) => ({
      check: CHECK_LABEL.undeposited,
      date: u.oldestEntryDate ?? "",
      type: "Oldest entry",
      name: u.entryCount === null ? "" : `${u.entryCount} entries`,
      account: `${u.accountCode} ${u.name}`,
      amount: money(u.balanceMinor),
    })),
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
      name: "",
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
