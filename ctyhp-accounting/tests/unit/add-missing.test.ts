import { describe, expect, it } from "vitest";
import {
  ADD_BLOCKED,
  ADD_MISSING_LIMIT,
  CANNOT_ADD_NOTE,
  UNCATEGORIZED_WHY,
  addedMessage,
  planAddMissing,
  type AddBankLine,
  type AddStatementLine,
  type AddSuggestion,
} from "@/lib/domain/add-missing";
import type { Standing } from "@/lib/domain/reconcile-statement";
import { holdingAccountIds, holdingAccountsOf, isHoldingDetail, needsCoding } from "@/lib/domain/uncategorized";

const holding = {
  income: { id: "uncat-in", label: "4999 — Uncategorized Income" },
  expense: { id: "uncat-out", label: "6999 — Uncategorized Expense" },
};
const missing: Standing = { kind: "missing" };
const paired: Standing = { kind: "paired", how: "date and amount", bookId: "b1", entryNumber: "JE-1", ticked: true };
const after: Standing = { kind: "after" };

const line = (lineNo: number, txnDate: string, amountMinor: number, description: string, reference: string | null = null): AddStatementLine => ({
  lineNo,
  txnDate,
  amountMinor,
  description,
  reference,
});
const txn = (id: string, l: AddStatementLine, extra: Partial<AddBankLine> = {}): AddBankLine => ({
  id,
  txnDate: l.txnDate,
  description: l.description,
  reference: l.reference,
  amountMinor: l.amountMinor,
  status: "unmatched",
  suggested: false,
  ...extra,
});
const rule: AddSuggestion = { accountId: "charges", accountLabel: "6400 — Bank Charges", source: "rule", short: "Rule 1", why: "Rule 1: SERVICE FEE" };

const deposit = line(0, "2026-07-05", 50000, "DEPOSIT 0041");
const wire = line(1, "2026-07-15", 3000, "INCOMING WIRE");
const shop = line(2, "2026-07-28", -4200, "POS EXAMPLE SHOP");
const fee = line(3, "2026-07-30", -1500, "SERVICE FEE");
const late = line(4, "2026-08-02", -700, "AFTER THE STATEMENT");

