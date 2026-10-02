import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CodingAccount } from "@/lib/domain/coding";
import {
  interestAccountAllowed,
  kindChangeProblem,
  phrasesOf,
  repaymentHits,
  repaymentMatches,
  repaysAccountAllowed,
  seedDigits,
  seedWords,
  usableRepayment,
  validateRepaymentInput,
  type RepaymentAccount,
  type RepaymentInput,
} from "@/lib/domain/repayments";

const acct = (id: string, type: CodingAccount["type"], over: Partial<CodingAccount> = {}): CodingAccount => ({
  id,
  code: id.toUpperCase(),
  name: `Account ${id}`,
  type,
  active: true,
  posting: true,
  ...over,
});
const accounts = new Map(
  [
    acct("card1", "credit_card"),
    acct("card2", "credit_card"),
    acct("loan1", "long_term_liability"),
    acct("int", "other_expense"),
    acct("rent", "expense"),
    acct("closed", "credit_card", { active: false }),
  ].map((a) => [a.id, a]),
);
const card = (over: Partial<RepaymentAccount> = {}): RepaymentAccount => ({
  id: "r1",
  kind: "card",
  accountId: "card1",
  matchWords: "example card",
  matchDigits: "4321",
  interestAccountId: null,
  interestMethod: null,
  annualRate: null,
  fixedInterestMinor: null,
  isActive: true,
  ...over,
});
const loan = (over: Partial<RepaymentAccount> = {}): RepaymentAccount =>
  card({ id: "l1", kind: "loan", accountId: "loan1", matchWords: "example loan", matchDigits: null, interestAccountId: "int", interestMethod: "rate", annualRate: 4, ...over });
const out = (description: string, amountMinor = -50000) => ({ description, amountMinor, inBaseCurrency: true });

describe("phrasesOf", () => {
  it("splits on commas, trims, squeezes spaces and keeps each phrase once", () => {
    expect(phrasesOf(" example card ,EXAMPLE  CARD, card epay,, ")).toEqual(["example card", "card epay"]);
    expect(phrasesOf("")).toEqual([]);
  });
});

describe("defaults from the account name", () => {
  it("takes the name without its trailing digits as the words", () => {
    expect(seedWords("Example Card 4321")).toBe("Example Card");
    expect(seedWords("Example Visa ••4321")).toBe("Example Visa");
    expect(seedWords("Example Card x3388")).toBe("Example Card");
    expect(seedWords("Example Loan")).toBe("Example Loan");
  });
  it("takes the last four digits in the name, when there are any", () => {
    expect(seedDigits("Example Card 4321")).toBe("4321");
    expect(seedDigits("Example Card x3388")).toBe("3388");
    expect(seedDigits("Example Loan")).toBeNull();
  });
});

describe("which accounts an entry may use", () => {
  it("lets a card repay only an active posting credit card account", () => {
    expect(repaysAccountAllowed("card", accounts.get("card1"))).toBe(true);
    expect(repaysAccountAllowed("card", accounts.get("loan1"))).toBe(false);
    expect(repaysAccountAllowed("card", accounts.get("closed"))).toBe(false);
    expect(repaysAccountAllowed("card", undefined)).toBe(false);
  });
  it("lets a loan repay a current or long-term liability, and charge interest to an expense", () => {
    expect(repaysAccountAllowed("loan", accounts.get("loan1"))).toBe(true);
    expect(repaysAccountAllowed("loan", accounts.get("card1"))).toBe(false);
    expect(interestAccountAllowed(accounts.get("int"))).toBe(true);
    expect(interestAccountAllowed(accounts.get("rent"))).toBe(true);
    expect(interestAccountAllowed(accounts.get("loan1"))).toBe(false);
  });
  it("counts an entry only while it is on and its accounts are still the right kind", () => {
    expect(usableRepayment(card(), accounts)).toBe(true);
    expect(usableRepayment(card({ isActive: false }), accounts)).toBe(false);
    expect(usableRepayment(card({ accountId: "closed" }), accounts)).toBe(false);
    expect(usableRepayment(loan(), accounts)).toBe(true);
    expect(usableRepayment(loan({ interestAccountId: "loan1" }), accounts)).toBe(false);
  });
});

