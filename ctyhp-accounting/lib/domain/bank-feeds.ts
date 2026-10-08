/**
 * Disconnecting a bank feed and undoing a bank-feed sync (1.89): what Plaid's
 * answer to a removal means, what each screen says, and whether a sync can be
 * undone now. Pure, so the wording is tested where it is written.
 */

/**
 * Plaid's answers that mean the connection is already gone at Plaid — removed
 * before, or its access revoked — so disconnecting has nothing left to remove.
 */
export const PLAID_ITEM_GONE_CODES: readonly string[] = ["ITEM_NOT_FOUND", "INVALID_ACCESS_TOKEN"];

export function plaidItemAlreadyGone(code: string | null | undefined): boolean {
  return code != null && PLAID_ITEM_GONE_CODES.includes(code);
}

const reasonText = (reason: string) => reason.trim().replace(/[.\s]+$/, "") || "an unexpected error occurred";

/** Said when Plaid did not confirm the removal, and the person has not chosen to disconnect in OneBook only. */
export function unconfirmedRemovalMessage(reason: string): string {
  return `Plaid did not confirm the removal: ${reasonText(reason)}. Try again, or tick Disconnect in OneBook only.`;
}

/** Kept on a connection disconnected in OneBook only, so whoever reads it later knows Plaid was not told. */
export function disconnectNote(reason: string): string {
  return `Disconnected in OneBook only: Plaid did not confirm the removal (${reasonText(reason)})`;
}

export function disconnectedMessage(institution: string, confirmedByPlaid: boolean): string {
  return confirmedByPlaid
    ? `${institution} is disconnected. The lines already here stay.`
    : `${institution} is disconnected in OneBook only. The lines already here stay.`;
}

export type BankFeedSyncStatus = "running" | "succeeded" | "failed" | "undone";

export const SYNC_STATUS_LABEL: Record<BankFeedSyncStatus, string> = {
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  undone: "Undone",
};

/** A sync as Bank feed syncs lists it (acc_bank_feed_syncs). */
export interface BankFeedSyncView {
  runId: string;
  connectionId: string;
  institutionName: string;
  connectionStatus: string;
  status: BankFeedSyncStatus;
  startedAt: string;
  completedAt: string | null;
  added: number;
  modified: number;
  removed: number;
  errorMessage: string | null;
  undoneAt: string | null;
  undoReason: string | null;
  /** Lines the sync added or retired; zero when it changed nothing. */
  changes: number;
  /** The connection's newest sync that changed something, not undone, with no sync running. */
  isNewest: boolean;
  /** Lines it added that a person has matched, coded or ignored since. */
  lockedLines: number;
}

const lines = (n: number) => `${n} line${n === 1 ? "" : "s"}`;

/** Whether Undo is offered on a sync, and when not, the tooltip that says why. */
export function syncUndoState(sync: BankFeedSyncView): { canUndo: boolean; why: string | null } {
  if (sync.status === "undone") return { canUndo: false, why: sync.undoReason ? `Undone: ${sync.undoReason}` : "Undone" };
  if (sync.status === "running") return { canUndo: false, why: "This sync is still running" };
  if (sync.changes === 0) return { canUndo: false, why: "This sync changed nothing in Bank Transactions" };
  if (!sync.isNewest) return { canUndo: false, why: "Undo the newer syncs of this bank connection first" };
  if (sync.lockedLines > 0) {
    return {
      canUndo: false,
      why: `${lines(sync.lockedLines)} of this sync ${sync.lockedLines === 1 ? "has" : "have"} been matched, coded or ignored — unmatch ${sync.lockedLines === 1 ? "it" : "them"} first`,
    };
  }
  return { canUndo: true, why: null };
}

/** What the Undo dialog says will happen. */
export function undoSyncWarning(sync: BankFeedSyncView): string {
  const changed = sync.modified + sync.removed;
  const back = changed > 0 ? ` The ${lines(changed)} it changed or removed come back as they were.` : "";
  const nextSyncText = sync.status === "failed"
    ? "This sync did not finish, so the next sync fetches its changes again."
    : "The next sync does not bring them back; to fetch them again, disconnect the bank and connect it again.";
  return (
    `The lines this sync added are removed from Bank Transactions.${back} ` +
    nextSyncText
  );
}

export function undoneSyncMessage(result: { removed: number; restored: number }): string {
  const restored = result.restored > 0 ? `; ${lines(result.restored)} restored` : "";
  return `Sync undone: ${lines(result.removed)} removed${restored}.`;
}
