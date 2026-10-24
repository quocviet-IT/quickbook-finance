import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COLUMN, TABLE_BOX_AT_1280 } from "@/lib/design/table-metrics";
import { TONES } from "@/lib/design/tone";
import type { AccountRow } from "@/lib/db/types";
import {
  SALES_RECEIPT_CLOSING_LINE,
  SALES_RECEIPT_METHODS,
  SALES_RECEIPT_METHOD_LABEL,
  buildSalesReceiptDocument,
  defaultDepositAccountId,
  depositAccountChoices,
  paymentLine,
  salesReceiptFileName,
  type SalesReceiptDocumentSource,
} from "@/lib/domain/sales-receipts";
import { salesReceiptCreateSchema, salesReceiptVoidSchema } from "@/lib/domain/schemas";
import { sourceLabel, sourceTone } from "@/lib/domain/entry-detail";
import {
  SALES_RECEIPT_COLUMN_WIDTH,
  SALES_RECEIPT_CUSTOMER_FLOOR,
  SALES_RECEIPT_DEPOSIT_FLOOR,
  SALES_RECEIPT_STATUS_TONES,
} from "@/app/(app)/sales-receipts/sales-receipt-columns";

const ROOT = process.cwd();
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

const account = (over: Partial<AccountRow>): AccountRow =>
  ({
    id: over.account_code ?? "x",
    account_code: "0000",
    name: "Account",
    account_type: "income",
    detail_type: null,
    status: "active",
    is_posting_account: true,
    ...over,
  }) as AccountRow;

describe("where a receipt's money may go", () => {
  const chart = [
    account({ account_code: "4000", name: "Sales", account_type: "income" }),
    account({ account_code: "1210", name: "Undeposited Funds", account_type: "current_asset", detail_type: "undeposited_funds" }),
    account({ account_code: "1020", name: "Bank – Checking", account_type: "bank", detail_type: "checking" }),
    account({ account_code: "1000", name: "Cash on Hand", account_type: "bank", detail_type: "cash_on_hand" }),
    account({ account_code: "1010", name: "Bank – Operating Account", account_type: "bank", detail_type: "checking" }),
    account({ account_code: "1030", name: "Old Savings", account_type: "bank", detail_type: "savings", status: "inactive" }),
    account({ account_code: "1001", name: "Bank header", account_type: "bank", is_posting_account: false }),
    account({ account_code: "1090", name: "Transfer Clearing", account_type: "current_asset", detail_type: "transfer_clearing" }),
  ];

  it("offers the active banks and cash, and Undeposited Funds, by code", () => {
    expect(depositAccountChoices(chart).map((a) => a.account_code)).toEqual(["1000", "1010", "1020", "1210"]);
  });

  it("starts on the first bank account, never on cash or Undeposited Funds", () => {
    expect(defaultDepositAccountId(depositAccountChoices(chart))).toBe("1010");
  });

  it("falls back to cash, then to Undeposited Funds, then to nothing", () => {
    const cashOnly = depositAccountChoices(chart.filter((a) => a.detail_type !== "checking"));
    expect(defaultDepositAccountId(cashOnly)).toBe("1000");
    const holdingOnly = depositAccountChoices(chart.filter((a) => a.account_type !== "bank"));
    expect(defaultDepositAccountId(holdingOnly)).toBe("1210");
    expect(defaultDepositAccountId([])).toBeNull();
  });
});

describe("how a receipt was paid", () => {
  it("names the method and the reference, either alone, or neither", () => {
    expect(paymentLine("check", " 1042 ")).toBe("Check · 1042");
    expect(paymentLine("bank_transfer", null)).toBe("Bank transfer");
    expect(paymentLine(null, "Slip 88")).toBe("Slip 88");
    expect(paymentLine(null, "  ")).toBeNull();
  });

  it("offers the methods Receive payment offers, each in words", () => {
    expect([...SALES_RECEIPT_METHODS].sort()).toEqual(["bank_transfer", "card", "cash", "check"]);
    for (const m of SALES_RECEIPT_METHODS) expect(SALES_RECEIPT_METHOD_LABEL[m]).toMatch(/^[A-Z][a-z ]+$/);
  });
});

