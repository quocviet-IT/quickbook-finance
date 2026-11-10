import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

import { getCustomerDetail, listCustomerTransactions } from "@/lib/services/customer-detail";

type Pair = [string, unknown];

function fakeClient(
  tables: Record<string, unknown[]>,
  rpcResult: { data?: unknown; error?: { message: string } | null } = {},
) {
  const calls: {
    table: string;
    eq: Pair[];
    neq: Pair[];
    gte: Pair[];
    lte: Pair[];
    in: Pair[];
    gt: Pair[];
    order: string[];
    range: [number, number][];
  }[] = [];
  const from = vi.fn((table: string) => {
    const call = {
      table,
      eq: [] as Pair[],
      neq: [] as Pair[],
      gte: [] as Pair[],
      lte: [] as Pair[],
      in: [] as Pair[],
      gt: [] as Pair[],
      order: [] as string[],
      range: [] as [number, number][],
    };
    calls.push(call);
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    for (const name of ["eq", "neq", "gte", "lte", "in", "gt"] as const) {
      builder[name] = (column: string, value: unknown) => {
        call[name].push([column, value]);
        return builder;
      };
    }
    builder.order = (column: string) => {
      call.order.push(column);
      return builder;
    };
    builder.range = (a: number, b: number) => {
      call.range.push([a, b]);
      return builder;
    };
    builder.maybeSingle = async () => ({ data: (tables[table] ?? [])[0] ?? null, error: null });
    builder.then = (resolve: (v: unknown) => unknown) => resolve({ data: tables[table] ?? [], error: null });
    return builder;
  });
  const rpc = vi.fn(async () => ({ data: rpcResult.data ?? [], error: rpcResult.error ?? null }));
  const sb = { from, rpc } as unknown as SupabaseClient;
  return Object.assign(sb, { calls });
}

describe("customer detail reads", () => {
  it("returns null for a customer that does not exist", async () => {
    const sb = fakeClient({ acc_customer: [] });
    await expect(getCustomerDetail(sb, "missing")).resolves.toBeNull();
  });

  it("reads each kind of document by this customer and the date range only", async () => {
    const sb = fakeClient({ acc_invoice: [], acc_payment: [], acc_credit_memo: [], acc_sales_receipt: [] });
    await listCustomerTransactions(sb, "c1", { from: "2025-11-10", to: "2026-11-10" });
    for (const table of ["acc_invoice", "acc_payment", "acc_credit_memo", "acc_sales_receipt"]) {
      const call = sb.calls.find((c) => c.table === table)!;
      expect(call.eq).toContainEqual(["customer_id", "c1"]);
      expect(call.gte.length).toBe(1);
      expect(call.lte.length).toBe(1);
    }
    // A draft invoice is not a transaction yet.
    expect(sb.calls.find((c) => c.table === "acc_invoice")!.neq).toContainEqual(["status", "draft"]);
    expect(sb.calls.find((c) => c.table === "acc_credit_memo")!.neq).toContainEqual(["status", "draft"]);
  });

  it("keeps the page when the credit status cannot be read", async () => {
    const sb = fakeClient(
      { acc_customer: [{ id: "c1", name: "BlueRidge Foods" }], acc_invoice: [] },
      { error: { message: "rpc down" } },
    );
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const detail = await getCustomerDetail(sb, "c1");
    expect(detail?.credit).toBeNull();
    expect(detail?.creditError).toBe("Credit status could not be read");
    expect(logged).toHaveBeenCalledWith("Reading customer credit failed:", "rpc down");
    logged.mockRestore();
  });
});