describe("planAddMissing", () => {
  it("adds each missing line through its bank line: by its suggestion, or to Uncategorized by direction", () => {
    const plan = planAddMissing({
      lines: [deposit, wire, shop, fee, late],
      standings: [paired, missing, missing, missing, after],
      flipped: false,
      transactions: [txn("t-dep", deposit, { status: "matched" }), txn("t-wire", wire), txn("t-shop", shop), txn("t-fee", fee), txn("t-late", late)],
      suggestions: new Map([["t-fee", rule]]),
      holding,
    });
    expect(plan.missing).toBe(3);
    expect(plan.blocked).toBeNull();
    expect(plan.cannot).toEqual([]);
    expect(plan.items.map((i) => [i.lineNo, i.transactionId, i.accountId, i.source])).toEqual([
      [1, "t-wire", "uncat-in", "uncategorized"],
      [2, "t-shop", "uncat-out", "uncategorized"],
      [3, "t-fee", "charges", "rule"],
    ]);
    expect(plan.items[0].why).toBe(UNCATEGORIZED_WHY);
    expect(plan.items[2]).toMatchObject({ accountLabel: "6400 — Bank Charges", short: "Rule 1", why: "Rule 1: SERVICE FEE" });
    expect(plan.uncategorized).toBe(2);
  });

  it("pairs identical lines of one day one to one, in the order they were imported", () => {
    const one = line(1, "2026-07-30", -500, "ATM FEE");
    const two = line(2, "2026-07-30", -500, "ATM FEE");
    const plan = planAddMissing({
      lines: [one, two],
      standings: [missing, missing],
      flipped: false,
      transactions: [txn("first", one), txn("second", two)],
      suggestions: new Map(),
      holding,
    });
    expect(plan.items.map((i) => [i.lineNo, i.transactionId])).toEqual([
      [1, "first"],
      [2, "second"],
    ]);
  });

  it("reads a reference the way the statement keeps it: trimmed", () => {
    const check = line(1, "2026-07-02", -60000, "CHECK", "1201");
    const plan = planAddMissing({
      lines: [check],
      standings: [missing],
      flipped: false,
      transactions: [txn("t-check", check, { reference: " 1201 " })],
      suggestions: new Map(),
      holding,
    });
    expect(plan.items.map((i) => i.transactionId)).toEqual(["t-check"]);
  });

  it("says why a line cannot be added: no bank line, coded already, excluded, or a match suggested", () => {
    const a = line(1, "2026-07-10", -100, "A");
    const b = line(2, "2026-07-11", -200, "B");
    const c = line(3, "2026-07-12", -300, "C");
    const d = line(4, "2026-07-13", -400, "D");
    const plan = planAddMissing({
      lines: [a, b, c, d],
      standings: [missing, missing, missing, missing],
      flipped: false,
      transactions: [txn("t-b", b, { status: "matched" }), txn("t-c", c, { status: "ignored" }), txn("t-d", d, { suggested: true })],
      suggestions: new Map(),
      holding,
    });
    expect(plan.items).toEqual([]);
    expect(plan.cannot.map((x) => [x.lineNo, x.reason, x.note])).toEqual([
      [1, "not-found", CANNOT_ADD_NOTE["not-found"]],
      [2, "coded", CANNOT_ADD_NOTE.coded],
      [3, "ignored", CANNOT_ADD_NOTE.ignored],
      [4, "suggested", CANNOT_ADD_NOTE.suggested],
    ]);
  });

  it("adds nothing from a statement read the other way around", () => {
    const plan = planAddMissing({
      lines: [fee],
      standings: [missing],
      flipped: true,
      transactions: [txn("t-fee", fee)],
      suggestions: new Map(),
      holding,
    });
    expect(plan).toEqual({ missing: 1, items: [], cannot: [], uncategorized: 0, blocked: ADD_BLOCKED.flipped });
  });

  it("adds nothing when a line needs an Uncategorized account the chart does not have", () => {
    const plan = planAddMissing({
      lines: [shop],
      standings: [missing],
      flipped: false,
      transactions: [txn("t-shop", shop)],
      suggestions: new Map(),
      holding: { income: holding.income, expense: null },
    });
    expect(plan.items).toEqual([]);
    expect(plan.blocked).toBe(ADD_BLOCKED.noHolding);
  });

  it(`stops at more than ${ADD_MISSING_LIMIT} lines`, () => {
    const lines = Array.from({ length: ADD_MISSING_LIMIT + 1 }, (_, i) => line(i, "2026-07-30", -(i + 1), `FEE ${i}`));
    const plan = planAddMissing({
      lines,
      standings: lines.map(() => missing),
      flipped: false,
      transactions: lines.map((l, i) => txn(`t-${i}`, l)),
      suggestions: new Map(),
      holding,
    });
    expect([plan.missing, plan.items.length, plan.uncategorized, plan.blocked]).toEqual([ADD_MISSING_LIMIT + 1, 0, 0, ADD_BLOCKED.tooMany]);
  });

  it("has nothing to say when every line is in the books", () => {
    expect(
      planAddMissing({ lines: [deposit], standings: [paired], flipped: false, transactions: [], suggestions: new Map(), holding }),
    ).toEqual({ missing: 0, items: [], cannot: [], uncategorized: 0, blocked: null });
  });
});

describe("addedMessage", () => {
  it("says how many were added, and how many went to Uncategorized", () => {
    expect(addedMessage(3, 1)).toBe("3 entries added from the statement and ticked; 1 went to Uncategorized.");
    expect(addedMessage(1, 0)).toBe("1 entry added from the statement and ticked.");
  });
});

describe("the Uncategorized accounts", () => {
  const chart = [
    { id: "a", account_code: "4999", name: "Uncategorized Income", detail_type: "uncategorized_income", status: "active" },
    { id: "b", account_code: "6999", name: "Uncategorized Expense", detail_type: "uncategorized_expense", status: "active" },
    { id: "c", account_code: "6400", name: "Bank Charges", detail_type: null, status: "active" },
  ];

  it("are found by their detail type", () => {
    expect(holdingAccountsOf(chart)).toEqual({
      income: { id: "a", label: "4999 — Uncategorized Income" },
      expense: { id: "b", label: "6999 — Uncategorized Expense" },
    });
    expect([...holdingAccountIds(chart)]).toEqual(["a", "b"]);
    expect([isHoldingDetail("uncategorized_expense"), isHoldingDetail("undeposited_funds"), isHoldingDetail(null)]).toEqual([true, false, false]);
  });

  it("a line posted to one and not recoded needs coding", () => {
    const ids = holdingAccountIds(chart);
    expect([needsCoding("b", ids, false), needsCoding("b", ids, true), needsCoding("c", ids, false), needsCoding(undefined, ids, false)]).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });
});
