import type { SupabaseClient } from "@supabase/supabase-js";
import { toClearingStanding, type ClearingStanding } from "@/lib/domain/clearing-accounts";
import { readAllPages } from "@/lib/services/paging";

export class ClearingAccountsError extends Error {}

/**
 * What each clearing account still holds on a day, from acc_clearing_standing:
 * its balance, its last movement and its oldest open item, first in first out.
 * Paged all the same (the account id orders it totally), so nothing between the
 * account list and PostgREST's row cap can shorten it silently.
 */
export async function getClearingStanding(sb: SupabaseClient, asOf: string): Promise<ClearingStanding[]> {
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) => sb.rpc("acc_clearing_standing", { p_as_of: asOf }).order("account_id").range(from, to),
    (message) => new ClearingAccountsError(message),
  );
  return rows.map(toClearingStanding);
}
