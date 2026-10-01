import { describe, expect, it } from "vitest";
import type { CodingSuggestionView } from "@/lib/domain/coding";
import { reviewProposal, startsTicked } from "@/lib/domain/statement-review";

const line = { id: "t1", status: "unmatched", pending: false, amountMinor: -50000, currencyCode: "USD" };
const card: CodingSuggestionView = {
  transactionId: "t1",
  accountId: "acct-card",
  accountLabel: "2050 — Example Card",
  source: "card",
  short: "Card",
  why: "Card payment — repays 2050 Example Card. A card payment is never an expense.",
};
const funding = {
  kind: "funding" as const,
  counterpartId: "t9",
  label: "Shareholder funding · 2600 Shareholder Loan",
  why: "Answered by …",
  also: "possible shareholder funding with WIRE IN on 2026-02-09",
};
const history: CodingSuggestionView = {
  transactionId: "t1",
  accountId: "acct-rent",
  accountLabel: "6000 — Rent",
  source: "history",
  short: "2 of 2",
  why: 'Coded to 6000 Rent 2 of the last 2 times for "metro realty"',
};
const transfer = {
  kind: "transfer" as const,
  counterpartId: "t2",
  label: "Transfer to Sample Savings · 1020",
  why: "…",
  also: "",
};

describe("reviewProposal with cards", () => {
  it("labels a card payment as one, marks it, and ticks it", () => {
    const p = reviewProposal({ line, match: null, documents: [], coding: card });
    expect(p).toEqual({ kind: "account", accountId: "acct-card", label: "Card payment · 2050 — Example Card", why: card.why, repayment: "card" });
    expect(startsTicked(p)).toBe(true);
  });
  it("keeps a funding pair beside a card as the second choice", () => {
    const p = reviewProposal({ line, match: null, documents: [], coding: card, pair: funding });
    expect(p).toMatchObject({ kind: "account", repayment: "card", alternative: funding });
  });
  it("refuses to choose when two cards or loans claim the line", () => {
    expect(reviewProposal({ line, match: null, documents: [], coding: null, repaymentRivals: 2 })).toEqual({
      kind: "none",
      why: "Matches 2 cards or loans — code it yourself",
    });
  });
  it("lets a document and a named transfer speak before the refusal", () => {
    const doc = { documentId: "b1", documentNumber: "BILL-1", partyName: "Example Vendor", balanceDueMinor: 50000, currencyCode: "USD", direction: "payable" as const };
    expect(reviewProposal({ line, match: null, documents: [doc], coding: null, repaymentRivals: 2 }).kind).toBe("document");
    const named = { accountId: "acct-savings", label: "Transfer to Sample Savings · 1020", why: "Reads as a transfer…" };
    expect(reviewProposal({ line, match: null, documents: [], coding: null, namedTransfer: named, repaymentRivals: 2 }).kind).toBe("account");
  });
  it("does not refuse on zero or one repayment rival", () => {
    for (const repaymentRivals of [0, 1]) {
      const withCard = reviewProposal({ line, match: null, documents: [], coding: card, repaymentRivals });
      expect(withCard).toEqual({ kind: "account", accountId: "acct-card", label: "Card payment · 2050 — Example Card", why: card.why, repayment: "card" });
      const withoutCoding = reviewProposal({ line, match: null, documents: [], coding: null, repaymentRivals });
      expect(withoutCoding).toEqual({ kind: "none", why: "Nothing to go on yet — choose an account, or leave it waiting" });
    }
  });
  it("lets a transfer pair outrank two repayment rivals", () => {
    const p = reviewProposal({ line, match: null, documents: [], coding: null, pair: transfer, repaymentRivals: 2 });
    expect(p).toEqual({ kind: "transfer", counterpartId: "t2", label: "Transfer to Sample Savings · 1020", why: "…" });
  });
  it("gives a history proposal no repayment key", () => {
    const p = reviewProposal({ line, match: null, documents: [], coding: history });
    expect(p).toEqual({ kind: "account", accountId: "acct-rent", label: "6000 — Rent", why: history.why });
  });
});
