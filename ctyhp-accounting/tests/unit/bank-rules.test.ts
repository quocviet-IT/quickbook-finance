import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  firstMatchingRule,
  ruleMatches,
  ruleSeedText,
  validateRuleInput,
  wordPattern,
  type BankRule,
} from "@/lib/domain/bank-rules";

const rule = (over: Partial<BankRule> = {}): BankRule => ({
  id: "r1",
  position: 1,
  matchKind: "words",
  matchText: "fee",
  direction: "any",
  minMinor: null,
  maxMinor: null,
  accountId: "acct-fees",
  isActive: true,
  ...over,
});
const line = (description: string, amountMinor: number) => ({ description, amountMinor });

describe("wordPattern", () => {
  it("holds a word to its boundaries, so 'fee' is not found in 'coffee'", () => {
    expect(wordPattern("fee").test("Wire fee")).toBe(true);
    expect(wordPattern("fee").test("Coffee Roasters")).toBe(false);
  });
  it("matches whatever the case, and takes punctuation literally", () => {
    expect(wordPattern("AT&T").test("at&t wireless")).toBe(true);
    expect(wordPattern("a.b").test("axb")).toBe(false);
  });
});

describe("ruleMatches", () => {
  it("matches words, and a regular expression when the rule says so", () => {
    expect(ruleMatches(rule(), line("Monthly service fee", -1500))).toBe(true);
    expect(ruleMatches(rule({ matchKind: "regex", matchText: "^gusto\\b" }), line("GUSTO PAYROLL 0915", -900000))).toBe(true);
    expect(ruleMatches(rule({ matchKind: "regex", matchText: "^gusto\\b" }), line("Paid via Gusto", -900000))).toBe(false);
  });
  it("keeps to its direction", () => {
    expect(ruleMatches(rule({ direction: "out" }), line("Wire fee", -2500))).toBe(true);
    expect(ruleMatches(rule({ direction: "out" }), line("Wire fee refund", 2500))).toBe(false);
    expect(ruleMatches(rule({ direction: "in" }), line("Wire fee refund", 2500))).toBe(true);
  });
  it("keeps to its amount window, both ends included, on the size of the amount", () => {
    const windowed = rule({ minMinor: 1000, maxMinor: 5000 });
    expect(ruleMatches(windowed, line("fee", -1000))).toBe(true);
    expect(ruleMatches(windowed, line("fee", -5000))).toBe(true);
    expect(ruleMatches(windowed, line("fee", -999))).toBe(false);
    expect(ruleMatches(windowed, line("fee", -500001))).toBe(false);
    expect(ruleMatches(rule({ maxMinor: 5000 }), line("fee", -100))).toBe(true);
  });
  it("never matches while switched off, or with a pattern that does not compile", () => {
    expect(ruleMatches(rule({ isActive: false }), line("fee", -100))).toBe(false);
    expect(ruleMatches(rule({ matchKind: "regex", matchText: "(unclosed" }), line("(unclosed", -100))).toBe(false);
  });
});

describe("firstMatchingRule", () => {
  it("takes the first by position whose account can take the line", () => {
    const rules = [rule({ id: "late", position: 2, accountId: "acct-b" }), rule({ id: "early", position: 1, accountId: "acct-a" })];
    expect(firstMatchingRule(rules, line("fee", -100), () => true)?.id).toBe("early");
    expect(firstMatchingRule(rules, line("fee", -100), (id) => id !== "acct-a")?.id).toBe("late");
    expect(firstMatchingRule(rules, line("rent", -100), () => true)).toBeNull();
  });
});

describe("validateRuleInput", () => {
  const input = {
    matchKind: "words" as const,
    matchText: "fee",
    direction: "any" as const,
    minMinor: null,
    maxMinor: null,
    accountId: "acct",
    isActive: true,
  };
  it("accepts a sound rule", () => {
    expect(validateRuleInput(input)).toBeNull();
  });
  it("names what is wrong", () => {
    expect(validateRuleInput({ ...input, matchText: "  " })).toMatch(/what the rule looks for/);
    expect(validateRuleInput({ ...input, matchText: "x".repeat(201) })).toMatch(/200/);
    expect(validateRuleInput({ ...input, matchKind: "regex", matchText: "(" })).toMatch(/does not compile/);
    expect(validateRuleInput({ ...input, minMinor: 5000, maxMinor: 1000 })).toMatch(/lowest amount/);
    expect(validateRuleInput({ ...input, minMinor: -1 })).toMatch(/negative/);
    expect(validateRuleInput({ ...input, accountId: "" })).toMatch(/account/);
  });
});

describe("ruleSeedText", () => {
  it("takes the longest run of name words, from the first, that the line itself contains", () => {
    expect(ruleSeedText("METRO REALTY PARTNERS LLC ACH")).toBe("metro realty partners");
    expect(ruleSeedText("HARBOR POWER & LIGHT")).toBe("harbor power");
    expect(ruleSeedText("POS STARBUCKS 12345678 SEATTLE")).toBe("starbucks");
  });
  it("gives a rule that matches the line it came from", () => {
    for (const description of ["HARBOR POWER & LIGHT", "ONLINE TRANSFER TO Metro Realty", "POS STARBUCKS 12345678 SEATTLE"]) {
      expect(ruleMatches(rule({ matchText: ruleSeedText(description) }), line(description, -100))).toBe(true);
    }
  });
  it("leaves the words to the person when the line has no name in it", () => {
    expect(ruleSeedText("WIRE TYPE:WIRE IN DATE:260915")).toBe("");
  });
});

describe("the rules module", () => {
  it("can be imported by plain-Node scripts", () => {
    const src = readFileSync("lib/domain/bank-rules.ts", "utf8");
    expect(src).not.toMatch(/from "@\//);
    expect(src).toMatch(/from "\.\/coding-names\.ts"/);
  });
});
