import { describe, expect, it } from "vitest";
import {
  FINISH_IN_PROGRESS_FIRST,
  HISTORY_STATE_LABELS,
  OPEN_IN_PROGRESS,
  RECONCILE_HISTORY,
  RECONCILE_HISTORY_PATH,
  STATEMENT_BALANCE_ON,
  booksReadText,
  bringForwardEntriesLabel,
  defaultHistoryAccount,
  historyAccounts,
  historyAdvice,
  historyBroughtForwardMessage,
  historyBroughtForwardNote,
  historyOutByText,
  inProgressText,
  reconciledUpTo,
  type ReconciliationHistoryRow,
} from "@/lib/domain/reconcile-history";

const money = (minor: number) => `$${(minor / 100).toFixed(2)}`;

const bank = (id: string, bankName: string, code: string, masked: string | null = null, accountName = "") => ({
  id,
  bank_name: bankName,
  account_name: accountName,
  account_code: code,
  account_number_masked: masked,
});
const row = (bankAccountId: string, over: Partial<ReconciliationHistoryRow> = {}): ReconciliationHistoryRow => ({
  bankAccountId,
  openLines: 0,
  firstOpenDate: null,
  lastOpenDate: null,
  lastReconciledDate: null,
  inProgress: null,
  ...over,
});

describe("historyAccounts", () => {
  it("names each account as Banking does, in Banking's order, with its state", () => {
    const rows = [
      row("b2", { openLines: 12, firstOpenDate: "2025-01-04", lastOpenDate: "2026-09-28", lastReconciledDate: "2026-08-31" }),
      row("b1", { openLines: 340, firstOpenDate: "2024-03-01", lastOpenDate: "2026-09-29", inProgress: { id: "r1", endingDate: "2026-09-30" } }),
    ];
    const accounts = historyAccounts(rows, [
      bank("b1", "Example Bank", "1010", "****1111"),
      bank("b2", "", "1020", null, "Example Savings"),
    ]);
    expect(accounts).toEqual([
      {
        ...rows[1],
        label: "Example Bank · 1010",
        maskedNumber: "****1111",
        state: "never",
      },
      {
        ...rows[0],
        label: "Example Savings · 1020",
        maskedNumber: null,
        state: "reconciled",
      },
    ]);
  });

  it("gives an account the history does not name yet nothing open, and leaves out a row for an account not listed", () => {
    const accounts = historyAccounts([row("hidden", { openLines: 5 })], [bank("new", "Example Bank", "")]);
    expect(accounts).toEqual([{ ...row("new"), label: "Example Bank", maskedNumber: null, state: "never" }]);
  });
});

describe("historyAdvice", () => {
  const never = { lastReconciledDate: null, inProgress: null };

  it("offers to bring the entries forward when the books read the statement's balance", () => {
    expect(historyAdvice(never, "2026-08-31", 512340, { bookBalanceMinor: 512340, entries: 214 }, money)).toEqual({
      kind: "match",
      text: "Books on 08/31/2026 read $5123.40 ✓",
      action: "Bring forward 214 entries",
      entries: 214,
      outByMinor: 0,
      inProgressId: null,
    });
    expect(historyAdvice(never, "2026-08-31", 1500, { bookBalanceMinor: 1500, entries: 1 }, money).action).toBe("Bring forward 1 entry");
  });

  it("offers no button when the books hold nothing through the date", () => {
    expect(historyAdvice(never, "2023-12-31", 0, { bookBalanceMinor: 0, entries: 0 }, money)).toMatchObject({
      kind: "match",
      text: "Books on 12/31/2023 read $0.00 ✓",
      action: null,
    });
  });

  it("says by how much they are out, in either direction", () => {
    expect(historyAdvice(never, "2026-08-31", 512340, { bookBalanceMinor: 498765, entries: 214 }, money)).toEqual({
      kind: "out",
      text: "Out by $135.75. Find the entry that differs, or try another statement.",
      action: null,
      entries: 214,
      outByMinor: 13575,
      inProgressId: null,
    });
    expect(historyAdvice(never, "2026-08-31", 498765, { bookBalanceMinor: 512340, entries: 214 }, money).outByMinor).toBe(13575);
  });

  it("asks for the session in progress to be finished first when it ends on or before the date", () => {
    const busy = { lastReconciledDate: null, inProgress: { id: "r1", endingDate: "2026-08-31" } };
    expect(historyAdvice(busy, "2026-08-31", 512340, { bookBalanceMinor: 512340, entries: 214 }, money)).toMatchObject({
      kind: "inProgress",
      text: "Finish or discard the reconciliation in progress first.",
      action: null,
      inProgressId: "r1",
    });
    // One that ends after the date is moved on by bringing the history forward, not in the way.
    const later = { lastReconciledDate: null, inProgress: { id: "r1", endingDate: "2026-09-30" } };
    expect(historyAdvice(later, "2026-08-31", 512340, { bookBalanceMinor: 512340, entries: 214 }, money).kind).toBe("match");
  });

  it("offers nothing on an account already reconciled, before anything else", () => {
    const done = { lastReconciledDate: "2026-07-31", inProgress: { id: "r1", endingDate: "2026-08-31" } };
    expect(historyAdvice(done, "2026-08-31", 1, { bookBalanceMinor: 2, entries: 3 }, money)).toMatchObject({
      kind: "reconciled",
      text: "Reconciled up to 07/31/2026",
      action: null,
    });
  });
});

