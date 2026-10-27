import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUserRole: vi.fn(),
  revalidatePath: vi.fn(),
  companyClock: vi.fn(),
  listEstimates: vi.fn(),
  getEstimateDetail: vi.fn(),
  getEstimateDocumentSource: vi.fn(),
  getEstimateInvoicePrefill: vi.fn(),
  saveEstimate: vi.fn(),
  setEstimateDeclined: vi.fn(),
  deleteEstimate: vi.fn(),
  createInvoiceFromEstimate: vi.fn(),
  createDraftInvoice: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/db/server", () => ({ createSupabaseServerClient: mocks.createClient }));
vi.mock("@/lib/auth", () => ({
  getUserRole: mocks.getUserRole,
  canWrite: (role: string | null) => role === "admin" || role === "accountant",
  // The starting matrix: invoice.create is on for admin, accountant and sales (0173).
  holdsPermission: async (key: string) =>
    key === "invoice.create" && ["admin", "accountant", "sales"].includes((await mocks.getUserRole()) ?? ""),
}));
vi.mock("@/lib/services/report-context", () => ({ companyClock: mocks.companyClock }));
vi.mock("@/lib/services/access", () => ({ searchAudit: vi.fn() }));
vi.mock("@/lib/services/settlements", () => ({ listInvoiceSettlements: vi.fn() }));
vi.mock("@/lib/services/estimates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/estimates")>()),
  listEstimates: mocks.listEstimates,
  getEstimateDetail: mocks.getEstimateDetail,
  getEstimateDocumentSource: mocks.getEstimateDocumentSource,
  getEstimateInvoicePrefill: mocks.getEstimateInvoicePrefill,
  saveEstimate: mocks.saveEstimate,
  setEstimateDeclined: mocks.setEstimateDeclined,
  deleteEstimate: mocks.deleteEstimate,
  createInvoiceFromEstimate: mocks.createInvoiceFromEstimate,
}));
vi.mock("@/lib/services/invoicing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/invoicing")>()),
  createDraftInvoice: mocks.createDraftInvoice,
}));

import {
  declineEstimateAction,
  deleteEstimateAction,
  getEstimateDetailAction,
  getEstimateDocumentAction,
  getEstimateInvoicePrefillAction,
  listEstimatesAction,
  reopenEstimateAction,
  saveEstimateAction,
} from "@/app/(app)/estimates/actions";
import { createInvoiceAction } from "@/app/(app)/invoices/actions";
import { EstimatesError } from "@/lib/services/estimates";
import {
  estimateIdSchema,
  estimateLineInputSchema,
  estimateSaveSchema,
  invoiceCreateSchema,
  invoiceCreateWithEstimateSchema,
  invoiceLineInputSchema,
} from "@/lib/domain/schemas";

const sb = { name: "company client" };
const DENIED = "You do not have permission to perform this action";
const EST = "3c9a7e10-0000-4000-8000-000000000001";
const CUSTOMER = "3c9a7e10-0000-4000-8000-0000000000c1";
const ACCOUNT = "3c9a7e10-0000-4000-8000-0000000000a1";

const saveInput = {
  customer_id: CUSTOMER,
  estimate_date: "2026-10-12",
  expiry_date: "2026-11-11",
  memo: "Delivery within two weeks of acceptance.",
  lines: [{ description: "Oak bench", quantity: 1, unit_price_minor: 45_000, income_account_id: ACCOUNT }],
};

const invoiceInput = {
  customer_id: CUSTOMER,
  issue_date: "2026-10-12",
  due_date: "2026-11-11",
  memo: null,
  lines: [{ description: "Oak bench", quantity: 2, unit_price_minor: 45_000, income_account_id: ACCOUNT }],
};

function row(n: number, extra: Record<string, unknown> = {}) {
  return {
    id: `est-${n}`,
    estimate_number: `EST-00000${n}`,
    expiry_date: "2026-10-31",
    declined_at: null,
    live_invoice: null,
    customer_name: "Juniper Street Studio",
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createClient.mockResolvedValue(sb);
  mocks.getUserRole.mockResolvedValue("accountant");
  mocks.companyClock.mockResolvedValue({ today: "2026-11-01", timeZone: "America/Chicago" });
});

