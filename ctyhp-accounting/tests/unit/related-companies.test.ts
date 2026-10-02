import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CodingAccount } from "@/lib/domain/coding";
import {
  balanceWords,
  relatedAccountAllowed,
  relatedAccountProblem,
  relatedHits,
  relatedMatches,
  seedRelatedWords,
  usableRelated,
  validateRelatedInput,
  type RelatedCompany,
  type RelatedCompanyInput,
} from "@/lib/domain/related-companies";

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
    acct("due", "current_asset", { name: "Due from/to Example Affiliate" }),
    acct("due2", "current_liability", { name: "Due to Other Affiliate" }),
    acct("ltl", "long_term_liability"),
    acct("rent", "expense"),
    acct("sales", "income"),
    acct("other-inc", "other_income"),
    acct("bank", "bank"),
    acct("ar", "accounts_receivable"),
    acct("card", "credit_card"),
    acct("held", "current_asset", { name: "Uncategorized Asset" }),
    acct("closed", "current_asset", { active: false }),
    acct("heading", "current_asset", { posting: false }),
  ].map((a) => [a.id, a]),
);
const company = (over: Partial<RelatedCompany> = {}): RelatedCompany => ({
  id: "rc1",
  name: "Example Affiliate, LLC",
  accountId: "due",
  matchWords: "example affiliate, exa",
  isActive: true,
  ...over,
});
const at = (description: string, amountMinor = -50000) => ({ description, amountMinor, inBaseCurrency: true });

describe("seedRelatedWords", () => {
  it("drops a trailing company suffix, with any comma before it", () => {
    expect(seedRelatedWords("Example Affiliate, LLC")).toBe("Example Affiliate");
    expect(seedRelatedWords("Example Affiliate L.L.C.")).toBe("Example Affiliate");
    expect(seedRelatedWords("Example Holdings Inc.")).toBe("Example Holdings");
    expect(seedRelatedWords("Example Trading Corp")).toBe("Example Trading");
    expect(seedRelatedWords("Example Trading Corporation")).toBe("Example Trading");
    expect(seedRelatedWords("Example Co.")).toBe("Example");
    expect(seedRelatedWords("Example Ltd")).toBe("Example");
  });
  it("keeps a name with no suffix, a suffix inside a word, and a name that is only a suffix", () => {
    expect(seedRelatedWords("  Example   Affiliate ")).toBe("Example Affiliate");
    expect(seedRelatedWords("Costco")).toBe("Costco");
    expect(seedRelatedWords("LLC")).toBe("LLC");
  });
});

describe("relatedAccountAllowed", () => {
  it("allows an active posting current asset, current liability or long-term liability", () => {
    for (const id of ["due", "due2", "ltl"]) expect(relatedAccountAllowed(accounts.get(id))).toBe(true);
  });
  it("refuses income, expense, bank, receivable, card, holding, inactive, heading and missing accounts", () => {
    for (const id of ["rent", "sales", "other-inc", "bank", "ar", "card", "held", "closed", "heading", "nope"]) {
      expect(relatedAccountAllowed(accounts.get(id)), id).toBe(false);
    }
  });
});

describe("usableRelated", () => {
  it("speaks only when switched on and its account is still allowed", () => {
    expect(usableRelated(company(), accounts)).toBe(true);
    expect(usableRelated(company({ isActive: false }), accounts)).toBe(false);
    expect(usableRelated(company({ accountId: "rent" }), accounts)).toBe(false);
  });
});

describe("relatedMatches", () => {
  it("matches any phrase as whole words, in any case", () => {
    expect(relatedMatches(company(), "WIRE TO EXAMPLE AFFILIATE LLC")).toBe(true);
    expect(relatedMatches(company(), "Online transfer to EXA ref 12")).toBe(true);
    expect(relatedMatches(company(), "exa-0042")).toBe(true);
  });
  it("never matches a short phrase inside a longer word", () => {
    expect(relatedMatches(company({ matchWords: "ab" }), "TAB PAYMENT")).toBe(false);
    expect(relatedMatches(company({ matchWords: "ab" }), "ABC SUPPLY")).toBe(false);
    expect(relatedMatches(company({ matchWords: "ab" }), "WIRE TO AB")).toBe(true);
    expect(relatedMatches(company(), "EXAMPLE SUPPLY")).toBe(false);
  });
});

