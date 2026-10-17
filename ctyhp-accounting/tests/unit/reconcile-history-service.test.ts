import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// The kept statement file is tied through lib/services/statement-files, a server module.
vi.mock("server-only", () => ({}));

import { PAIRED_LINE_REFUSAL, SESSION_HISTORY_REFUSAL } from "@/lib/domain/reconcile-statement";
import { BankRecError } from "@/lib/services/bankrec";
import {
  bringHistoryForward,
  bringHistoryForwardFromSession,
  discardReconciliation,
  getHistoryPreview,
  getReconciliationHistory,
  getSessionHistoryAdvice,
  readReconciliationHistory,
  setStatementLineAside,
  statementLineDuplicates,
} from "@/lib/services/reconcile-history";

/**
 * A stand-in for PostgREST: tables and table-returning RPCs page at a row cap
 * as PostgREST does; an RPC given as a function answers once with what it
 * returns, and every call is recorded with its arguments.
 */
type Rows = Record<string, unknown>[];
type Scalar = (args: Record<string, unknown> | undefined) => { data: unknown; error: { message: string } | null };

function fakeClient(tables: Record<string, Rows>, rpcs: Record<string, Rows | Scalar>, cap = 1000) {
  const calls: { fn: string; args: Record<string, unknown> | undefined }[] = [];
  const orders: Record<string, string[]> = {};
  const ranges: Record<string, number> = {};
  function builder(target: string, rows: Rows) {
    orders[target] = [];
    const page = (from: number, to: number) => {
      ranges[target] = (ranges[target] ?? 0) + 1;
      return { data: rows.slice(from, from + Math.min(to - from + 1, cap)), error: null };
    };
    const chain: Record<string, unknown> = {};
    for (const name of ["select", "eq"]) chain[name] = () => chain;
    chain.order = (column: string) => {
      if (!orders[target].includes(column)) orders[target].push(column);
      return chain;
    };
    chain.range = (from: number, to: number) => Promise.resolve(page(from, to));
    chain.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null });
    chain.then = (resolve: (value: unknown) => unknown) => resolve(page(0, cap - 1));
    return chain;
  }
  const sb = {
    from: (table: string) => builder(table, tables[table] ?? []),
    rpc: (fn: string, args?: Record<string, unknown>) => {
      calls.push({ fn, args });
      const answer = rpcs[fn];
      if (typeof answer === "function") return Promise.resolve(answer(args));
      return builder(`rpc:${fn}`, answer ?? []);
    },
  } as unknown as SupabaseClient;
  return { sb, calls, orders, ranges };
}

const ok = (data: unknown) => () => ({ data, error: null });
const refused = (message: string) => () => ({ data: null, error: { message } });

const historyRow = (i: number, over: Record<string, unknown> = {}) => ({
  bank_account_id: `bank-${String(i).padStart(4, "0")}`,
  open_lines: i,
  first_open_date: "2025-01-02",
  last_open_date: "2026-09-28",
  last_reconciled_date: null,
  in_progress_id: null,
  in_progress_ending_date: null,
  ...over,
});

describe("reconciliation history", () => {
  it("reads every row past the row cap, in a total order", async () => {
    const rows = Array.from({ length: 2300 }, (_, i) => historyRow(i));
    rows[1] = historyRow(1, { in_progress_id: "rec-9", in_progress_ending_date: "2026-09-30", last_reconciled_date: "2026-07-31" });
    const { sb, orders, ranges } = fakeClient({}, { acc_reconciliation_history: rows });
    const history = await readReconciliationHistory(sb);
    expect(history).toHaveLength(2300);
    expect(ranges["rpc:acc_reconciliation_history"]).toBe(3);
    expect(orders["rpc:acc_reconciliation_history"]).toEqual(["bank_account_id"]);
    expect(history[0]).toEqual({
      bankAccountId: "bank-0000",
      openLines: 0,
      firstOpenDate: "2025-01-02",
      lastOpenDate: "2026-09-28",
      lastReconciledDate: null,
      inProgress: null,
    });
    expect(history[1]).toMatchObject({ lastReconciledDate: "2026-07-31", inProgress: { id: "rec-9", endingDate: "2026-09-30" } });
  });

  it("names and orders the rows as Banking lists the bank accounts", async () => {
    const { sb } = fakeClient(
      {
        acc_bank_account: [
          { id: "bank-0002", account_id: "gl-2", bank_name: "Example Bank", account_number_masked: "****2222", currency_code: "USD", created_at: "2026-01-01", acc_account: { account_code: "1020", name: "Operating" } },
          { id: "bank-0001", account_id: "gl-1", bank_name: "", account_number_masked: null, currency_code: "USD", created_at: "2026-02-01", acc_account: { account_code: "1010", name: "Example Savings" } },
        ],
      },
      { acc_reconciliation_history: [historyRow(1, { last_reconciled_date: "2026-08-31" }), historyRow(2)] },
    );
    const accounts = await getReconciliationHistory(sb);
    expect(accounts.map((a) => [a.bankAccountId, a.label, a.maskedNumber, a.state, a.openLines])).toEqual([
      ["bank-0002", "Example Bank · 1020", "****2222", "never", 2],
      ["bank-0001", "Example Savings · 1010", null, "reconciled", 1],
    ]);
  });

  it("previews the books through a day", async () => {
    const { sb, calls } = fakeClient({}, { acc_brought_forward_preview: [{ has_reconciliations: false, book_balance_minor: "512340", open_lines: 214 }] });
    expect(await getHistoryPreview(sb, "bank-1", "2026-08-31")).toEqual({ bookBalanceMinor: 512340, entries: 214 });
    expect(calls[0].args).toEqual({ p_bank_account_id: "bank-1", p_through: "2026-08-31" });
  });
});