describe("estimate schemas", () => {
  it("takes an estimate line exactly as an invoice line", () => {
    expect(estimateLineInputSchema).toBe(invoiceLineInputSchema);
  });

  it("takes a full estimate, and defaults the currency to USD", () => {
    const parsed = estimateSaveSchema.parse(saveInput);
    expect(parsed.currency_code).toBe("USD");
    expect(parsed.lines[0]).toEqual({ ...saveInput.lines[0] });
  });

  it("leaves Valid until to the database when it is not given", () => {
    expect(estimateSaveSchema.safeParse({ ...saveInput, expiry_date: null }).success).toBe(true);
    expect(estimateSaveSchema.safeParse({ ...saveInput, expiry_date: undefined }).success).toBe(true);
  });

  it("accepts Valid until on the estimate date itself", () => {
    expect(estimateSaveSchema.safeParse({ ...saveInput, expiry_date: "2026-10-12" }).success).toBe(true);
  });

  it.each([
    ["no estimate date", { estimate_date: undefined }, "Choose the estimate date."],
    ["a date not on the calendar", { estimate_date: "2026-02-30" }, "Choose the estimate date."],
    ["Valid until before the date", { expiry_date: "2026-10-11" }, "Valid until cannot be before the estimate date."],
    ["no customer", { customer_id: "" }, "Select a customer"],
    ["no lines", { lines: [] }, "Add at least one line item"],
    ["another currency", { currency_code: "EUR" }, "Only USD is supported"],
    ["a zero quantity", { lines: [{ ...saveInput.lines[0], quantity: 0 }] }, "Quantity must be greater than 0"],
  ])("refuses %s", (_name, change, message) => {
    const result = estimateSaveSchema.safeParse({ ...saveInput, ...change });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(message);
  });

  it("takes an estimate id only as a uuid", () => {
    expect(estimateIdSchema.safeParse(EST).success).toBe(true);
    expect(estimateIdSchema.safeParse("est-1").success).toBe(false);
  });

  it("validates the invoice fields the same way with or without an estimate", () => {
    const plain = invoiceCreateSchema.parse(invoiceInput);
    expect(invoiceCreateWithEstimateSchema.parse(invoiceInput)).toEqual(plain);
    expect(invoiceCreateWithEstimateSchema.parse({ ...invoiceInput, estimateId: EST })).toEqual({
      ...plain,
      estimateId: EST,
    });
    expect(invoiceCreateWithEstimateSchema.safeParse({ ...invoiceInput, estimateId: "nope" }).success).toBe(false);
  });
});

