import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getApAging, getArAging } from "@/lib/services/aging";
import { listCustomerCredit } from "@/lib/services/credit";

const CAP = 1000;

/**
 * PostgREST's answer to an RPC, as tests/unit/report-rpc-paging.test.ts
 * describes it: awaited without a range it is silently cut at `CAP` rows;
 * `.range()` pages through the rest. Orders and filters are recorded.
 */
function rpcClient(answers: Record<string, readonly Record<string, unknown>[]>) {
  const calls: { fn: string; eq: [string, unknown][]; order: string[]; ranges: [number, number][] }[] = [];
  const sb = {
    rpc(fn: string) {
      const rows = answers[fn];
      if (!rows) throw new Error(`unexpected rpc ${fn}`);
      const call = { fn, eq: [] as [string, unknown][], order: [] as string[], ranges: [] as [number, number][] };
      calls.push(call);
      const filtered = () => rows.filter((row) => call.eq.every(([column, value]) => row[column] === value));
      const builder: Record<string, unknown> = {
        eq: (column: string, value: unknown) => (call.eq.push([column, value]), builder),
        order: (column: string) => (call.order.push(column), builder),
        range: (from: number, to: number) => {
          call.ranges.push([from, to]);
          return Promise.resolve({ data: filtered().slice(from, from + Math.min(to - from + 1, CAP)), error: null });
        },
        then: (resolve: (value: unknown) => unknown) => resolve({ data: filtered().slice(0, CAP), error: null }),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
  return { sb, calls };
}

const arRow = (i: number, docType = "invoice", balance = 100): Record<string, unknown> => ({
  customer_id: `c${i % 7}`,
  customer_name: `Customer ${i % 7}`,
  doc_type: docType,
  doc_number: `${docType}-${String(i).padStart(5, "0")}`,
  doc_date: "2026-10-01",
  due_date: "2026-10-31",
  balance_minor: balance,
});

describe("A/R and A/P Aging read every row (3.0.14)", () => {
  it("reads past PostgREST's 1,000-row cap, so the total is every document's", async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => arRow(i));
    const { sb, calls } = rpcClient({ acc_ar_ageing: rows, acc_ledger_balances: [] });
    const report = await getArAging(sb, "2026-11-10", { reconcileAsOf: "2026-11-10" });
    expect(report.rows).toHaveLength(2500);
    expect(report.total).toBe(250_000);
    const ageing = calls.filter((c) => c.fn === "acc_ar_ageing");
    expect(ageing.map((c) => c.ranges[0])).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
    // A total order, so no row can straddle two pages.
    expect(ageing[0].order).toEqual(["doc_type", "doc_number", "doc_date", "customer_id", "balance_minor"]);
  });

  it("gives the same rows and total as one request when there are fewer than 1,000", async () => {
    const rows = [arRow(1), arRow(2, "credit_memo", -40), arRow(3, "payment", -25), arRow(4)];
    const { sb } = rpcClient({ acc_ar_ageing: rows, acc_ledger_balances: [] });
    const report = await getArAging(sb, "2026-11-10", { reconcileAsOf: "2026-11-10" });
    expect(report.total).toBe(100 - 40 - 25 + 100);
    expect(report.rows).toHaveLength(4);
  });

  it("lists documents, then credits, then payments, each by number", async () => {
    // As the paged read returns them: by kind name, then number.
    const rows = [arRow(9, "credit_memo", -10), arRow(1), arRow(2), arRow(5, "payment", -5)];
    const { sb } = rpcClient({ acc_ar_ageing: rows, acc_ledger_balances: [] });
    const report = await getArAging(sb, "2026-11-10", { reconcileAsOf: "2026-11-10" });
    expect(report.rows.map((r) => r.docNumber)).toEqual([
      "invoice-00001",
      "invoice-00002",
      "credit_memo-00009",
      "payment-00005",
    ]);
  });

  it("pages A/P Aging the same way, keyed by vendor", async () => {
    const rows = Array.from({ length: 1200 }, (_, i) => ({
      vendor_id: `v${i % 3}`,
      vendor_name: `Vendor ${i % 3}`,
      doc_type: i % 2 ? "bill" : "vendor_credit",
      doc_number: `B-${i}`,
      doc_date: "2026-10-01",
      due_date: "2026-10-31",
      balance_minor: 10,
    }));
    const { sb, calls } = rpcClient({ acc_ap_ageing: rows, acc_ledger_balances: [] });
    const report = await getApAging(sb, "2026-11-10", { reconcileAsOf: "2026-11-10" });
    expect(report.rows).toHaveLength(1200);
    expect(report.rows[0].docType).toBe("bill");
    expect(report.rows[report.rows.length - 1].docType).toBe("vendor_credit");
    expect(calls.find((c) => c.fn === "acc_ap_ageing")!.order).toContain("vendor_id");
  });
});

describe("customer credit (3.0.14)", () => {
  const creditRow = (i: number): Record<string, unknown> => ({
    customer_id: `c${i}`,
    name: `Customer ${String(i).padStart(5, "0")}`,
    is_active: true,
    open_balance_minor: i,
    overdue_minor: 0,
    sales_window_minor: 0,
  });

  it("reads every customer past the 1,000-row cap, in the RPC's name order", async () => {
    const rows = Array.from({ length: 1500 }, (_, i) => creditRow(i));
    const { sb, calls } = rpcClient({ acc_customer_credit_status: rows });
    const list = await listCustomerCredit(sb);
    expect(list).toHaveLength(1500);
    expect(calls[0].order).toEqual(["name", "customer_id"]);
    expect(calls[0].eq).toEqual([]);
  });

  it("asks for one customer's row when given its id", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => creditRow(i));
    const { sb, calls } = rpcClient({ acc_customer_credit_status: rows });
    const list = await listCustomerCredit(sb, { customerId: "c3" });
    expect(calls[0].eq).toEqual([["customer_id", "c3"]]);
    expect(list.map((r) => r.customerId)).toEqual(["c3"]);
  });
});
