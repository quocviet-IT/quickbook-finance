import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

const file = "0095_void_customer_payments.sql";
const migrationPath = join(process.cwd(), "supabase", "migrations", file);

describe("customer payment void migration", () => {
  const sql = readFileSync(migrationPath, "utf8");

  it("attributes a void and exposes one atomic RPC", () => {
    expect(sql).toContain("add column if not exists voided_at timestamptz");
    expect(sql).toContain("add column if not exists voided_by uuid references auth.users (id)");
    expect(sql).toContain("add column if not exists void_reason text");
    expect(sql).toMatch(/create or replace function acc_void_payment\s*\(/i);
    expect(sql).toContain("p_reason text");
  });

  it("locks and guards every downstream dependency", () => {
    expect(sql).toMatch(/from acc_payment where id = p_payment_id for update/i);
    expect(sql).toContain("acc_customer_refund");
    expect(sql).toContain("acc_reconciliation");
    expect(sql).toContain("acc_reconciliation_line");
    expect(sql).toContain("acc_payment_allocation");
  });

  it("catches a bank match named by journal line, not only by payment", () => {
    // acc_reconciliation.journal_line_id arrived in 0045; a guard that reads
    // payment_id alone leaves a line-level match tied to a retired entry.
    expect(sql).toMatch(/r\.payment_id = p_payment_id/);
    expect(sql).toMatch(/jl\.journal_entry_id = v_payment\.journal_entry_id/);
  });

  it("restores invoices and voids history without deleting it", () => {
    expect(sql).toMatch(/balance_due_minor\s*=\s*v_restored/i);
    expect(sql).toMatch(/update acc_journal_entry\s+set status = 'void'/i);
    expect(sql).toMatch(/update acc_payment\s+set status = 'void'/i);
    expect(sql).not.toMatch(/delete\s+from\s+acc_payment/i);
    expect(sql).not.toMatch(/delete\s+from\s+acc_payment_allocation/i);
  });

  it("refuses a void the caller may not make, and one with no reason", () => {
    expect(sql).toContain("acc_is_staff()");
    expect(sql).toMatch(/length\(v_reason\) = 0/);
    expect(sql).toMatch(/length\(v_reason\) > 500/);
    expect(sql).toMatch(/revoke all on function acc_void_payment\(uuid, text\) from public/i);
    expect(sql).toMatch(
      /grant execute on function acc_void_payment\(uuid, text\) to authenticated, service_role/i,
    );
  });

  it("leaves the stamped audit columns to their trigger", () => {
    // `acc_stamp_actor` owns updated_at/updated_by on every document table.
    expect(sql).not.toMatch(/set[\s\S]{0,400}?updated_at\s*=\s*now\(\)/i);
  });

  it("retargets into a company schema", () => {
    const plan = planCompanySchema([{ file, sql }], "co_probe");
    expect(plan.skipped).toEqual([]);
    expect(plan.statements.join("\n")).toContain("set search_path = co_probe");
  });
});
