import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  StatementBankLinesError,
  bankLinesBetween,
  matchAfterCompletion,
  matchCountsOf,
  matchReconciledBankLines,
} from "@/lib/services/statement-bank-lines";

/**
 * A stand-in for PostgREST: tables and table-returning RPCs page at a row cap
 * as PostgREST does; an RPC given as a function returns a single value and
 * records what it was called with.
 */
type Rows = Record<string, unknown>[];
type Scalar = (args: Record<string, unknown>) => { data: unknown; error: { message: string } | null };

function fakeClient(tables: Record<string, Rows>, rpcs: Record<string, Rows | Scalar>, cap = 1000) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const orders: Record<string, string[]> = {};
  function builder(target: string, rows: Rows) {
    orders[target] = [];
    const page = (from: number, to: number) => ({ data: rows.slice(from, from + Math.min(to - from + 1, cap)), error: null });
    const chain: Record<string, unknown> = {};
    for (const name of ["select", "eq", "is", "gte", "lte"]) chain[name] = () => chain;
    chain.order = (column: string) => {
      orders[target].push(column);
      return chain;
    };
    chain.range = (from: number, to: number) => Promise.resolve(page(from, to));
    chain.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null });
    return chain;
  }
  const sb = {
    from: (table: string) => builder(table, tables[table] ?? []),
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      const answer = rpcs[fn];
      if (typeof answer === "function") return Promise.resolve(answer(args));
      return builder(`rpc:${fn}`, answer ?? []);
    },
  } as unknown as SupabaseClient;
  return { sb, calls, orders };
}

const bankRow = (id: string, txnDate: string, amount: number, description: string, matches: Rows = [], status = "unmatched") => ({
  id,
  txn_date: txnDate,
  description,
  reference: null,
  amount_minor: amount,
  status,
  matches,
});

describe("a bank account's lines between two days", () => {
  it("reads every line past the row cap, oldest first, with the book line its approved match is to", async () => {
    const rows = Array.from({ length: 2300 }, (_, i) => bankRow(`t-${i}`, "2026-09-01", 100 + i, `Line ${i}`));
    rows[0] = bankRow("t-0", "2026-09-01", 100, "Line 0", [
      { journal_line_id: "jl-rejected", status: "rejected" },
      { journal_line_id: "jl-approved", status: "approved" },
    ], "matched");
    rows[1] = bankRow("t-1", "2026-09-01", 101, "Line 1", [{ journal_line_id: "jl-suggested", status: "suggested" }]);
    const { sb, orders } = fakeClient({ acc_bank_transaction: rows }, {});
    const lines = await bankLinesBetween(sb, "bank-1", "2026-09-01", "2026-09-30");
    expect(lines).toHaveLength(2300);
    expect(orders.acc_bank_transaction).toEqual(["txn_date", "id"]);
    expect(lines[0]).toEqual({
      id: "t-0",
      txnDate: "2026-09-01",
      description: "Line 0",
      reference: null,
      amountMinor: 100,
      status: "matched",
      approvedLineId: "jl-approved",
    });
    expect(lines[1].approvedLineId).toBeNull();
  });
});