describe("bringing the history forward", () => {
  const answer = { reconciliation_id: "rec-bf", lines: 214, moved: 3, rebased_reconciliation_id: "rec-1" };

  it("sends the day, the balance and the note, and reads what was made", async () => {
    const { sb, calls } = fakeClient({}, { acc_bring_history_forward: ok(answer) });
    expect(await bringHistoryForward(sb, "bank-1", "2026-08-31", 512340, "A note")).toEqual({
      reconciliationId: "rec-bf",
      lines: 214,
      moved: 3,
      rebasedReconciliationId: "rec-1",
    });
    expect(calls[0]).toEqual({
      fn: "acc_bring_history_forward",
      args: { p_bank_account_id: "bank-1", p_through: "2026-08-31", p_balance_minor: 512340, p_note: "A note" },
    });
  });

  it("passes the database's refusal on as it is", async () => {
    const message = "The books hold 4,987.65 on 08/31/2026; the statement shows 5,123.40. Out by 135.75.";
    const { sb } = fakeClient({}, { acc_bring_history_forward: refused(message) });
    await expect(bringHistoryForward(sb, "bank-1", "2026-08-31", 512340, "A note")).rejects.toThrow(new BankRecError(message));
  });

  // A reconciliation in progress, begun at 0, against a kept statement for September that opens at $5,123.40.
  const session = (file: Record<string, unknown> | null, over: Record<string, unknown> = {}) => ({
    bank_account_id: "bank-1",
    statement_ending_date: "2026-09-30",
    status: "in_progress",
    statement_ref: "september.pdf",
    statement_opening_minor: 512340,
    statement_closing_minor: 530000,
    note: null,
    brought_forward: false,
    statement_file_id: file ? "file-1" : null,
    statement_file: file,
    ...over,
  });
  const keptFile = { id: "file-1", file_name: "september.pdf", uploaded_at: "2026-10-02T10:00:00Z", sha256: "ab", period_start: "2026-09-01", period_end: "2026-09-30" };
  const detail = (beginning: number) => [
    { beginning_minor: beginning, statement_ending_minor: 530000, cleared_total_minor: 0, reconciled_balance_minor: beginning, difference_minor: 530000 - beginning, status: "in_progress" },
  ];

  it("from a reconciliation, takes the day and the balance from the stored statement, never from the screen", async () => {
    const { sb, calls } = fakeClient(
      { acc_statement_reconciliation: [session(keptFile)] },
      {
        acc_reconciliation_detail: detail(0),
        acc_bring_history_forward: ok(answer),
        acc_link_reconciliation_statement_file: ok(null),
      },
    );
    const result = await bringHistoryForwardFromSession(sb, "rec-1");
    expect(result).toEqual({ reconciliationId: "rec-bf", lines: 214, moved: 3, rebasedReconciliationId: "rec-1", fileWarning: null });
    expect(calls.find((c) => c.fn === "acc_bring_history_forward")?.args).toEqual({
      p_bank_account_id: "bank-1",
      p_through: "2026-08-31",
      p_balance_minor: 512340,
      p_note: "Brought forward, proved by the opening balance on the statement for 09/01/2026 – 09/30/2026",
    });
    // The statement's file is the new reconciliation's evidence too.
    expect(calls.find((c) => c.fn === "acc_link_reconciliation_statement_file")?.args).toEqual({
      p_reconciliation_id: "rec-bf",
      p_file_id: "file-1",
    });
  });

  it("says, rather than undoes, a file that could not be tied", async () => {
    const { sb } = fakeClient(
      { acc_statement_reconciliation: [session(keptFile)] },
      {
        acc_reconciliation_detail: detail(0),
        acc_bring_history_forward: ok(answer),
        acc_link_reconciliation_statement_file: refused("connection lost"),
      },
    );
    const result = await bringHistoryForwardFromSession(sb, "rec-1");
    expect(result.reconciliationId).toBe("rec-bf");
    expect(result.fileWarning).toContain("connection lost");
  });

  it("refuses, and asks the database nothing, when the file names no period or the session already begins at the opening", async () => {
    const cases = [
      [session({ ...keptFile, period_start: null }), detail(0), SESSION_HISTORY_REFUSAL.noStart],
      [session(null), detail(0), SESSION_HISTORY_REFUSAL.noStart],
      // A file is kept, but this person may not read saved files, so the embed comes back empty.
      [session(null, { statement_file_id: "file-1" }), detail(0), SESSION_HISTORY_REFUSAL.unreadFile],
      [session(keptFile, { statement_opening_minor: null }), detail(0), SESSION_HISTORY_REFUSAL.noStart],
      [session(keptFile), detail(512340), SESSION_HISTORY_REFUSAL.begins],
      [session(keptFile, { status: "completed" }), detail(0), SESSION_HISTORY_REFUSAL.notInProgress],
    ] as const;
    for (const [row, d, why] of cases) {
      const { sb, calls } = fakeClient(
        { acc_statement_reconciliation: [row] },
        { acc_reconciliation_detail: [...d], acc_bring_history_forward: ok(answer) },
      );
      await expect(bringHistoryForwardFromSession(sb, "rec-1")).rejects.toThrow(why);
      expect(calls.map((c) => c.fn)).not.toContain("acc_bring_history_forward");
    }
  });

  it("tells the workspace what its offer rests on, read on the server", async () => {
    const { sb, calls } = fakeClient(
      { acc_statement_reconciliation: [session(keptFile)] },
      {
        acc_reconciliation_detail: detail(0),
        acc_reconciliation_history: [historyRow(1, { bank_account_id: "bank-1" }), historyRow(2, { last_reconciled_date: "2026-08-31" })],
        acc_brought_forward_preview: [{ has_reconciliations: true, book_balance_minor: 498765, open_lines: 214 }],
      },
    );
    expect(await getSessionHistoryAdvice(sb, "rec-1")).toEqual({
      through: "2026-08-31",
      openingMinor: 512340,
      bookBalanceMinor: 498765,
      entries: 214,
      reconciled: false,
    });
    expect(calls.find((c) => c.fn === "acc_brought_forward_preview")?.args).toEqual({ p_bank_account_id: "bank-1", p_through: "2026-08-31" });
  });

  it("says the account was reconciled before when the history has a completed reconciliation", async () => {
    const { sb } = fakeClient(
      { acc_statement_reconciliation: [session(keptFile)] },
      {
        acc_reconciliation_detail: detail(0),
        acc_reconciliation_history: [historyRow(1, { bank_account_id: "bank-1", last_reconciled_date: "2026-08-31" })],
        acc_brought_forward_preview: [{ has_reconciliations: true, book_balance_minor: 512340, open_lines: 0 }],
      },
    );
    expect((await getSessionHistoryAdvice(sb, "rec-1"))?.reconciled).toBe(true);
  });

  it("offers nothing, and reads nothing more, for a session with no kept statement file", async () => {
    const { sb, calls } = fakeClient({ acc_statement_reconciliation: [session(null)] }, { acc_reconciliation_detail: detail(0) });
    expect(await getSessionHistoryAdvice(sb, "rec-1")).toBeNull();
    expect(calls.map((c) => c.fn)).toEqual(["acc_reconciliation_detail"]);
  });
});

