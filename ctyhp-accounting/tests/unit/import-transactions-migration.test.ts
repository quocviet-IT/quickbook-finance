import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

const file = "0100_import_transactions.sql";
const sql = readFileSync(join(process.cwd(), "supabase", "migrations", file), "utf8");

describe("import transactions migration", () => {
  it("exposes one gated function", () => {
    expect(sql).toMatch(/create or replace function acc_import_transactions\s*\(/i);
    expect(sql).toContain("acc_is_staff()");
    expect(sql).toMatch(
      /revoke all on function acc_import_transactions\(jsonb, uuid\) from public/i,
    );
    expect(sql).toMatch(
      /grant execute on function acc_import_transactions\(jsonb, uuid\)\s*\n?\s*to authenticated, service_role/i,
    );
  });

  it("posts through the same door every other document uses", () => {
    expect(sql).toContain("acc_post_entry(");
    expect(sql).toContain("acc_to_base_minor(");
    // Never a direct write to the ledger.
    expect(sql).not.toMatch(/insert into acc_journal_line/i);
    expect(sql).not.toMatch(/insert into acc_journal_entry/i);
  });

  it("resolves an account by code, by code and name, or by name", () => {
    // All three comparisons are case- and space-insensitive, so a file that
    // writes "121", "121 - PC49 BoA CK 3388" or the bare name all land.
    expect(sql).toMatch(/lower\(btrim\(account_code\)\)\s*=\s*v_ref/i);
    expect(sql).toMatch(/lower\(btrim\(account_code \|\| ' - ' \|\| name\)\)\s*=\s*v_ref/i);
    expect(sql).toMatch(/lower\(btrim\(name\)\)\s*=\s*v_ref/i);
    expect(sql).toMatch(/raise exception 'Account not found/i);
  });

  it("records the bank line as already matched, and links it", () => {
    expect(sql).toMatch(/insert into acc_bank_transaction/i);
    expect(sql).toMatch(/'matched'/);
    expect(sql).toMatch(/on conflict \(bank_account_id, raw_hash\) do nothing/i);
    expect(sql).toMatch(/insert into acc_reconciliation/i);
    expect(sql).toMatch(/'approved'/);
  });

  it("never creates an account from a transaction row", () => {
    expect(sql).not.toMatch(/insert into acc_account\b/i);
  });

  it("retargets into a company schema", () => {
    const plan = planCompanySchema([{ file, sql }], "co_probe");
    expect(plan.skipped).toEqual([]);
    expect(plan.statements.join("\n")).toContain("set search_path = co_probe");
  });
});