describe("the printed receipt", () => {
  const source = (status: "posted" | "void"): SalesReceiptDocumentSource => ({
    receipt: {
      receipt_number: "SR-000007",
      receipt_date: "2026-09-12",
      currency_code: "USD",
      payment_method: "card",
      reference: null,
      subtotal_minor: 25000,
      tax_minor: 825,
      total_minor: 25825,
      memo: "  ",
      status,
    },
    lines: [
      { line_order: 0, description: "Fitting", quantity: 2, unit_price_minor: 5000, line_subtotal_minor: 10000, line_tax_minor: 825, line_total_minor: 10825 },
      { line_order: 1, description: "Widget", quantity: 3, unit_price_minor: 5000, line_subtotal_minor: 15000, line_tax_minor: 0, line_total_minor: 15000 },
    ],
    customer: { name: "Example: Walk-in / Counter", email: null, contact_name: null, phone: null, address_line1: null, address_line2: null, city: null, region: null, postal_code: null, country: null },
    company: { legal_name: "Example Co", display_name: "Example Co", address_line1: null, address_line2: null, city: null, region: null, postal_code: null, country: null, phone: null, email: null, tax_id: null } as unknown as SalesReceiptDocumentSource["company"],
  });

  it("is titled Sales Receipt, sold to the customer, paid in full", () => {
    const doc = buildSalesReceiptDocument(source("posted"));
    expect(doc.title).toBe("Sales Receipt SR-000007");
    expect(doc.partyHeading).toBe("SOLD TO");
    expect(doc.watermark).toBeNull();
    expect(doc.meta).toEqual([
      { label: "Receipt date", value: "2026-09-12" },
      { label: "Paid by", value: "Card" },
    ]);
    expect(doc.totals.at(-1)).toEqual({ label: "Paid", amount: "$258.25" });
    expect(doc.footer).toBe(SALES_RECEIPT_CLOSING_LINE);
    expect(doc.memo).toBeNull();
  });

  it("says VOID, and never Paid, once voided", () => {
    const doc = buildSalesReceiptDocument(source("void"));
    expect(doc.watermark).toBe("VOID");
    expect(doc.totals.some((t) => t.label === "Paid")).toBe(false);
    expect(doc.footer).toBe("This receipt was voided.");
  });

  it("saves under a name every file system takes", () => {
    expect(buildSalesReceiptDocument(source("posted")).fileName).toBe("Sales receipt SR-000007 Example Walk-in Counter.pdf");
    expect(salesReceiptFileName("SR-000001", "   ")).toBe("Sales receipt SR-000001.pdf");
  });
});

describe("what the server takes", () => {
  const line = { description: "Fitting", quantity: 1, unit_price_minor: 5000, income_account_id: "8a0c5c9e-0b3a-4e55-9d0e-6f1a2b3c4d5e" };
  const valid = {
    customer_id: "1b2c3d4e-5f60-4718-8293-a4b5c6d7e8f9",
    receipt_date: "2026-09-12",
    deposit_account_id: "2c3d4e5f-6071-4829-93a4-b5c6d7e8f901",
    lines: [line],
  };

  it("needs a customer, a date, where the money went and a line; the method is optional", () => {
    expect(salesReceiptCreateSchema.safeParse(valid).success).toBe(true);
    expect(salesReceiptCreateSchema.safeParse({ ...valid, customer_id: "" }).error?.issues[0].message).toBe("Select a customer");
    expect(salesReceiptCreateSchema.safeParse({ ...valid, deposit_account_id: undefined }).success).toBe(false);
    expect(salesReceiptCreateSchema.safeParse({ ...valid, lines: [] }).error?.issues[0].message).toBe("Add at least one line item");
    expect(salesReceiptCreateSchema.safeParse({ ...valid, payment_method: "bitcoin" }).success).toBe(false);
  });

  it("asks why a receipt is voided", () => {
    expect(salesReceiptVoidSchema.safeParse({ id: valid.customer_id, reason: " a " }).success).toBe(false);
    expect(salesReceiptVoidSchema.safeParse({ id: valid.customer_id, reason: "Entered twice" }).success).toBe(true);
  });
});

describe("the Sales Receipts screen", () => {
  it("fits the 984px box of a 1280px window, with both elastic columns at their floors", () => {
    const measured = sum(Object.values(SALES_RECEIPT_COLUMN_WIDTH));
    expect(measured + SALES_RECEIPT_CUSTOMER_FLOOR + SALES_RECEIPT_DEPOSIT_FLOOR).toBeLessThanOrEqual(TABLE_BOX_AT_1280);
    expect(SALES_RECEIPT_COLUMN_WIDTH.number).toBe(COLUMN.CODE);
    expect(SALES_RECEIPT_COLUMN_WIDTH.date).toBe(COLUMN.DATE);
    expect(SALES_RECEIPT_COLUMN_WIDTH.total).toBe(COLUMN.MONEY);
    expect(SALES_RECEIPT_COLUMN_WIDTH.status).toBe(COLUMN.STATUS);
  });

  it("draws every measured width it adds up", () => {
    const client = read("app", "(app)", "sales-receipts", "SalesReceiptsClient.tsx");
    for (const key of Object.keys(SALES_RECEIPT_COLUMN_WIDTH)) expect(client, key).toContain(`width: W.${key}`);
    expect(client.match(/width: W\.\w+/g)).toHaveLength(Object.keys(SALES_RECEIPT_COLUMN_WIDTH).length);
    expect(client).toContain("floor: SALES_RECEIPT_CUSTOMER_FLOOR");
    expect(client).toContain("floor: SALES_RECEIPT_DEPOSIT_FLOOR");
  });

  it("reads Paid and Void on the shared tones", () => {
    expect(SALES_RECEIPT_STATUS_TONES.posted).toEqual({ tone: "positive", label: "Paid" });
    expect(SALES_RECEIPT_STATUS_TONES.void.label).toBe("Void");
    for (const t of Object.values(SALES_RECEIPT_STATUS_TONES)) expect(TONES).toContain(t.tone);
  });

  it("never edits a saved receipt: the dialog only views it, and offers Void", () => {
    const form = read("app", "(app)", "sales-receipts", "SalesReceiptFormModal.tsx");
    expect(form).toMatch(/const readOnly = receipt !== null \|\| !canWrite;/);
    expect(form).toContain("Save and post");
    expect(form).not.toMatch(/updateSalesReceipt|saveSalesReceipt/);
  });

  it("names the entry it posts in the ledger's words, as a sale", () => {
    expect(sourceLabel("sales_receipt")).toBe("Sales receipt");
    expect(sourceTone("sales_receipt")).toBe("sales");
  });
});
