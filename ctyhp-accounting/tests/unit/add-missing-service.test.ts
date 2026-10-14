import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  listSuggestions: vi.fn(),
  codingSuggestions: vi.fn(),
  listAccounts: vi.fn(),
  bankLinesBetween: vi.fn(),
}));
vi.mock("@/lib/services/banking", () => ({ listSuggestions: mocks.listSuggestions, listBankAccounts: vi.fn() }));
vi.mock("@/lib/services/coding", () => ({ codingSuggestions: mocks.codingSuggestions }));
vi.mock("@/lib/services/accounts", () => ({ listAccounts: mocks.listAccounts }));
vi.mock("@/lib/services/statement-bank-lines", () => ({ bankLinesBetween: mocks.bankLinesBetween }));

import { EXTRA_LINE_NOTE } from "@/lib/domain/add-missing";
import { AddMissingError, PLAN_CHANGED, addMissingLines, getAddMissingPlan } from "@/lib/services/add-missing";

/**
 * A stand-in for PostgREST: tables and table-returning RPCs page at a row cap;
 * an RPC given as a function answers with what it returns. Every RPC call is
 * recorded with its arguments.
 */
type Rows = Record<string, unknown>[];
type Scalar = (args: Record<string, unknown>) => { data: unknown; error: { message: string } | null };

function fakeClient(tables: Record<string, Rows>, rpcs: Record<string, Rows | Scalar>, cap = 1000) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  function builder(rows: Rows) {
    const page = (from: number, to: number) => ({ data: rows.slice(from, from + Math.min(to - from + 1, cap)), error: null });
    const chain: Record<string, unknown> = {};
    for (const name of ["select", "eq", "order"]) chain[name] = () => chain;
    chain.range = (from: number, to: number) => Promise.resolve(page(from, to));
    chain.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null });
    chain.then = (resolve: (value: unknown) => unknown) => resolve(page(0, cap - 1));
    return chain;
  }
  const sb = {
    from: (table: string) => builder(tables[table] ?? []),
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      const answer = rpcs[fn];
      if (typeof answer === "function") return Promise.resolve(answer(args));
      return builder(answer ?? []);
    },
  } as unknown as SupabaseClient;
  return { sb, calls };
}

const CHARGES = "11111111-1111-4111-8111-111111111111";
const UNCAT_OUT = "22222222-2222-4222-8222-222222222222";
const UNCAT_IN = "33333333-3333-4333-8333-333333333333";

// An invented September statement: the deposit is in the books; a shop payment and a fee are not.
const session = (closing: number | null) => ({
  id: "rec-1",
  bank_account_id: "bank-1",
  statement_ending_date: "2026-09-30",
  status: "in_progress",
  statement_ref: "september.pdf",
  statement_opening_minor: 100000,
  statement_closing_minor: closing,
  note: null,
  brought_forward: false,
  statement_file_id: null,
  statement_file: null,
});
const statementLines = [
  { line_no: 1, txn_date: "2026-09-05", description: "EXAMPLE DEPOSIT", reference: null, amount_minor: 50000, balance_minor: null, set_aside: false },
  { line_no: 2, txn_date: "2026-09-12", description: "POS EXAMPLE SHOP", reference: null, amount_minor: -4200, balance_minor: null, set_aside: false },
  { line_no: 3, txn_date: "2026-09-25", description: "SERVICE FEE", reference: null, amount_minor: -1500, balance_minor: null, set_aside: false },
];
const book = [
  { journal_line_id: "jl-dep", entry_id: "e-dep", entry_number: "JE-000101", entry_date: "2026-09-05", source_type: "manual", memo: null, signed_minor: 50000, cleared: true, reference: null },
];
// The statement needs both lines: $1,000.00 + 500.00 − 42.00 − 15.00.
const PROVES = 100000 + 50000 - 4200 - 1500;
// The statement balances on the deposit alone: the shop and the fee are extra.
const BALANCES_WITHOUT = 100000 + 50000;

