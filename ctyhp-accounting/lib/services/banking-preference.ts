import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_PAIR_WINDOW, fundingAccountAllowed } from "@/lib/domain/bank-pairs";
import { listAccounts } from "./accounts";

export class BankingPreferenceError extends Error {}

export interface BankingPreference {
  fundingAccountId: string | null;
  pairWindowDays: number;
  /** False until someone saves it; the defaults are only offered. */
  saved: boolean;
}

export async function getBankingPreference(sb: SupabaseClient): Promise<BankingPreference> {
  const { data, error } = await sb.from("acc_banking_preference").select("funding_account_id,pair_window_days").eq("singleton", true).maybeSingle();
  if (error) throw new BankingPreferenceError(error.message);
  if (!data) return { fundingAccountId: null, pairWindowDays: DEFAULT_PAIR_WINDOW, saved: false };
  const row = data as { funding_account_id: string | null; pair_window_days: number };
  return { fundingAccountId: row.funding_account_id, pairWindowDays: Number(row.pair_window_days), saved: true };
}

export async function saveBankingPreference(
  sb: SupabaseClient,
  input: { fundingAccountId: string | null; pairWindowDays: number },
): Promise<void> {
  if (input.fundingAccountId) {
    const account = (await listAccounts(sb)).find((a) => a.id === input.fundingAccountId);
    if (!account || !fundingAccountAllowed(account)) {
      throw new BankingPreferenceError("Funding pairs post only to an active posting liability account");
    }
  }
  const { error } = await sb
    .from("acc_banking_preference")
    .upsert({ singleton: true, funding_account_id: input.fundingAccountId, pair_window_days: input.pairWindowDays }, { onConflict: "singleton" });
  if (error) throw new BankingPreferenceError(error.message);
}
