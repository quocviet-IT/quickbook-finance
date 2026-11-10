import { describe, expect, it } from "vitest";
import {
  DUE_SOON_DAYS,
  invoiceAttention,
  invoiceAttentionLook,
  invoiceStatusCounts,
  sortInvoicesByAttention,
  type AttentionInvoice,
} from "@/lib/domain/invoice-attention";

const TODAY = "2026-11-10";

function inv(over: Partial<AttentionInvoice> & { id: string }): AttentionInvoice {
  return {
    status: "issued",
    invoice_number: `INV-${over.id}`,
    due_date: "2026-12-31",
    total_minor: 10_000,
    balance_due_minor: 10_000,
    created_at: "2026-11-01T00:00:00Z",
    ...over,
  };
}

describe("invoiceAttention", () => {
  it("is overdue, with the days past due, when money is still owed after the due date", () => {
    expect(invoiceAttention(inv({ id: "1", due_date: "2026-10-31" }), TODAY)).toEqual({ kind: "overdue", days: 10 });
    expect(invoiceAttention(inv({ id: "2", status: "partial", balance_due_minor: 500, due_date: "2026-11-09" }), TODAY)).toEqual({
      kind: "overdue",
      days: 1,
    });
  });

  it(`is due soon within ${DUE_SOON_DAYS} days, today included`, () => {
    expect(invoiceAttention(inv({ id: "1", due_date: TODAY }), TODAY)).toEqual({ kind: "due-soon", days: 0 });
    expect(invoiceAttention(inv({ id: "2", due_date: "2026-11-17" }), TODAY)).toEqual({ kind: "due-soon", days: 7 });
    expect(invoiceAttention(inv({ id: "3", due_date: "2026-11-18" }), TODAY)).toEqual({ kind: "other" });
  });

  it("asks nothing of a paid or void invoice, whatever its due date", () => {
    expect(invoiceAttention(inv({ id: "1", status: "paid", balance_due_minor: 0, due_date: "2026-01-01" }), TODAY)).toEqual({
      kind: "other",
    });
    expect(invoiceAttention(inv({ id: "2", status: "void", balance_due_minor: 0, due_date: "2026-01-01" }), TODAY)).toEqual({
      kind: "other",
    });
  });

  it("treats a draft as waiting to be issued, not as late", () => {
    expect(invoiceAttention(inv({ id: "1", status: "draft", invoice_number: null, due_date: "2026-01-01" }), TODAY)).toEqual({
      kind: "draft",
    });
  });
});

describe("sortInvoicesByAttention", () => {
  // The list opened by number, newest first: the invoice 296 days late was last.
  it("puts overdue first (oldest due first), then due soon, then drafts, then the rest newest first", () => {
    const rows = [
      inv({ id: "000004", due_date: "2026-04-23", status: "partial", balance_due_minor: 1 }),
      inv({ id: "000005", status: "paid", balance_due_minor: 0 }),
      inv({ id: "000003", due_date: "2026-03-05" }),
      inv({ id: "000006", due_date: "2026-11-12" }),
      inv({ id: "draft-a", status: "draft", invoice_number: null, created_at: "2026-11-02T00:00:00Z" }),
      inv({ id: "draft-b", status: "draft", invoice_number: null, created_at: "2026-11-05T00:00:00Z" }),
      inv({ id: "000007", due_date: "2026-12-31" }),
      inv({ id: "000001", due_date: "2026-01-17" }),
    ];
    expect(sortInvoicesByAttention(rows, TODAY).map((r) => r.id)).toEqual([
      "000001",
      "000003",
      "000004",
      "000006",
      "draft-b",
      "draft-a",
      "000007",
      "000005",
    ]);
  });

  it("does not reorder the array it was given", () => {
    const rows = [inv({ id: "b", due_date: "2026-12-31" }), inv({ id: "a", due_date: "2026-01-01" })];
    sortInvoicesByAttention(rows, TODAY);
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
  });
});

describe("invoiceAttentionLook", () => {
  it("says which group the row is in, in words, on the danger or warning tone", () => {
    // "Overdue · 297 days" needs 135px and the list's status cell holds 124:
    // it was cut to "Overdue · 297 …", losing the number. "297 days late" is 103px.
    expect(invoiceAttentionLook({ kind: "overdue", days: 200 })).toEqual({ tone: "danger", label: "200 days late" });
    expect(invoiceAttentionLook({ kind: "overdue", days: 1 })).toEqual({ tone: "danger", label: "1 day late" });
    expect(invoiceAttentionLook({ kind: "due-soon", days: 0 })).toEqual({ tone: "warning", label: "Due today" });
    expect(invoiceAttentionLook({ kind: "due-soon", days: 1 })).toEqual({ tone: "warning", label: "Due tomorrow" });
    expect(invoiceAttentionLook({ kind: "due-soon", days: 5 })).toEqual({ tone: "warning", label: "Due in 5 days" });
  });

  it("leaves a draft and everything else to the invoice's own status", () => {
    expect(invoiceAttentionLook({ kind: "draft" })).toBeNull();
    expect(invoiceAttentionLook({ kind: "other" })).toBeNull();
  });
});

describe("invoiceStatusCounts", () => {
  it("counts each status tab by the same rule its filter uses", () => {
    const rows = [
      inv({ id: "1", due_date: "2026-01-17" }),
      inv({ id: "2", status: "partial", balance_due_minor: 1, due_date: "2026-04-23" }),
      inv({ id: "3", status: "paid", balance_due_minor: 0 }),
      inv({ id: "4", status: "draft", invoice_number: null }),
      inv({ id: "5" }),
    ];
    expect(invoiceStatusCounts(rows, TODAY)).toEqual({
      all: 5,
      overdue: 2,
      draft: 1,
      issued: 2,
      partial: 1,
      paid: 1,
      void: 0,
    });
  });
});
