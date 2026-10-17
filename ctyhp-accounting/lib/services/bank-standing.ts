import type { SupabaseClient } from "@supabase/supabase-js";
import { toBankStanding, withReconciliationChanges, type BankStanding } from "@/lib/domain/bank-standing";
import type { ReconciliationChange } from "@/lib/domain/reconciliation-changes";
import { BankRecError } from "@/lib/services/bankrec";
import { readAllPages } from "@/lib/services/paging";
import { getReconciliationChanges } from "@/lib/services/reconciliation-changes";

/**
 * How each bank account stands against its statements on a day: its last
 * agreed statement and what has happened since. One row per bank account from
 * acc_bank_standing, paged all the same (the bank account id orders it
 * totally), so nothing between the account and PostgREST's row cap can shorten
 * the list silently.
 *
 * `changes`, when given, are the changes to completed reconciliations already
 * read by the caller (the Exceptions report reads them once for its own
 * check); they are put on each standing so the "No longer agrees" badge counts
 * the same reconciliations. Left out, the standing is the plain one.
 */
export async function getBankStanding(
  sb: SupabaseClient,
  asOf: string,
  changes?: readonly ReconciliationChange[] | null,
): Promise<BankStanding[]> {
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) => sb.rpc("acc_bank_standing", { p_as_of: asOf }).order("bank_account_id").range(from, to),
    (message) => new BankRecError(message),
  );
  const standings = rows.map(toBankStanding);
  return changes ? withReconciliationChanges(standings, changes, asOf) : standings;
}

/**
 * The standing with the badge counted from the changes to completed
 * reconciliations: one extra read of `acc_reconciliation_changes()`. If that
 * read fails the plain standing is returned, and the badge keeps counting
 * voided entries, so a screen never loses its standing over the badge.
 */
export async function getBankStandingWithChanges(sb: SupabaseClient, asOf: string): Promise<BankStanding[]> {
  const [standings, changes] = await Promise.all([
    getBankStanding(sb, asOf),
    getReconciliationChanges(sb).catch(() => null),
  ]);
  return changes ? withReconciliationChanges(standings, changes, asOf) : standings;
}
