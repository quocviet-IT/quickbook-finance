import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/services/access", () => ({ searchAudit: vi.fn() }));

import {
  EstimatesError,
  createInvoiceFromEstimate,
  deleteEstimate,
  getEstimateDetail,
  getEstimateDocumentSource,
  getEstimateInvoicePrefill,
  listEstimates,
  liveInvoiceOf,
  saveEstimate,
  setEstimateDeclined,
  type EstimateLinkedInvoice,
} from "@/lib/services/estimates";
import { InvoicingError, createDraftInvoice, getInvoiceEstimate } from "@/lib/services/invoicing";
import { describeAuditActivity } from "@/lib/services/dashboard";
import { estimateSaveSchema, invoiceCreateSchema } from "@/lib/domain/schemas";

/**
 * A stub client that answers the way PostgREST does: `.range(from, to)` is
 * inclusive at both ends, `.eq` filters, and an embedded resource is already
 * inside each row. Every select, order, range and RPC call is recorded.
 */
type Row = Record<string, unknown>;

interface World {
  tables: Record<string, Row[]>;
  /** A table whose reads fail. */
  fail?: string;
  rpc?: Record<string, { data?: unknown; error?: { message: string } }>;
}

interface Calls {
  selects: { table: string; columns: string }[];
  orders: { table: string; column: string; ascending: boolean | undefined }[];
  ranges: Record<string, [number, number][]>;
  rpc: { name: string; args: Record<string, unknown> }[];
}

function stubClient(world: World): { sb: SupabaseClient; calls: Calls } {
  const calls: Calls = { selects: [], orders: [], ranges: {}, rpc: [] };
  const sb = {
    from(table: string) {
      const eqs: Record<string, unknown> = {};
      const rows = () =>
        (world.tables[table] ?? []).filter((row) =>
          Object.entries(eqs).every(([column, value]) => row[column] === value),
        );
      const failure = () =>
        world.fail === table ? { data: null, error: { message: `${table} is unreachable` } } : null;
      const builder: Record<string, unknown> = {
        select(columns: string) {
          calls.selects.push({ table, columns });
          return builder;
        },
        eq(column: string, value: unknown) {
          eqs[column] = value;
          return builder;
        },
        order(column: string, options?: { ascending?: boolean }) {
          calls.orders.push({ table, column, ascending: options?.ascending });
          return builder;
        },
        limit: () => builder,
        async range(from: number, to: number) {
          (calls.ranges[table] ??= []).push([from, to]);
          return failure() ?? { data: rows().slice(from, to + 1), error: null };
        },
        async maybeSingle() {
          return failure() ?? { data: rows()[0] ?? null, error: null };
        },
        async single() {
          const found = rows()[0];
          return failure() ?? (found ? { data: found, error: null } : { data: null, error: { message: "no rows" } });
        },
      };
      return builder;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.rpc.push({ name, args });
      const answer = world.rpc?.[name] ?? {};
      return { data: answer.data ?? null, error: answer.error ?? null };
    },
  };
  return { sb: sb as unknown as SupabaseClient, calls };
}

const CUSTOMER = "8d1f0a52-0000-4000-8000-0000000000c1";
const ACCOUNT = "8d1f0a52-0000-4000-8000-0000000000a1";
const TAX = "8d1f0a52-0000-4000-8000-0000000000e1";

function estimateRow(n: number, extra: Row = {}): Row {
  return {
    id: `est-${n}`,
    estimate_number: `EST-${String(n).padStart(6, "0")}`,
    customer_id: CUSTOMER,
    estimate_date: "2026-10-01",
    expiry_date: "2026-10-31",
    currency_code: "USD",
    memo: null,
    subtotal_minor: 10_000,
    tax_minor: 625,
    total_minor: 10_625,
    declined_at: null,
    status: "open",
    created_by: null,
    created_at: "2026-10-01T09:00:00+00:00",
    updated_by: null,
    updated_at: "2026-10-01T09:00:00+00:00",
    acc_customer: { name: "Harbor Lane Bakery" },
    acc_invoice: [],
    ...extra,
  };
}

