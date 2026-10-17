import { describe, expect, it } from "vitest";
import {
  groupReconciliationChanges,
  reconciliationChangeSentences,
  toReconciliationChange,
  type ReconciliationChange,
} from "@/lib/domain/reconciliation-changes";

const money = (minor: number) => `$${(minor / 100).toFixed(2)}`;

const change = (over: Partial<ReconciliationChange> & Pick<ReconciliationChange, "kind">): ReconciliationChange => ({
  changeKey: `${over.kind}:r1:${over.entryId ?? ""}`,
  reconciliationId: "r1",
  bankAccountId: "b1",
  statementEndingDate: "2026-08-31",
  completedAt: "2026-09-02T10:00:00Z",
  entryId: null,
  entryNumber: null,
  entryDate: null,
  signedMinor: null,
  reversalEntryId: null,
  reversalEntryNumber: null,
  differenceMinor: null,
  ...over,
});

const sentences = (changes: ReconciliationChange[]) =>
  groupReconciliationChanges(changes).map((r) => reconciliationChangeSentences(r, money));

describe("the four sentences", () => {
  it("words a void", () => {
    expect(sentences([change({ kind: "voided", entryId: "e1", entryNumber: "JE-900101", signedMinor: 5000 })])[0]).toContain("JE-900101 was voided.");
  });

  it("words a reversal with the reversing entry", () => {
    const rows = [change({ kind: "reversed", entryId: "e1", entryNumber: "JE-900102", reversalEntryNumber: "JE-900110" })];
    expect(sentences(rows)).toEqual([["JE-900102 was reversed by JE-900110."]]);
  });

  it("words an entry posted after sign-off with its date", () => {
    const rows = [change({ kind: "added", entryId: "e1", entryNumber: "JE-900103", entryDate: "2026-08-28" })];
    expect(sentences(rows)).toEqual([["JE-900103, dated Aug 28, 2026, was posted after the reconciliation was signed off."]]);
  });

  it("words a drift with how far out it is, unsigned", () => {
    expect(sentences([change({ kind: "drift", differenceMinor: -1200 })])).toEqual([["The reconciliation no longer adds up: it is out by $12.00."]]);
    expect(sentences([change({ kind: "drift", differenceMinor: 1200 })])).toEqual([["The reconciliation no longer adds up: it is out by $12.00."]]);
  });
});

describe("drift beside voids", () => {
  const voided = (id: string, n: string, signed: number) => change({ kind: "voided", entryId: id, entryNumber: n, signedMinor: signed });

  it("prints no drift sentence when the voided entries explain it exactly", () => {
    const rows = [voided("e1", "JE-900201", 10000), change({ kind: "drift", differenceMinor: 10000 })];
    expect(sentences(rows)).toEqual([["JE-900201 was voided."]]);
  });

  it("explains it exactly with several voids", () => {
    const rows = [voided("e1", "JE-900201", 10000), voided("e2", "JE-900202", -2500), change({ kind: "drift", differenceMinor: 7500 })];
    expect(sentences(rows)).toEqual([["JE-900201 was voided.", "JE-900202 was voided."]]);
  });

  it("prints only the part the voids do not explain", () => {
    const rows = [voided("e1", "JE-900201", 10000), change({ kind: "drift", differenceMinor: 11200 })];
    expect(sentences(rows)).toEqual([["JE-900201 was voided.", "The reconciliation no longer adds up: it is out by $12.00."]]);
  });

  it("does not let a reversal explain a drift", () => {
    const rows = [change({ kind: "reversed", entryId: "e1", entryNumber: "JE-900202", signedMinor: 10000, reversalEntryNumber: "JE-900203" }), change({ kind: "drift", differenceMinor: 10000 })];
    expect(sentences(rows)[0]).toHaveLength(2);
  });
});

describe("grouping", () => {
  it("makes one group per reconciliation, oldest statement first, entries before the drift", () => {
    const rows = [
      change({ kind: "drift", differenceMinor: 300, reconciliationId: "r2", statementEndingDate: "2026-09-30", changeKey: "d2" }),
      change({ kind: "added", entryId: "e9", entryNumber: "JE-900301", entryDate: "2026-08-30", changeKey: "a1" }),
      change({ kind: "voided", entryId: "e8", entryNumber: "JE-900300", signedMinor: 1, changeKey: "v1" }),
    ];
    const groups = groupReconciliationChanges(rows);
    expect(groups.map((g) => g.reconciliationId)).toEqual(["r1", "r2"]);
    expect(groups[0].items.map((i) => i.kind)).toEqual(["voided", "added"]);
    expect(groups[1].unexplainedDriftMinor).toBe(300);
  });

  it("leaves out a reconciliation whose statement ends after the report date", () => {
    const rows = [change({ kind: "voided", entryId: "e1", entryNumber: "JE-900101", signedMinor: 1 })];
    expect(groupReconciliationChanges(rows, "2026-08-30")).toEqual([]);
    expect(groupReconciliationChanges(rows, "2026-08-31")).toHaveLength(1);
  });

  it("reads an RPC row, bigint strings and all, and refuses an unknown kind", () => {
    const row = toReconciliationChange({
      change_key: "k",
      reconciliation_id: "r1",
      bank_account_id: "b1",
      statement_ending_date: "2026-08-31",
      completed_at: "2026-09-02T10:00:00Z",
      kind: "drift",
      difference_minor: "1200",
    });
    expect(row.differenceMinor).toBe(1200);
    expect(row.entryId).toBeNull();
    expect(() => toReconciliationChange({ ...row, kind: "other" })).toThrow();
  });
});
