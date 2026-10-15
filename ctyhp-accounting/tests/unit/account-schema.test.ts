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

describe("accountUpdateSchema", () => {
  it("changes only what it is given — renaming an inactive account must not reactivate it", () => {
    expect(accountUpdateSchema.parse({ name: "Rent" })).toEqual({ name: "Rent" });
    expect(accountUpdateSchema.parse({ cash_flow_role: "operating" })).toEqual({ cash_flow_role: "operating" });
  });

  it("carries the clearing tick when given, and leaves it alone when not", () => {
    expect(accountUpdateSchema.parse({ is_clearing: true })).toEqual({ is_clearing: true });
    expect("is_clearing" in accountUpdateSchema.parse({ name: "Rent" })).toBe(false);
    const created = accountCreateSchema.parse({ account_code: "1291", name: "Payroll Clearing", account_type: "current_liability" });
    expect(created.is_clearing).toBe(false);
    expect(
      accountCreateSchema.parse({ account_code: "1291", name: "Payroll Clearing", account_type: "current_liability", is_clearing: true }).is_clearing,
    ).toBe(true);
  });

  describe("clearing rule", () => {
    const WORDS = "Only a current asset or a current liability can be a clearing account.";
    const base = { account_code: "1291", name: "Payroll Clearing" };

    it("accepts the tick on a current asset and a current liability", () => {
      for (const account_type of ["current_asset", "current_liability"] as const) {
        expect(accountCreateSchema.parse({ ...base, account_type, is_clearing: true }).is_clearing).toBe(true);
      }
    });

    it("refuses the tick on any other type, in words", () => {
      for (const account_type of ["expense", "bank", "income", "equity", "fixed_asset"] as const) {
        const r = accountCreateSchema.safeParse({ ...base, account_type, is_clearing: true });
        expect(r.success).toBe(false);
        if (!r.success) expect(r.error.issues[0]?.message).toBe(WORDS);
      }
    });

    it("lets an untick through on any type, and defaults to false", () => {
      expect(accountCreateSchema.parse({ ...base, account_type: "expense" }).is_clearing).toBe(false);
      expect(accountCreateSchema.parse({ ...base, account_type: "bank", is_clearing: false }).is_clearing).toBe(false);
    });

    it("refuses an update that ticks while moving to a type that cannot clear", () => {
      const r = accountUpdateSchema.safeParse({ account_type: "expense", is_clearing: true });
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues[0]?.message).toBe(WORDS);
      expect(accountUpdateSchema.parse({ account_type: "expense", is_clearing: false })).toEqual({
        account_type: "expense",
        is_clearing: false,
      });
      expect(accountUpdateSchema.parse({ account_type: "current_asset", is_clearing: true }).is_clearing).toBe(true);
    });
  });
});
