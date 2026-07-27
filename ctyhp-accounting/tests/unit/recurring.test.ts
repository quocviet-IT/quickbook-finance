import { describe, expect, it } from "vitest";
import {
  nextRecurringDate,
  recurringAmountMinor,
  recurringTemplateCreateSchema,
} from "@/lib/domain/recurring";

describe("recurring schedules", () => {
  it("preserves a month-end schedule", () => {
    expect(nextRecurringDate("2026-01-31", "2026-01-31", "monthly", 1)).toBe("2026-02-28");
    expect(nextRecurringDate("2026-02-28", "2026-01-31", "monthly", 1)).toBe("2026-03-31");
  });

  it("preserves an anchored day when a short month intervenes", () => {
    expect(nextRecurringDate("2026-01-30", "2026-01-30", "monthly", 1)).toBe("2026-02-28");
    expect(nextRecurringDate("2026-02-28", "2026-01-30", "monthly", 1)).toBe("2026-03-30");
  });

  it("advances weekly and quarterly intervals", () => {
    expect(nextRecurringDate("2026-07-27", "2026-07-27", "weekly", 2)).toBe("2026-08-10");
    expect(nextRecurringDate("2026-01-15", "2026-01-15", "quarterly", 1)).toBe("2026-04-15");
  });

  it("rejects an end date before the first occurrence", () => {
    const parsed = recurringTemplateCreateSchema.safeParse({
      name: "Monthly rent",
      document_type: "expense",
      frequency: "monthly",
      interval_count: 1,
      start_date: "2026-08-01",
      end_date: "2026-07-01",
      payload: {
        payment_account_id: "c8434d83-e37f-43d5-9b63-cafa9db390d0",
        lines: [
          {
            description: "Rent",
            expense_account_id: "7541becf-70f0-4f3c-949b-6c6dcbe495e2",
            amount_minor: 250000,
          },
        ],
      },
    });
    expect(parsed.success).toBe(false);
  });

  it("calculates the review amount from balanced journal debits", () => {
    const input = recurringTemplateCreateSchema.parse({
      name: "Prepaid insurance",
      document_type: "journal",
      frequency: "monthly",
      interval_count: 1,
      start_date: "2026-08-31",
      payload: {
        description: "Monthly insurance allocation",
        lines: [
          {
            account_id: "c8434d83-e37f-43d5-9b63-cafa9db390d0",
            debit_minor: 10000,
            credit_minor: 0,
          },
          {
            account_id: "7541becf-70f0-4f3c-949b-6c6dcbe495e2",
            debit_minor: 0,
            credit_minor: 10000,
          },
        ],
      },
    });
    expect(recurringAmountMinor(input)).toBe(10000);
  });
});
