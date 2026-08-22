import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  BankTransactionRow,
  StatementReconciliationRow,
} from "@/lib/db/types";
import { listBankAccounts, listBankConnections } from "@/lib/services/banking";
import { getCurrentCompanySettings } from "@/lib/services/company";
import { todayInTimeZone } from "@/lib/services/dashboard";

export class BankingSurfaceError extends Error {}

export interface BankingContext {
  asOf: string;
  currencyCode: string;
  currencyDecimals: number;
  timeZone: string;
}

export interface BankingAccount {
  id: string;
  name: string;
}

export interface BankingFeed {
  id: string;
  institutionName: string;
  status: string;
  lastError: string | null;
  lastSyncAt: string | null;
  broken: boolean;
}

/**
 * Everything Banking reads, read once.
 *
 * The accounting surface fetches per section, because its sections ask genuinely
 * different questions of genuinely different tables. Banking's do not: the
 * controls and the queue are two views of the same four small tables, and
 * fetching them twice would be paying twice to disagree with itself.
 *
 * They still *fail* separately. This is one settled read, and each section wraps
 * it in its own envelope — so a failure here is reported as "we could not look"
 * on both, which is the truth, rather than as an empty queue on one.
 */
export interface BankingFacts {
  accounts: BankingAccount[];
  feeds: BankingFeed[];
  transactions: BankTransactionRow[];
  sessions: StatementReconciliationRow[];
}

/**
 * The frame the rest hangs on: which day this speaks for, in which currency.
 *
 * `asOf` is the company's own today in the company's timezone — never the
 * server's UTC date. Phase 5 found the ageing report netting a control account
 * at the server's date, which for a company on America/New_York is tomorrow from
 * 8pm local; every date on this surface comes from here so the same thing cannot
 * happen again.
 */
export async function getBankingContext(sb: SupabaseClient): Promise<BankingContext> {
  const company = await getCurrentCompanySettings(sb);
  const timeZone = company?.time_zone ?? "America/New_York";
  return {
    asOf: todayInTimeZone(timeZone),
    currencyCode: "USD",
    currencyDecimals: 2,
    timeZone,
  };
}

export async function getBankingFacts(
  sb: SupabaseClient,
  context: BankingContext,
): Promise<BankingFacts> {
  const [accounts, connections, transactions, sessions] = await Promise.all([
    listBankAccounts(sb),
    listBankConnections(sb),
    sb
      .from("acc_bank_transaction")
      .select("id,bank_account_id,txn_date,description,amount_minor,status,pending,provider_removed_at")
      .is("provider_removed_at", null)
      .lte("txn_date", context.asOf)
      .order("txn_date", { ascending: true }),
    sb
      .from("acc_statement_reconciliation")
      .select("id,bank_account_id,statement_ending_date,status,completed_at,created_at")
      .order("statement_ending_date", { ascending: false }),
  ]);
  if (transactions.error) throw new BankingSurfaceError(transactions.error.message);
  if (sessions.error) throw new BankingSurfaceError(sessions.error.message);

  return {
    accounts: accounts.map((account) => ({
      id: account.id,
      // The GL account's name is what an accountant calls this thing; the bank's
      // own name is the fallback, and the masked number the last resort.
      name:
        account.account_name?.trim() ||
        account.bank_name?.trim() ||
        account.account_number_masked ||
        "Bank account",
    })),
    feeds: connections.map((connection) => ({
      id: connection.id,
      institutionName: connection.institution_name,
      status: connection.status,
      lastError: connection.last_error,
      lastSyncAt: connection.last_sync_at,
      broken: connection.status !== "active" || Boolean(connection.last_error),
    })),
    transactions: (transactions.data ?? []) as unknown as BankTransactionRow[],
    sessions: (sessions.data ?? []) as unknown as StatementReconciliationRow[],
  };
}

const DAY_MS = 24 * 60 * 60 * 1_000;

/** Whole days between two calendar dates, never negative. */
export function daysBetween(later: string, earlier: string): number {
  const a = Date.parse(`${later.slice(0, 10)}T00:00:00.000Z`);
  const b = Date.parse(`${earlier.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.round((a - b) / DAY_MS));
}

/**
 * The end of the month before the one `asOf` falls in.
 *
 * What a reconciliation has to reach to count as current. Deliberately not "30
 * days ago": statements arrive monthly, and an account reconciled through last
 * month end is up to date on the 1st and still up to date on the 28th.
 */
export function previousMonthEnd(asOf: string): string {
  const [year, month] = asOf.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10);
}