function client(closing: number | null, duplicates: Rows = [], lines = statementLines) {
  return fakeClient(
    { acc_statement_reconciliation: [session(closing)], acc_reconciliation_statement_line: lines },
    {
      acc_reconciliation_lines: book,
      acc_statement_line_duplicates: duplicates,
      acc_add_statement_lines_to_books: () => ({ data: null, error: null }),
      acc_set_cleared_many: (args) => ({ data: (args.p_journal_line_ids as string[]).length, error: null }),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.bankLinesBetween.mockResolvedValue([
    { id: "t-shop", txnDate: "2026-09-12", description: "POS EXAMPLE SHOP", reference: null, amountMinor: -4200, status: "unmatched", approvedLineId: null },
    { id: "t-fee", txnDate: "2026-09-25", description: "SERVICE FEE", reference: null, amountMinor: -1500, status: "unmatched", approvedLineId: null },
  ]);
  mocks.listSuggestions.mockResolvedValue([]);
  mocks.codingSuggestions.mockResolvedValue([
    { transactionId: "t-fee", accountId: CHARGES, accountLabel: "6400 — Bank Charges", source: "rule", short: "Rule 1", why: "Rule 1: SERVICE FEE" },
  ]);
  mocks.listAccounts.mockResolvedValue([
    { id: UNCAT_IN, account_code: "4999", name: "Uncategorized Income", detail_type: "uncategorized_income", status: "active" },
    { id: UNCAT_OUT, account_code: "6999", name: "Uncategorized Expense", detail_type: "uncategorized_expense", status: "active" },
  ]);
});

describe("the Add missing plan", () => {
  it("asks the books about the lines Add all would add, and holds back the one they seem to hold", async () => {
    const { sb, calls } = client(PROVES, [
      { line_no: 2, journal_line_id: "jl-old", entry_id: "e-old", entry_number: "JE-000310", entry_date: "2026-09-10" },
    ]);
    const plan = await getAddMissingPlan(sb, "rec-1");
    expect(calls.find((c) => c.fn === "acc_statement_line_duplicates")?.args).toEqual({ p_reconciliation_id: "rec-1", p_line_nos: [2, 3] });
    expect(plan.items.map((i) => [i.lineNo, i.accountId])).toEqual([[3, CHARGES]]);
    expect(plan.held.map((h) => [h.lineNo, h.reason, h.note, h.accountId])).toEqual([
      [2, "duplicate", "Looks like JE-000310 already in the books.", UNCAT_OUT],
    ]);
    expect(plan.uncategorized).toBe(0);
  });

  it("holds back every missing line when the statement balances without them, and asks the books nothing", async () => {
    const { sb, calls } = client(BALANCES_WITHOUT);
    const plan = await getAddMissingPlan(sb, "rec-1");
    expect(plan.items).toEqual([]);
    expect(plan.held.map((h) => [h.lineNo, h.reason, h.note])).toEqual([
      [2, "extra", EXTRA_LINE_NOTE],
      [3, "extra", EXTRA_LINE_NOTE],
    ]);
    expect(calls.map((c) => c.fn)).not.toContain("acc_statement_line_duplicates");
  });

  it("asks the books nothing when nothing is missing, or every missing line is set aside", async () => {
    const aside = statementLines.map((l) => (l.line_no === 1 ? l : { ...l, set_aside: true }));
    const { sb, calls } = client(PROVES, [], aside);
    const plan = await getAddMissingPlan(sb, "rec-1");
    expect([plan.missing, plan.items, plan.held]).toEqual([0, [], []]);
    expect(calls.map((c) => c.fn)).not.toContain("acc_statement_line_duplicates");
  });

  it("asks once and changes nothing when the books hold nothing alike", async () => {
    const { sb, calls } = client(PROVES);
    const plan = await getAddMissingPlan(sb, "rec-1");
    expect(calls.filter((c) => c.fn === "acc_statement_line_duplicates")).toHaveLength(1);
    expect(plan.items.map((i) => i.lineNo)).toEqual([2, 3]);
    expect(plan.held).toEqual([]);
    expect(plan.uncategorized).toBe(1);
  });
});

describe("adding the lines", () => {
  const posted = (calls: { fn: string; args: Record<string, unknown> }[]) =>
    calls.find((c) => c.fn === "acc_add_statement_lines_to_books")?.args.p_items;

  it("posts Add all's lines as shown, and counts those that went to Uncategorized", async () => {
    const { sb, calls } = client(PROVES);
    const added = await addMissingLines(sb, "rec-1", [
      { lineNo: 2, accountId: UNCAT_OUT },
      { lineNo: 3, accountId: CHARGES },
    ]);
    expect(posted(calls)).toEqual([
      { line_no: 2, bank_transaction_id: "t-shop", account_id: UNCAT_OUT },
      { line_no: 3, bank_transaction_id: "t-fee", account_id: CHARGES },
    ]);
    expect([added.added, added.uncategorized, added.pairingError]).toEqual([2, 1, null]);
  });

  it("posts a held-back line only when it was chosen with Add anyway", async () => {
    const duplicate = [{ line_no: 2, journal_line_id: "jl-old", entry_id: "e-old", entry_number: "JE-000310", entry_date: "2026-09-10" }];
    const refused = client(PROVES, duplicate);
    await expect(addMissingLines(refused.sb, "rec-1", [{ lineNo: 2, accountId: UNCAT_OUT }])).rejects.toThrow(PLAN_CHANGED);
    expect(posted(refused.calls)).toBeUndefined();

    const anyway = client(PROVES, duplicate);
    const added = await addMissingLines(anyway.sb, "rec-1", [{ lineNo: 2, accountId: UNCAT_OUT }], [2]);
    expect(posted(anyway.calls)).toEqual([{ line_no: 2, bank_transaction_id: "t-shop", account_id: UNCAT_OUT }]);
    expect([added.added, added.uncategorized]).toEqual([1, 1]);
  });

  it("posts an extra line with Add anyway", async () => {
    const { sb, calls } = client(BALANCES_WITHOUT);
    await addMissingLines(sb, "rec-1", [{ lineNo: 3, accountId: CHARGES }], [3]);
    expect(posted(calls)).toEqual([{ line_no: 3, bank_transaction_id: "t-fee", account_id: CHARGES }]);
  });

  it("refuses, posting nothing, a line to another account than shown or one the plan no longer holds", async () => {
    for (const shown of [[{ lineNo: 3, accountId: UNCAT_OUT }], [{ lineNo: 1, accountId: UNCAT_IN }]]) {
      const { sb, calls } = client(PROVES);
      const attempt = addMissingLines(sb, "rec-1", shown, [1]);
      await expect(attempt).rejects.toThrow(AddMissingError);
      await expect(addMissingLines(sb, "rec-1", shown, [1])).rejects.toThrow(PLAN_CHANGED);
      expect(posted(calls)).toBeUndefined();
    }
  });
});
