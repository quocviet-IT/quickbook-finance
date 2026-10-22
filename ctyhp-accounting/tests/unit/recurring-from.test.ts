import { describe, expect, it } from "vitest";
import { recurringTemplateCreateSchema } from "@/lib/domain/recurring";
import {
  ALREADY_RECURRING,
  firstDueAfter,
  recurringFromBill,
  recurringFromExpense,
  recurringFromInvoice,
  recurringFromJournal,
} from "@/lib/domain/recurring-from";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const D = "44444444-4444-4444-8444-444444444444";

describe("Make it recurring: a monthly schedule from a document that exists", () => {
  it("makes an invoice recur a month later, with its terms and lines, and remembers where it came from", () => {
    const input = recurringFromInvoice(
      {
        id: A,
        issue_date: "2026-10-15",
        due_date: "2026-11-14",
        customer_id: B,
        memo: "Monthly retainer",
        lines: [{ description: "Retainer", quantity: 1, unit_price_minor: 150_000, income_account_id: C, tax_code_id: null, item_id: null }],
      },
      "Example Customer",
      "$1,500.00",
      "2026-10-22",
    );
    expect(input).toMatchObject({
      name: "Example Customer · $1,500.00",
      document_type: "invoice",
      frequency: "monthly",
      interval_count: 1,
      start_date: "2026-11-15",
      end_date: null,
      payload: { customer_id: B, due_days: 30, memo: "Monthly retainer", source: { type: "invoice", id: A } },
    });
    expect(recurringTemplateCreateSchema.safeParse(input).success).toBe(true);
  });

  it("keeps a month-end document on the month's end", () => {
    const input = recurringFromExpense(
      { id: A, expense_date: "2026-01-31", vendor_id: null, payment_account_id: B, memo: null, lines: [{ description: "", expense_account_id: C, amount_minor: 5_000 }] },
      "Expense",
      "$50.00",
      "2026-01-31",
    );
    expect(input.start_date).toBe("2026-02-28");
    expect(recurringTemplateCreateSchema.safeParse(input).success).toBe(true);
  });

  it("gives a bill its usual terms, and drops the vendor's own reference, which names that one bill", () => {
    const input = recurringFromBill(
      {
        id: A,
        bill_date: "2026-10-01",
        due_date: null,
        vendor_id: B,
        vendor_ref: "INV-778",
        memo: null,
        lines: [{ description: "Rent", expense_account_id: C, amount_minor: 200_000, item_id: null }],
      },
      "Example Landlord",
      "$2,000.00",
      "2026-10-22",
    );
    expect(input.payload).toMatchObject({ vendor_ref: null, due_days: 30, source: { type: "bill", id: A } });
    expect(input.start_date).toBe("2026-11-01");
    expect(recurringTemplateCreateSchema.safeParse(input).success).toBe(true);
  });

  it("makes a journal entry written by hand recur, leaving out lines that move nothing", () => {
    const input = recurringFromJournal(
      {
        id: A,
        entryNumber: "JE-000042",
        entryDate: "2026-10-31",
        description: null,
        lines: [
          { accountId: B, debitMinor: 10_000, creditMinor: 0 },
          { accountId: C, debitMinor: 0, creditMinor: 10_000 },
          { accountId: D, debitMinor: 0, creditMinor: 0 },
        ],
      },
      "$100.00",
      "2026-10-31",
    );
    expect(input.name).toBe("As JE-000042 · $100.00");
    expect(input.start_date).toBe("2026-11-30");
    expect(input.payload).toMatchObject({ description: "As JE-000042", source: { type: "journal", id: A } });
    expect((input.payload as { lines: unknown[] }).lines).toHaveLength(2);
    expect(recurringTemplateCreateSchema.safeParse(input).success).toBe(true);
  });

  it("keeps a schedule's name within what the schedule takes", () => {
    const input = recurringFromExpense(
      { id: A, expense_date: "2026-10-01", vendor_id: B, payment_account_id: C, memo: null, lines: [{ description: "", expense_account_id: D, amount_minor: 1 }] },
      "x".repeat(300),
      "$0.01",
      "2026-10-22",
    );
    expect(input.name.length).toBeLessThanOrEqual(160);
    expect(recurringTemplateCreateSchema.safeParse(input).success).toBe(true);
  });

  it("first falls due after today, never in the past, so an old document sets off no catch-up drafts", () => {
    expect(firstDueAfter("2026-03-15", "2026-10-22")).toBe("2026-11-15");
    expect(firstDueAfter("2026-10-15", "2026-10-22")).toBe("2026-11-15");
    expect(firstDueAfter("2026-10-22", "2026-10-22")).toBe("2026-11-22");
    expect(firstDueAfter("2026-01-31", "2026-10-22")).toBe("2026-10-31");
    expect(firstDueAfter("2026-01-31", "2026-10-31")).toBe("2026-11-30");
  });

  it("says, in the design's words, when the entry already recurs", () => {
    expect(ALREADY_RECURRING).toBe("That entry is already set to recur.");
  });
});
