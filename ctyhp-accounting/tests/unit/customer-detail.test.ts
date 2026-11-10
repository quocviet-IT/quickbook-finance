import { describe, expect, it } from "vitest";
import { customerFacts, mergeCustomerTransactions, transactionTypeLabel } from "@/lib/domain/customer-detail";
import type { CustomerCreditRow } from "@/lib/services/credit";

const TODAY = "2026-11-10";
const open = (id: string, due: string | null, balance: number, total = balance, status: "issued" | "partial" = "issued") => ({
  id, status, invoice_number: `INV-${id}`, due_date: due, total_minor: total, balance_due_minor: balance, created_at: "2026-01-01T00:00:00Z",
});
function credit(over: Partial<CustomerCreditRow["status"]> = {}): CustomerCreditRow {
  return {
    customerId: "c", name: "BlueRidge Foods", isActive: true, creditLimitMinor: null, creditTermsDays: null, creditHold: false,
    creditReviewedAt: null, openBalanceMinor: 1_000_000, overdueMinor: 1_000_000, oldestDueDate: "2026-04-23",
    salesWindowMinor: 0, hasBillingAddress: false,
    status: { state: "no_limit", label: "No limit set", availableMinor: null, utilization: null, overdueMinor: 1_000_000, daysSalesOutstanding: null, reasons: [], ...over },
  };
}

describe("customerFacts", () => {
  it("sums what is owed and overdue from the open invoices, and finds the latest one", () => {
    const facts = customerFacts({
      creditTermsDays: null, defaultTermsDays: 30, credit: credit(), today: TODAY,
      openInvoices: [open("4", "2026-04-23", 1_000_000, 2_680_000, "partial"), open("9", "2026-11-15", 50_000)],
    });
    expect(facts).toEqual({
      owedMinor: 1_050_000, openCount: 2, overdueMinor: 1_000_000, oldestLateDays: 201,
      availableMinor: null, limitMinor: null, termsDays: 30, termsAreDefault: true, dsoDays: null, creditKnown: true,
    });
  });

  it("uses the customer's own terms and the credit row's limit, availability and DSO", () => {
    const facts = customerFacts({
      creditTermsDays: 15, defaultTermsDays: 30, today: TODAY, openInvoices: [],
      credit: { ...credit({ state: "within_limit", availableMinor: 400_000, daysSalesOutstanding: 22.4 }), creditLimitMinor: 500_000 },
    });
    expect(facts).toMatchObject({ owedMinor: 0, openCount: 0, overdueMinor: 0, oldestLateDays: null, availableMinor: 400_000, limitMinor: 500_000, termsDays: 15, termsAreDefault: false, dsoDays: 22.4 });
  });

  it("says so when the credit status could not be read", () => {
    expect(customerFacts({ creditTermsDays: null, defaultTermsDays: 30, credit: null, today: TODAY, openInvoices: [] })).toMatchObject({
      creditKnown: false, availableMinor: null, limitMinor: null, dsoDays: null,
    });
  });
});

describe("mergeCustomerTransactions", () => {
  it("puts every kind of document in one list, newest first, typed and signed as the customer sees it", () => {
    const rows = mergeCustomerTransactions({
      invoices: [{ id: "i1", invoice_number: "INV-000004", issue_date: "2026-03-24", total_minor: 2_680_000, currency_code: "USD", status: "partial", memo: null }],
      payments: [{ id: "p1", payment_number: "PMT-000003", payment_date: "2026-03-30", amount_minor: 1_680_000, currency_code: "USD", status: "applied", memo: "RCV-1003" }],
      creditMemos: [{ id: "m1", credit_memo_number: "CM-000001", memo_date: "2026-03-30", total_minor: 5_000, currency_code: "USD", status: "applied", memo: null }],
      salesReceipts: [{ id: "s1", receipt_number: "SR-000001", receipt_date: "2026-02-01", total_minor: 9_900, currency_code: "USD", status: "posted", reference: "Card" }],
    });
    expect(rows.map((r) => [r.type, r.number, r.date, r.amountMinor, r.reference])).toEqual([
      ["payment", "PMT-000003", "2026-03-30", 1_680_000, "RCV-1003"],
      ["credit_memo", "CM-000001", "2026-03-30", 5_000, null],
      ["invoice", "INV-000004", "2026-03-24", 2_680_000, null],
      ["sales_receipt", "SR-000001", "2026-02-01", 9_900, "Card"],
    ]);
  });

  it("names each type for the reader", () => {
    expect(transactionTypeLabel("credit_memo")).toBe("Credit memo");
    expect(transactionTypeLabel("sales_receipt")).toBe("Sales receipt");
  });
});
