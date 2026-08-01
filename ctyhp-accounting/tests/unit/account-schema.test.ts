import { describe, it, expect } from "vitest";
import { accountCreateSchema, accountUpdateSchema } from "@/lib/domain/schemas";

describe("accountCreateSchema", () => {
  it("accepts a valid account and applies defaults", () => {
    const parsed = accountCreateSchema.parse({
      account_code: "4000",
      name: "Sales Revenue",
      account_type: "income",
    });
    expect(parsed.is_posting_account).toBe(true);
    expect(parsed.status).toBe("active");
    expect(parsed.cash_flow_role).toBe("operating");
  });

  it("uses conservative cash-flow defaults and accepts an explicit policy", () => {
    const bank = accountCreateSchema.parse({
      account_code: "1015",
      name: "Savings",
      account_type: "bank",
    });
    const ambiguousLiability = accountCreateSchema.parse({
      account_code: "2300",
      name: "Other current liability",
      account_type: "current_liability",
    });
    const loan = accountCreateSchema.parse({
      account_code: "2310",
      name: "Working capital loan",
      account_type: "current_liability",
      cash_flow_role: "financing",
    });

    expect(bank.cash_flow_role).toBe("cash");
    expect(ambiguousLiability.cash_flow_role).toBe("unclassified");
    expect(loan.cash_flow_role).toBe("financing");
  });

  it("rejects an unknown cash-flow role", () => {
    expect(() =>
      accountCreateSchema.parse({
        account_code: "2311",
        name: "Bad policy",
        account_type: "current_liability",
        cash_flow_role: "cash-ish",
      }),
    ).toThrow();
  });

  it("rejects an empty code", () => {
    expect(() =>
      accountCreateSchema.parse({ account_code: "", name: "X", account_type: "income" }),
    ).toThrow();
  });

  it("rejects an invalid account type", () => {
    expect(() =>
      accountCreateSchema.parse({ account_code: "9", name: "X", account_type: "nonsense" }),
    ).toThrow();
  });

  it("rejects a malformed currency code", () => {
    expect(() =>
      accountCreateSchema.parse({
        account_code: "1000",
        name: "Bank",
        account_type: "bank",
        currency_code: "dong",
      }),
    ).toThrow();
  });

  it("rejects a non-uuid parent", () => {
    expect(() =>
      accountCreateSchema.parse({
        account_code: "1001",
        name: "Sub",
        account_type: "bank",
        parent_account_id: "not-a-uuid",
      }),
    ).toThrow();
  });

  it("update schema forbids changing the account code", () => {
    expect("account_code" in accountUpdateSchema.shape).toBe(false);
  });
});