describe("repaymentMatches", () => {
  it("finds a phrase held to word boundaries, in any case", () => {
    expect(repaymentMatches(card({ matchDigits: null }), "EXAMPLE CARD EPAY 0928")).toBe(true);
    expect(repaymentMatches(card({ matchDigits: null }), "EXAMPLECARDS")).toBe(false);
  });
  it("finds the last four only as a run of exactly four digits", () => {
    expect(repaymentMatches(card({ matchWords: "" }), "Payment to card ending in 4321")).toBe(true);
    expect(repaymentMatches(card({ matchWords: "" }), "REF 143210")).toBe(false);
  });
  it("matches any one of several phrases", () => {
    expect(repaymentMatches(card({ matchWords: "example card, xyz bank epay", matchDigits: null }), "XYZ BANK EPAY")).toBe(true);
  });
});

describe("repaymentHits", () => {
  it("returns every usable entry a payment out carries, and none for money in or a foreign-currency bank", () => {
    const other = card({ id: "r2", accountId: "card2", matchDigits: null });
    expect(repaymentHits([card(), other], out("EXAMPLE CARD EPAY"), accounts)).toEqual([card(), other]);
    expect(repaymentHits([card()], out("EXAMPLE CARD REFUND", 50000), accounts)).toEqual([]);
    expect(repaymentHits([card()], { ...out("EXAMPLE CARD EPAY"), inBaseCurrency: false }, accounts)).toEqual([]);
    expect(repaymentHits([card({ isActive: false })], out("EXAMPLE CARD EPAY"), accounts)).toEqual([]);
  });
});

describe("validateRepaymentInput", () => {
  const input = (over: Partial<RepaymentInput> = {}): RepaymentInput => {
    const { id: _id, ...rest } = card();
    return { ...rest, ...over };
  };
  it("accepts a card with words, digits or both", () => {
    expect(validateRepaymentInput(input())).toBeNull();
    expect(validateRepaymentInput(input({ matchWords: "" }))).toBeNull();
    expect(validateRepaymentInput(input({ matchDigits: null }))).toBeNull();
  });
  it("needs words or digits, and exactly four digits", () => {
    expect(validateRepaymentInput(input({ matchWords: " , ", matchDigits: null }))).toBe(
      "Give the words your bank prints for these payments, or the last four digits",
    );
    expect(validateRepaymentInput(input({ matchDigits: "432" }))).toBe("The last four are exactly four digits");
    expect(validateRepaymentInput(input({ matchWords: "x".repeat(201) }))).toBe("Words are at most 200 characters");
    expect(validateRepaymentInput(input({ accountId: "" }))).toBe("Choose the card account");
  });
  it("keeps interest off a card", () => {
    expect(validateRepaymentInput(input({ interestMethod: "rate" }))).toBe("A card payment has no interest to split");
  });
  it("needs a loan's interest account and method, a rate within 0–100 with three decimals, and a fixed amount", () => {
    const { id: _id, ...base } = loan();
    expect(validateRepaymentInput(base)).toBeNull();
    expect(validateRepaymentInput({ ...base, interestAccountId: null })).toBe("Choose the account interest posts to");
    expect(validateRepaymentInput({ ...base, interestMethod: null })).toBe("Say how the interest is worked out");
    expect(validateRepaymentInput({ ...base, annualRate: 101 })).toBe("The rate a year is between 0 and 100%");
    expect(validateRepaymentInput({ ...base, annualRate: 1.0005 })).toBe("The rate a year has at most three decimals");
    expect(validateRepaymentInput({ ...base, annualRate: 1.005 })).toBeNull();
    expect(validateRepaymentInput({ ...base, interestMethod: "fixed", fixedInterestMinor: null })).toBe("Give the fixed interest per payment");
    expect(validateRepaymentInput({ ...base, interestMethod: "fixed", fixedInterestMinor: 40000 })).toBeNull();
    expect(validateRepaymentInput({ ...base, interestMethod: "entered" })).toBeNull();
  });
});

describe("the repayments module", () => {
  it("can be imported by plain-Node scripts", () => {
    const src = readFileSync("lib/domain/repayments.ts", "utf8");
    expect(src).not.toMatch(/from "@\//);
  });
});

describe("kindChangeProblem", () => {
  it("lets an entry stay what it is, and refuses a card becoming a loan or a loan a card", () => {
    expect(kindChangeProblem("card", "card")).toBeNull();
    expect(kindChangeProblem("loan", "loan")).toBeNull();
    expect(kindChangeProblem("card", "loan")).toBe("A card cannot become a loan, or a loan a card — remove the entry and add it again");
    expect(kindChangeProblem("loan", "card")).toBe("A card cannot become a loan, or a loan a card — remove the entry and add it again");
  });
});
