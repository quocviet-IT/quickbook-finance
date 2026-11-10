import { describe, expect, it } from "vitest";
import { invoiceVoidConfirm, invoiceVoidOption, type VoidableInvoice } from "@/lib/domain/invoice-void";

const ISSUED: VoidableInvoice = {
  status: "issued",
  invoice_number: "INV-000001",
  customer_name: "Alder Grove Ventures",
  total_minor: 1_850_000,
  balance_due_minor: 1_850_000,
  entry_number: "JE-000002",
};

const DRAFT: VoidableInvoice = {
  ...ISSUED,
  status: "draft",
  invoice_number: null,
  entry_number: null,
};

describe("invoiceVoidOption", () => {
  it("offers Void on a draft and on an issued invoice nothing has been applied to", () => {
    expect(invoiceVoidOption(DRAFT)).toEqual({ offered: true, blockedReason: null });
    expect(invoiceVoidOption(ISSUED)).toEqual({ offered: true, blockedReason: null });
  });

  // acc_void_invoice refuses whenever balance_due_minor <> total_minor. The menu
  // offered Void on INV-000004 (partially paid) and the database said no only
  // after the reader had confirmed.
  it("says why Void is unavailable once money is applied, by the database's own rule", () => {
    const partial = { ...ISSUED, status: "partial" as const, balance_due_minor: 1_000_000 };
    const creditedButIssued = { ...ISSUED, balance_due_minor: 1_849_999 };
    for (const invoice of [partial, creditedButIssued]) {
      const option = invoiceVoidOption(invoice);
      expect(option.offered).toBe(true);
      expect(option.offered && option.blockedReason).toBe(
        "Payments or credits are applied to it, so it cannot be voided",
      );
    }
  });

  it("does not offer Void on a paid or an already void invoice", () => {
    expect(invoiceVoidOption({ ...ISSUED, status: "paid", balance_due_minor: 0 })).toEqual({ offered: false });
    expect(invoiceVoidOption({ ...ISSUED, status: "void", balance_due_minor: 0 })).toEqual({ offered: false });
  });
});

describe("invoiceVoidConfirm", () => {
  it("names an issued invoice and the journal entry it reverses", () => {
    expect(invoiceVoidConfirm(ISSUED)).toEqual({
      title: "Void INV-000001?",
      content: "This reverses journal entry JE-000002, so the sale comes off the ledger. The number INV-000001 is not used again.",
    });
  });

  // A draft has posted nothing: telling the reader it "reverses its journal
  // entry" described something that does not exist.
  it("names a draft by its customer and says the ledger does not change", () => {
    const confirm = invoiceVoidConfirm(DRAFT);
    expect(confirm.title).toBe("Void the draft invoice for Alder Grove Ventures?");
    expect(confirm.content).toBe(
      "Nothing has been posted for a draft, so the ledger does not change. The draft stays in the list, marked Void.",
    );
    expect(confirm.content).not.toMatch(/journal entry/);
  });
});
