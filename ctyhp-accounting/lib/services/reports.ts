import type { SupabaseClient } from "@supabase/supabase-js";
import type { LedgerBalance } from "@/lib/domain/reports";

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
    accountCode: r.account_code as string,
    name: r.name as string,
    accountType: r.account_type as LedgerBalance["accountType"],
    debitBase: Number(r.debit_base),
    creditBase: Number(r.credit_base),
  }));
}