describe("the history page's sentences", () => {
  it("are the spec's, character for character", () => {
    expect(booksReadText("2026-08-31", 512340, money)).toBe("Books on 08/31/2026 read $5123.40 ✓");
    expect(bringForwardEntriesLabel(1)).toBe("Bring forward 1 entry");
    expect(bringForwardEntriesLabel(1204)).toBe("Bring forward 1,204 entries");
    expect(historyOutByText(13575, money)).toBe("Out by $135.75. Find the entry that differs, or try another statement.");
    expect(reconciledUpTo("2026-08-31")).toBe("Reconciled up to 08/31/2026");
    expect(FINISH_IN_PROGRESS_FIRST).toBe("Finish or discard the reconciliation in progress first.");
  });

  it("keeps the statement balance and its date as the note of a reconciliation brought forward from the history page", () => {
    expect(historyBroughtForwardNote(512340, "2026-08-31", money)).toBe(
      "Brought forward, proved by the statement balance of $5123.40 on 08/31/2026",
    );
  });

  it("names the page, each state, the session in progress and the form's words", () => {
    expect(RECONCILE_HISTORY).toBe("Reconcile history");
    expect(RECONCILE_HISTORY_PATH).toBe("/banking/reconcile/history");
    expect(HISTORY_STATE_LABELS).toEqual({ never: "Never reconciled", reconciled: "Reconciled" });
    expect(inProgressText("2026-09-30")).toBe("In progress, ending 09/30/2026");
    expect(OPEN_IN_PROGRESS).toBe("Open the reconciliation in progress");
    expect(STATEMENT_BALANCE_ON).toBe("Statement balance on");
  });

  it("says how many entries were brought forward, nothing posted, and where a session in progress now begins", () => {
    expect(historyBroughtForwardMessage(214, "2026-08-31", null, money)).toBe(
      "Brought forward: 214 entries up to 08/31/2026 marked reconciled. Nothing was posted to the books.",
    );
    expect(historyBroughtForwardMessage(1, "2026-08-31", 512340, money)).toBe(
      "Brought forward: 1 entry up to 08/31/2026 marked reconciled. Nothing was posted to the books. " +
        "The reconciliation in progress now begins at $5123.40.",
    );
  });
});

describe("defaultHistoryAccount", () => {
  const account = (bankAccountId: string, state: "never" | "reconciled", openLines: number) => ({ bankAccountId, state, openLines });

  it("opens on the first account never reconciled that has lines to bring forward", () => {
    expect(
      defaultHistoryAccount([account("b1", "reconciled", 40), account("b2", "never", 0), account("b3", "never", 12), account("b4", "never", 9)]),
    ).toBe("b3");
  });

  it("falls back to the first never reconciled, then the first account, then none", () => {
    expect(defaultHistoryAccount([account("b1", "reconciled", 4), account("b2", "never", 0)])).toBe("b2");
    expect(defaultHistoryAccount([account("b1", "reconciled", 4), account("b2", "reconciled", 0)])).toBe("b1");
    expect(defaultHistoryAccount([])).toBeNull();
  });
});
