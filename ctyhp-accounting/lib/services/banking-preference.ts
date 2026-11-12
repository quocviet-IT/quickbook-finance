import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_PAIR_WINDOW, fundingAccountAllowed } from "@/lib/domain/bank-pairs";
import { MATCH_WINDOW_DEFAULT, matchWindowProblem } from "@/lib/domain/statement-match-window";
import { listAccounts } from "./accounts";

export class BankingPreferenceError extends Error {}

export interface BankingPreference {
  fundingAccountId: string | null;
  pairWindowDays: number;
  /** How many days apart a statement line and an entry of the same amount may be and still pair (3.0.24). */
  matchWindowDays: number;
  /** False until someone saves it; the defaults are only offered. */
  saved: boolean;
}

export async function getBankingPreference(sb: SupabaseClient): Promise<BankingPreference> {
  const { data, error } = await sb
    .from("acc_banking_preference")
    .select("funding_account_id,pair_window_days,match_window_days")
    .eq("singleton", true)
    .maybeSingle();
  if (error) throw new BankingPreferenceError(error.message);
  if (!data) {
    return { fundingAccountId: null, pairWindowDays: DEFAULT_PAIR_WINDOW, matchWindowDays: MATCH_WINDOW_DEFAULT, saved: false };
  }
  const row = data as { funding_account_id: string | null; pair_window_days: number; match_window_days: number };
  return {
    fundingAccountId: row.funding_account_id,
    pairWindowDays: Number(row.pair_window_days),
    matchWindowDays: Number(row.match_window_days),
    saved: true,
  };
}

/**
 * The company's statement matching window (3.0.24, acc_statement_match_window):
 * the one figure every pairing reads, on the server and in the workspace.
 */
export async function getStatementMatchWindow(sb: SupabaseClient): Promise<number> {
  const { data, error } = await sb.rpc("acc_statement_match_window");
  if (error) throw new BankingPreferenceError(error.message);
  // A figure, or the default: never an empty answer read as 0 days.
  const days = typeof data === "number" ? data : typeof data === "string" && data.trim() !== "" ? Number(data) : Number.NaN;
  return matchWindowProblem(days) === null ? days : MATCH_WINDOW_DEFAULT;
}

/** Save the statement matching window. The database checks the role and the range again. */
export async function saveStatementMatchWindow(sb: SupabaseClient, days: number): Promise<void> {
  const problem = matchWindowProblem(days);
  if (problem) throw new BankingPreferenceError(problem);
  const { error } = await sb.rpc("acc_save_statement_match_window", { p_days: days });
  if (error) throw new BankingPreferenceError(error.message);
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
  const { error } = await sb.rpc("acc_save_banking_preference", {
    p_funding_account_id: input.fundingAccountId,
    p_pair_window_days: input.pairWindowDays,
  });
  if (error) throw new BankingPreferenceError(error.message);
}
