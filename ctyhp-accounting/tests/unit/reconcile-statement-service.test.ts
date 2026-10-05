import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getBroughtForwardPreview,
  getReconciliationStatement,
  pairAndTick,
  setReconciliationStatement,
} from "@/lib/services/bankrec";

/**
 * A stand-in for PostgREST: tables and table-returning RPCs page at a row cap
 * as PostgREST does; an RPC given as a function returns a single value and
 * records what it was called with.
 */
type Rows = Record<string, unknown>[];
type Scalar = (args: Record<string, unknown>) => unknown;

function fakeClient(tables: Record<string, Rows>, rpcs: Record<string, Rows | Scalar>, cap = 1000) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const orders: Record<string, string[]> = {};
  function builder(target: string, rows: Rows) {
    orders[target] = [];
    const page = (from: number, to: number) => ({ data: rows.slice(from, from + Math.min(to - from + 1, cap)), error: null });
    const chain: Record<string, unknown> = {};
    for (const name of ["select", "eq"]) chain[name] = () => chain;
    chain.order = (column: string) => {
      orders[target].push(column);
      return chain;
    };
    chain.range = (from: number, to: number) => Promise.resolve(page(from, to));
    chain.single = () => Promise.resolve({ data: rows[0] ?? null, error: null });
    chain.then = (resolve: (value: unknown) => unknown) => resolve(page(0, cap - 1));
    return chain;
  }
  const sb = {
    from: (table: string) => builder(table, tables[table] ?? []),
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      const answer = rpcs[fn];
      if (typeof answer === "function") return Promise.resolve({ data: answer(args), error: null });
      return builder(`rpc:${fn}`, answer ?? []);
    },
  } as unknown as SupabaseClient;
  return { sb, calls, orders };
}

const session = {
  bank_account_id: "bank-1",
  statement_ending_date: "2026-09-30",
  status: "in_progress",
  statement_ref: "september.pdf",
  statement_opening_minor: 75000,
  statement_closing_minor: null,
  note: null,
  brought_forward: false,
};
const bookLine = (id: string, date: string, signed: number, cleared: boolean, reference: string | null = null) => ({
  journal_line_id: id,
  entry_id: `e-${id}`,
  entry_number: `JE-${id}`,
  entry_date: date,
  source_type: "manual",
  memo: null,
  signed_minor: signed,
  cleared,
  reference,
});

describe("a reconciliation's kept statement", () => {
  it("reads every line past the row cap, in line order, with its balances as printed", async () => {
    const lines = Array.from({ length: 2400 }, (_, i) => ({
      line_no: i,
      txn_date: "2026-09-01",
      description: `Line ${i}`,
      reference: null,
      amount_minor: 100 + i,
      balance_minor: null,
    }));
    const { sb, orders } = fakeClient({ acc_statement_reconciliation: [session], acc_reconciliation_statement_line: lines }, {});
    const statement = await getReconciliationStatement(sb, "rec-1");
    expect(statement.lines).toHaveLength(2400);
    expect(orders.acc_reconciliation_statement_line).toEqual(["line_no"]);
    expect(statement).toMatchObject({
      bankAccountId: "bank-1",
      endingDate: "2026-09-30",
      fileName: "september.pdf",
      openingMinor: 75000,
      closingMinor: null,
      broughtForward: false,
    });
    expect(statement.lines[5]).toEqual({
      lineNo: 5, txnDate: "2026-09-01", description: "Line 5", reference: null, amountMinor: 105, balanceMinor: null,
    });
  });

  it("sends the lines as the database keeps them, leaving out a line of no amount", async () => {
    const { sb, calls } = fakeClient({}, { acc_set_reconciliation_statement: () => 1 });
    await setReconciliationStatement(sb, "rec-1", {
      fileName: "september.csv",
      openingMinor: null,
      closingMinor: null,
      lines: [
        { txn_date: "2026-09-05", description: "FEE", reference: null, amount_minor: -500, running_balance_minor: 74500, raw_line: "x" },
        { txn_date: "2026-09-06", description: "NOTHING", reference: null, amount_minor: 0, running_balance_minor: 74500, raw_line: "y" },
      ],
    });
    expect(calls[0].args.p_lines).toEqual([
      { txn_date: "2026-09-05", description: "FEE", reference: null, amount_minor: -500, balance_minor: 74500 },
    ]);
  });

  it("reads what bringing an account forward would sign off", async () => {
    const { sb } = fakeClient({}, {
      acc_brought_forward_preview: [{ has_reconciliations: false, book_balance_minor: "75000", open_lines: 2 }],
    });
    expect(await getBroughtForwardPreview(sb, "bank-1", "2026-08-31")).toEqual({
      hasReconciliations: false,
      bookBalanceMinor: 75000,
      openLines: 2,
    });
  });
});

describe("pairAndTick", () => {
  const statementLines = [
    { line_no: 0, txn_date: "2026-09-05", description: "DEPOSIT", reference: null, amount_minor: 50000, balance_minor: null },
    { line_no: 1, txn_date: "2026-09-28", description: "Check 1201", reference: "1201", amount_minor: -12000, balance_minor: null },
    { line_no: 2, txn_date: "2026-09-25", description: "SERVICE FEE", reference: null, amount_minor: -500, balance_minor: null },
  ];

  it("ticks, in one call, every pair not ticked yet — and counts what is missing", async () => {
    const { sb, calls } = fakeClient(
      { acc_statement_reconciliation: [session], acc_reconciliation_statement_line: statementLines },
      {
        acc_reconciliation_lines: [
          bookLine("a", "2026-09-05", 50000, true),
          bookLine("b", "2026-09-12", -12000, false, "1201"),
          bookLine("c", "2026-09-20", 9900, false),
        ],
        acc_set_cleared_many: (args) => (args.p_journal_line_ids as string[]).length,
      },
    );
    const outcome = await pairAndTick(sb, "rec-1");
    const ticking = calls.filter((c) => c.fn === "acc_set_cleared_many");
    expect(ticking).toHaveLength(1);
    expect(ticking[0].args).toEqual({ p_reconciliation_id: "rec-1", p_journal_line_ids: ["b"], p_cleared: true });
    expect(outcome).toEqual({ lines: 3, paired: 2, ticked: 1, missing: 1, after: 0, flipped: false });
  });

  it("makes no call when every pair is ticked already", async () => {
    const { sb, calls } = fakeClient(
      { acc_statement_reconciliation: [session], acc_reconciliation_statement_line: statementLines.slice(0, 1) },
      { acc_reconciliation_lines: [bookLine("a", "2026-09-05", 50000, true)], acc_set_cleared_many: () => 0 },
    );
    expect((await pairAndTick(sb, "rec-1")).ticked).toBe(0);
    expect(calls.some((c) => c.fn === "acc_set_cleared_many")).toBe(false);
  });
});