describe("discarding a reconciliation", () => {
  it("sends the reason and says how many ticks went with it", async () => {
    const { sb, calls } = fakeClient({}, { acc_discard_reconciliation: ok(7) });
    expect(await discardReconciliation(sb, "rec-1", "Started on the wrong statement")).toBe(7);
    expect(calls[0].args).toEqual({ p_reconciliation_id: "rec-1", p_reason: "Started on the wrong statement" });
  });

  it("passes the database's refusal on as it is", async () => {
    const message = "This reconciliation posted an adjustment (JE-000999), so it cannot be discarded.";
    const { sb } = fakeClient({}, { acc_discard_reconciliation: refused(message) });
    await expect(discardReconciliation(sb, "rec-1", "Wrong")).rejects.toThrow(message);
  });
});

describe("setting a statement line aside", () => {
  const session = {
    bank_account_id: "bank-1",
    statement_ending_date: "2026-09-30",
    status: "in_progress",
    statement_ref: "september.pdf",
    statement_opening_minor: 100000,
    statement_closing_minor: 150000,
    note: null,
    brought_forward: false,
    statement_file_id: null,
    statement_file: null,
  };
  const statementLines = [
    { line_no: 0, txn_date: "2026-09-05", description: "EXAMPLE DEPOSIT", reference: null, amount_minor: 50000, balance_minor: null, set_aside: false },
    { line_no: 1, txn_date: "2026-09-08", description: "4101 4102", reference: "4101", amount_minor: -36000, balance_minor: null, set_aside: false },
  ];
  const book = [
    { journal_line_id: "jl-dep", entry_id: "e-dep", entry_number: "JE-000101", entry_date: "2026-09-05", source_type: "manual", memo: null, signed_minor: 50000, cleared: true, reference: null },
  ];
  const tables = { acc_statement_reconciliation: [session], acc_reconciliation_statement_line: statementLines };

  it("refuses a line paired with the books, without asking the database to set it aside", async () => {
    const { sb, calls } = fakeClient(tables, { acc_reconciliation_lines: book, acc_set_statement_line_aside: ok(null) });
    await expect(setStatementLineAside(sb, "rec-1", 0, true)).rejects.toThrow(PAIRED_LINE_REFUSAL);
    expect(calls.map((c) => c.fn)).not.toContain("acc_set_statement_line_aside");
  });

  it("sets aside a line the books do not have", async () => {
    const { sb, calls } = fakeClient(tables, { acc_reconciliation_lines: book, acc_set_statement_line_aside: ok(null) });
    await setStatementLineAside(sb, "rec-1", 1, true);
    expect(calls.find((c) => c.fn === "acc_set_statement_line_aside")?.args).toEqual({
      p_reconciliation_id: "rec-1",
      p_line_no: 1,
      p_aside: true,
    });
  });

  it("always brings a line back, without working out the pairing", async () => {
    const { sb, calls } = fakeClient(tables, { acc_reconciliation_lines: book, acc_set_statement_line_aside: ok(null) });
    await setStatementLineAside(sb, "rec-1", 0, false);
    expect(calls.map((c) => c.fn)).toEqual(["acc_set_statement_line_aside"]);
  });

  it("passes the database's refusal on as it is", async () => {
    const { sb } = fakeClient(tables, { acc_reconciliation_lines: book, acc_set_statement_line_aside: refused("Statement line not found") });
    await expect(setStatementLineAside(sb, "rec-1", 9, true)).rejects.toThrow("Statement line not found");
  });
});

