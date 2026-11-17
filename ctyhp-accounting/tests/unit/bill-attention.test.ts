import { describe, expect, it } from "vitest";
import { billAttention, billStatusCounts, sortBillsByAttention, type AttentionBill } from "@/lib/domain/bill-attention";
import { documentAttentionLook, invoiceAttention, type AttentionInvoice } from "@/lib/domain/invoice-attention";

const TODAY = "2026-11-17";

function bill(over: Partial<AttentionBill> & { id: string }): AttentionBill {
  return {
    status: "open",
    bill_number: null,
    due_date: null,
    total_minor: 100_00,
    balance_due_minor: 100_00,
    created_at: "2026-11-01T10:00:00Z",
    ...over,
  };
}

describe("billAttention", () => {
  it("calls an open or part-paid bill past its due date overdue, by how many days", () => {
    expect(billAttention(bill({ id: "a", due_date: "2026-11-10" }), TODAY)).toEqual({ kind: "overdue", days: 7 });
    expect(billAttention(bill({ id: "b", status: "partial", due_date: "2026-11-16" }), TODAY)).toEqual({ kind: "overdue", days: 1 });
  });

  it("calls one due today or within a week due soon", () => {
    expect(billAttention(bill({ id: "a", due_date: TODAY }), TODAY)).toEqual({ kind: "due-soon", days: 0 });
    expect(billAttention(bill({ id: "b", due_date: "2026-11-24" }), TODAY)).toEqual({ kind: "due-soon", days: 7 });
    expect(billAttention(bill({ id: "c", due_date: "2026-11-25" }), TODAY)).toEqual({ kind: "other" });
  });

  it("never calls a draft, a void, a paid bill or one with nothing due overdue", () => {
    expect(billAttention(bill({ id: "a", status: "draft", due_date: "2026-10-01" }), TODAY)).toEqual({ kind: "draft" });
    expect(billAttention(bill({ id: "b", status: "void", due_date: "2026-10-01" }), TODAY)).toEqual({ kind: "other" });
    expect(billAttention(bill({ id: "c", status: "paid", balance_due_minor: 0, due_date: "2026-10-01" }), TODAY)).toEqual({ kind: "other" });
    expect(billAttention(bill({ id: "d", due_date: null }), TODAY)).toEqual({ kind: "other" });
  });

  it("is the invoices' rule: the same dates give the same answer", () => {
    for (const due of ["2026-10-01", "2026-11-16", TODAY, "2026-11-20", "2026-12-31", null]) {
      const asInvoice: AttentionInvoice = {
        id: "i",
        status: "issued",
        invoice_number: null,
        due_date: due,
        total_minor: 100_00,
        balance_due_minor: 100_00,
        created_at: "2026-11-01T10:00:00Z",
      };
      expect(billAttention(bill({ id: "b", due_date: due }), TODAY), String(due)).toEqual(invoiceAttention(asInvoice, TODAY));
    }
  });

  it("reads the same words as an invoice in the status cell", () => {
    expect(documentAttentionLook(billAttention(bill({ id: "a", due_date: "2026-11-10" }), TODAY))).toEqual({ tone: "danger", label: "7 days late" });
    expect(documentAttentionLook(billAttention(bill({ id: "b", due_date: "2026-11-18" }), TODAY))).toEqual({ tone: "warning", label: "Due tomorrow" });
    expect(documentAttentionLook(billAttention(bill({ id: "c", status: "paid", balance_due_minor: 0 }), TODAY))).toBeNull();
  });
});

describe("sortBillsByAttention", () => {
  it("puts overdue first (oldest due first), then due soon, then drafts (newest first), then the rest by number, newest first", () => {
    const bills = [
      bill({ id: "paid-old", status: "paid", balance_due_minor: 0, bill_number: "BILL-000001", due_date: "2026-09-01" }),
      bill({ id: "draft-old", status: "draft", created_at: "2026-11-02T10:00:00Z" }),
      bill({ id: "soon", bill_number: "BILL-000007", due_date: "2026-11-20" }),
      bill({ id: "late-recent", bill_number: "BILL-000006", due_date: "2026-11-12" }),
      bill({ id: "open-later", bill_number: "BILL-000009", due_date: "2026-12-30" }),
      bill({ id: "draft-new", status: "draft", created_at: "2026-11-15T10:00:00Z" }),
      bill({ id: "late-oldest", bill_number: "BILL-000003", due_date: "2026-08-01" }),
      bill({ id: "today", bill_number: "BILL-000008", due_date: TODAY }),
    ];
    expect(sortBillsByAttention(bills, TODAY).map((b) => b.id)).toEqual([
      "late-oldest",
      "late-recent",
      "today",
      "soon",
      "draft-new",
      "draft-old",
      "open-later",
      "paid-old",
    ]);
  });

  it("returns a copy and leaves the list it was given alone", () => {
    const bills = [bill({ id: "b", bill_number: "BILL-000002" }), bill({ id: "a", due_date: "2026-01-01" })];
    const sorted = sortBillsByAttention(bills, TODAY);
    expect(sorted.map((b) => b.id)).toEqual(["a", "b"]);
    expect(bills.map((b) => b.id)).toEqual(["b", "a"]);
  });
});

describe("billStatusCounts", () => {
  it("counts each tab by the rule its filter applies, Overdue across Open and Partially paid", () => {
    const bills = [
      bill({ id: "1", status: "draft" }),
      bill({ id: "2", status: "open", due_date: "2026-11-01" }),
      bill({ id: "3", status: "partial", due_date: "2026-11-02" }),
      bill({ id: "4", status: "open", due_date: "2026-12-01" }),
      bill({ id: "5", status: "paid", balance_due_minor: 0, due_date: "2026-10-01" }),
      bill({ id: "6", status: "void", due_date: "2026-10-01" }),
    ];
    expect(billStatusCounts(bills, TODAY)).toEqual({ all: 6, overdue: 2, draft: 1, open: 2, partial: 1, paid: 1, void: 1 });
  });
});
