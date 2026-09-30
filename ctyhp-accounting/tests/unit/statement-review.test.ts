import { describe, expect, it } from "vitest";
import type { CodingSuggestionView } from "@/lib/domain/coding";
import {
  chunked,
  itemFromValue,
  proposalValue,
  REVIEW_POST_CHUNK,
  reviewProposal,
  type ReviewDocument,
} from "@/lib/domain/statement-review";

const line = (amountMinor: number, over: Partial<{ status: string; pending: boolean }> = {}) => ({
  id: "t1",
  status: "unmatched",
  pending: false,
  amountMinor,
  currencyCode: "USD",
  ...over,
});
const doc = (id: string, balanceDueMinor: number, direction: "receivable" | "payable" = "receivable"): ReviewDocument => ({
  documentId: id,
  documentNumber: `INV-${id}`,
  partyName: "Acme Retail",
  balanceDueMinor,
  currencyCode: "USD",
  direction,
});
const coding: CodingSuggestionView = {
  transactionId: "t1",
  accountId: "acct-rent",
  accountLabel: "6100 — Rent Expense",
  source: "history",
  short: "2 of 2",
  why: 'Coded to 6100 Rent Expense 2 of the last 2 times for "metro realty"',
};

describe("reviewProposal", () => {
  it("leaves alone a line already handled or still pending", () => {
    expect(reviewProposal({ line: line(-100, { status: "matched" }), match: null, documents: [], coding }).kind).toBe("handled");
    expect(reviewProposal({ line: line(-100, { pending: true }), match: null, documents: [], coding }).kind).toBe("handled");
  });
  it("puts a ledger match first", () => {
    const p = reviewProposal({ line: line(125000), match: { reconciliationId: "r1", entryNumber: "JE-000123" }, documents: [doc("1", 125000)], coding });
    expect(p).toMatchObject({ kind: "match", reconciliationId: "r1", label: "Already in the books · JE-000123" });
  });
  it("offers the one open document of exactly this amount, on the right side", () => {
    expect(reviewProposal({ line: line(125000), match: null, documents: [doc("1", 125000), doc("2", 125000, "payable")], coding })).toMatchObject({
      kind: "document",
      documentId: "1",
      label: "Pays INV-1 · Acme Retail",
    });
  });
  it("offers no document, and no account, when two documents have this amount", () => {
    const p = reviewProposal({ line: line(125000), match: null, documents: [doc("1", 125000), doc("2", 125000)], coding });
    expect(p).toEqual({ kind: "none", why: "2 open invoices of this amount — use Settle on Bank Transactions" });
  });
  it("ignores documents of another currency or amount, then takes a rule or history", () => {
    const other = { ...doc("3", 125000), currencyCode: "EUR" };
    expect(reviewProposal({ line: line(125000), match: null, documents: [other, doc("4", 99)], coding })).toMatchObject({
      kind: "account",
      accountId: "acct-rent",
      label: "6100 — Rent Expense",
      why: coding.why,
    });
  });
  it("says a line needs coding when nothing applies", () => {
    expect(reviewProposal({ line: line(-100), match: null, documents: [], coding: null }).kind).toBe("none");
  });
});

describe("the Post as value", () => {
  it("round-trips each postable proposal, and an account a person picked", () => {
    expect(itemFromValue("t1", proposalValue({ kind: "match", reconciliationId: "r1", label: "", why: "" }))).toEqual({ transactionId: "t1", kind: "match", reconciliationId: "r1" });
    expect(itemFromValue("t1", proposalValue({ kind: "document", documentId: "d1", label: "", why: "" }))).toEqual({ transactionId: "t1", kind: "document", documentId: "d1" });
    expect(itemFromValue("t1", "account:a1")).toEqual({ transactionId: "t1", kind: "account", accountId: "a1" });
  });
  it("has no value for a line with nothing to post", () => {
    expect(proposalValue({ kind: "none", why: "" })).toBeNull();
    expect(itemFromValue("t1", null)).toBeNull();
    expect(itemFromValue("t1", "bogus:x")).toBeNull();
  });
});

describe("chunked", () => {
  it("posts fifty at a time", () => {
    expect(REVIEW_POST_CHUNK).toBe(50);
    expect(chunked(Array.from({ length: 120 }, (_, i) => i)).map((c) => c.length)).toEqual([50, 50, 20]);
  });
});