function lineRow(estimateId: string, order: number, extra: Row = {}): Row {
  return {
    id: `${estimateId}-line-${order}`,
    estimate_id: estimateId,
    line_order: order,
    item_id: null,
    description: `Line ${order + 1}`,
    quantity: 1,
    unit_price_minor: 100,
    income_account_id: ACCOUNT,
    tax_code_id: null,
    line_subtotal_minor: 100,
    line_tax_minor: 0,
    line_total_minor: 100,
    ...extra,
  };
}

const voidInvoice: EstimateLinkedInvoice = {
  id: "inv-void",
  invoice_number: null,
  status: "void",
  issue_date: "2026-10-02",
  created_at: "2026-10-02T10:00:00+00:00",
};
const draftInvoice: EstimateLinkedInvoice = {
  id: "inv-draft",
  invoice_number: null,
  status: "draft",
  issue_date: "2026-10-05",
  created_at: "2026-10-05T10:00:00+00:00",
};
const issuedInvoice: EstimateLinkedInvoice = {
  id: "inv-issued",
  invoice_number: "INV-000123",
  status: "issued",
  issue_date: "2026-10-05",
  created_at: "2026-10-05T10:00:00+00:00",
};

describe("listEstimates", () => {
  it("pages past PostgREST's 1,000-row cap, newest first by a total order", async () => {
    const rows = Array.from({ length: 1_001 }, (_, i) => estimateRow(1_001 - i));
    const { sb, calls } = stubClient({ tables: { acc_estimate: rows } });
    const list = await listEstimates(sb);
    expect(list).toHaveLength(1_001);
    expect(calls.ranges.acc_estimate).toEqual([
      [0, 999],
      [1_000, 1_999],
    ]);
    // Date, then the unique number: no row can straddle two pages.
    expect(calls.orders.filter((o) => o.table === "acc_estimate")).toEqual([
      { table: "acc_estimate", column: "estimate_date", ascending: false },
      { table: "acc_estimate", column: "estimate_number", ascending: false },
      { table: "acc_estimate", column: "estimate_date", ascending: false },
      { table: "acc_estimate", column: "estimate_number", ascending: false },
    ]);
  });

  it("asks for the customer's name and the invoices made from each estimate", async () => {
    const { sb, calls } = stubClient({ tables: { acc_estimate: [estimateRow(1)] } });
    await listEstimates(sb);
    const columns = calls.selects.find((s) => s.table === "acc_estimate")?.columns ?? "";
    expect(columns).toContain("acc_customer(name)");
    expect(columns).toContain("acc_invoice(id,invoice_number,status");
  });

  it("carries the customer name, the totals, and the live invoice: not void", async () => {
    const { sb } = stubClient({
      tables: {
        acc_estimate: [
          estimateRow(3, { acc_invoice: [issuedInvoice, voidInvoice] }),
          estimateRow(2, { acc_invoice: [voidInvoice] }),
          estimateRow(1, { acc_customer: null }),
        ],
      },
    });
    const [converted, voidedOnly, plain] = await listEstimates(sb);
    expect(converted).toMatchObject({
      estimate_number: "EST-000003",
      customer_name: "Harbor Lane Bakery",
      subtotal_minor: 10_000,
      tax_minor: 625,
      total_minor: 10_625,
      live_invoice: issuedInvoice,
    });
    expect(converted).not.toHaveProperty("acc_invoice");
    expect(converted).not.toHaveProperty("acc_customer");
    expect(voidedOnly.live_invoice).toBeNull();
    expect(plain.customer_name).toBe("—");
    expect(plain.live_invoice).toBeNull();
  });

  it("passes a failed read through as its own error", async () => {
    const { sb } = stubClient({ tables: {}, fail: "acc_estimate" });
    await expect(listEstimates(sb)).rejects.toThrow(EstimatesError);
    await expect(listEstimates(sb)).rejects.toThrow("acc_estimate is unreachable");
  });
});

describe("liveInvoiceOf", () => {
  it("picks the one invoice that is not void, draft or issued", () => {
    expect(liveInvoiceOf([voidInvoice, draftInvoice])).toEqual(draftInvoice);
    expect(liveInvoiceOf([issuedInvoice, voidInvoice])).toEqual(issuedInvoice);
    expect(liveInvoiceOf([voidInvoice])).toBeNull();
    expect(liveInvoiceOf([])).toBeNull();
  });
});

