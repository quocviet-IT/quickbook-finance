import { describe, expect, it } from "vitest";
import type { CodingSuggestionView } from "@/lib/domain/coding";
import {
  alternativeValue,
  dedupePairItems,
  itemFromValue,
  proposalValue,
  reciprocalValue,
  reviewProposal,
  startsTicked,
  type ReviewPairView,
} from "@/lib/domain/statement-review";

const line = { id: "t1", status: "unmatched", pending: false, amountMinor: -100000, currencyCode: "USD" };
const transfer: ReviewPairView = { kind: "transfer", counterpartId: "t2", label: "Transfer to Sample Savings · 1020", why: "The other side is on Sample Savings", also: "" };
const funding: ReviewPairView = {
  kind: "funding",
  counterpartId: "t9",
  label: "Shareholder funding · 2600 Shareholder Loan",
  why: "Answered by WIRE IN of the same amount on 2026-02-09",
  also: "possible shareholder funding with WIRE IN on 2026-02-09",
};
const coding: CodingSuggestionView = { transactionId: "t1", accountId: "acct-6200", accountLabel: "6200 — Salaries", source: "rule", short: "Rule 1", why: 'Rule 1: "payflow" → 6200 Salaries' };
const base = { line, match: null, documents: [], coding: null };

describe("pair proposals", () => {
  it("puts a transfer pair after documents and before rules, ticked", () => {
    const p = reviewProposal({ ...base, coding, pair: transfer });
    expect(p).toMatchObject({ kind: "transfer", counterpartId: "t2", label: transfer.label });
    expect(startsTicked(p)).toBe(true);
  });
  it("lets a named transfer speak before a rule", () => {
    const p = reviewProposal({ ...base, coding, namedTransfer: { accountId: "gl-sav", label: "Transfer to Sample Savings · 1020", why: "Reads as a transfer" } });
    expect(p).toMatchObject({ kind: "account", accountId: "gl-sav" });
  });
  it("keeps a rule, and offers funding as a second choice", () => {
    const p = reviewProposal({ ...base, coding, pair: funding });
    expect(p).toMatchObject({ kind: "account", accountId: "acct-6200" });
    expect(p.why).toBe('Rule 1: "payflow" → 6200 Salaries. Also: possible shareholder funding with WIRE IN on 2026-02-09');
    expect(alternativeValue(p)).toBe("pair:funding:t9");
  });
  it("proposes funding only when nothing else does, and never ticks it", () => {
    const p = reviewProposal({ ...base, pair: funding });
    expect(p).toMatchObject({ kind: "funding", counterpartId: "t9" });
    expect(startsTicked(p)).toBe(false);
  });
  it("says so when several lines could be the other side", () => {
    expect(reviewProposal({ ...base, pairRivals: 2 })).toEqual({ kind: "none", why: "2 lines could be the other side — code it yourself" });
  });
  it("still lets two documents of the same amount silence everything", () => {
    const docs = [1, 2].map((n) => ({ documentId: `d${n}`, documentNumber: `BILL-${n}`, partyName: "Vendor", balanceDueMinor: 100000, currencyCode: "USD", direction: "payable" as const }));
    expect(reviewProposal({ ...base, documents: docs, coding, pair: transfer }).kind).toBe("none");
  });
});

describe("pair values", () => {
  it("round-trips a pair, and gives the other line its own value", () => {
    const value = proposalValue({ kind: "transfer", counterpartId: "t2", label: "", why: "" });
    expect(value).toBe("pair:transfer:t2");
    expect(itemFromValue("t1", value)).toEqual({ transactionId: "t1", kind: "pair", pairKind: "transfer", counterpartId: "t2" });
    expect(reciprocalValue("pair:funding:t9", "t1")).toBe("pair:funding:t1");
    expect(reciprocalValue("account:x", "t1")).toBeNull();
  });
  it("posts a pair once, whichever line carries it", () => {
    const items = dedupePairItems([
      { transactionId: "t1", kind: "pair", pairKind: "transfer", counterpartId: "t2" },
      { transactionId: "t2", kind: "pair", pairKind: "transfer", counterpartId: "t1" },
      { transactionId: "t3", kind: "account", accountId: "a" },
    ]);
    expect(items).toHaveLength(2);
  });
});
