import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  generateSuggestions,
  listBankTransactionPostings,
  listBankTransactions,
  listSuggestions,
} from "@/lib/services/banking";
import { getReconciliationLines } from "@/lib/services/bankrec";
import { getBankingFacts } from "@/lib/services/banking-surface/facts";

/**
 * A stand-in for PostgREST's row cap, for tables and RPCs alike.
 *
 * PostgREST returns at most a thousand rows from "a view, table, or stored
 * procedure" and says nothing when it truncates. A read that never asks for a
 * range gets the first thousand and stops; `.range()` pages through the rest.
 * Filters are not modelled — each test hands over rows already filtered — but
 * every `.order()` is recorded, because paging is only correct when the order
 * is total.
 */
type Rows = Record<string, unknown>[];
interface Read {
  target: string;
  orders: string[];
  pages: number;
  args?: unknown;
}

function fakeClient(tables: Record<string, Rows>, rpcs: Record<string, Rows> = {}, cap = 1000) {
  const reads: Read[] = [];
  function builder(target: string, rows: Rows, args?: unknown) {
    const read: Read = { target, orders: [], pages: 0, args };
    reads.push(read);
    const page = (from: number, to: number) => {
      read.pages += 1;
      const width = Math.min(to - from + 1, cap);
      return { data: rows.slice(from, from + width), error: null };
    };
    const chain: Record<string, unknown> = {};
    for (const name of ["select", "eq", "is", "not", "lte", "gte", "gt", "in"]) chain[name] = () => chain;
    chain.order = (column: string, options?: { ascending?: boolean }) => {
      read.orders.push(options?.ascending === false ? `${column} desc` : column);
      return chain;
    };
    chain.range = (from: number, to: number) => Promise.resolve(page(from, to));
    chain.single = () => Promise.resolve({ data: rows[0] ?? null, error: null });
    chain.then = (resolve: (value: unknown) => unknown) => resolve(page(0, cap - 1));
    return chain;
  }
  const sb = {
    from: (table: string) => builder(table, tables[table] ?? []),
    rpc: (fn: string, args: unknown) => builder(`rpc:${fn}`, rpcs[fn] ?? [], args),
  } as unknown as SupabaseClient;
  const readOf = (target: string) => reads.find((r) => r.target === target);
  return { sb, reads, readOf };
}

const many = (n: number, make: (i: number) => Record<string, unknown>) => Array.from({ length: n }, (_, i) => make(i));
const bankLine = (i: number) => ({
  id: `txn-${String(i).padStart(5, "0")}`,
  bank_account_id: "bank-1",
  txn_date: "2026-01-01",
  description: `Line ${i}`,
  reference: null,
  amount_minor: 100 + i,
  status: "matched",
  pending: false,
  provider_removed_at: null,
  acc_bank_category: null,
});

describe("Bank Transactions reads past the row cap", () => {
  it("lists every bank line, newest first, with the id breaking ties", async () => {
    // The number that made this real: a company with 2,755 bank lines, of
    // which the all-accounts view showed 1,000 and called that the total.
    const { sb, readOf } = fakeClient({ acc_bank_transaction: many(2755, bankLine) });
    const rows = await listBankTransactions(sb, null);
    expect(rows).toHaveLength(2755);
    expect(readOf("acc_bank_transaction")!.orders).toEqual(["txn_date desc", "id"]);
  });

  it("reads every posting, in an order that leaves only identical rows tied", async () => {
    // One deposit of 64 items is 64 rows here, so a few hundred lines pass the
    // cap. Lines past it showed "Matched elsewhere" instead of their account.
    const rows = many(3400, (i) => ({ bank_transaction_id: `txn-${Math.floor(i / 4)}`, account_id: "acct", journal_entry_id: "je" }));
    const { sb, readOf } = fakeClient({}, { acc_bank_transaction_postings: rows });
    const postings = await listBankTransactionPostings(sb, null);
    expect(postings).toHaveLength(3400);
    expect(readOf("rpc:acc_bank_transaction_postings")!.orders).toEqual([
      "bank_transaction_id",
      "account_id",
      "journal_entry_id",
    ]);
  });

  it("reads every match suggestion, most confident first, with the id breaking ties", async () => {
    const rows = many(1200, (i) => ({
      id: `rec-${i}`,
      confidence: 0.8,
      status: "suggested",
      bank_transaction_id: `txn-${i}`,
      acc_bank_transaction: { txn_date: "2026-01-01", description: "x", amount_minor: 1 },
    }));
    const { sb, readOf } = fakeClient({ acc_reconciliation: rows });
    const suggestions = await listSuggestions(sb, null);
    expect(suggestions).toHaveLength(1200);
    expect(readOf("acc_reconciliation")!.orders).toEqual(["confidence desc", "id"]);
  });
});

describe("Find ledger matches reads past the row cap", () => {
  it("never offers a ledger line that a bank line already holds, however far down the list it is", async () => {
    // 2,755 approved matches, and the ledger line this bank line would match is
    // the 1,500th of them. Read without paging, it looked free and was offered.
    const approved = many(2755, (i) => ({ journal_line_id: i === 1500 ? "line-taken" : `line-${i}` }));
    const { sb, readOf } = fakeClient({
      acc_bank_account: [{ account_id: "gl-bank" }],
      acc_bank_transaction: [{ id: "txn-new", txn_date: "2026-03-10", amount_minor: 50000, description: "Deposit", reference: null }],
      acc_reconciliation: approved,
      acc_journal_line: [
        {
          id: "line-taken",
          journal_entry_id: "je-1",
          debit_minor: 50000,
          credit_minor: 0,
          memo: null,
          acc_journal_entry: { id: "je-1", entry_number: "JE-1", entry_date: "2026-03-10", description: "Deposit", source_type: "manual", source_id: null, source_ref: null, status: "posted" },
        },
      ],
    });
    const count = await generateSuggestions(sb, "bank-1");
    expect(count).toBe(0);
    expect(readOf("rpc:acc_upsert_bank_match_suggestions")).toBeUndefined();
    expect(readOf("acc_reconciliation")!.orders).toEqual(["journal_line_id"]);
    expect(readOf("acc_bank_transaction")!.orders).toEqual(["id"]);
    expect(readOf("acc_journal_line")!.orders).toEqual(["id"]);
  });
});

describe("Banking overview and Reconcile read past the row cap", () => {
  it("counts every bank line up to the date, including the newest", async () => {
    // Ordered oldest first, an unpaged read dropped exactly the lines a reader
    // opens the overview to see: the most recent ones.
    const { sb, readOf } = fakeClient({ acc_bank_transaction: many(2755, bankLine) });
    const facts = await getBankingFacts(sb, { asOf: "2026-09-29" } as Parameters<typeof getBankingFacts>[1]);
    expect(JSON.stringify(facts)).toContain("txn-02754");
    expect(readOf("acc_bank_transaction")!.orders).toEqual(["txn_date", "id"]);
  });

  it("lists every ledger line a reconciliation can tick, in entry order with the line id breaking ties", async () => {
    const lines = many(1450, (i) => ({ journal_line_id: `line-${i}`, entry_id: `je-${i}`, entry_number: `JE-${i}`, entry_date: "2026-01-01", debit_minor: 1, credit_minor: 0, cleared: false }));
    const { sb, readOf } = fakeClient({}, { acc_reconciliation_lines: lines });
    const found = await getReconciliationLines(sb, "rec-1");
    expect(found).toHaveLength(1450);
    expect(readOf("rpc:acc_reconciliation_lines")!.orders).toEqual(["entry_date", "entry_number", "journal_line_id"]);
  });
});
