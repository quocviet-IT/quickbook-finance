import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CodingAccount } from "@/lib/domain/coding";
import {
  estimateInterest,
  loanSuggestionsFrom,
  loanWhy,
  monthlyInterest,
  owedOn,
  planLoanLines,
  suggestInterestAccount,
  type LoanMovement,
} from "@/lib/domain/loan-interest";
import type { RepaymentAccount } from "@/lib/domain/repayments";

const loan = (over: Partial<RepaymentAccount> = {}): RepaymentAccount => ({
  id: "rp-loan",
  kind: "loan",
  accountId: "loan1",
  matchWords: "example loan",
  matchDigits: null,
  interestAccountId: "int1",
  interestMethod: "rate",
  annualRate: 4,
  fixedInterestMinor: null,
  isActive: true,
  ...over,
});
const borrowed: LoanMovement[] = [
  { accountId: "loan1", date: "2026-01-01", debitMinor: 0, creditMinor: 12_000_000 },
  { accountId: "loan1", date: "2026-12-31", debitMinor: 0, creditMinor: 99_999 },
  { accountId: "other", date: "2026-01-01", debitMinor: 0, creditMinor: 5_000 },
];
const acct = (id: string, code: string, name: string, type: CodingAccount["type"], over: Partial<CodingAccount> = {}): CodingAccount => ({
  id,
  code,
  name,
  type,
  active: true,
  posting: true,
  ...over,
});

describe("owedOn", () => {
  it("adds credits less debits on that account, on or before the date", () => {
    expect(owedOn(borrowed, "loan1", "2026-09-15")).toBe(12_000_000);
    expect(owedOn(borrowed, "loan1", "2025-12-31")).toBe(0);
    expect(owedOn([...borrowed, { accountId: "loan1", date: "2026-02-01", debitMinor: 160_000, creditMinor: 0 }], "loan1", "2026-09-15")).toBe(11_840_000);
  });
});

describe("monthlyInterest", () => {
  it("is owed × rate ÷ 12, in cents", () => {
    expect(monthlyInterest(12_000_000, 4)).toBe(40_000); // 120,000.00 × 4% ÷ 12 = 400.00
  });
  it("rounds half up at a cent", () => {
    expect(monthlyInterest(150, 4)).toBe(1); // 0.5 cent → 1
    expect(monthlyInterest(149, 4)).toBe(0); // 0.4966 cent → 0
    expect(monthlyInterest(11_840_000, 4)).toBe(39_467); // 394.666… → 394.67
  });
  it("takes a rate with three decimals exactly", () => {
    expect(monthlyInterest(12_000_000, 3.75)).toBe(37_500);
    expect(monthlyInterest(12_000_000, 0.001)).toBe(10);
  });
  it("is nothing when nothing is owed", () => {
    expect(monthlyInterest(0, 4)).toBe(0);
    expect(monthlyInterest(-500, 4)).toBe(0);
  });
});

describe("estimateInterest", () => {
  it("estimates from the rate and says how", () => {
    expect(estimateInterest({ method: "rate", annualRate: 4, fixedInterestMinor: null, owedMinor: 12_000_000, paymentMinor: 200_000 })).toEqual({
      interestMinor: 40_000,
      basis: "estimated at 4.000% a year on 120,000.00 owed, ÷ 12. Check it against the lender's statement.",
    });
  });
  it("never proposes more than the payment", () => {
    expect(estimateInterest({ method: "rate", annualRate: 4, fixedInterestMinor: null, owedMinor: 12_000_000, paymentMinor: 30_000 }).interestMinor).toBe(30_000);
    expect(estimateInterest({ method: "fixed", annualRate: null, fixedInterestMinor: 50_000, owedMinor: 0, paymentMinor: 30_000 }).interestMinor).toBe(30_000);
  });
  it("proposes nothing when nothing is owed on the books", () => {
    expect(estimateInterest({ method: "rate", annualRate: 4, fixedInterestMinor: null, owedMinor: 0, paymentMinor: 200_000 })).toEqual({
      interestMinor: 0,
      basis: "nothing is owed on the books before this payment. Check it against the lender's statement.",
    });
  });
  it("uses the fixed amount, or leaves it to be typed", () => {
    expect(estimateInterest({ method: "fixed", annualRate: null, fixedInterestMinor: 40_000, owedMinor: 0, paymentMinor: 200_000 })).toEqual({
      interestMinor: 40_000,
      basis: "the fixed amount for this loan.",
    });
    expect(estimateInterest({ method: "entered", annualRate: null, fixedInterestMinor: null, owedMinor: 12_000_000, paymentMinor: 200_000 })).toEqual({
      interestMinor: null,
      basis: "Enter the interest from the lender's statement.",
    });
  });
});