describe("relatedHits", () => {
  it("finds a company named on money out and on money in", () => {
    expect(relatedHits([company()], at("WIRE TO EXA"), accounts)).toEqual([company()]);
    expect(relatedHits([company()], at("WIRE FROM EXA", 50000), accounts)).toEqual([company()]);
  });
  it("ignores a zero line, a foreign-currency bank, a company switched off and an unusable account", () => {
    expect(relatedHits([company()], at("WIRE TO EXA", 0), accounts)).toEqual([]);
    expect(relatedHits([company()], { ...at("WIRE TO EXA"), inBaseCurrency: false }, accounts)).toEqual([]);
    expect(relatedHits([company({ isActive: false })], at("WIRE TO EXA"), accounts)).toEqual([]);
    expect(relatedHits([company({ accountId: "closed" })], at("WIRE TO EXA"), accounts)).toEqual([]);
  });
  it("returns every company a line names", () => {
    const other = company({ id: "rc2", name: "Other Affiliate", accountId: "due2", matchWords: "affiliate" });
    expect(relatedHits([company(), other], at("WIRE TO EXAMPLE AFFILIATE"), accounts)).toEqual([company(), other]);
    expect(relatedHits([company(), other], at("METRO REALTY RENT"), accounts)).toEqual([]);
  });
});

describe("validateRelatedInput", () => {
  const input = (over: Partial<RelatedCompanyInput> = {}): RelatedCompanyInput => ({
    name: "Example Affiliate, LLC",
    accountId: "due",
    matchWords: "example affiliate, exa",
    isActive: true,
    ...over,
  });
  it("accepts a company with a name, an account and words of two characters or more", () => {
    expect(validateRelatedInput(input())).toBeNull();
    expect(validateRelatedInput(input({ matchWords: "AB" }))).toBeNull();
  });
  it("needs a name of at most 120 characters", () => {
    expect(validateRelatedInput(input({ name: "   " }))).toBe("Give the company's name");
    expect(validateRelatedInput(input({ name: "x".repeat(121) }))).toBe("The name is at most 120 characters");
    expect(validateRelatedInput(input({ name: ` ${"x".repeat(120)} ` }))).toBeNull();
  });
  it("needs an account", () => {
    expect(validateRelatedInput(input({ accountId: "" }))).toBe("Choose the account it owes or is owed on");
  });
  it("needs words, at most 200 characters, every phrase at least two characters", () => {
    expect(validateRelatedInput(input({ matchWords: " , " }))).toBe("Give the words your bank prints for this company");
    expect(validateRelatedInput(input({ matchWords: "x".repeat(201) }))).toBe("Words are at most 200 characters");
    expect(validateRelatedInput(input({ matchWords: "example affiliate, e" }))).toBe(
      '"e" is too short — each word or phrase is at least 2 characters',
    );
  });
});

describe("relatedAccountProblem", () => {
  it("refuses an account of the wrong kind, then one already in Cards and loans", () => {
    expect(relatedAccountProblem(accounts.get("rent"), false)).toBe(
      "A related company's account is an active posting current asset, current liability or long-term liability",
    );
    expect(relatedAccountProblem(accounts.get("ltl"), true)).toBe(
      "This account is in Cards and loans — a related company needs an account of its own",
    );
    expect(relatedAccountProblem(accounts.get("due"), false)).toBeNull();
  });
});

describe("balanceWords", () => {
  const money = (minor: number) => `$${(minor / 100).toFixed(2)}`;
  it("says who owes whom, or that nothing is owed", () => {
    expect(balanceWords(114025, money)).toBe("Owes us $1140.25");
    expect(balanceWords(-300000, money)).toBe("We owe $3000.00");
    expect(balanceWords(0, money)).toBe("Settled");
  });
});

describe("the related-companies module", () => {
  it("can be imported by plain-Node scripts", () => {
    const src = readFileSync("lib/domain/related-companies.ts", "utf8");
    expect(src).not.toMatch(/from "@\//);
  });
});