describe("getEstimateDetail", () => {
  it("reads the header, every page of lines, and every invoice made from it, oldest first", async () => {
    const lines = Array.from({ length: 1_002 }, (_, i) => lineRow("est-9", i));
    const { sb, calls } = stubClient({
      tables: {
        acc_estimate: [estimateRow(9, { id: "est-9", acc_invoice: [draftInvoice, voidInvoice] })],
        acc_estimate_line: [...lines, lineRow("est-other", 0)],
      },
    });
    const detail = await getEstimateDetail(sb, "est-9");
    expect(detail.estimate.estimate_number).toBe("EST-000009");
    expect(detail.estimate.live_invoice).toEqual(draftInvoice);
    expect(detail.invoices.map((i) => i.id)).toEqual(["inv-void", "inv-draft"]);
    expect(detail.lines).toHaveLength(1_002);
    expect(calls.ranges.acc_estimate_line).toEqual([
      [0, 999],
      [1_000, 1_999],
    ]);
    expect(calls.orders).toContainEqual({ table: "acc_estimate_line", column: "line_order", ascending: undefined });
  });

  it("says when there is no such estimate", async () => {
    const { sb } = stubClient({ tables: { acc_estimate: [] } });
    await expect(getEstimateDetail(sb, "missing")).rejects.toThrow("Estimate not found");
  });
});

describe("getEstimateInvoicePrefill", () => {
  it("fills the New invoice form from the estimate and its lines", async () => {
    const { sb } = stubClient({
      tables: {
        acc_estimate: [estimateRow(4, { id: "est-4" })],
        acc_estimate_line: [
          lineRow("est-4", 1, { unit_price_minor: 4_250, quantity: 2.5 }),
          lineRow("est-4", 0, { unit_price_minor: 1_999, quantity: 3, tax_code_id: TAX }),
        ],
      },
    });
    const prefill = await getEstimateInvoicePrefill(sb, "est-4");
    expect(prefill).toEqual({
      estimateId: "est-4",
      estimateNumber: "EST-000004",
      values: {
        customer_id: CUSTOMER,
        lines: [
          { item_id: null, description: "Line 1", quantity: 3, unit_price: 19.99, income_account_id: ACCOUNT, tax_code_id: TAX },
          { item_id: null, description: "Line 2", quantity: 2.5, unit_price: 42.5, income_account_id: ACCOUNT, tax_code_id: null },
        ],
      },
      blocked: null,
    });
  });

  it("says why instead when a live invoice was already made from it", async () => {
    const { sb } = stubClient({
      tables: { acc_estimate: [estimateRow(4, { id: "est-4", acc_invoice: [voidInvoice, issuedInvoice] })] },
    });
    expect((await getEstimateInvoicePrefill(sb, "est-4"))?.blocked).toBe(
      "EST-000004 has already been turned into an invoice (INV-000123).",
    );
  });

  it("is null when there is no such estimate", async () => {
    const { sb } = stubClient({ tables: { acc_estimate: [] } });
    expect(await getEstimateInvoicePrefill(sb, "missing")).toBeNull();
  });
});

describe("getEstimateDocumentSource", () => {
  const settings = {
    legal_name: "Larkspur Joinery LLC",
    dba_name: null,
    address_line1: null,
    address_line2: null,
    city: null,
    region: null,
    postal_code: null,
    country: null,
  };
  const customer = {
    name: "Harbor Lane Bakery",
    email: null,
    contact_name: null,
    phone: null,
    address_line1: null,
    address_line2: null,
    city: null,
    region: null,
    postal_code: null,
    country: null,
  };

  it("reads the estimate with its customer, its lines and the company in one go", async () => {
    const { sb } = stubClient({
      tables: {
        acc_estimate: [estimateRow(5, { id: "est-5", acc_customer: customer })],
        acc_estimate_line: [lineRow("est-5", 0)],
        acc_company_setting_version: [settings],
      },
    });
    const source = await getEstimateDocumentSource(sb, "est-5");
    expect(source.customer).toEqual(customer);
    expect(source.company).toEqual(settings);
    expect(source.lines).toHaveLength(1);
    expect(source.estimate).toMatchObject({ estimate_number: "EST-000005", expiry_date: "2026-10-31" });
    expect(source.estimate).not.toHaveProperty("acc_customer");
  });

  it("refuses to print without company settings", async () => {
    const { sb } = stubClient({
      tables: { acc_estimate: [estimateRow(5, { id: "est-5", acc_customer: customer })] },
    });
    await expect(getEstimateDocumentSource(sb, "est-5")).rejects.toThrow(
      "Company settings are required before an estimate can be printed. Set them in Settings → Company.",
    );
  });
});