describe("planLoanLines", () => {
  it("takes payments to one loan in date order, each on what the earlier ones leave", () => {
    const plans = planLoanLines(
      [
        { id: "b", date: "2026-09-15", paymentMinor: 200_000, entry: loan() },
        { id: "a", date: "2026-08-15", paymentMinor: 200_000, entry: loan() },
      ],
      borrowed,
    );
    expect(plans.get("a")).toMatchObject({ owedMinor: 12_000_000, interestMinor: 40_000, principalMinor: 160_000 });
    expect(plans.get("b")).toMatchObject({ owedMinor: 11_840_000, interestMinor: 39_467, principalMinor: 160_533 });
  });
  it("carries nothing when the interest is still to be typed", () => {
    const entered = loan({ interestMethod: "entered", annualRate: null });
    const plans = planLoanLines(
      [
        { id: "a", date: "2026-08-15", paymentMinor: 200_000, entry: entered },
        { id: "b", date: "2026-09-15", paymentMinor: 200_000, entry: entered },
      ],
      borrowed,
    );
    expect(plans.get("a")).toMatchObject({ interestMinor: null, principalMinor: null, owedMinor: 12_000_000 });
    expect(plans.get("b")).toMatchObject({ owedMinor: 12_000_000 });
  });
  it("keeps two loans apart", () => {
    const other = loan({ id: "rp2", accountId: "other" });
    const plans = planLoanLines(
      [
        { id: "a", date: "2026-08-15", paymentMinor: 200_000, entry: loan() },
        { id: "b", date: "2026-08-16", paymentMinor: 1_000, entry: other },
      ],
      borrowed,
    );
    expect(plans.get("b")).toMatchObject({ owedMinor: 5_000 });
  });
});

describe("loanWhy", () => {
  it("names the split, then how the interest was reached", () => {
    const [plan] = [...planLoanLines([{ id: "a", date: "2026-08-15", paymentMinor: 200_000, entry: loan() }], borrowed).values()];
    expect(loanWhy(plan, "2500 Example Loan", "8100 Interest Expense")).toBe(
      "Principal 1,600.00 to 2500 Example Loan, interest 400.00 to 8100 Interest Expense — estimated at 4.000% a year on 120,000.00 owed, ÷ 12. Check it against the lender's statement.",
    );
  });
  it("says only what to do while the interest is still to be typed", () => {
    expect(loanWhy({ interestMinor: null, principalMinor: null, owedMinor: 0, basis: "Enter the interest from the lender's statement." }, "x", "y")).toBe(
      "Enter the interest from the lender's statement.",
    );
  });
});

describe("suggestInterestAccount", () => {
  it("offers the first active posting expense account named for interest", () => {
    expect(
      suggestInterestAccount([
        acct("a", "8200", "Interest Expense", "other_expense"),
        acct("b", "8100", "Interest Expense", "other_expense", { active: false }),
        acct("c", "7100", "Interest Income", "other_income"),
        acct("d", "8150", "Loan interest", "expense"),
      ]),
    ).toBe("d");
    expect(suggestInterestAccount([acct("x", "6000", "Rent", "expense")])).toBeNull();
  });
  it("picks by account number, not by text", () => {
    expect(
      suggestInterestAccount([
        acct("y", "810", "Interest Expense", "other_expense"),
        acct("x", "1000", "Interest Expense", "other_expense"),
      ]),
    ).toBe("y");
  });
});

describe("loanSuggestionsFrom", () => {
  const accounts = new Map(
    [
      acct("loan1", "2500", "Example Loan", "long_term_liability"),
      acct("int1", "8100", "Interest Expense", "other_expense"),
      acct("card1", "2050", "Example Card", "credit_card"),
    ].map((a) => [a.id, a]),
  );
  const card: RepaymentAccount = { ...loan(), id: "rp-card", kind: "card", accountId: "card1", matchWords: "example card", interestAccountId: null, interestMethod: null, annualRate: null };
  const line = (id: string, description: string, amountMinor = -200_000, over = {}) => ({ id, bankAccountId: "bank1", date: "2026-08-15", amountMinor, description, ...over });
  const base = { repayments: [loan(), card], baseCurrencyBankIds: new Set(["bank1"]), accounts, movements: borrowed };

  it("proposes each waiting loan payment with its split, in the screen's words", () => {
    expect(loanSuggestionsFrom({ ...base, lines: [line("t1", "EXAMPLE LOAN PMT")] })).toEqual([
      {
        transactionId: "t1",
        repaymentId: "rp-loan",
        label: "Loan payment · 2500 — Example Loan",
        why: "Principal 1,600.00 to 2500 Example Loan, interest 400.00 to 8100 Interest Expense — estimated at 4.000% a year on 120,000.00 owed, ÷ 12. Check it against the lender's statement.",
        paymentMinor: 200_000,
        interestMinor: 40_000,
        principalMinor: 160_000,
        basis: "estimated at 4.000% a year on 120,000.00 owed, ÷ 12. Check it against the lender's statement.",
        loanAccountLabel: "2500 Example Loan",
        interestAccountLabel: "8100 Interest Expense",
      },
    ]);
  });
  it("leaves out card payments, money in, foreign banks and lines with a ledger match on offer", () => {
    const views = loanSuggestionsFrom({
      ...base,
      lines: [
        line("c", "EXAMPLE CARD EPAY"),
        line("in", "EXAMPLE LOAN REFUND", 50_000),
        line("fx", "EXAMPLE LOAN PMT", -200_000, { bankAccountId: "bank-eur" }),
        line("m", "EXAMPLE LOAN PMT"),
      ],
      excludeIds: new Set(["m"]),
    });
    expect(views).toEqual([]);
  });
  it("proposes no split when a related company also claims the line", () => {
    const withDue = new Map<string, CodingAccount>([...accounts, ["due", acct("due", "1460", "Due from/to Example Affiliate", "current_asset")]]);
    const company = { id: "rc1", name: "Example Affiliate", accountId: "due", matchWords: "example loan", isActive: true };
    expect(loanSuggestionsFrom({ ...base, accounts: withDue, related: [company], lines: [line("t1", "EXAMPLE LOAN PMT")] })).toEqual([]);
  });
});

describe("the loan-interest module", () => {
  it("can be imported by plain-Node scripts", () => {
    expect(readFileSync("lib/domain/loan-interest.ts", "utf8")).not.toMatch(/from "@\//);
  });
});
