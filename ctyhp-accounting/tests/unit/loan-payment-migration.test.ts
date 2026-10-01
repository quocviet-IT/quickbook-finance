import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function body(): string {
  const raw = readFileSync(join(process.cwd(), "supabase/migrations/0130_loan_payment.sql"), "utf8");
  return raw.replace(/\/\*[\s\S]*?\*\//g, "").split(/\r?\n/).map((l) => l.replace(/--.*$/, "")).join("\n");
}

describe("0130 loan payment", () => {
  const sql = body();
  it("posts a loan payment, staff only, through acc_post_entry", () => {
    expect(sql).toMatch(/create or replace function acc_post_bank_loan_payment\(\s*p_transaction_id uuid,\s*p_repayment_id uuid,\s*p_interest_minor bigint\s*\)/i);
    expect(sql).toMatch(/security definer set search_path = public/i);
    expect(sql).toMatch(/if not acc_is_staff\(\) then/i);
    expect(sql).toMatch(/acc_post_entry\(/i);
  });
  it("takes the accounts from the register, never from the caller", () => {
    expect(sql).toMatch(/select \* into v_reg from acc_repayment_account where id = p_repayment_id/i);
    expect(sql).toMatch(/select \* into v_loan from acc_account where id = v_reg\.account_id/i);
    expect(sql).toMatch(/select \* into v_interest from acc_account where id = v_reg\.interest_account_id/i);
  });
  it("works out the principal itself and refuses interest outside 0..payment", () => {
    expect(sql).toMatch(/v_principal := v_abs - p_interest_minor/i);
    expect(sql).toMatch(/p_interest_minor is null or p_interest_minor < 0 or p_interest_minor > v_abs/i);
  });
  it("is callable by authenticated users and the service role only", () => {
    expect(sql).toMatch(/revoke all on function acc_post_bank_loan_payment\(uuid, uuid, bigint\) from public, anon/i);
    expect(sql).toMatch(/grant execute on function acc_post_bank_loan_payment\(uuid, uuid, bigint\) to authenticated, service_role/i);
  });
});
