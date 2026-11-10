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
    select: string;
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
      select: "",
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
    builder.select = (columns: string) => {
      call.select = columns;
      return builder;
    };
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
    builder.limit = () => builder;
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

  it("reads the open invoices with the entry each posted, named for this customer, a page at a time", async () => {
    const sb = fakeClient({
      acc_customer: [{ id: "c1", name: "BlueRidge Foods" }],
      acc_invoice: [
        { id: "i1", invoice_number: "INV-0001", status: "issued", balance_due_minor: 500, acc_journal_entry: { entry_number: "JE-000123" } },
        { id: "i2", invoice_number: "INV-0002", status: "partial", balance_due_minor: 200, acc_journal_entry: null },
      ],
    });
    const detail = await getCustomerDetail(sb, "c1");
    // Without the entry number the invoice dialog says "Not posted yet" for an issued invoice.
    expect(detail?.openInvoices.map((i) => [i.id, i.customer_name, i.entry_number])).toEqual([
      ["i1", "BlueRidge Foods", "JE-000123"],
      ["i2", "BlueRidge Foods", null],
    ]);
    expect(detail?.openInvoices[0]).not.toHaveProperty("acc_journal_entry");
    const call = sb.calls.find((c) => c.table === "acc_invoice")!;
    expect(call.select).toContain("acc_journal_entry(entry_number)");
    expect(call.eq).toContainEqual(["customer_id", "c1"]);
    expect(call.in).toContainEqual(["status", ["issued", "partial"]]);
    expect(call.gt).toContainEqual(["balance_due_minor", 0]);
    // A total order, so a row cannot straddle two pages (readAllPages).
    expect(call.order).toEqual(["issue_date", "id"]);
    expect(call.range).toEqual([[0, 999]]);
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
    // A payment has its own Reference apart from its memo.
    expect(sb.calls.find((c) => c.table === "acc_payment")!.select).toContain("reference,memo");
  });

  it("reads the credit status as of the company's day, not the server's", async () => {
    const sb = fakeClient({ acc_customer: [{ id: "c1", name: "BlueRidge Foods" }], acc_invoice: [] });
    await getCustomerDetail(sb, "c1");
    expect(sb.rpc).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ p_as_of: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }));
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
