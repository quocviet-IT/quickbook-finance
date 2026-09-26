import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readBeancountInput, readBeancountSummary } from "@/lib/services/beancount";

type Row = Record<string, unknown>;
type Filter = [string, string, unknown];

interface Table {
  rows: Row[];
  /** Fail this request number (1-based) with an error, to prove all-or-nothing. */
  failOnPage?: number;
}

/**
 * A stub of the supabase-js builder. `.range(from, to)` returns that slice and
 * no more, the way PostgREST does; `.limit()` and a `head` count are answered
 * from the same rows, filtered by the `.eq()` calls made.
 */
function fakeClient(tables: Record<string, Table>, rpcRows: Row[] = []) {
  const calls: Array<{ table: string; filters: Filter[] }> = [];
  // Pages are counted per table across the whole run, so `failOnPage: 2` fails
  // the second page that table is asked for, whichever query asks.
  const pagesServed = new Map<string, number>();

  function builder(table: string) {
    const filters: Filter[] = [];
    let head = false;
    let limitTo: number | null = null;
    const matching = () =>
      (tables[table]?.rows ?? []).filter((r) => filters.every(([op, col, v]) => (op === "eq" ? r[col] === v : true)));
    const b: Record<string, unknown> = {
      select: (_cols: string, opts?: { head?: boolean }) => {
        head = Boolean(opts?.head);
        return b;
      },
      eq: (col: string, v: unknown) => {
        filters.push(["eq", col, v]);
        return b;
      },
      not: (col: string, _op: string, v: unknown) => {
        filters.push(["not", col, v]);
        return b;
      },
      order: () => b,
      limit: (n: number) => {
        limitTo = n;
        return b;
      },
      range: async (from: number, to: number) => {
        const page = (pagesServed.get(table) ?? 0) + 1;
        pagesServed.set(table, page);
        calls.push({ table, filters: [...filters] });
        if (tables[table]?.failOnPage === page) return { data: null, error: { message: `${table} page ${page} failed` } };
        return { data: matching().slice(from, to + 1), error: null };
      },
      maybeSingle: async () => ({ data: matching()[0] ?? null, error: null }),
      // Awaiting the builder itself: a head count, or a plain (possibly limited) read.
      then: (resolve: (v: unknown) => void) => {
        if (head) return resolve({ count: matching().length, data: null, error: null });
        const rows = matching();
        return resolve({ data: limitTo === null ? rows : rows.slice(0, limitTo), error: null });
      },
    };
    return b;
  }

  const sb = {
    from: (table: string) => builder(table),
    rpc: () => ({
      range: async (from: number, to: number) => ({ data: rpcRows.slice(from, to + 1), error: null }),
    }),
  };
  return { sb: sb as unknown as SupabaseClient, calls };
}

const settings = {
  rows: [{ legal_name: "Riverbend Trading LLC", fiscal_year_start_month: 1, accounting_basis: "accrual" } as Row],
};
// Read straight from the table, so a non-USD currency is present here even
// though the app's own picker offers only USD.
const currencies = {
  rows: [
    { code: "EUR", decimal_places: 2, is_base: false },
    { code: "USD", decimal_places: 2, is_base: true },
  ],
};

function entryRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `e${i}`,
    entry_number: `JE-${String(i).padStart(6, "0")}`,
    entry_date: "2025-01-15",
    description: `Entry ${i}`,
    source_type: "manual",
    currency_code: "USD",
    status: "posted",
    acc_journal_line: [
      { account_id: "acc-sales", debit_minor: 0, credit_minor: 100, line_order: 2 },
      { account_id: "acc-bank", debit_minor: 100, credit_minor: 0, line_order: 1 },
    ],
  }));
}