describe("estimate writes go through the database's functions, refusals unchanged", () => {
  const input = estimateSaveSchema.parse({
    customer_id: CUSTOMER,
    estimate_date: "2026-10-12",
    memo: "",
    lines: [{ quantity: 2, unit_price_minor: 1_500, income_account_id: ACCOUNT, tax_code_id: TAX }],
  });

  it("saves with every argument the function takes, and returns its figures", async () => {
    const { sb, calls } = stubClient({
      tables: {},
      rpc: {
        acc_save_estimate: {
          data: { id: "est-new", estimate_number: "EST-000010", subtotal_minor: 3_000, tax_minor: 188, total_minor: 3_188 },
        },
      },
    });
    const saved = await saveEstimate(sb, null, input);
    expect(saved).toEqual({
      id: "est-new",
      estimate_number: "EST-000010",
      subtotal_minor: 3_000,
      tax_minor: 188,
      total_minor: 3_188,
    });
    expect(calls.rpc).toEqual([
      {
        name: "acc_save_estimate",
        args: {
          p_estimate_id: null,
          p_customer_id: CUSTOMER,
          p_estimate_date: "2026-10-12",
          p_expiry_date: null,
          p_currency: "USD",
          p_memo: null,
          p_lines: [
            {
              description: "",
              quantity: 2,
              unit_price_minor: 1_500,
              income_account_id: ACCOUNT,
              tax_code_id: TAX,
              item_id: null,
            },
          ],
        },
      },
    ]);
  });

  it("edits by id, with the expiry date given", async () => {
    const { sb, calls } = stubClient({
      tables: {},
      rpc: { acc_save_estimate: { data: { id: "est-1", estimate_number: "EST-000001", subtotal_minor: 0, tax_minor: 0, total_minor: 0 } } },
    });
    await saveEstimate(sb, "est-1", { ...input, expiry_date: "2026-12-01" });
    expect(calls.rpc[0].args).toMatchObject({ p_estimate_id: "est-1", p_expiry_date: "2026-12-01" });
  });

  it.each([
    ["save", (sb: SupabaseClient) => saveEstimate(sb, "est-1", input), "acc_save_estimate",
      "EST-000001 has been turned into an invoice (INV-000123), so it can no longer be edited."],
    ["decline", (sb: SupabaseClient) => setEstimateDeclined(sb, "est-1", true), "acc_set_estimate_declined",
      "EST-000001 has been turned into an invoice (a draft invoice), so it cannot be marked declined."],
    ["delete", (sb: SupabaseClient) => deleteEstimate(sb, "est-1"), "acc_delete_estimate",
      "EST-000001 has had an invoice made from it. Mark it declined instead."],
    ["convert", (sb: SupabaseClient) => createInvoiceFromEstimate(sb, "est-1", invoiceCreateSchema.parse({
      customer_id: CUSTOMER, lines: [{ quantity: 1, unit_price_minor: 1, income_account_id: ACCOUNT }],
    })), "acc_create_invoice_from_estimate",
      "EST-000001 has already been turned into an invoice (INV-000123)."],
  ])("passes the database's refusal to %s through word for word", async (_name, call, rpc, words) => {
    const { sb } = stubClient({ tables: {}, rpc: { [rpc]: { error: { message: words } } } });
    const error = await call(sb).then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(EstimatesError);
    expect((error as Error).message).toBe(words);
  });

  it("declines and reopens by the flag", async () => {
    const { sb, calls } = stubClient({
      tables: {},
      rpc: { acc_set_estimate_declined: { data: { id: "est-1", estimate_number: "EST-000001", declined_at: null } } },
    });
    expect(await setEstimateDeclined(sb, "est-1", false)).toEqual({
      id: "est-1",
      estimate_number: "EST-000001",
      declined_at: null,
    });
    await setEstimateDeclined(sb, "est-1", true);
    expect(calls.rpc.map((c) => c.args)).toEqual([
      { p_estimate_id: "est-1", p_declined: false },
      { p_estimate_id: "est-1", p_declined: true },
    ]);
  });

  it("deletes by id and returns the freed number", async () => {
    const { sb, calls } = stubClient({
      tables: {},
      rpc: { acc_delete_estimate: { data: { id: "est-1", estimate_number: "EST-000001" } } },
    });
    expect(await deleteEstimate(sb, "est-1")).toEqual({ id: "est-1", estimate_number: "EST-000001" });
    expect(calls.rpc).toEqual([{ name: "acc_delete_estimate", args: { p_estimate_id: "est-1" } }]);
  });
});

