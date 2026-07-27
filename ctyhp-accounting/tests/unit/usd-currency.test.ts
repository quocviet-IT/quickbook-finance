import { describe, expect, it } from "vitest";
import {
  accountCreateSchema,
  companySettingsSchema,
  invoiceCreateSchema,
  usdCurrencySchema,
} from "@/lib/domain/schemas";

describe("USD-only input policy", () => {
  it("accepts USD and rejects foreign currencies", () => {
    expect(usdCurrencySchema.safeParse("USD").success).toBe(true);
    expect(usdCurrencySchema.safeParse("EUR").success).toBe(false);
    expect(usdCurrencySchema.safeParse("VND").success).toBe(false);
  });

  it("defaults new accounts to USD", () => {
    const parsed = accountCreateSchema.parse({
      account_code: "1999",
      name: "Test Account",
      account_type: "current_asset",
      is_posting_account: true,
      status: "active",
    });
    expect(parsed.currency_code).toBe("USD");
  });

  it("rejects a foreign-currency invoice before it reaches the service", () => {
    const parsed = invoiceCreateSchema.safeParse({
      customer_id: "00000000-0000-4000-8000-000000000001",
      currency_code: "EUR",
      lines: [
        {
          description: "Foreign currency attempt",
          quantity: 1,
          unit_price_minor: 10_000,
          income_account_id: "00000000-0000-4000-8000-000000000002",
        },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("keeps the company base currency fixed at USD", () => {
    const parsed = companySettingsSchema.safeParse({
      legal_name: "CTYHP",
      fiscal_year_start_month: 1,
      base_currency_code: "VND",
      time_zone: "America/New_York",
      accounting_basis: "accrual",
      default_payment_terms_days: 30,
    });
    expect(parsed.success).toBe(false);
  });
});
