import { describe, expect, it } from "vitest";
import type { LoanSuggestionView } from "@/lib/domain/loan-interest";
import { itemFromValue, proposalValue, reviewProposal, startsTicked } from "@/lib/domain/statement-review";

const line = { id: "t1", status: "unmatched", pending: false, amountMinor: -200_000, currencyCode: "USD" };
const loan: LoanSuggestionView = {
  transactionId: "t1",
  repaymentId: "rp-loan",
  label: "Loan payment · 2500 — Example Loan",
  why: "Principal 1,600.00 to 2500 Example Loan, interest 400.00 to 8100 Interest Expense — estimated …",
  paymentMinor: 200_000,
  interestMinor: 40_000,
  principalMinor: 160_000,
  basis: "estimated …",
  loanAccountLabel: "2500 Example Loan",
  interestAccountLabel: "8100 Interest Expense",
};
const funding = { kind: "funding" as const, counterpartId: "t9", label: "Shareholder funding · 2600 Shareholder Loan", why: "…", also: "…" };

describe("reviewProposal with loans", () => {
  it("proposes the loan payment with its split, and never ticks it", () => {
    const p = reviewProposal({ line, match: null, documents: [], coding: null, loan });
    expect(p).toEqual({ kind: "loan", repaymentId: "rp-loan", label: loan.label, why: loan.why, loan });
    expect(startsTicked(p)).toBe(false);
    expect(proposalValue(p)).toBe("loan:rp-loan");
  });
  it("offers no funding pair beside a loan", () => {
    expect(reviewProposal({ line, match: null, documents: [], coding: null, loan, pair: funding }).kind).toBe("loan");
  });
  it("lets a document, a transfer and the two-entries refusal come first", () => {
    const doc = { documentId: "b1", documentNumber: "BILL-1", partyName: "Example Vendor", balanceDueMinor: 200_000, currencyCode: "USD", direction: "payable" as const };
    expect(reviewProposal({ line, match: null, documents: [doc], coding: null, loan }).kind).toBe("document");
    expect(reviewProposal({ line, match: null, documents: [], coding: null, loan, registerRivals: ["2500 Example Loan", "Example Affiliate"] }).kind).toBe("none");
  });
});

describe("itemFromValue for a loan", () => {
  it("posts with the interest the person accepted, and not without one", () => {
    expect(itemFromValue("t1", "loan:rp-loan", 40_000)).toEqual({ transactionId: "t1", kind: "loan", repaymentId: "rp-loan", interestMinor: 40_000 });
    expect(itemFromValue("t1", "loan:rp-loan", 0)).toEqual({ transactionId: "t1", kind: "loan", repaymentId: "rp-loan", interestMinor: 0 });
    expect(itemFromValue("t1", "loan:rp-loan", null)).toBeNull();
    expect(itemFromValue("t1", "loan:rp-loan")).toBeNull();
  });
  it("still reads every other kind as before", () => {
    expect(itemFromValue("t1", "account:a1")).toEqual({ transactionId: "t1", kind: "account", accountId: "a1" });
  });
});
