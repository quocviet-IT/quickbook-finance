import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildExceptionReport,
  yearTotalsFromMonthly,
  yearsWithIncomeAndNoCost,
  UNDEPOSITED_CODE,
  UNDEPOSITED_NAME,
  type CheckKey,
  type ExceptionAccount,
  type ExceptionBankAccount,
  type ExceptionPaymentRef,
  type ExceptionReport,
  type UndepositedDetail,
} from "@/lib/domain/exceptions";
import type { AccountRow } from "@/lib/db/types";
import type { LedgerBalance } from "@/lib/domain/reports";
import type { TransactionListRow } from "@/lib/domain/transaction-list";
import { listAccounts } from "@/lib/services/accounts";
import { listBankAccounts, type BankAccountWithGl } from "@/lib/services/banking";
import {
  getLedgerBalances,
  getMonthlyLedgerBalances,
  getTransactionList,
} from "@/lib/services/reports";

/**
 * Reading what the Exception Report needs.
 *
 * Every call in this file is a read. There is no insert, update, delete or
 * posting RPC here, and there must never be one: the report is designed to be
 * safe to run on live books at any time, including inside a closed period.
 */
export class ExceptionsError extends Error {}

/**
 * How many rows PostgREST will return before it stops and says nothing.
 *
 * Measured on a real company in `transaction-import-preview.ts`: 1,466 rows
 * in a table, 1,000 visible, 466 invisible, with no error reported. Every
 * select in this file that could plausibly cross that line is paged past it,
 * following the same pattern as `existingHashes` there and `readTable` in
 * `company-export.ts`.
 */
const PAGE = 1000;

/**
 * Run one read; if it fails, record which checks lose their data and carry on.
 *
 * Seven working checks are worth more than a blank page, and a reader must be
 * told which one is missing rather than left to read "nothing found" as an
 * answer. Failures are collected into `failed`, which the report carries.
 */
async function readOr<T>(
  failed: CheckKey[],
  checks: readonly CheckKey[],
  fallback: T,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch {
    for (const c of checks) if (!failed.includes(c)) failed.push(c);
    return fallback;
  }
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole months from `from` to `to` inclusive, which is what the RPC counts back. */
function monthSpan(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return Math.max((ty - fy) * 12 + (tm - fm) + 1, 1);
}

/** The latest completed statement date for each bank account, read in pages. */
async function lastReconciledByBankAccount(
  sb: SupabaseClient,
): Promise<Map<string, string>> {
  const latest = new Map<string, string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("acc_statement_reconciliation")
      .select("bank_account_id,statement_ending_date")
      .eq("status", "completed")
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new ExceptionsError(error.message);
    const rows = (data ?? []) as { bank_account_id: string; statement_ending_date: string }[];
    for (const r of rows) {
      const seen = latest.get(r.bank_account_id);
      if (!seen || r.statement_ending_date > seen) latest.set(r.bank_account_id, r.statement_ending_date);
    }
    if (rows.length < PAGE) return latest;
  }
}

/** The earliest or latest posted entry's date. */
async function edgeEntryDate(sb: SupabaseClient, ascending: boolean): Promise<string | null> {
  const { data, error } = await sb
    .from("acc_journal_entry")
    .select("entry_date")
    .eq("status", "posted")
    .order("entry_date", { ascending })
    .limit(1);
  if (error) throw new ExceptionsError(error.message);
  const rows = (data ?? []) as { entry_date: string }[];
  return rows.length > 0 ? String(rows[0].entry_date).slice(0, 10) : null;
}

/** The earliest posted entry, which is where the per-year check has to start. */
function earliestEntryDate(sb: SupabaseClient): Promise<string | null> {
  return edgeEntryDate(sb, true);
}

/**
 * The first and last posted entry, which the period picker needs: "All dates"
 * runs between them, and "Last 3 years" counts back from the last.
 */
export async function postedEntryDateSpan(
  sb: SupabaseClient,
): Promise<{ first: string | null; last: string | null }> {
  const [first, last] = await Promise.all([edgeEntryDate(sb, true), edgeEntryDate(sb, false)]);
  return { first, last };
}

/**
 * Posted entries in each of the given calendar years, up to `to`.
 *
 * Only the years the income check flags are counted — usually none, rarely
 * more than two — so this costs a head count per flagged year and nothing when
 * the books are in order.
 */
async function entriesPerYear(
  sb: SupabaseClient,
  years: readonly string[],
  to: string,
): Promise<Map<string, number>> {
  const counts = await Promise.all(
    years.map(async (year) => {
      const end = `${year}-12-31` < to ? `${year}-12-31` : to;
      const { count, error } = await sb
        .from("acc_journal_entry")
        .select("id", { count: "exact", head: true })
        .eq("status", "posted")
        .gte("entry_date", `${year}-01-01`)
        .lte("entry_date", end);
      if (error) throw new ExceptionsError(error.message);
      return [year, count ?? 0] as const;
    }),
  );
  return new Map(counts);
}

