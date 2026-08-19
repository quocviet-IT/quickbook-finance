import { describe, expect, it } from "vitest";
import { isOverdueDocument, matchesDocumentKeyword } from "@/lib/domain/document-filter";

describe("matchesDocumentKeyword", () => {
  it("matches any of the fields the screen hands it, ignoring case", () => {
    expect(matchesDocumentKeyword(["INV-000123", "Daniel Carter"], "daniel")).toBe(true);
    expect(matchesDocumentKeyword(["INV-000123", "Daniel Carter"], "inv-0001")).toBe(true);
  });

  it("skips fields the record does not carry rather than crashing", () => {
    // A draft has no number yet, a bill may have no vendor reference.
    expect(matchesDocumentKeyword([null, undefined, "Harbor Metals"], "harbor")).toBe(true);
    expect(matchesDocumentKeyword([null, undefined], "harbor")).toBe(false);
  });

  it("treats an empty keyword as matching everything", () => {
    expect(matchesDocumentKeyword([null], "")).toBe(true);
    expect(matchesDocumentKeyword(["x"], "   ")).toBe(true);
  });
});

describe("isOverdueDocument", () => {
  const base = { status: "issued", dueDate: "2026-08-01", balanceDueMinor: 50_00 };

  it("is overdue when money is still owed past the due date", () => {
    expect(isOverdueDocument(base, "2026-08-19")).toBe(true);
  });

  it("is not overdue on or before the due date", () => {
    // Due today is due, not late: the debtor still has until midnight.
    expect(isOverdueDocument(base, "2026-08-01")).toBe(false);
    expect(isOverdueDocument(base, "2026-07-30")).toBe(false);
  });

  it("is never overdue once nothing is owed", () => {
    expect(isOverdueDocument({ ...base, balanceDueMinor: 0 }, "2026-08-19")).toBe(false);
  });

  it("is never overdue as a draft or a void, whatever the dates say", () => {
    // A draft is not yet a receivable, and a void never will be. Both unions
    // (invoice: issued/partial, bill: open/partial) pass through on the
    // balance alone — this rule is the one thing they must agree on.
    expect(isOverdueDocument({ ...base, status: "draft" }, "2026-08-19")).toBe(false);
    expect(isOverdueDocument({ ...base, status: "void" }, "2026-08-19")).toBe(false);
  });

  it("is never overdue without a due date to be late against", () => {
    expect(isOverdueDocument({ ...base, dueDate: null }, "2026-08-19")).toBe(false);
  });

  it("works for a bill's own statuses too", () => {
    expect(isOverdueDocument({ status: "open", dueDate: "2026-08-01", balanceDueMinor: 1 }, "2026-08-19")).toBe(true);
    expect(isOverdueDocument({ status: "partial", dueDate: "2026-08-01", balanceDueMinor: 1 }, "2026-08-19")).toBe(true);
  });
});
