import { describe, expect, it } from "vitest";
import {
  ADD_ANYWAY,
  ADD_BLOCKED,
  ADD_MISSING_LIMIT,
  CANNOT_ADD_NOTE,
  EXTRA_LINE_NOTE,
  EXTRA_LINE_TAG,
  HELD_BACK_HEADING,
  UNCATEGORIZED_WHY,
  addedMessage,
  addedNotPairedMessage,
  chooseLinesToAdd,
  duplicateNote,
  extraLineNos,
  extraStatementLines,
  linesToCheckForDuplicates,
  planAddMissing,
  type AddBankLine,
  type AddStatementLine,
  type AddSuggestion,
  type DuplicateMatch,
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

  it("leaves out a line of 0.00 and a line dated in a month already signed off", () => {
    const zero = line(1, "2026-07-10", 0, "ZERO");
    const old = line(2, "2026-06-28", -900, "LATE CHARGE");
    const plan = planAddMissing({
      lines: [zero, old, fee],
      standings: [missing, missing, missing],
      flipped: false,
      transactions: [txn("t-zero", zero), txn("t-old", old), txn("t-fee", fee)],
      suggestions: new Map([["t-fee", rule]]),
      holding,
      signedThrough: "2026-06-30",
    });
    expect(plan.cannot.map((x) => [x.lineNo, x.reason, x.note])).toEqual([
      [1, "zero", CANNOT_ADD_NOTE.zero],
      [2, "signed", CANNOT_ADD_NOTE.signed],
    ]);
    expect(plan.items.map((i) => i.transactionId)).toEqual(["t-fee"]);
  });

  it("never gives one bank line to two statement lines", () => {
    const one = line(1, "2026-07-30", -500, "ATM FEE");
    const two = line(2, "2026-07-30", -500, "ATM FEE");
    const plan = planAddMissing({
      lines: [one, two],
      standings: [missing, missing],
      flipped: false,
      transactions: [txn("only", one)],
      suggestions: new Map(),
      holding,
    });
    expect(plan.items.map((i) => [i.lineNo, i.transactionId])).toEqual([[1, "only"]]);
    expect(plan.cannot.map((x) => [x.lineNo, x.reason])).toEqual([[2, "not-found"]]);
  });

  it("adds a line through the line of another source Bank Transactions holds for it, since the statement was not imported again (2.44)", () => {
    // The same fee from a CSV export, worded the bank's other way, still waiting to be coded.
    const csvFee = { ...fee, description: "MONTHLY SVC CHARGE" };
    const plan = planAddMissing({
      lines: [fee],
      standings: [missing],
      flipped: false,
      transactions: [txn("csv-fee", csvFee)],
      suggestions: new Map([["csv-fee", rule]]),
      holding,
    });
    expect(plan.items.map((i) => [i.lineNo, i.transactionId, i.accountId])).toEqual([[3, "csv-fee", "charges"]]);
    expect(plan.cannot).toEqual([]);
  });

  it("says a line of another source already coded is in the books, rather than to import the statement again", () => {
    const csvFee = { ...fee, description: "MONTHLY SVC CHARGE" };
    const plan = planAddMissing({
      lines: [fee],
      standings: [missing],
      flipped: false,
      transactions: [txn("csv-fee", csvFee, { status: "matched" })],
      suggestions: new Map(),
      holding,
    });
    expect(plan.items).toEqual([]);
    expect(plan.cannot.map((x) => [x.lineNo, x.reason])).toEqual([[3, "coded"]]);
  });

  it("takes the statement's own bank line before one of another source, and each once", () => {
    const one = line(1, "2026-07-30", -500, "ATM FEE");
    const two = line(2, "2026-07-30", -500, "ATM FEE 2");
    const plan = planAddMissing({
      lines: [one, two],
      standings: [missing, missing],
      flipped: false,
      transactions: [txn("csv", { ...one, description: "ATM WITHDRAWAL FEE" }), txn("own", one)],
      suggestions: new Map(),
      holding,
    });
    expect(plan.items.map((i) => [i.lineNo, i.transactionId])).toEqual([
      [1, "own"],
      [2, "csv"],
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
    expect(plan).toEqual({ missing: 1, items: [], held: [], cannot: [], uncategorized: 0, blocked: ADD_BLOCKED.flipped });
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
    ).toEqual({ missing: 0, items: [], held: [], cannot: [], uncategorized: 0, blocked: null });
  });
});