describe("matching a completed reconciliation's bank lines", () => {
  const session = {
    bank_account_id: "bank-1",
    statement_ending_date: "2026-09-30",
    status: "completed",
    statement_ref: "september.csv",
    statement_opening_minor: 0,
    statement_closing_minor: null,
    note: null,
    brought_forward: false,
    statement_file_id: null,
    statement_file: null,
  };
  const statementLine = (lineNo: number, date: string, amount: number, description: string) => ({
    line_no: lineNo,
    txn_date: date,
    description,
    reference: null,
    amount_minor: amount,
    balance_minor: null,
  });
  const bookLine = (id: string, date: string, signed: number, cleared: boolean) => ({
    journal_line_id: id,
    entry_id: `e-${id}`,
    entry_number: `JE-${id}`,
    entry_date: date,
    source_type: "manual",
    memo: null,
    signed_minor: signed,
    cleared,
    reference: null,
  });
  const tables = {
    acc_statement_reconciliation: [session],
    acc_reconciliation_statement_line: [
      statementLine(1, "2026-09-03", 50000, "DEPOSIT EXAMPLE"),
      statementLine(2, "2026-09-10", -500, "SERVICE FEE"),
      statementLine(3, "2026-09-12", -1200, "POS EXAMPLE SHOP"),
    ],
    acc_bank_transaction: [
      bankRow("t-dep", "2026-09-03", 50000, "DEPOSIT EXAMPLE"),
      bankRow("t-fee", "2026-09-10", -500, "SERVICE FEE"),
      bankRow("t-shop", "2026-09-12", -1200, "POS EXAMPLE SHOP"),
    ],
  };
  // The deposit is paired and ticked; the fee is paired but not ticked; the shop is not in the books.
  const book = [bookLine("jl-dep", "2026-09-03", 50000, true), bookLine("jl-fee", "2026-09-10", -500, false)];

  it("hands the paired, ticked lines to the database and says what it did", async () => {
    const { sb, calls } = fakeClient(tables, {
      acc_reconciliation_lines: book,
      acc_match_reconciled_bank_lines: () => ({ data: { matched: 1, already: 0, elsewhere: 0, ignored: 0, differs: 0 }, error: null }),
    });
    expect(await matchReconciledBankLines(sb, "rec-1")).toEqual({ matched: 1, already: 0, elsewhere: 0, ignored: 0, differs: 0 });
    expect(calls.find((c) => c.fn === "acc_match_reconciled_bank_lines")?.args).toEqual({
      p_reconciliation_id: "rec-1",
      p_pairs: [{ bank_transaction_id: "t-dep", journal_line_id: "jl-dep" }],
    });
  });

  it("asks nothing of the database when no line is paired and ticked", async () => {
    const { sb, calls } = fakeClient(tables, { acc_reconciliation_lines: [bookLine("jl-fee", "2026-09-10", -500, false)] });
    expect(await matchReconciledBankLines(sb, "rec-1")).toEqual({ matched: 0, already: 0, elsewhere: 0, ignored: 0, differs: 0 });
    expect(calls.map((c) => c.fn)).not.toContain("acc_match_reconciled_bank_lines");
  });

  it("says why when the database refuses", async () => {
    const { sb } = fakeClient(tables, {
      acc_reconciliation_lines: book,
      acc_match_reconciled_bank_lines: () => ({ data: null, error: { message: "Not authorized to match bank lines" } }),
    });
    await expect(matchReconciledBankLines(sb, "rec-1")).rejects.toThrow(StatementBankLinesError);
    await expect(matchReconciledBankLines(sb, "rec-1")).rejects.toThrow("Not authorized to match bank lines");
  });

  it("after completion, returns a failure to be said rather than throwing it", async () => {
    const { sb } = fakeClient(tables, {
      acc_reconciliation_lines: book,
      acc_match_reconciled_bank_lines: () => ({ data: null, error: { message: "connection lost" } }),
    });
    expect(await matchAfterCompletion(sb, "rec-1")).toEqual({ matched: null, matchError: "connection lost" });
    const ok = fakeClient(tables, {
      acc_reconciliation_lines: book,
      acc_match_reconciled_bank_lines: () => ({ data: { matched: 1, already: 0, elsewhere: 0, ignored: 0, differs: 0 }, error: null }),
    });
    expect(await matchAfterCompletion(ok.sb, "rec-1")).toEqual({
      matched: { matched: 1, already: 0, elsewhere: 0, ignored: 0, differs: 0 },
      matchError: null,
    });
  });

  it("reads the database's answer as counts", () => {
    expect(matchCountsOf({ matched: 2, already: "3", elsewhere: 1, ignored: 0, differs: 4 })).toEqual({
      matched: 2,
      already: 3,
      elsewhere: 1,
      ignored: 0,
      differs: 4,
    });
    expect(matchCountsOf(null)).toEqual({ matched: 0, already: 0, elsewhere: 0, ignored: 0, differs: 0 });
  });
});
