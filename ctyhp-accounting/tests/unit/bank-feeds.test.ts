import { describe, expect, it } from "vitest";
import {
  disconnectNote,
  disconnectedMessage,
  plaidItemAlreadyGone,
  syncUndoState,
  undoSyncWarning,
  undoneSyncMessage,
  unconfirmedRemovalMessage,
  type BankFeedSyncView,
} from "@/lib/domain/bank-feeds";

const sync = (extra: Partial<BankFeedSyncView> = {}): BankFeedSyncView => ({
  runId: "run-1",
  connectionId: "conn-1",
  institutionName: "Example Bank",
  connectionStatus: "active",
  status: "succeeded",
  startedAt: "2026-10-07T11:00:00Z",
  completedAt: "2026-10-07T11:00:05Z",
  added: 3,
  modified: 0,
  removed: 0,
  errorMessage: null,
  undoneAt: null,
  undoReason: null,
  changes: 3,
  isNewest: true,
  lockedLines: 0,
  ...extra,
});

describe("Plaid's answer to a removal", () => {
  it("takes an item Plaid no longer has as removed", () => {
    expect(plaidItemAlreadyGone("ITEM_NOT_FOUND")).toBe(true);
    expect(plaidItemAlreadyGone("INVALID_ACCESS_TOKEN")).toBe(true);
  });

  it("takes anything else as not confirmed", () => {
    expect(plaidItemAlreadyGone("INTERNAL_SERVER_ERROR")).toBe(false);
    expect(plaidItemAlreadyGone("ITEM_LOGIN_REQUIRED")).toBe(false);
    expect(plaidItemAlreadyGone(null)).toBe(false);
  });
});

describe("what disconnecting says", () => {
  it("asks to try again or disconnect in OneBook only", () => {
    expect(unconfirmedRemovalMessage("Plaid request failed: fetch failed.")).toBe(
      "Plaid did not confirm the removal: Plaid request failed: fetch failed. Try again, or tick Disconnect in OneBook only.",
    );
  });

  it("keeps a note on a connection Plaid was not told about", () => {
    expect(disconnectNote("OneBook has no Plaid keys")).toBe(
      "Disconnected in OneBook only: Plaid did not confirm the removal (OneBook has no Plaid keys)",
    );
    expect(disconnectNote("  ")).toBe("Disconnected in OneBook only: Plaid did not confirm the removal (an unexpected error occurred)");
  });

  it("says the lines stay", () => {
    expect(disconnectedMessage("Example Bank", true)).toBe("Example Bank is disconnected. The lines already here stay.");
    expect(disconnectedMessage("Example Bank", false)).toBe("Example Bank is disconnected in OneBook only. The lines already here stay.");
  });
});

describe("whether a sync can be undone", () => {
  it("offers Undo on the newest sync with nothing locked", () => {
    expect(syncUndoState(sync())).toEqual({ canUndo: true, why: null });
  });

  it("says why not, in order", () => {
    expect(syncUndoState(sync({ status: "undone", undoReason: "Duplicates of the CSV" })).why).toBe("Undone: Duplicates of the CSV");
    expect(syncUndoState(sync({ status: "running" })).why).toBe("This sync is still running");
    expect(syncUndoState(sync({ changes: 0 })).why).toBe("This sync changed nothing in Bank Transactions");
    expect(syncUndoState(sync({ isNewest: false, lockedLines: 2 })).why).toBe("Undo the newer syncs of this bank connection first");
    expect(syncUndoState(sync({ lockedLines: 1 })).why).toBe("1 line of this sync has been matched, coded or ignored — unmatch it first");
    expect(syncUndoState(sync({ lockedLines: 2 })).why).toBe("2 lines of this sync have been matched, coded or ignored — unmatch them first");
  });

  it("offers Undo on a failed sync that changed something", () => {
    expect(syncUndoState(sync({ status: "failed" })).canUndo).toBe(true);
  });
});

describe("what undoing says", () => {
  it("warns the lines do not come back with the next sync", () => {
    expect(undoSyncWarning(sync())).toBe(
      "The lines this sync added are removed from Bank Transactions. The next sync does not bring them back; to fetch them again, disconnect the bank and connect it again.",
    );
    expect(undoSyncWarning(sync({ modified: 1, removed: 1 }))).toContain("The 2 lines it changed or removed come back as they were.");
  });

  it("says what was removed and restored", () => {
    expect(undoneSyncMessage({ removed: 3, restored: 0 })).toBe("Sync undone: 3 lines removed.");
    expect(undoneSyncMessage({ removed: 1, restored: 2 })).toBe("Sync undone: 1 line removed; 2 lines restored.");
  });

  it("says a failed sync's undo fetches it again next time", () => {
    expect(undoSyncWarning(sync({ status: "failed" }))).toBe("The lines this sync added are removed from Bank Transactions. This sync did not finish, so the next sync fetches its changes again.");
  });
});
