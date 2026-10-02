import { describe, expect, it } from "vitest";
import type { CodingSuggestionView } from "@/lib/domain/coding";
import { reviewProposal, startsTicked } from "@/lib/domain/statement-review";

const out = { id: "t1", status: "unmatched", pending: false, amountMinor: -1_500_000, currencyCode: "USD" };
const into = { ...out, amountMinor: 1_500_000 };
const related: CodingSuggestionView = {
  transactionId: "t1",
  accountId: "acct-due",
  accountLabel: "1460 — Due from/to Example Affiliate",
  source: "related",
  short: "Related",
  why: "Names Example Affiliate, a related company. Money between your companies is owed, never income or a cost.",
};
const funding = {
  kind: "funding" as const,
  counterpartId: "t9",
  label: "Shareholder funding · 2600 Shareholder Loan",
  why: "Answered by …",
  also: "possible shareholder funding with WIRE IN on 2026-02-09",
};

describe("reviewProposal with a related company", () => {
  it("labels money out or in as between companies, marks it, and ticks it", () => {
    for (const line of [out, into]) {
      const p = reviewProposal({ line, match: null, documents: [], coding: related });
      expect(p).toEqual({
        kind: "account",
        accountId: "acct-due",
        label: "Between companies · 1460 — Due from/to Example Affiliate",
        why: related.why,
        related: true,
      });
      expect(startsTicked(p)).toBe(true);
    }
  });
  it("keeps a funding pair beside it as the second choice", () => {
    expect(reviewProposal({ line: out, match: null, documents: [], coding: related, pair: funding })).toMatchObject({
      kind: "account",
      related: true,
      alternative: funding,
    });
  });
  it("lets a document and a transfer pair speak first", () => {
    const doc = { documentId: "b1", documentNumber: "BILL-1", partyName: "Example Vendor", balanceDueMinor: 1_500_000, currencyCode: "USD", direction: "payable" as const };
    expect(reviewProposal({ line: out, match: null, documents: [doc], coding: related }).kind).toBe("document");
    const transfer = { kind: "transfer" as const, counterpartId: "t2", label: "Transfer to Sample Savings · 1020", why: "…", also: "" };
    expect(reviewProposal({ line: out, match: null, documents: [], coding: related, pair: transfer }).kind).toBe("transfer");
  });
  it("refuses, naming both, when a related company and a card claim the line", () => {
    expect(
      reviewProposal({ line: out, match: null, documents: [], coding: null, registerRivals: ["Example Affiliate", "2050 Example Card"] }),
    ).toEqual({ kind: "none", why: "Matches Example Affiliate and 2050 Example Card — code it yourself" });
  });
});
