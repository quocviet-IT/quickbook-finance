import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  getUserRole: vi.fn(),
  canWrite: vi.fn(),
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
  discardReconciliation: vi.fn(),
  bringHistoryForward: vi.fn(),
  bringHistoryForwardFromSession: vi.fn(),
  getHistoryPreview: vi.fn(),
  getReconciliationHistory: vi.fn(),
  getSessionHistoryAdvice: vi.fn(),
  setStatementLineAside: vi.fn(),
  addMissingLines: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth", () => ({ getUserRole: mocks.getUserRole, canWrite: mocks.canWrite, isAdmin: vi.fn() }));
vi.mock("@/lib/db/server", () => ({ createSupabaseServerClient: mocks.createClient }));
vi.mock("@/lib/services/reconcile-history", () => ({
  discardReconciliation: mocks.discardReconciliation,
  bringHistoryForward: mocks.bringHistoryForward,
  bringHistoryForwardFromSession: mocks.bringHistoryForwardFromSession,
  getHistoryPreview: mocks.getHistoryPreview,
  getReconciliationHistory: mocks.getReconciliationHistory,
  getSessionHistoryAdvice: mocks.getSessionHistoryAdvice,
  setStatementLineAside: mocks.setStatementLineAside,
  statementLineDuplicates: vi.fn(),
}));
vi.mock("@/lib/services/add-missing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/add-missing")>()),
  addMissingLines: mocks.addMissingLines,
}));

import {
  bringHistoryForwardAction,
  bringHistoryForwardFromSessionAction,
  discardReconciliationAction,
  historyPreviewAction,
  reconciliationHistoryAction,
  sessionHistoryAdviceAction,
  setStatementLineAsideAction,
} from "@/app/(app)/banking/reconcile/history-actions";
import { addMissingLinesAction } from "@/app/(app)/banking/reconcile/statement-actions";

const REC = "11111111-1111-4111-8111-111111111111";
const BANK = "22222222-2222-4222-8222-222222222222";
const ACCOUNT = "33333333-3333-4333-8333-333333333333";
const client = { marker: "company-bound" };
const DENIED = "You do not have permission to perform this action";

function asViewer() {
  mocks.getUserRole.mockResolvedValue("viewer");
  mocks.canWrite.mockReturnValue(false);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUserRole.mockResolvedValue("accountant");
  mocks.canWrite.mockReturnValue(true);
  mocks.createClient.mockResolvedValue(client);
  mocks.discardReconciliation.mockResolvedValue(4);
  const made = { reconciliationId: "rec-bf", lines: 214, moved: 3, rebasedReconciliationId: REC };
  mocks.bringHistoryForward.mockResolvedValue(made);
  mocks.bringHistoryForwardFromSession.mockResolvedValue({ ...made, fileWarning: null });
  mocks.getHistoryPreview.mockResolvedValue({ bookBalanceMinor: 512340, entries: 214 });
  mocks.getReconciliationHistory.mockResolvedValue([]);
  mocks.getSessionHistoryAdvice.mockResolvedValue(null);
  mocks.setStatementLineAside.mockResolvedValue(undefined);
  mocks.addMissingLines.mockResolvedValue({ added: 1, uncategorized: 1, outcome: null, pairingError: null });
});

describe("who may", () => {
  it("refuses every write to a viewer, and calls nothing", async () => {
    asViewer();
    const results = await Promise.all([
      discardReconciliationAction(REC, { reason: "Wrong statement" }),
      bringHistoryForwardFromSessionAction(REC),
      bringHistoryForwardAction({ bank_account_id: BANK, through: "2026-08-31", balance_minor: 512340 }),
      setStatementLineAsideAction(REC, { line_no: 2, aside: true }),
      addMissingLinesAction(REC, [{ lineNo: 2, accountId: ACCOUNT }], [2]),
    ]);
    for (const result of results) expect(result).toEqual({ ok: false, error: DENIED });
    for (const fn of [
      mocks.discardReconciliation,
      mocks.bringHistoryForwardFromSession,
      mocks.bringHistoryForward,
      mocks.setStatementLineAside,
      mocks.addMissingLines,
    ]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });

  it("lets a viewer read, and nobody without a role", async () => {
    asViewer();
    expect((await reconciliationHistoryAction()).ok).toBe(true);
    expect((await historyPreviewAction({ bank_account_id: BANK, through: "2026-08-31" })).data).toEqual({ bookBalanceMinor: 512340, entries: 214 });
    expect(await sessionHistoryAdviceAction(REC)).toEqual({ ok: true, data: null });
    mocks.getUserRole.mockResolvedValue(null);
    expect(await reconciliationHistoryAction()).toEqual({ ok: false, error: "Not authorized" });
    expect(mocks.getReconciliationHistory).toHaveBeenCalledTimes(1);
  });
});

describe("discardReconciliationAction", () => {
  it("discards with the reason and counts the ticks removed", async () => {
    expect(await discardReconciliationAction(REC, { reason: "  Wrong statement  " })).toEqual({
      ok: true,
      data: { ticksRemoved: 4 },
    });
    expect(mocks.discardReconciliation).toHaveBeenCalledWith(client, REC, "Wrong statement");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/banking/reconcile");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/banking");
  });

  it("asks for a reason, and refuses an id that is not one", async () => {
    expect(await discardReconciliationAction(REC, { reason: " " })).toEqual({
      ok: false,
      error: "A reason is required to discard a reconciliation",
    });
    expect(await discardReconciliationAction("not-an-id", { reason: "Wrong" })).toEqual({ ok: false, error: "Reconciliation not found" });
    expect(mocks.discardReconciliation).not.toHaveBeenCalled();
  });

  it("says the database's refusal as it is", async () => {
    mocks.discardReconciliation.mockRejectedValue(new Error("Only a reconciliation in progress can be discarded"));
    expect(await discardReconciliationAction(REC, { reason: "Wrong" })).toEqual({
      ok: false,
      error: "Only a reconciliation in progress can be discarded",
    });
  });
});

