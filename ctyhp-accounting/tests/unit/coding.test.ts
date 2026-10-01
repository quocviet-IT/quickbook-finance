import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CODE_ALL_LIMIT,
  codableAccount,
  codingAccountOf,
  codingView,
  suggestCoding,
  type CodingAccount,
} from "@/lib/domain/coding";
import type { BankRule } from "@/lib/domain/bank-rules";
import { buildHistoryIndex } from "@/lib/domain/coding-history";
import type { RepaymentAccount } from "@/lib/domain/repayments";

const account = (id: string, over: Partial<CodingAccount> = {}): CodingAccount => ({
  id,
  code: id.toUpperCase(),
  name: `Account ${id}`,
  type: "expense",
  active: true,
  posting: true,
  ...over,
});
const accounts = new Map(
  [account("rent"), account("payroll"), account("repairs"), account("old", { active: false })].map((a) => [a.id, a]),
);
const rule = (over: Partial<BankRule>): BankRule => ({
  id: "r",
  position: 1,
  matchKind: "words",
  matchText: "metro",
  direction: "any",
  minMinor: null,
  maxMinor: null,
  accountId: "repairs",
  isActive: true,
  ...over,
});
const history = buildHistoryIndex(
  [
    { entryId: "1", date: "2026-01-05", direction: "out", accountId: "rent", texts: ["Metro Realty Partners"] },
    { entryId: "2", date: "2026-02-05", direction: "out", accountId: "rent", texts: ["Metro Realty Partners"] },
    { entryId: "3", date: "2026-02-10", direction: "out", accountId: "payroll", texts: ["Starbucks"] },
    { entryId: "4", date: "2026-03-10", direction: "out", accountId: "payroll", texts: ["Starbucks"] },
  ],
  () => true,
);
const line = { id: "t1", amountMinor: -420000, description: "Metro Realty Partners LLC", merchantName: null };

describe("codableAccount", () => {
  it("allows an active posting account and refuses control, holding, inactive and heading accounts", () => {
    expect(codableAccount(account("x"))).toBe(true);
    expect(codableAccount(account("x", { active: false }))).toBe(false);
    expect(codableAccount(account("x", { posting: false }))).toBe(false);
    expect(codableAccount(account("x", { type: "accounts_receivable" }))).toBe(false);
    expect(codableAccount(account("x", { type: "accounts_payable" }))).toBe(false);
    expect(codableAccount(account("x", { name: "Uncategorized Expense" }))).toBe(false);
    expect(codableAccount(account("x", { name: "Suspense" }))).toBe(false);
    expect(codableAccount(undefined)).toBe(false);
  });
  it("reads a chart row", () => {
    expect(
      codingAccountOf({ id: "a", account_code: "6300", name: "Rent", account_type: "expense", status: "inactive", is_posting_account: true }),
    ).toEqual({ id: "a", code: "6300", name: "Rent", type: "expense", active: false, posting: true });
  });
});

describe("suggestCoding", () => {
  it("says nothing on a line that already has a match to the ledger", () => {
    expect(suggestCoding({ line, rules: [rule({})], index: history, accounts, hasMatch: true })).toBeNull();
  });
  it("lets a rule speak before history", () => {
    const s = suggestCoding({ line, rules: [rule({})], index: history, accounts, hasMatch: false });
    expect(s).toMatchObject({ source: "rule", accountId: "repairs", ruleId: "r", ruleNumber: 1 });
  });
  it("numbers a rule by its place in the list, not its stored position", () => {
    const rules = [rule({ id: "a", position: 5, matchText: "nothing here" }), rule({ id: "b", position: 9 })];
    expect(suggestCoding({ line, rules, index: history, accounts, hasMatch: false })).toMatchObject({ ruleId: "b", ruleNumber: 2 });
  });
  it("asks history when no rule answers", () => {
    expect(suggestCoding({ line, rules: [], index: history, accounts, hasMatch: false })).toMatchObject({
      source: "history",
      accountId: "rent",
      hits: 2,
      of: 2,
      key: "metro realty partners",
    });
  });
  it("skips a rule whose account cannot take the line, and falls through to history", () => {
    const s = suggestCoding({ line, rules: [rule({ accountId: "old" })], index: history, accounts, hasMatch: false });
    expect(s?.source).toBe("history");
  });
  it("reads a bank feed's merchant name too", () => {
    const fed = { id: "t2", amountMinor: -650, description: "POS 4432 0915", merchantName: "Starbucks" };
    expect(suggestCoding({ line: fed, rules: [], index: history, accounts, hasMatch: false })?.accountId).toBe("payroll");
  });
  it("stays quiet when nothing answers", () => {
    const unknown = { id: "t3", amountMinor: -100, description: "Somebody New", merchantName: null };
    expect(suggestCoding({ line: unknown, rules: [], index: history, accounts, hasMatch: false })).toBeNull();
  });
});