const named = (v: unknown): string => (v as { name?: string } | null)?.name ?? "";

/**
 * Every customer payment carrying a reference, read in pages.
 *
 * Past a thousand rows, an unpaged read fell silently back to blank
 * references for everything past the cut — and the duplicates check then
 * reported two genuinely different payments, with different check numbers,
 * as a double posting. Ordered by `id` so a page boundary cannot land in the
 * middle of an arbitrary, undeclared order and drop rows a second read would
 * have seen.
 */
async function customerPaymentReferences(sb: SupabaseClient): Promise<ExceptionPaymentRef[]> {
  const out: ExceptionPaymentRef[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("acc_payment")
      .select("id,payment_number,journal_entry_id,payment_date,reference,amount_minor,deposit_account_id,acc_customer(name),acc_account(name)")
      .not("reference", "is", null)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new ExceptionsError(error.message);
    const rows = (data ?? []) as Record<string, unknown>[];
    for (const r of rows) {
      out.push({
        paymentId: r.id as string,
        kind: "customer",
        paymentNumber: (r.payment_number as string | null) ?? null,
        journalEntryId: (r.journal_entry_id as string | null) ?? null,
        paymentDate: r.payment_date as string,
        reference: (r.reference as string | null) ?? "",
        accountId: r.deposit_account_id as string,
        accountName: named(r.acc_account),
        partyName: named(r.acc_customer),
        amountMinor: Number(r.amount_minor),
      });
    }
    if (rows.length < PAGE) return out;
  }
}

/** Every vendor (check) payment carrying a reference, read in pages. Same reasoning as above. */
async function vendorPaymentReferences(sb: SupabaseClient): Promise<ExceptionPaymentRef[]> {
  const out: ExceptionPaymentRef[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("acc_bill_payment")
      .select("id,payment_number,journal_entry_id,payment_date,reference,amount_minor,payment_account_id,acc_vendor(name),acc_account(name)")
      .not("reference", "is", null)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new ExceptionsError(error.message);
    const rows = (data ?? []) as Record<string, unknown>[];
    for (const r of rows) {
      out.push({
        paymentId: r.id as string,
        kind: "vendor",
        paymentNumber: (r.payment_number as string | null) ?? null,
        journalEntryId: (r.journal_entry_id as string | null) ?? null,
        paymentDate: r.payment_date as string,
        reference: (r.reference as string | null) ?? "",
        accountId: r.payment_account_id as string,
        accountName: named(r.acc_account),
        partyName: named(r.acc_vendor),
        amountMinor: Number(r.amount_minor),
      });
    }
    if (rows.length < PAGE) return out;
  }
}

/**
 * Every payment carrying the reference a statement is reconciled by.
 *
 * `acc_account` needs no disambiguating hint: each of the two source tables
 * has exactly one foreign key to it (`deposit_account_id`, `payment_account_id`).
 */
async function paymentReferences(sb: SupabaseClient): Promise<ExceptionPaymentRef[]> {
  const [customer, vendor] = await Promise.all([
    customerPaymentReferences(sb),
    vendorPaymentReferences(sb),
  ]);
  return [...customer, ...vendor];
}

/**
 * How many entries have touched a holding account, and since when.
 *
 * One query across every holding account, not one per account: past a
 * thousand lines, `entryCount` used to cap and `oldestEntryDate` became the
 * minimum of whatever arbitrary subset arrived, so the screen could print an
 * "Oldest" date later than the true oldest. Paged past the cap and ordered by
 * `id` — not by the embedded entry date, which is a to-many embed PostgREST
 * does not let a caller use to order the parent — so the oldest date is
 * instead the minimum taken client side across every row, which is correct
 * once every page has been read.
 *
 * Only asked about accounts that actually carry a balance, so the common case
 * — an undeposited funds account that empties as it should — costs nothing.
 */
