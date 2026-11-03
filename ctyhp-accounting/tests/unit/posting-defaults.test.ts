import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultIn,
  lineExpenseDefault,
  POSTING_DEFAULT_RULES,
  refillLineAccounts,
} from "@/lib/domain/posting-defaults";
import { postingDefaultsSchema } from "@/lib/domain/schemas";

const account = (over: Partial<Parameters<typeof POSTING_DEFAULT_RULES.depositAccountId>[0]>) => ({
  account_type: "bank" as const,
  account_code: "1020",
  detail_type: null,
  is_posting_account: true,
  status: "active" as const,
  ...over,
});

describe("POSTING_DEFAULT_RULES", () => {
  it("lets money land in a bank account or Undeposited Funds, and nowhere else", () => {
    const rule = POSTING_DEFAULT_RULES.depositAccountId;
    expect(rule(account({}))).toBe(true);
    expect(rule(account({ account_type: "current_asset", account_code: "1210", detail_type: "undeposited_funds" }))).toBe(true);
    expect(rule(account({ account_type: "credit_card" }))).toBe(false);
    expect(rule(account({ status: "inactive" }))).toBe(false);
    expect(rule(account({ is_posting_account: false }))).toBe(false);
  });

  it("pays from a bank or a credit card account", () => {
    expect(POSTING_DEFAULT_RULES.payFromAccountId(account({ account_type: "credit_card" }))).toBe(true);
    expect(POSTING_DEFAULT_RULES.payFromAccountId(account({ account_type: "current_asset", detail_type: "undeposited_funds" }))).toBe(false);
  });

  it("takes sales revenue for income, and expense or cost of goods sold for expense", () => {
    expect(POSTING_DEFAULT_RULES.incomeAccountId(account({ account_type: "income" }))).toBe(true);
    expect(POSTING_DEFAULT_RULES.incomeAccountId(account({ account_type: "other_income" }))).toBe(false);
    for (const type of ["expense", "cost_of_goods_sold", "other_expense"] as const) {
      expect(POSTING_DEFAULT_RULES.expenseAccountId(account({ account_type: type }))).toBe(true);
    }
    expect(POSTING_DEFAULT_RULES.expenseAccountId(account({ account_type: "fixed_asset" }))).toBe(false);
  });

  it("are the rules the database checks", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/0187_posting_defaults.sql"), "utf8");
    expect(sql).toContain("(a.account_type = 'bank' or a.detail_type = 'undeposited_funds' or a.account_code = '1210')");
    expect(sql).toContain("a.account_type in ('bank', 'credit_card')");
    expect(sql).toContain("a.account_type = 'income'");
    expect(sql).toContain("a.account_type in ('expense', 'cost_of_goods_sold', 'other_expense')");
    expect(sql.match(/a\.is_posting_account and a\.status = 'active'/g)).toHaveLength(4);
  });
});

describe("defaultIn", () => {
  const choices = [{ id: "a" }, { id: "b" }];
  it("fills a default only while the form still offers it", () => {
    expect(defaultIn("b", choices)).toBe("b");
    expect(defaultIn("gone", choices)).toBeUndefined();
    expect(defaultIn(null, choices)).toBeUndefined();
  });
});

describe("lineExpenseDefault", () => {
  const choices = [{ id: "vendor-acct" }, { id: "company-acct" }];
  it("prefers the vendor's own account, then the company's", () => {
    expect(lineExpenseDefault("vendor-acct", "company-acct", choices)).toBe("vendor-acct");
    expect(lineExpenseDefault(null, "company-acct", choices)).toBe("company-acct");
    expect(lineExpenseDefault("inactive", "company-acct", choices)).toBe("company-acct");
    expect(lineExpenseDefault(null, null, choices)).toBeUndefined();
  });
});

describe("refillLineAccounts", () => {
  type Line = { description?: string; expense_account_id?: string };
  it("moves the lines the form filled, and leaves one somebody chose", () => {
    const lines: Line[] = [
      { description: "empty" },
      { description: "company default", expense_account_id: "company" },
      { description: "chosen", expense_account_id: "chosen" },
    ];
    expect(refillLineAccounts(lines, "expense_account_id", ["company"], "vendor")).toEqual([
      { description: "empty", expense_account_id: "vendor" },
      { description: "company default", expense_account_id: "vendor" },
      { description: "chosen", expense_account_id: "chosen" },
    ]);
  });

  it("changes nothing when there is no account to move to", () => {
    const lines: Line[] = [{ description: "empty" }];
    expect(refillLineAccounts(lines, "expense_account_id", ["company"], undefined)).toEqual(lines);
  });
});

describe("postingDefaultsSchema", () => {
  it("takes account ids, or none, and refuses anything else", () => {
    const id = "6f1c2a4e-1d1b-4c55-9f0e-2f4b0e8b9a11";
    expect(postingDefaultsSchema.safeParse({ depositAccountId: id, incomeAccountId: null }).success).toBe(true);
    expect(postingDefaultsSchema.safeParse({}).success).toBe(true);
    expect(postingDefaultsSchema.safeParse({ expenseAccountId: "1010" }).success).toBe(false);
  });
});
