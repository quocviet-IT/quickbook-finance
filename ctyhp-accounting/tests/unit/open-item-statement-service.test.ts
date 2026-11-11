import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

import { OpenItemStatementError, readOpenItemStatement } from "@/lib/services/open-item-statement";

type Pair = [string, unknown];
type Row = Record<string, unknown>;

function fakeClient(
  tables: Record<string, Row[]>,
  rpcResult: { data?: Row[]; error?: { message: string } | null } = {},
) {
  const calls: { table: string; select: string; eq: Pair[]; in: Pair[] }[] = [];
  const rpcCalls: { name: string; args: unknown; eq: Pair[]; order: string[]; range: [number, number][] }[] = [];

  const from = vi.fn((table: string) => {
    const call = { table, select: "", eq: [] as Pair[], in: [] as Pair[] };
    calls.push(call);
    const builder: Record<string, unknown> = {};
    builder.select = (columns: string) => {
      call.select = columns;
      return builder;
    };
    builder.eq = (column: string, value: unknown) => {
      call.eq.push([column, value]);
      return builder;
    };
    builder.in = (column: string, values: unknown[]) => {
      call.in.push([column, values]);
      return builder;
    };
    builder.maybeSingle = async () => ({ data: (tables[table] ?? [])[0] ?? null, error: null });
    builder.then = (resolve: (v: unknown) => unknown) => {
      let rows = tables[table] ?? [];
      for (const [column, values] of call.in) rows = rows.filter((r) => (values as unknown[]).includes(r[column]));
      return resolve({ data: rows, error: null });
    };
    return builder;
  });

  const rpc = vi.fn((name: string, args: unknown) => {
    const call = { name, args, eq: [] as Pair[], order: [] as string[], range: [] as [number, number][] };
    rpcCalls.push(call);
    const builder: Record<string, unknown> = {};
    builder.eq = (column: string, value: unknown) => {
      call.eq.push([column, value]);
      return builder;
    };
    builder.order = (column: string) => {
      call.order.push(column);
      return builder;
    };
    builder.range = (a: number, b: number) => {
      call.range.push([a, b]);
      return builder;
    };
    builder.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: rpcResult.data ?? [], error: rpcResult.error ?? null });
    return builder;
  });

  const sb = { from, rpc } as unknown as SupabaseClient;
  return Object.assign(sb, { calls, rpcCalls });
}

const customer = { id: "c1", name: "BlueRidge Foods" };

const ageingRows: Row[] = [
  { customer_id: "c1", doc_type: "invoice", doc_number: "INV-000004", doc_date: "2026-10-01", due_date: "2026-10-31", balance_minor: 1000000 },
  { customer_id: "c1", doc_type: "credit_memo", doc_number: "CM-000002", doc_date: "2026-10-05", due_date: "2026-10-05", balance_minor: -50000 },
  { customer_id: "c1", doc_type: "payment", doc_number: "PMT-000009", doc_date: "2026-10-07", due_date: "2026-10-07", balance_minor: -120000 },
];

const detailTables = (): Record<string, Row[]> => ({
  acc_customer: [customer],
  acc_invoice: [
    { invoice_number: "INV-000004", total_minor: 2680000, balance_due_minor: 1000000, currency_code: "USD", memo: "Spring order" },
  ],
  acc_credit_memo: [
    { credit_memo_number: "CM-000002", total_minor: 50000, balance_remaining_minor: 50000, currency_code: "USD", memo: null, reason: "Damaged stock" },
  ],
  acc_payment: [
    { payment_number: "PMT-000009", amount_minor: 500000, unapplied_minor: 120000, currency_code: "USD", reference: "RCV-1010" },
  ],
});

describe("readOpenItemStatement", () => {
  it("returns null for an unknown customer without calling the RPC", async () => {
    const sb = fakeClient({ acc_customer: [] });
    await expect(readOpenItemStatement(sb, "missing", "2026-11-10")).resolves.toBeNull();
    expect(sb.rpc).not.toHaveBeenCalled();
  });

  it("reads acc_ar_ageing for this customer, ordered totally, a page at a time", async () => {
    const sb = fakeClient(detailTables(), { data: ageingRows });
    await readOpenItemStatement(sb, "c1", "2026-11-10");
    expect(sb.rpcCalls).toHaveLength(1);
    const call = sb.rpcCalls[0];
    expect(call.name).toBe("acc_ar_ageing");
    expect(call.args).toEqual({ p_as_of: "2026-11-10" });
    expect(call.eq).toEqual([["customer_id", "c1"]]);
    expect(call.order).toEqual(["doc_date", "doc_number", "doc_type"]);
    expect(call.range).toEqual([[0, 999]]);
  });

  it("gives each row its document's total, open amount, currency and note", async () => {
    const sb = fakeClient(detailTables(), { data: ageingRows });
    const result = await readOpenItemStatement(sb, "c1", "2026-11-10");
    expect(result?.customer).toEqual(customer);
    expect(result?.items.map((i) => [i.docNumber, i.outstandingMinor, i.detail])).toEqual([
      ["INV-000004", 1000000, { totalMinor: 2680000, openMinor: 1000000, currencyCode: "USD", note: "Spring order" }],
      ["CM-000002", -50000, { totalMinor: 50000, openMinor: 50000, currencyCode: "USD", note: "Damaged stock" }],
      ["PMT-000009", -120000, { totalMinor: 500000, openMinor: 120000, currencyCode: "USD", note: "RCV-1010" }],
    ]);
    for (const [table, column, number] of [
      ["acc_invoice", "invoice_number", "INV-000004"],
      ["acc_credit_memo", "credit_memo_number", "CM-000002"],
      ["acc_payment", "payment_number", "PMT-000009"],
    ]) {
      const call = sb.calls.find((c) => c.table === table)!;
      expect(call.eq).toContainEqual(["customer_id", "c1"]);
      expect(call.in).toEqual([[column, [number]]]);
    }
  });

  it("still returns a row whose document cannot be matched, with no detail", async () => {
    const rows: Row[] = [
      { customer_id: "c1", doc_type: "invoice", doc_number: null, doc_date: "2026-10-01", due_date: "2026-10-31", balance_minor: 700 },
      { customer_id: "c1", doc_type: "invoice", doc_number: "INV-999999", doc_date: "2026-10-02", due_date: "2026-11-01", balance_minor: 800 },
    ];
    const sb = fakeClient(detailTables(), { data: rows });
    const result = await readOpenItemStatement(sb, "c1", "2026-11-10");
    expect(result?.items.map((i) => [i.docNumber, i.detail])).toEqual([
      [null, null],
      ["INV-999999", null],
    ]);
  });

  it("does not read a table that has no rows to look up", async () => {
    const sb = fakeClient(detailTables(), { data: [ageingRows[0]] });
    await readOpenItemStatement(sb, "c1", "2026-11-10");
    expect(sb.calls.map((c) => c.table)).toEqual(["acc_customer", "acc_invoice"]);
  });

  it("throws OpenItemStatementError with the RPC's message", async () => {
    const sb = fakeClient(detailTables(), { error: { message: "rpc down" } });
    const failure = readOpenItemStatement(sb, "c1", "2026-11-10");
    await expect(failure).rejects.toBeInstanceOf(OpenItemStatementError);
    await expect(failure).rejects.toThrow("rpc down");
  });
});