describe("bringing the history forward", () => {
  it("from a reconciliation, sends the service nothing but which reconciliation", async () => {
    const result = await bringHistoryForwardFromSessionAction(REC);
    expect(result.ok).toBe(true);
    expect(mocks.bringHistoryForwardFromSession).toHaveBeenCalledWith(client, REC);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/banking/reconcile/${REC}`);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/banking/reconcile/rec-bf");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/banking/reconcile/history");
  });

  it("from the history page, keeps the statement balance and its date as the note", async () => {
    const result = await bringHistoryForwardAction({ bank_account_id: BANK, through: "2026-08-31", balance_minor: 512340 });
    expect(result).toEqual({ ok: true, data: { reconciliationId: "rec-bf", lines: 214, moved: 3, rebasedReconciliationId: REC } });
    expect(mocks.bringHistoryForward).toHaveBeenCalledWith(
      client,
      BANK,
      "2026-08-31",
      512340,
      "Brought forward, proved by the statement balance of $5,123.40 on Aug 31, 2026",
    );
  });

  it("refuses a day that does not exist, or a balance in part-cents", async () => {
    expect((await bringHistoryForwardAction({ bank_account_id: BANK, through: "2026-02-30", balance_minor: 1 })).error).toBe(
      "A statement date must be a real day",
    );
    expect((await bringHistoryForwardAction({ bank_account_id: BANK, through: "2026-08-31", balance_minor: 1.5 })).error).toBe(
      "The statement balance must be a whole minor-unit amount",
    );
    expect((await historyPreviewAction({ bank_account_id: BANK, through: "" })).ok).toBe(false);
    expect(mocks.bringHistoryForward).not.toHaveBeenCalled();
    expect(mocks.getHistoryPreview).not.toHaveBeenCalled();
  });
});

describe("setStatementLineAsideAction", () => {
  it("sets a line aside, or brings it back", async () => {
    expect(await setStatementLineAsideAction(REC, { line_no: 2, aside: true })).toEqual({ ok: true });
    expect(mocks.setStatementLineAside).toHaveBeenCalledWith(client, REC, 2, true);
    await setStatementLineAsideAction(REC, { line_no: 2, aside: false });
    expect(mocks.setStatementLineAside).toHaveBeenLastCalledWith(client, REC, 2, false);
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/banking/reconcile/${REC}`);
  });

  it("says the paired-line refusal as the service gives it", async () => {
    mocks.setStatementLineAside.mockRejectedValue(new Error("This line is paired with the books, so it is a transaction."));
    expect(await setStatementLineAsideAction(REC, { line_no: 0, aside: true })).toEqual({
      ok: false,
      error: "This line is paired with the books, so it is a transaction.",
    });
  });
});

describe("addMissingLinesAction", () => {
  it("hands the lines chosen with Add anyway to the service", async () => {
    await addMissingLinesAction(REC, [{ lineNo: 2, accountId: ACCOUNT }], [2]);
    expect(mocks.addMissingLines).toHaveBeenCalledWith(client, REC, [{ lineNo: 2, accountId: ACCOUNT }], [2]);
  });

  it("adds none anyway when none are named, as Add all does", async () => {
    await addMissingLinesAction(REC, [{ lineNo: 2, accountId: ACCOUNT }]);
    expect(mocks.addMissingLines).toHaveBeenCalledWith(client, REC, [{ lineNo: 2, accountId: ACCOUNT }], []);
  });

  it("refuses add-anyway lines that are not line numbers", async () => {
    expect((await addMissingLinesAction(REC, [{ lineNo: 2, accountId: ACCOUNT }], ["2"])).ok).toBe(false);
    expect(mocks.addMissingLines).not.toHaveBeenCalled();
  });
});