describe("lines held back from Add all", () => {
  // The deposit pairs with the books; the shop and the fee do not.
  const lines = [deposit, shop, fee];
  const standings: Standing[] = [paired, missing, missing];
  const transactions = [txn("t-dep", deposit, { status: "matched" }), txn("t-shop", shop), txn("t-fee", fee)];
  const base = { lines, standings, flipped: false, transactions, suggestions: new Map([["t-fee", rule]]), holding };
  const match = (entryId: string, entryNumber: string | null, journalLineId = `${entryId}-l`): DuplicateMatch => ({
    journalLineId,
    entryId,
    entryNumber,
    entryDate: "2026-07-27",
  });

  it("holds back every missing line when the statement already balances on the paired lines", () => {
    // Opening $1,000.00 + the deposit $500.00 = the closing $1,500.00: the shop and the fee are extra.
    const plan = planAddMissing({ ...base, openingMinor: 100000, closingMinor: 150000 });
    expect(plan.items).toEqual([]);
    expect(plan.uncategorized).toBe(0);
    expect(plan.held.map((h) => [h.lineNo, h.reason, h.note, h.transactionId, h.accountId, h.matches])).toEqual([
      [2, "extra", EXTRA_LINE_NOTE, "t-shop", "uncat-out", []],
      [3, "extra", EXTRA_LINE_NOTE, "t-fee", "charges", []],
    ]);
    expect(EXTRA_LINE_NOTE).toBe("Extra — likely not a transaction: the statement already balances without it.");
    // Nothing is left for Add all, so the books are asked about nothing.
    expect(linesToCheckForDuplicates(plan)).toEqual([]);
  });

  it("holds nothing back when the statement needs the missing lines, or does not print both balances", () => {
    const needs = planAddMissing({ ...base, openingMinor: 100000, closingMinor: 150000 - 4200 - 1500 });
    expect([needs.items.map((i) => i.lineNo), needs.held]).toEqual([[2, 3], []]);
    expect(linesToCheckForDuplicates(needs)).toEqual([2, 3]);
    expect(planAddMissing({ ...base, openingMinor: null, closingMinor: 150000 }).held).toEqual([]);
    expect(planAddMissing({ ...base, openingMinor: 100000, closingMinor: null }).held).toEqual([]);
    expect(planAddMissing(base).held).toEqual([]);
  });

  it("holds back a line the books seem to hold already, naming the entry, and counts only the rest in Add all", () => {
    const plan = planAddMissing({ ...base, duplicates: new Map([[2, [match("e-310", "JE-000310")]]]) });
    expect(plan.items.map((i) => i.lineNo)).toEqual([3]);
    expect(plan.uncategorized).toBe(0);
    expect(plan.held).toEqual([
      {
        lineNo: 2,
        txnDate: shop.txnDate,
        description: shop.description,
        amountMinor: shop.amountMinor,
        transactionId: "t-shop",
        accountId: "uncat-out",
        accountLabel: holding.expense.label,
        source: "uncategorized",
        short: "",
        why: UNCATEGORIZED_WHY,
        reason: "duplicate",
        note: "Looks like JE-000310 already in the books.",
        matches: [match("e-310", "JE-000310")],
      },
    ]);
  });

  it("names the first entry and counts the others", () => {
    expect(duplicateNote([match("e1", "JE-000101")])).toBe("Looks like JE-000101 already in the books.");
    // Two lines of one entry are one entry.
    expect(
      duplicateNote([match("e1", "JE-000101", "a"), match("e1", "JE-000101", "b"), match("e2", "JE-000102"), match("e3", "JE-000103")]),
    ).toBe("Looks like JE-000101 and 2 more already in the books.");
    expect(duplicateNote([match("e9", null)])).toBe("Looks like an entry already in the books.");
  });

  it(`stops at more than ${ADD_MISSING_LIMIT} lines held back and added together`, () => {
    const many = Array.from({ length: ADD_MISSING_LIMIT + 1 }, (_, i) => line(i, "2026-07-30", -(i + 1), `FEE ${i}`));
    const plan = planAddMissing({
      lines: many,
      standings: many.map(() => missing),
      flipped: false,
      transactions: many.map((l, i) => txn(`t-${i}`, l)),
      suggestions: new Map(),
      holding,
      duplicates: new Map([[0, [match("e1", "JE-000101")]]]),
    });
    expect([plan.items.length, plan.held.length, plan.blocked]).toEqual([0, 0, ADD_BLOCKED.tooMany]);
    expect(linesToCheckForDuplicates(plan)).toEqual([]);
  });

  it("marks only the lines held back as extra in the statement lines table, never a likely duplicate", () => {
    expect(extraLineNos(planAddMissing({ ...base, openingMinor: 100000, closingMinor: 150000 }))).toEqual(new Set([2, 3]));
    expect(extraLineNos(planAddMissing({ ...base, duplicates: new Map([[2, [match("e-310", "JE-000310")]]]) }))).toEqual(new Set());
    expect(extraLineNos(null)).toEqual(new Set());
  });

  it("words the box's held lines as the screen shows them", () => {
    expect([EXTRA_LINE_TAG, HELD_BACK_HEADING, ADD_ANYWAY]).toEqual(["Extra", "Held back from Add all:", "Add anyway"]);
  });
});

