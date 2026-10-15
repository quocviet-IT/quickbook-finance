import type { SupabaseClient } from "@supabase/supabase-js";
import { toBankStanding, type BankStanding } from "@/lib/domain/bank-standing";
import { BankRecError } from "@/lib/services/bankrec";
import { readAllPages } from "@/lib/services/paging";

/**
 * How each bank account stands against its statements on a day: its last
 * agreed statement and what has happened since. One row per bank account from
 * acc_bank_standing, paged all the same (the bank account id orders it
 * totally), so nothing between the account and PostgREST's row cap can shorten
 * the list silently.
 */
export async function getBankStanding(sb: SupabaseClient, asOf: string): Promise<BankStanding[]> {
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) => sb.rpc("acc_bank_standing", { p_as_of: asOf }).order("bank_account_id").range(from, to),
    (message) => new BankRecError(message),
  );
  return rows.map(toBankStanding);
}
