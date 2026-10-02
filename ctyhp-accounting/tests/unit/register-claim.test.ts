import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CodingAccount } from "@/lib/domain/coding";
import { registerClaim, rivalsWhy } from "@/lib/domain/register-claim";
import type { RelatedCompany } from "@/lib/domain/related-companies";
import type { RepaymentAccount } from "@/lib/domain/repayments";

const acct = (id: string, code: string, name: string, type: CodingAccount["type"]): CodingAccount => ({
  id,
  code,
  name,
  type,
  active: true,
  posting: true,
});
const accounts = new Map(
  [
    acct("card1", "2050", "Example Card", "credit_card"),
    acct("card2", "2060", "Other Card", "credit_card"),
    acct("due", "1460", "Due from/to Example Affiliate", "current_asset"),
    acct("due2", "2460", "Due to Other Affiliate", "current_liability"),
  ].map((a) => [a.id, a]),
);
const card = (over: Partial<RepaymentAccount> = {}): RepaymentAccount => ({
  id: "rp1",
  kind: "card",
  accountId: "card1",
  matchWords: "example card",
  matchDigits: null,
  interestAccountId: null,
  interestMethod: null,
  annualRate: null,
  fixedInterestMinor: null,
  isActive: true,
  ...over,
});
const company = (over: Partial<RelatedCompany> = {}): RelatedCompany => ({
  id: "rc1",
  name: "Example Affiliate",
  accountId: "due",
  matchWords: "example affiliate",
  isActive: true,
  ...over,
});
const line = (description: string, amountMinor = -50000) => ({ description, amountMinor, inBaseCurrency: true });
const claim = (repayments: RepaymentAccount[], related: RelatedCompany[], description: string, amountMinor?: number) =>
  registerClaim({ repayments, related, line: line(description, amountMinor), accounts });

describe("registerClaim", () => {
  it("gives the one card a payment out repays", () => {
    expect(claim([card()], [company()], "EXAMPLE CARD EPAY")).toEqual({ kind: "repayment", entry: card() });
  });
  it("gives the one related company a line names, out or in", () => {
    expect(claim([card()], [company()], "WIRE TO EXAMPLE AFFILIATE")).toEqual({ kind: "related", company: company() });
    expect(claim([card()], [company()], "WIRE FROM EXAMPLE AFFILIATE", 50000)).toEqual({ kind: "related", company: company() });
  });
  it("never lets a card claim money in", () => {
    expect(claim([card()], [], "EXAMPLE CARD REFUND", 50000)).toBeNull();
  });
  it("names every claimant when more than one claims the line, related companies first", () => {
    const both = "EXAMPLE CARD PAID BY EXAMPLE AFFILIATE";
    expect(claim([card()], [company()], both)).toEqual({ kind: "rivals", labels: ["Example Affiliate", "2050 Example Card"] });
    const other = company({ id: "rc2", name: "Other Affiliate", accountId: "due2", matchWords: "affiliate" });
    expect(claim([], [company(), other], "WIRE TO EXAMPLE AFFILIATE")).toEqual({
      kind: "rivals",
      labels: ["Example Affiliate", "Other Affiliate"],
    });
    const second = card({ id: "rp2", accountId: "card2", matchWords: "card epay" });
    expect(claim([card(), second], [], "EXAMPLE CARD EPAY")).toEqual({ kind: "rivals", labels: ["2050 Example Card", "2060 Other Card"] });
  });
  it("says nothing when nothing claims the line, or the bank is not in the base currency", () => {
    expect(claim([card()], [company()], "METRO REALTY RENT")).toBeNull();
    expect(
      registerClaim({ repayments: [card()], related: [company()], line: { ...line("WIRE TO EXAMPLE AFFILIATE"), inBaseCurrency: false }, accounts }),
    ).toBeNull();
  });
});

describe("rivalsWhy", () => {
  it("names two, and past two says how many more", () => {
    expect(rivalsWhy(["Example Affiliate", "2050 Example Card"])).toBe("Matches Example Affiliate and 2050 Example Card — code it yourself");
    expect(rivalsWhy(["A", "B", "C"])).toBe("Matches A, B and 1 more — code it yourself");
    expect(rivalsWhy(["A", "B", "C", "D"])).toBe("Matches A, B and 2 more — code it yourself");
  });
});

describe("the register-claim module", () => {
  it("can be imported by plain-Node scripts", () => {
    expect(readFileSync("lib/domain/register-claim.ts", "utf8")).not.toMatch(/from "@\//);
  });
});
