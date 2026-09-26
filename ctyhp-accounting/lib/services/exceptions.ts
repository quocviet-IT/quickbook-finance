import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildExceptionReport,
  yearTotalsFromMonthly,
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

/** The latest completed statement date for each bank account, in one read. */
async function lastReconciledByBankAccount(
  sb: SupabaseClient,
): Promise<Map<string, string>> {
  const { data, error } = await sb
    .from("acc_statement_reconciliation")
    .select("bank_account_id,statement_ending_date")
    .eq("status", "completed");
  if (error) throw new ExceptionsError(error.message);
  const latest = new Map<string, string>();
  for (const r of (data ?? []) as { bank_account_id: string; statement_ending_date: string }[]) {
    const seen = latest.get(r.bank_account_id);
    if (!seen || r.statement_ending_date > seen) latest.set(r.bank_account_id, r.statement_ending_date);
  }
  return latest;
}

/** The earliest posted entry, which is where the per-year check has to start. */
async function earliestEntryDate(sb: SupabaseClient): Promise<string | null> {
  const { data, error } = await sb
    .from("acc_journal_entry")
    .select("entry_date")
    .eq("status", "posted")
    .order("entry_date", { ascending: true })
    .limit(1);
  if (error) throw new ExceptionsError(error.message);
  const rows = (data ?? []) as { entry_date: string }[];
  return rows.length > 0 ? rows[0].entry_date : null;
}

/** Every payment carrying the reference a statement is reconciled by. */
async function paymentReferences(sb: SupabaseClient): Promise<ExceptionPaymentRef[]> {
  // `acc_account` needs no disambiguating hint: each of these tables has
  // exactly one foreign key to it (`deposit_account_id`, `payment_account_id`).
  const [customer, vendor] = await Promise.all([
    sb
      .from("acc_payment")
      .select("id,payment_number,journal_entry_id,payment_date,reference,amount_minor,deposit_account_id,acc_customer(name),acc_account(name)")
      .not("reference", "is", null),
    sb
      .from("acc_bill_payment")
      .select("id,payment_number,journal_entry_id,payment_date,reference,amount_minor,payment_account_id,acc_vendor(name),acc_account(name)")
      .not("reference", "is", null),
  ]);
  if (customer.error) throw new ExceptionsError(customer.error.message);
  if (vendor.error) throw new ExceptionsError(vendor.error.message);

  const named = (v: unknown): string => (v as { name?: string } | null)?.name ?? "";

  const out: ExceptionPaymentRef[] = [];
  for (const r of (customer.data ?? []) as Record<string, unknown>[]) {
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
  for (const r of (vendor.data ?? []) as Record<string, unknown>[]) {
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
  return out;
}

/**
 * How many entries have touched a holding account, and since when.
 *
 * Only asked about accounts that actually carry a balance, so the common case —
 * an undeposited funds account that empties as it should — costs nothing.
 */
async function undepositedDetails(
  sb: SupabaseClient,
  accountIds: readonly string[],
  to: string,
): Promise<Map<string, UndepositedDetail>> {
  const details = new Map<string, UndepositedDetail>();
  for (const accountId of accountIds) {
    const { data, error } = await sb
      .from("acc_journal_line")
      .select("journal_entry_id,acc_journal_entry!inner(entry_date,status)")
      .eq("account_id", accountId)
      .eq("acc_journal_entry.status", "posted")
      .lte("acc_journal_entry.entry_date", to);
    if (error) throw new ExceptionsError(error.message);
    const rows = (data ?? []) as unknown as { acc_journal_entry: { entry_date: string } }[];
    const dates = rows.map((r) => r.acc_journal_entry.entry_date).sort();
    details.set(accountId, {
      entryCount: rows.length,
      oldestEntryDate: dates.length > 0 ? dates[0] : null,
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
    yearTotals: yearTotalsFromMonthly(byMonth),
    entriesInRange,
    entriesAfterToday,
    paymentReferences: refs,
    unavailable,
  });
}
