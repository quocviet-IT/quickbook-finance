import { describe, expect, it } from "vitest";
import {
  AFTER_TAKING_BACK,
  BANK_LINE_DELETE_KINDS,
  DELETE_DIALOG,
  UNREADABLE_STATE,
  bankLineDeleteStateOf,
  deleteStep,
  reasonIsEnough,
  type BankLineDeleteState,
} from "@/lib/domain/bank-transaction-delete";

/**
 * 3.0.23 (item C of the defect report): a bank line is deleted only when it is
 * unposted, unmatched and unreconciled; every other line is refused with the
 * way out. Entry numbers and dates here are invented.
 */
const state = (over: Partial<BankLineDeleteState> = {}): BankLineDeleteState => ({
  kind: "deletable",
  message: null,
  entryNumber: null,
  reconciliationId: null,
  reconciledTo: null,
  ...over,
});

describe("bankLineDeleteStateOf", () => {
  it("reads the database's answer", () => {
    expect(
      bankLineDeleteStateOf({
        kind: "reconciled",
        message: "This line is reconciled to Jul 31, 2026, so it is not deleted. Reopen that reconciliation to change it.",
        entry_id: "e-1",
        entry_number: "JE-000123",
        reconciliation_id: "rec-7",
        reconciled_to: "2026-07-31",
      }),
    ).toEqual({
      kind: "reconciled",
      message: "This line is reconciled to Jul 31, 2026, so it is not deleted. Reopen that reconciliation to change it.",
      entryNumber: "JE-000123",
      reconciliationId: "rec-7",
      reconciledTo: "2026-07-31",
    });
    expect(bankLineDeleteStateOf({ kind: "deletable" })).toEqual(state());
  });

  it("never reads an answer it does not know as a delete", () => {
    expect(() => bankLineDeleteStateOf({ kind: "maybe" })).toThrow(UNREADABLE_STATE);
    expect(() => bankLineDeleteStateOf(null)).toThrow(UNREADABLE_STATE);
    expect(() => bankLineDeleteStateOf({ kind: "posted" })).toThrow(UNREADABLE_STATE);
  });

  it("knows the eight kinds the database gives, and only those", () => {
    expect([...BANK_LINE_DELETE_KINDS].sort()).toEqual(
      ["deletable", "ignored", "import_batch", "matched", "posted", "reconciled", "settled", "suggested"],
    );
  });
});

describe("deleteStep", () => {
  it("deletes only a deletable line", () => {
    expect(deleteStep(state())).toEqual({ kind: "delete" });
    for (const kind of BANK_LINE_DELETE_KINDS.filter((k) => k !== "deletable")) {
      expect(deleteStep(state({ kind, message: "refused" })).kind, kind).not.toBe("delete");
    }
  });

  it("offers Void for a line posted here, naming its entry, and says the delete can follow", () => {
    expect(deleteStep(state({ kind: "posted", message: "x", entryNumber: "JE-000123" }))).toEqual({
      kind: "void",
      label: "Void JE-000123",
      note: AFTER_TAKING_BACK,
    });
  });

  it("offers Unmatch for a line matched to an entry posted elsewhere", () => {
    expect(deleteStep(state({ kind: "matched", message: "x", entryNumber: "JE-000045" }))).toEqual({
      kind: "unmatch",
      label: "Unmatch",
      note: AFTER_TAKING_BACK,
    });
  });

  it("does not repeat in its note what the refusal above it already says", () => {
    expect(AFTER_TAKING_BACK).not.toMatch(/stays (posted|in the journal)|For review/);
  });

  it("sends a reconciled line to its reconciliation, and offers nothing that changes it here", () => {
    expect(deleteStep(state({ kind: "reconciled", message: "x", reconciliationId: "rec-7", reconciledTo: "2026-07-31" }))).toEqual({
      kind: "open",
      label: "Open the reconciliation",
      href: "/banking/reconcile/rec-7",
      note: "Reopening a completed reconciliation is for an administrator, on its own page.",
    });
    expect(deleteStep(state({ kind: "reconciled", message: "x" }))).toEqual({ kind: "none" });
  });

  it("offers nothing for a line something else owns: its message says what", () => {
    for (const kind of ["settled", "import_batch", "suggested", "ignored"] as const) {
      expect(deleteStep(state({ kind, message: "x" })), kind).toEqual({ kind: "none" });
    }
  });
});

describe("the reason", () => {
  it("asks for a sentence, as the database does", () => {
    expect(DELETE_DIALOG.reasonMin).toBe(10);
    expect(reasonIsEnough("duplicate")).toBe(false);
    expect(reasonIsEnough("  Imported twice  ")).toBe(true);
  });
});
