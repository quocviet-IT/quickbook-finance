import type { SupabaseClient } from "@supabase/supabase-js";
import { toReconciliationChange, type ReconciliationChange } from "@/lib/domain/reconciliation-changes";
import { BankRecError } from "@/lib/services/bankrec";
import { readAllPages } from "@/lib/services/paging";

/**
 * Every change made to a completed reconciliation since it was signed off, as
 * `acc_reconciliation_changes()` returns them. A read; paged past PostgREST's
 * 1,000-row cap, ordered by `change_key`, which is unique.
 */
export async function getReconciliationChanges(sb: SupabaseClient): Promise<ReconciliationChange[]> {
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) => sb.rpc("acc_reconciliation_changes").order("change_key").range(from, to),
    (message) => new BankRecError(message),
  );
  return rows.map(toReconciliationChange);
}