describe("extra lines: the lines a statement balances without", () => {
  // An invented statement opening at $2,500.00. The deposit and the check pair
  // with the books. The fee is real and the books do not have it yet; the hold
  // was read from the PDF but is not a transaction, so the closing leaves it out.
  const aside: Standing = { kind: "aside" };
  const dep = line(1, "2026-09-04", 80000, "DEPOSIT 7001");
  const check = line(2, "2026-09-11", -12500, "CHECK 8101", "8101");
  const hold = line(3, "2026-09-17", -6400, "TEMPORARY AUTHORIZATION HOLD");
  const svc = line(4, "2026-09-30", -1800, "MONTHLY SERVICE FEE");
  const opening = 250000;
  const closing = opening + dep.amountMinor + check.amountMinor + svc.amountMinor;
  const lines = [dep, check, hold, svc];
  const standings: Standing[] = [paired, paired, missing, missing];
  const base = {
    lines,
    standings,
    flipped: false,
    transactions: [txn("t-dep", dep, { status: "matched" }), txn("t-check", check, { status: "matched" }), txn("t-hold", hold), txn("t-svc", svc)],
    suggestions: new Map([["t-svc", rule]]),
    holding,
    openingMinor: opening,
    closingMinor: closing,
  };

  it("holds back only the misread line when a real line is missing beside it, and leaves the fee in Add all 1", () => {
    // Opening + every line - closing = -64.00, the hold's amount and no other line's.
    expect(opening + 80000 - 12500 - 6400 - 1800 - closing).toBe(hold.amountMinor);
    expect(extraStatementLines(base)).toEqual(new Set([3]));
    const plan = planAddMissing(base);
    expect(plan.items.map((i) => [i.lineNo, i.transactionId, i.accountId])).toEqual([[4, "t-svc", "charges"]]);
    expect(plan.held.map((h) => [h.lineNo, h.reason, h.note, h.transactionId])).toEqual([[3, "extra", EXTRA_LINE_NOTE, "t-hold"]]);
    // The box and the statement lines table say the same thing.
    expect(extraLineNos(plan)).toEqual(new Set([3]));
    // The books are asked about the fee alone.
    expect(linesToCheckForDuplicates(plan)).toEqual([4]);
  });

  it("marks neither of two missing lines of the amount the statement is out by: exactly one is the rule", () => {
    const twin = line(5, "2026-09-18", -6400, "TEMPORARY AUTHORIZATION HOLD");
    const input = {
      ...base,
      lines: [...lines, twin],
      standings: [...standings, missing],
      transactions: [...base.transactions, txn("t-twin", twin)],
      // The statement holds one hold of -64.00; two were read.
      closingMinor: closing - 6400,
    };
    expect(opening + 80000 - 12500 - 6400 - 1800 - 6400 - input.closingMinor).toBe(-6400);
    expect(extraStatementLines(input)).toEqual(new Set());
    const plan = planAddMissing(input);
    expect(plan.held).toEqual([]);
    expect(plan.items.map((i) => i.lineNo)).toEqual([3, 4, 5]);
  });

  it("marks nothing when the statement proves itself", () => {
    const proves = { ...base, closingMinor: opening + 80000 - 12500 - 6400 - 1800 };
    expect(extraStatementLines(proves)).toEqual(new Set());
    expect(planAddMissing(proves).held).toEqual([]);
  });

  it("still marks every missing line when the statement balances on the paired lines alone", () => {
    const balances = { ...base, closingMinor: opening + 80000 - 12500 };
    expect(extraStatementLines(balances)).toEqual(new Set([3, 4]));
    expect(planAddMissing(balances).held.map((h) => [h.lineNo, h.reason])).toEqual([
      [3, "extra"],
      [4, "extra"],
    ]);
  });

  it("counts a line set aside for nothing, and never marks a line dated after the statement", () => {
    // The hold set aside: without it the statement proves itself, so the fee stays to be added.
    expect(extraStatementLines({ ...base, standings: [paired, paired, aside, missing] })).toEqual(new Set());
    // The hold dated after the statement is counted, but is not a line to mark; no other line is -64.00.
    expect(extraStatementLines({ ...base, standings: [paired, paired, after, missing] })).toEqual(new Set());
  });

  it("marks nothing without both balances, or with nothing missing", () => {
    expect(extraStatementLines({ ...base, openingMinor: null })).toEqual(new Set());
    expect(extraStatementLines({ ...base, closingMinor: undefined })).toEqual(new Set());
    expect(extraStatementLines({ ...base, standings: [paired, paired, paired, paired] })).toEqual(new Set());
  });
});