async function undepositedDetails(
  sb: SupabaseClient,
  accountIds: readonly string[],
  to: string,
): Promise<Map<string, UndepositedDetail>> {
  const details = new Map<string, UndepositedDetail>();
  if (accountIds.length === 0) return details;

  const counts = new Map<string, number>();
  const oldest = new Map<string, string>();

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("acc_journal_line")
      .select("account_id,journal_entry_id,acc_journal_entry!inner(entry_date,status)")
      .in("account_id", accountIds)
      .eq("acc_journal_entry.status", "posted")
      .lte("acc_journal_entry.entry_date", to)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new ExceptionsError(error.message);
    const rows = (data ?? []) as unknown as {
      account_id: string;
      acc_journal_entry: { entry_date: string };
    }[];
    for (const r of rows) {
      counts.set(r.account_id, (counts.get(r.account_id) ?? 0) + 1);
      const seen = oldest.get(r.account_id);
      if (!seen || r.acc_journal_entry.entry_date < seen) oldest.set(r.account_id, r.acc_journal_entry.entry_date);
    }
    if (rows.length < PAGE) break;
  }

  for (const accountId of accountIds) {
    details.set(accountId, {
      entryCount: counts.get(accountId) ?? 0,
      oldestEntryDate: oldest.get(accountId) ?? null,
    });
  }
  return details;
}

/**
 * The whole report.
 *
 * `today` is passed in rather than read here, so a caller — and a test — can
 * say what "today" means.
 */
export async function getExceptionReport(
  sb: SupabaseClient,
  from: string,
  to: string,
  today: string,
): Promise<ExceptionReport> {
  const unavailable: CheckKey[] = [];
  /** The checks that read balances: without them there is nothing to judge. */
  const BALANCE_CHECKS: readonly CheckKey[] = ["undeposited", "wrongWay", "holding", "unreconciled"];

  const [accountRows, balances, entriesInRange, entriesAfterToday, banks, lastReconciled, earliest] =
    await Promise.all([
      readOr(unavailable, BALANCE_CHECKS, [] as AccountRow[], () => listAccounts(sb)),
      readOr(unavailable, BALANCE_CHECKS, [] as LedgerBalance[], () =>
        getLedgerBalances(sb, null, to),
      ),
      readOr(unavailable, ["duplicates"], [] as TransactionListRow[], () =>
        getTransactionList(sb, from, to),
      ),
      readOr(unavailable, ["futureDated"], [] as TransactionListRow[], () =>
        getTransactionList(sb, addDays(today, 1), "9999-12-31"),
      ),
      readOr(unavailable, ["unreconciled"], [] as BankAccountWithGl[], () => listBankAccounts(sb)),
      readOr(unavailable, ["unreconciled"], new Map<string, string>(), () =>
        lastReconciledByBankAccount(sb),
      ),
      readOr(unavailable, ["incomeNoCost"], null as string | null, () => earliestEntryDate(sb)),
    ]);

  const detailByAccountId = new Map(accountRows.map((a) => [a.id, a]));
  const accounts: ExceptionAccount[] = balances.map((b: LedgerBalance) => ({
    accountId: b.accountId,
    accountCode: b.accountCode,
    name: b.name,
    accountType: b.accountType,
    detailType: detailByAccountId.get(b.accountId)?.detail_type ?? null,
    debitBase: b.debitBase,
    creditBase: b.creditBase,
  }));

  const holdingIds = accounts
    .filter(
      (a) =>
        a.debitBase - a.creditBase !== 0 &&
        (UNDEPOSITED_NAME.test(a.name) || a.accountCode === UNDEPOSITED_CODE),
    )
    .map((a) => a.accountId);

  const [refs, details, byMonth] = await Promise.all([
    readOr(unavailable, ["checkNumber", "duplicates"], [] as ExceptionPaymentRef[], () => paymentReferences(sb)),
    readOr(unavailable, [], new Map<string, UndepositedDetail>(), () =>
      undepositedDetails(sb, holdingIds, to),
    ),
    readOr(unavailable, ["incomeNoCost"], new Map<string, LedgerBalance[]>(), () =>
      earliest === null
        ? Promise.resolve(new Map<string, LedgerBalance[]>())
        : getMonthlyLedgerBalances(sb, to, monthSpan(earliest, to)),
    ),
  ]);

  const yearTotals = yearTotalsFromMonthly(byMonth);
  // A detail of the income check, like the undeposited detail above: if the
  // count cannot be read the check still stands, with its count left unknown.
  const entryCountByYear = await readOr(unavailable, [], new Map<string, number>(), () =>
    entriesPerYear(
      sb,
      yearsWithIncomeAndNoCost(yearTotals).map((y) => y.year),
      to,
    ),
  );

  const bankAccounts: ExceptionBankAccount[] = banks.map((b) => ({
    bankAccountId: b.id,
    accountId: b.account_id,
    accountName: b.account_name || b.bank_name,
    lastReconciledDate: lastReconciled.get(b.id) ?? null,
  }));

  return buildExceptionReport({
    to,
    today,
    accounts,
    undepositedDetails: details,
    bankAccounts,
    yearTotals,
    entryCountByYear,
    entriesInRange,
    entriesAfterToday,
    paymentReferences: refs,
    unavailable,
  });
}
