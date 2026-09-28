import type { SupabaseClient } from "@supabase/supabase-js";
import { parseClosedPeriod, type AdjustingResult } from "@/lib/domain/adjusting-entries";

/**
 * The two writes to `acc_adjusting_entry`. Each is one RPC, which checks the
 * permission, refuses a voided entry, asks before a closed period and writes
 * its own audit row — nothing is repeated here. Neither touches a journal
 * entry or line.
 */
export class AdjustingEntryError extends Error {}

async function call(sb: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<AdjustingResult> {
  const { error } = await sb.rpc(fn, args);
  if (!error) return { kind: "done" };
  const ask = parseClosedPeriod(error.message);
  if (ask) return { kind: "closed_period", ask };
  throw new AdjustingEntryError(error.message);
}

export function markAdjusting(
  sb: SupabaseClient,
  entryId: string,
  note: string | null,
  confirmClosed: boolean,
): Promise<AdjustingResult> {
  return call(sb, "acc_mark_adjusting", { p_entry_id: entryId, p_note: note, p_confirm_closed: confirmClosed });
}

export function unmarkAdjusting(sb: SupabaseClient, entryId: string, confirmClosed: boolean): Promise<AdjustingResult> {
  return call(sb, "acc_unmark_adjusting", { p_entry_id: entryId, p_confirm_closed: confirmClosed });
}