describe("guards: only writers change estimates", () => {
  beforeEach(() => mocks.getUserRole.mockResolvedValue("viewer"));

  it.each([
    ["save", () => saveEstimateAction(null, saveInput)],
    ["decline", () => declineEstimateAction(EST)],
    ["reopen", () => reopenEstimateAction(EST)],
    ["delete", () => deleteEstimateAction(EST)],
    ["the invoice prefill", () => getEstimateInvoicePrefillAction(EST)],
  ])("refuses %s to a read-only role, and touches nothing", async (_name, act) => {
    expect(await act()).toEqual({ ok: false, error: DENIED });
    for (const write of [
      mocks.saveEstimate,
      mocks.setEstimateDeclined,
      mocks.deleteEstimate,
      mocks.getEstimateInvoicePrefill,
    ]) {
      expect(write).not.toHaveBeenCalled();
    }
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("lets a read-only role see the list and print the PDF", async () => {
    mocks.listEstimates.mockResolvedValue([]);
    expect((await listEstimatesAction()).ok).toBe(true);
    mocks.getEstimateDocumentSource.mockRejectedValue(new EstimatesError("Estimate not found"));
    expect(await getEstimateDocumentAction(EST)).toEqual({ ok: false, error: "Estimate not found" });
    expect(mocks.getEstimateDocumentSource).toHaveBeenCalledWith(sb, EST);
  });
});

describe("listEstimatesAction", () => {
  it("gives each row its state on the company's today", async () => {
    mocks.listEstimates.mockResolvedValue([
      row(1),
      row(2, { expiry_date: "2026-11-01" }),
      row(3, { declined_at: "2026-10-20T10:00:00+00:00" }),
      row(4, { live_invoice: { id: "inv-1", invoice_number: null, status: "draft" } }),
    ]);
    const result = await listEstimatesAction();
    expect(result.ok).toBe(true);
    expect(result.data?.today).toBe("2026-11-01");
    expect(result.data?.estimates.map((r) => [r.estimate_number, r.state])).toEqual([
      ["EST-000001", "expired"],
      ["EST-000002", "open"],
      ["EST-000003", "declined"],
      ["EST-000004", "converted"],
    ]);
    expect(mocks.companyClock).toHaveBeenCalledWith(sb);
  });

  it("reports a failed read as an error", async () => {
    mocks.listEstimates.mockRejectedValue(new EstimatesError("acc_estimate is unreachable"));
    expect(await listEstimatesAction()).toEqual({ ok: false, error: "acc_estimate is unreachable" });
  });
});

describe("getEstimateDetailAction", () => {
  it("adds the state and the day it was worked out for", async () => {
    mocks.getEstimateDetail.mockResolvedValue({ estimate: row(1), lines: [], invoices: [] });
    const result = await getEstimateDetailAction(EST);
    expect(result).toEqual({
      ok: true,
      data: { estimate: row(1), lines: [], invoices: [], state: "expired", today: "2026-11-01" },
    });
    expect(mocks.getEstimateDetail).toHaveBeenCalledWith(sb, EST);
  });

  it("refuses an id that is not one", async () => {
    expect(await getEstimateDetailAction("est-1")).toEqual({ ok: false, error: "Estimate not found" });
    expect(mocks.getEstimateDetail).not.toHaveBeenCalled();
  });
});

describe("saveEstimateAction", () => {
  it("creates with the parsed input, and refreshes the list and the dashboard", async () => {
    const saved = { id: EST, estimate_number: "EST-000001", subtotal_minor: 45_000, tax_minor: 0, total_minor: 45_000 };
    mocks.saveEstimate.mockResolvedValue(saved);
    expect(await saveEstimateAction(null, saveInput)).toEqual({ ok: true, data: saved });
    expect(mocks.saveEstimate).toHaveBeenCalledWith(sb, null, estimateSaveSchema.parse(saveInput));
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual(["/estimates", "/dashboard"]);
  });

  it("edits by id", async () => {
    mocks.saveEstimate.mockResolvedValue({ id: EST });
    await saveEstimateAction(EST, saveInput);
    expect(mocks.saveEstimate).toHaveBeenCalledWith(sb, EST, expect.any(Object));
  });

  it("refuses invalid input with the schema's words, and saves nothing", async () => {
    expect(await saveEstimateAction(null, { ...saveInput, expiry_date: "2026-10-01" })).toEqual({
      ok: false,
      error: "Valid until cannot be before the estimate date.",
    });
    expect(await saveEstimateAction("not-an-id", saveInput)).toEqual({ ok: false, error: "Estimate not found" });
    expect(mocks.saveEstimate).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("passes the database's refusal through", async () => {
    const words = "EST-000001 has been turned into an invoice (INV-000123), so it can no longer be edited.";
    mocks.saveEstimate.mockRejectedValue(new EstimatesError(words));
    expect(await saveEstimateAction(EST, saveInput)).toEqual({ ok: false, error: words });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("declineEstimateAction and reopenEstimateAction", () => {
  it("decline sets the flag, reopen clears it", async () => {
    mocks.setEstimateDeclined.mockResolvedValue({ id: EST, estimate_number: "EST-000001", declined_at: "x" });
    expect((await declineEstimateAction(EST)).ok).toBe(true);
    expect((await reopenEstimateAction(EST)).ok).toBe(true);
    expect(mocks.setEstimateDeclined.mock.calls).toEqual([
      [sb, EST, true],
      [sb, EST, false],
    ]);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/estimates");
  });

  it("passes a refusal through", async () => {
    const words = "EST-000001 has been turned into an invoice (a draft invoice), so it cannot be marked declined.";
    mocks.setEstimateDeclined.mockRejectedValue(new EstimatesError(words));
    expect(await declineEstimateAction(EST)).toEqual({ ok: false, error: words });
  });
});

describe("deleteEstimateAction", () => {
  it("deletes and returns the number", async () => {
    mocks.deleteEstimate.mockResolvedValue({ id: EST, estimate_number: "EST-000001" });
    expect(await deleteEstimateAction(EST)).toEqual({
      ok: true,
      data: { id: EST, estimate_number: "EST-000001" },
    });
    expect(mocks.deleteEstimate).toHaveBeenCalledWith(sb, EST);
  });

  it("shows the database's words when it refuses", async () => {
    const words = "EST-000001 has had an invoice made from it. Mark it declined instead.";
    mocks.deleteEstimate.mockRejectedValue(new EstimatesError(words));
    expect(await deleteEstimateAction(EST)).toEqual({ ok: false, error: words });
  });
});

describe("getEstimateInvoicePrefillAction", () => {
  it("returns the prefill for a writer", async () => {
    const prefill = { estimateId: EST, estimateNumber: "EST-000001", values: { customer_id: CUSTOMER, lines: [] }, blocked: null };
    mocks.getEstimateInvoicePrefill.mockResolvedValue(prefill);
    expect(await getEstimateInvoicePrefillAction(EST)).toEqual({ ok: true, data: prefill });
  });

  it("says when there is no such estimate", async () => {
    mocks.getEstimateInvoicePrefill.mockResolvedValue(null);
    expect(await getEstimateInvoicePrefillAction(EST)).toEqual({ ok: false, error: "Estimate not found" });
  });
});

describe("getEstimateDocumentAction", () => {
  it("builds the printable model on the server", async () => {
    mocks.getEstimateDocumentSource.mockResolvedValue({
      estimate: {
        estimate_number: "EST-000001",
        estimate_date: "2026-10-12",
        expiry_date: "2026-11-11",
        currency_code: "USD",
        subtotal_minor: 45_000,
        tax_minor: 0,
        total_minor: 45_000,
        memo: null,
      },
      lines: [{ line_order: 0, description: "Oak bench", quantity: 1, unit_price_minor: 45_000, line_subtotal_minor: 45_000, line_tax_minor: 0, line_total_minor: 45_000 }],
      customer: { name: "Juniper Street Studio", email: null, contact_name: null, phone: null, address_line1: null, address_line2: null, city: null, region: null, postal_code: null, country: null },
      company: { legal_name: "Larkspur Joinery LLC", dba_name: null, address_line1: null, address_line2: null, city: null, region: null, postal_code: null, country: null },
    });
    const result = await getEstimateDocumentAction(EST);
    expect(result.ok).toBe(true);
    expect(result.data?.title).toBe("Estimate EST-000001");
    expect(result.data?.fileName).toBe("Estimate EST-000001 Juniper Street Studio.pdf");
  });
});

describe("createInvoiceAction routes by the estimate it carries", () => {
  it("without an estimate, makes the draft as before and refreshes only /invoices", async () => {
    mocks.createDraftInvoice.mockResolvedValue({ id: "inv-1" });
    expect(await createInvoiceAction(invoiceInput)).toEqual({ ok: true, data: { id: "inv-1" } });
    expect(mocks.createDraftInvoice).toHaveBeenCalledWith(sb, invoiceCreateSchema.parse(invoiceInput));
    expect(mocks.createInvoiceFromEstimate).not.toHaveBeenCalled();
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual(["/invoices"]);
  });

  it("treats a null estimate as none", async () => {
    mocks.createDraftInvoice.mockResolvedValue({ id: "inv-1" });
    await createInvoiceAction({ ...invoiceInput, estimateId: null });
    expect(mocks.createDraftInvoice).toHaveBeenCalledTimes(1);
    expect(mocks.createInvoiceFromEstimate).not.toHaveBeenCalled();
  });

  it("with an estimate, makes and links the draft in one call, and refreshes estimates and the dashboard too", async () => {
    mocks.createInvoiceFromEstimate.mockResolvedValue("inv-2");
    expect(await createInvoiceAction({ ...invoiceInput, estimateId: EST })).toEqual({
      ok: true,
      data: { id: "inv-2" },
    });
    // The invoice fields go through exactly as they would without the estimate.
    expect(mocks.createInvoiceFromEstimate).toHaveBeenCalledWith(sb, EST, invoiceCreateSchema.parse(invoiceInput));
    expect(mocks.createDraftInvoice).not.toHaveBeenCalled();
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      "/invoices",
      "/estimates",
      "/dashboard",
    ]);
  });

  it("validates the invoice input the same way with an estimate", async () => {
    const result = await createInvoiceAction({ ...invoiceInput, lines: [], estimateId: EST });
    expect(result).toEqual({ ok: false, error: "Add at least one line item" });
    expect(mocks.createInvoiceFromEstimate).not.toHaveBeenCalled();
  });

  it("refuses an estimate id that is not one", async () => {
    const result = await createInvoiceAction({ ...invoiceInput, estimateId: "est-1" });
    expect(result).toEqual({ ok: false, error: "The estimate this invoice is made from was not found" });
    expect(mocks.createInvoiceFromEstimate).not.toHaveBeenCalled();
    expect(mocks.createDraftInvoice).not.toHaveBeenCalled();
  });

  it("shows the database's refusal in the form", async () => {
    const words = "EST-000001 has already been turned into an invoice (a draft invoice).";
    mocks.createInvoiceFromEstimate.mockRejectedValue(new EstimatesError(words));
    expect(await createInvoiceAction({ ...invoiceInput, estimateId: EST })).toEqual({ ok: false, error: words });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("is refused to a read-only role either way", async () => {
    mocks.getUserRole.mockResolvedValue("viewer");
    expect(await createInvoiceAction({ ...invoiceInput, estimateId: EST })).toEqual({ ok: false, error: DENIED });
    expect(await createInvoiceAction(invoiceInput)).toEqual({
      ok: false,
      error: "You do not have permission to create invoices",
    });
    expect(mocks.createInvoiceFromEstimate).not.toHaveBeenCalled();
    expect(mocks.createDraftInvoice).not.toHaveBeenCalled();
  });

  it("lets sales make a draft of its own, but not turn an estimate into one", async () => {
    mocks.getUserRole.mockResolvedValue("sales");
    mocks.createDraftInvoice.mockResolvedValue({ id: "inv-3" });
    expect(await createInvoiceAction(invoiceInput)).toEqual({ ok: true, data: { id: "inv-3" } });
    expect(await createInvoiceAction({ ...invoiceInput, estimateId: EST })).toEqual({ ok: false, error: DENIED });
    expect(mocks.createInvoiceFromEstimate).not.toHaveBeenCalled();
  });
});
