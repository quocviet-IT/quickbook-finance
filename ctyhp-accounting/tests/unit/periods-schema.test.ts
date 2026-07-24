import { describe, it, expect } from "vitest";
import { companySettingsSchema, closePeriodSchema } from "@/lib/domain/schemas";

describe("companySettingsSchema", () => {
  it("requires legal name and a valid fiscal start month", () => {
    expect(companySettingsSchema.safeParse({ legal_name: "CTYHP LLC", fiscal_year_start_month: 1, accounting_basis: "accrual", default_payment_terms_days: 30 }).success).toBe(true);
    expect(companySettingsSchema.safeParse({ legal_name: "", fiscal_year_start_month: 1, accounting_basis: "accrual", default_payment_terms_days: 30 }).success).toBe(false);
    expect(companySettingsSchema.safeParse({ legal_name: "X", fiscal_year_start_month: 13, accounting_basis: "accrual", default_payment_terms_days: 30 }).success).toBe(false);
  });
});

describe("closePeriodSchema", () => {
  it("requires a non-empty reason", () => {
    expect(closePeriodSchema.safeParse({ reason: "" }).success).toBe(false);
    expect(closePeriodSchema.safeParse({ reason: "month-end close" }).success).toBe(true);
  });
});
