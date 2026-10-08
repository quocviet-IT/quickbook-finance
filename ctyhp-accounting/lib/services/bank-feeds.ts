/**
 * Disconnecting a bank feed and undoing a bank-feed sync (1.89). The rules are
 * in the database (0137); this removes the connection at Plaid first, and says
 * so when Plaid does not confirm, so a connection is never dropped in OneBook
 * while Plaid keeps it — unless the person chose that.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  disconnectNote,
  plaidItemAlreadyGone,
  unconfirmedRemovalMessage,
  type BankFeedSyncStatus,
  type BankFeedSyncView,
} from "@/lib/domain/bank-feeds";
import { decryptBankToken } from "./bank-token-crypto";
import { readAllPages } from "./paging";
import { PlaidError, plaidConfiguration, removePlaidItem } from "./plaid";

export class BankFeedError extends Error {}

/** Every sync of every connection that ever fed this bank account, newest first; one that changed nothing and did not fail is left out. */
export async function listBankFeedSyncs(sb: SupabaseClient, bankAccountId: string): Promise<BankFeedSyncView[]> {
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) =>
      sb
        .rpc("acc_bank_feed_syncs", { p_bank_account_id: bankAccountId })
        .order("started_at", { ascending: false })
        .order("run_id", { ascending: false })
        .range(from, to),
    (message) => new BankFeedError(message),
  );
  return rows.map((r) => ({
    runId: r.run_id as string,
    connectionId: r.connection_id as string,
    institutionName: r.institution_name as string,
    connectionStatus: r.connection_status as string,
    status: r.status as BankFeedSyncStatus,
    startedAt: r.started_at as string,
    completedAt: (r.completed_at as string | null) ?? null,
    added: Number(r.added_count ?? 0),
    modified: Number(r.modified_count ?? 0),
    removed: Number(r.removed_count ?? 0),
    errorMessage: (r.error_message as string | null) ?? null,
    undoneAt: (r.undone_at as string | null) ?? null,
    undoReason: (r.undo_reason as string | null) ?? null,
    changes: Number(r.changes ?? 0),
    isNewest: Boolean(r.is_newest),
    lockedLines: Number(r.locked_lines ?? 0),
  }));
}

/** Takes one sync back: the lines it added go, the lines it retired come back as they were. */
export async function undoBankFeedSync(sb: SupabaseClient, runId: string, reason: string): Promise<{ removed: number; restored: number }> {
  const { data, error } = await sb.rpc("acc_undo_bank_feed_sync", { p_run_id: runId, p_reason: reason });
  if (error) throw new BankFeedError(error.message);
  const out = (data ?? {}) as Record<string, unknown>;
  return { removed: Number(out.removed ?? 0), restored: Number(out.restored ?? 0) };
}

export type DisconnectOutcome =
  | { disconnected: true; confirmedByPlaid: boolean }
  /** Plaid did not confirm and the person has not chosen to disconnect in OneBook only: nothing changed. */
  | { disconnected: false; unconfirmed: string };

/**
 * Removes the connection at Plaid, then disconnects it in OneBook. Plaid
 * answering that the connection is already gone counts as removed. When Plaid
 * cannot be reached, answers otherwise, OneBook has no Plaid keys or the token
 * cannot be read, nothing changes — unless `onlyInOneBook`, and then the
 * connection keeps a note that Plaid was not told.
 */
export async function disconnectBankConnection(
  sb: SupabaseClient,
  connectionId: string,
  reason: string,
  onlyInOneBook: boolean,
): Promise<DisconnectOutcome> {
  const why = reason.trim();
  if (!why) throw new BankFeedError("Say why this bank connection is being disconnected");

  let problem: string | null = null;
  // Everything that can stop Plaid confirming — its settings included — lands
  // here, so Disconnect in OneBook only stays open whatever went wrong.
  try {
    if (!plaidConfiguration().configured) {
      problem = "OneBook has no Plaid keys";
    } else {
      const { data: encrypted, error } = await sb.rpc("acc_get_bank_connection_token", { p_connection_id: connectionId });
      if (error) throw new BankFeedError(error.message);
      if (typeof encrypted !== "string" || encrypted === "") throw new BankFeedError("the stored token was not found");
      await removePlaidItem(decryptBankToken(encrypted));
    }
  } catch (e) {
    if (!(e instanceof PlaidError && plaidItemAlreadyGone(e.code))) {
      problem = e instanceof Error ? e.message : "an unexpected error";
      const request = e instanceof PlaidError && e.requestId ? ` (Plaid request ${e.requestId})` : "";
      console.warn(`removing the bank connection at Plaid failed: ${problem}${request}`);
    }
  }
  if (problem && !onlyInOneBook) return { disconnected: false, unconfirmed: unconfirmedRemovalMessage(problem) };

  const { error } = await sb.rpc("acc_disconnect_bank_connection", {
    p_connection_id: connectionId,
    p_reason: why,
    p_note: problem ? disconnectNote(problem) : null,
  });
  if (error) throw new BankFeedError(error.message);
  return { disconnected: true, confirmedByPlaid: problem === null };
}