describe("suggestCoding with cards and loans", () => {
  const withCard = new Map<string, CodingAccount>([...accounts, ["card1", account("card1", { type: "credit_card", name: "Example Card" })]]);
  const entry = (over: Partial<RepaymentAccount> = {}): RepaymentAccount => ({
    id: "rp1",
    kind: "card",
    accountId: "card1",
    matchWords: "metro",
    matchDigits: null,
    interestAccountId: null,
    interestMethod: null,
    annualRate: null,
    fixedInterestMinor: null,
    isActive: true,
    ...over,
  });
  it("puts a card ahead of a rule and of history", () => {
    const s = suggestCoding({ line, rules: [rule({})], index: history, accounts: withCard, hasMatch: false, repayment: { kind: "one", entry: entry() } });
    expect(s).toEqual({ source: "card", accountId: "card1", repaymentId: "rp1" });
  });
  it("lets a loan, or two entries, silence rule and history", () => {
    const loan = entry({ kind: "loan", interestAccountId: "rent", interestMethod: "entered" });
    expect(suggestCoding({ line, rules: [rule({})], index: history, accounts: withCard, hasMatch: false, repayment: { kind: "one", entry: loan } })).toBeNull();
    expect(suggestCoding({ line, rules: [rule({})], index: history, accounts: withCard, hasMatch: false, repayment: { kind: "rivals", count: 2 } })).toBeNull();
  });
  it("still says nothing on a line that already has a match to the ledger", () => {
    expect(suggestCoding({ line, rules: [], index: history, accounts: withCard, hasMatch: true, repayment: { kind: "one", entry: entry() } })).toBeNull();
  });
  it("says why in the screen's words", () => {
    const view = codingView(line, { source: "card", accountId: "card1", repaymentId: "rp1" }, withCard.get("card1")!);
    expect(view).toEqual({
      transactionId: "t1",
      accountId: "card1",
      accountLabel: "CARD1 — Example Card",
      source: "card",
      short: "Card",
      why: "Card payment — repays CARD1 Example Card. A card payment is never an expense.",
    });
  });
});

describe("codingView", () => {
  it("says why, in the words the screen shows", () => {
    const rent = accounts.get("rent")!;
    expect(codingView(line, { source: "history", accountId: "rent", hits: 11, of: 11, key: "metro realty" }, rent)).toEqual({
      transactionId: "t1",
      accountId: "rent",
      accountLabel: "RENT — Account rent",
      source: "history",
      short: "11 of 11",
      why: 'Coded to RENT Account rent 11 of the last 11 times for "metro realty"',
    });
    const byRule = codingView(line, { source: "rule", accountId: "rent", ruleId: "r", ruleNumber: 3, ruleText: "gusto" }, rent);
    expect(byRule.short).toBe("Rule 3");
    expect(byRule.why).toBe('Rule 3: "gusto" → RENT Account rent');
  });
});

describe("the coding module", () => {
  it("codes at most a hundred lines at a time", () => {
    expect(CODE_ALL_LIMIT).toBe(100);
  });
  it("can be imported by plain-Node scripts", () => {
    const src = readFileSync("lib/domain/coding.ts", "utf8");
    expect(src).not.toMatch(/from "@\//);
    expect(src).toMatch(/import type \{ AccountType \} from "\.\/accounts\.ts"/);
  });
});
