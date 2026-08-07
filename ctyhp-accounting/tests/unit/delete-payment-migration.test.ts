import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

const file = "0106_delete_payment.sql";
const sql = readFileSync(join(process.cwd(), "supabase", "migrations", file), "utf8");
const code = sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");

describe("0106_delete_payment", () => {
  it("is an administrator's action, not ordinary bookkeeping", () => {
    expect(code).toMatch(/acc_is_admin\(\)/);
  });

  it("voids through the existing function rather than repeating its guards", () => {
    // Refunds, bank matches, statement reconciliation, closed periods and
    // restoring the invoice balances all live in acc_void_payment. A second
    // copy of those rules is a second chance to get them wrong.
    expect(code).toMatch(/acc_void_payment\(/);
  });

  it("accounts for the number it frees", () => {
    expect(code).toMatch(/insert into acc_number_gap_note/);
    expect(code).toMatch(/'payment'/);
  });

  it("insists on a reason long enough to be a reason", () => {
    expect(code).toMatch(/length\(v_reason\)\s*<\s*10/);
  });

  it("removes the payment and the void entry it left behind", () => {
    expect(code).toMatch(/delete from acc_payment_allocation/);
    expect(code).toMatch(/delete from acc_payment\b/);
    expect(code).toMatch(/delete from acc_journal_line/);
    expect(code).toMatch(/delete from acc_journal_entry/);
  });

  it("reaches a company created tomorrow", () => {
    const plan = planCompanySchema([{ file, sql }], "co_probe");
    expect(plan.statements.join("\n")).toMatch(/acc_delete_payment/);
    expect(plan.skipped).toEqual([]);
  });
});