describe("createInvoiceFromEstimate", () => {
  const input = invoiceCreateSchema.parse({
    customer_id: CUSTOMER,
    issue_date: "2026-10-12",
    due_date: "2026-11-11",
    memo: "Thanks",
    lines: [
      { description: "Walnut shelf", quantity: 3, unit_price_minor: 1_999, income_account_id: ACCOUNT, tax_code_id: TAX },
    ],
  });

  it("passes the invoice fields exactly as createDraftInvoice does, plus the estimate", async () => {
    const draft = stubClient({
      tables: { acc_invoice: [{ id: "inv-new" }] },
      rpc: { acc_create_draft_invoice: { data: "inv-new" } },
    });
    await createDraftInvoice(draft.sb, input);
    // Everything but the recurring run, which only a recurring schedule passes.
    const draftArgs = { ...draft.calls.rpc[0].args };
    expect(draftArgs.p_recurring_run_id).toBeNull();
    delete draftArgs.p_recurring_run_id;

    const converted = stubClient({ tables: {}, rpc: { acc_create_invoice_from_estimate: { data: "inv-new" } } });
    expect(await createInvoiceFromEstimate(converted.sb, "est-1", input)).toBe("inv-new");
    expect(converted.calls.rpc).toEqual([
      { name: "acc_create_invoice_from_estimate", args: { p_estimate_id: "est-1", ...draftArgs } },
    ]);
  });
});

describe("getInvoiceEstimate", () => {
  it("names the estimate an invoice was made from", async () => {
    const { sb, calls } = stubClient({
      tables: {
        acc_invoice: [
          { id: "inv-1", estimate_id: "est-1", acc_estimate: { id: "est-1", estimate_number: "EST-000001" } },
          { id: "inv-2", estimate_id: null, acc_estimate: null },
        ],
      },
    });
    expect(await getInvoiceEstimate(sb, "inv-1")).toEqual({ id: "est-1", estimate_number: "EST-000001" });
    expect(await getInvoiceEstimate(sb, "inv-2")).toBeNull();
    expect(await getInvoiceEstimate(sb, "inv-missing")).toBeNull();
    expect(calls.selects[0]).toEqual({ table: "acc_invoice", columns: "estimate_id,acc_estimate(id,estimate_number)" });
  });

  it("passes a failed read through as an invoicing error", async () => {
    const { sb } = stubClient({ tables: {}, fail: "acc_invoice" });
    await expect(getInvoiceEstimate(sb, "inv-1")).rejects.toThrow(InvoicingError);
  });
});

describe("dashboard recent activity", () => {
  it("reads an estimate's audit row as an Estimate, with its number, linking to /estimates", () => {
    expect(
      describeAuditActivity({
        id: "audit-9",
        table_name: "acc_estimate",
        record_id: "est-3",
        action: "insert",
        actor_id: "user-1",
        actor_email: "estimator@example.com",
        before_json: null,
        after_json: { estimate_number: "EST-000003", total_minor: 10_625 },
        created_at: "2026-10-12T09:00:00.000Z",
      }),
    ).toEqual({
      id: "audit-9",
      occurredAt: "2026-10-12T09:00:00.000Z",
      actor: "estimator@example.com",
      verb: "Created",
      entity: "Estimate",
      reference: "EST-000003",
      href: "/estimates",
      category: "sales",
    });
  });
});