const baseTables = (entries: Row[]): Record<string, Table> => ({
  acc_account: {
    rows: [
      { id: "acc-bank", account_code: "1010", name: "Operating Checking", account_type: "bank" },
      { id: "acc-sales", account_code: "4000", name: "Sales Revenue", account_type: "income" },
    ],
  },
  acc_journal_entry: { rows: entries },
  acc_invoice: { rows: [] },
  acc_bill: { rows: [] },
  acc_payment: { rows: [] },
  acc_bill_payment: { rows: [] },
  acc_payment_allocation: { rows: [] },
  acc_bill_payment_allocation: { rows: [] },
  acc_exchange_rate: { rows: [] },
  acc_currency: currencies,
  acc_company_setting_version: { rows: settings.rows.map((r) => ({ ...r })) },
});

describe("readBeancountInput", () => {
  it("reads a book of more than a thousand entries whole, in order", async () => {
    const { sb } = fakeClient(baseTables(entryRows(2345)));
    const input = await readBeancountInput(sb, "2026-09-26T08:00:00.000Z");
    expect(input.entries).toHaveLength(2345);
    expect(input.entries[1000].entryNumber).toBe("JE-001000");
  });

  it("reads posted entries only", async () => {
    const { sb, calls } = fakeClient(baseTables(entryRows(3)));
    await readBeancountInput(sb, "2026-09-26T08:00:00.000Z");
    const entryCalls = calls.filter((c) => c.table === "acc_journal_entry");
    expect(entryCalls.length).toBeGreaterThan(0);
    for (const c of entryCalls) expect(c.filters).toContainEqual(["eq", "status", "posted"]);
  });

  it("puts each entry's lines in their recorded order", async () => {
    const { sb } = fakeClient(baseTables(entryRows(1)));
    const input = await readBeancountInput(sb, "2026-09-26T08:00:00.000Z");
    expect(input.entries[0].lines.map((l) => l.accountId)).toEqual(["acc-bank", "acc-sales"]);
  });

  it("fails as a whole when any page of any read fails", async () => {
    const tables = baseTables(entryRows(2345));
    tables.acc_journal_entry.failOnPage = 2;
    const { sb } = fakeClient(tables);
    await expect(readBeancountInput(sb, "2026-09-26T08:00:00.000Z")).rejects.toThrow(/acc_journal_entry/);
  });

  it("never reads the TIN", async () => {
    const tables = baseTables(entryRows(1));
    tables.acc_company_setting_version.rows[0].ein_ref = "00-0000000";
    const { sb } = fakeClient(tables);
    const input = await readBeancountInput(sb, "2026-09-26T08:00:00.000Z");
    expect(JSON.stringify(input.company)).not.toContain("00-0000000");
  });

  it("reads every currency record, not only the ones the app offers today", async () => {
    // listCurrencies returns USD only. An entry left in another currency must
    // still format, or the whole export fails.
    const { sb } = fakeClient(baseTables(entryRows(1)));
    const input = await readBeancountInput(sb, "2026-09-26T08:00:00.000Z");
    expect(input.currencies.map((c) => c.code)).toEqual(["EUR", "USD"]);
  });

  it("takes each entry's counterparty from the transaction list", async () => {
    const { sb } = fakeClient(baseTables(entryRows(2)), [
      { entry_id: "e1", party_name: "Harbor Cafe", entry_date: "2025-01-15", amount_minor: 0, account_ids: [] },
    ]);
    const input = await readBeancountInput(sb, "2026-09-26T08:00:00.000Z");
    expect(input.partyByEntryId.get("e1")).toBe("Harbor Cafe");
    expect(input.partyByEntryId.has("e0")).toBe(false);
  });
});

describe("readBeancountSummary", () => {
  it("counts entries and accounts and names the currencies in use", async () => {
    const { sb } = fakeClient(baseTables(entryRows(4)));
    const summary = await readBeancountSummary(sb);
    expect(summary.entryCount).toBe(4);
    expect(summary.accountCount).toBe(2);
    expect(summary.currencies).toEqual(["USD"]);
  });
});
