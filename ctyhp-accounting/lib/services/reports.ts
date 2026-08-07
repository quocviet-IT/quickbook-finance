import type { SupabaseClient } from "@supabase/supabase-js";
import type { LedgerBalance } from "@/lib/domain/reports";
import type { TransactionListRow } from "@/lib/domain/transaction-list";

/**
 * Per-account debit/credit totals (base-currency minor units) from posted
 * entries within [p_from, p_to]. p_from null = cumulative (for as-of reports).
 * Aggregation runs in the database (acc_ledger_balances).
 */
export async function getLedgerBalances(
  sb: SupabaseClient,
  from: string | null,
  to: string,
): Promise<LedgerBalance[]> {
  const { data, error } = await sb.rpc("acc_ledger_balances", { p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    accountId: r.account_id as string,
    accountCode: r.account_code as string,
    name: r.name as string,
    accountType: r.account_type as LedgerBalance["accountType"],
    debitBase: Number(r.debit_base),
    creditBase: Number(r.credit_base),
  }));
}

/**
 * Every posted transaction between two dates, one row each, for the
 * Transaction List by Date report. The shaping that decides counterparty,
 * accounts and sign lives in `acc_transaction_list`; this only maps names.
 */
export async function getTransactionList(
  sb: SupabaseClient,
  from: string,
  to: string,
): Promise<TransactionListRow[]> {
  const { data, error } = await sb.rpc("acc_transaction_list", { p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    entryId: r.entry_id as string,
    entryNumber: r.entry_number as string,
    entryDate: String(r.entry_date).slice(0, 10),
    description: (r.description as string) ?? "",
    sourceType: r.source_type as string,
    partyName: (r.party_name as string) ?? null,
    categoryLabel: (r.category_label as string) ?? null,
    moneyLabel: (r.money_label as string) ?? null,
    amountMinor: Number(r.amount_minor),
    currencyCode: r.currency_code as string,
    reconciled: Boolean(r.reconciled),
    // Postgres hands back a uuid[]; an older function that predates 0105 would
    // send nothing, and an empty list simply matches no account filter.
    accountIds: ((r.account_ids as string[] | null) ?? []).map(String),
  }));
}