describe("statementLineDuplicates", () => {
  const dup = (lineNo: number, id: string, entry: string, number: string | null = `JE-${entry}`) => ({
    line_no: lineNo,
    journal_line_id: id,
    entry_id: entry,
    entry_number: number,
    entry_date: "2026-09-08",
  });

  it("asks nothing, and finds nothing, when no line is given", async () => {
    const { sb, calls } = fakeClient({}, { acc_statement_line_duplicates: [dup(1, "jl-1", "e1")] });
    expect((await statementLineDuplicates(sb, "rec-1", [])).size).toBe(0);
    expect(calls).toEqual([]);
  });

  it("groups what the books hold by statement line, reading every page in a total order", async () => {
    const many = Array.from({ length: 2300 }, (_, i) => dup(2, `jl-${String(i).padStart(4, "0")}`, `e${i}`));
    const { sb, calls, orders } = fakeClient({}, { acc_statement_line_duplicates: [dup(1, "jl-a", "e-a", null), ...many] });
    const found = await statementLineDuplicates(sb, "rec-1", [2, 1, 2]);
    expect(calls[0].args).toEqual({ p_reconciliation_id: "rec-1", p_line_nos: [2, 1] });
    expect(orders["rpc:acc_statement_line_duplicates"]).toEqual(["line_no", "entry_date", "entry_number", "journal_line_id"]);
    expect(found.get(1)).toEqual([{ journalLineId: "jl-a", entryId: "e-a", entryNumber: null, entryDate: "2026-09-08" }]);
    expect(found.get(2)).toHaveLength(2300);
  });
});