describe("chooseLinesToAdd", () => {
  const lines = [deposit, wire, shop, fee];
  const plan = planAddMissing({
    lines,
    standings: [missing, missing, missing, missing],
    flipped: false,
    transactions: lines.map((l, i) => txn(`t-${i}`, l)),
    suggestions: new Map([["t-3", rule]]),
    holding,
    duplicates: new Map([[2, [{ journalLineId: "jl", entryId: "e", entryNumber: "JE-000200", entryDate: "2026-07-28" }]]]),
  });
  const shown = (lineNo: number) => {
    const item = [...plan.items, ...plan.held].find((i) => i.lineNo === lineNo)!;
    return { lineNo, accountId: item.accountId };
  };

  it("takes the lines of Add all as they were shown, in statement order", () => {
    expect(plan.items.map((i) => i.lineNo)).toEqual([0, 1, 3]);
    expect(chooseLinesToAdd(plan, [shown(3), shown(0), shown(1)], [])?.map((i) => i.lineNo)).toEqual([0, 1, 3]);
    // A line of Add all may be asked for alone: each one is checked, and nothing unseen is added.
    expect(chooseLinesToAdd(plan, [shown(1)], [])?.map((i) => i.transactionId)).toEqual(["t-1"]);
  });

  it("takes a held-back line only when it was chosen with Add anyway", () => {
    expect(chooseLinesToAdd(plan, [shown(2)], [])).toBeNull();
    expect(chooseLinesToAdd(plan, [shown(2)], [2])?.map((i) => [i.lineNo, i.transactionId, i.accountId])).toEqual([[2, "t-2", "uncat-out"]]);
    // Add anyway names only held-back lines; it never lets in a line the plan does not hold.
    expect(chooseLinesToAdd(plan, [{ lineNo: 9, accountId: "uncat-out" }], [9])).toBeNull();
  });

  it("refuses a line posting to another account than shown, or asked for twice", () => {
    expect(chooseLinesToAdd(plan, [{ lineNo: 3, accountId: "uncat-out" }], [])).toBeNull();
    expect(chooseLinesToAdd(plan, [shown(0), shown(0)], [])).toBeNull();
  });
});

describe("addedMessage", () => {
  it("says how many were added, and how many went to Uncategorized", () => {
    expect(addedMessage(3, 1)).toBe("3 entries added from the statement and ticked; 1 went to Uncategorized.");
    expect(addedMessage(1, 0)).toBe("1 entry added from the statement and ticked.");
  });

  it("says the lines are in the books when pairing them afterwards failed", () => {
    expect(addedNotPairedMessage(2, 1, "timeout")).toBe(
      "2 entries added from the statement, 1 to Uncategorized, but pairing them with the statement failed (timeout). Click Match again to tick them.",
    );
    expect(addedNotPairedMessage(1, 0, "timeout")).toBe(
      "1 entry added from the statement, but pairing it with the statement failed (timeout). Click Match again to tick it.",
    );
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
