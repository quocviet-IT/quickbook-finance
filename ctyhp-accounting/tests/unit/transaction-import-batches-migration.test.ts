import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

const file = "0108_transaction_import_batches.sql";
const sql = readFileSync(join(process.cwd(), "supabase", "migrations", file), "utf8");

/** Assertions about code must not be satisfied by prose that mentions it. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}
const code = stripComments(sql);

describe("transaction import batches migration", () => {
  it("puts both kinds of import in one register", () => {
    expect(code).toMatch(/check \(source in \('wave_ledger', 'transactions'\)\)/i);
    expect(code).toMatch(/alter table acc_bank_transaction[\s\S]*?add column if not exists transaction_batch_id/i);
  });

  it("drops the old signature rather than leaving it beside the new one", () => {
    // A caller left on the two-argument form would import without a record,
    // and nobody would find out until they tried to undo it.
    expect(code).toMatch(/drop function if exists acc_import_transactions\(jsonb, uuid\)/i);
    expect(code).toMatch(
      /create or replace function acc_import_transactions\(\s*p_rows jsonb,\s*p_default_bank_account_id uuid,\s*p_file_name text,\s*p_sha256 text,\s*p_line_count int/i,
    );
  });

  it("keeps the guards the import already had", () => {
    expect(code).toContain("acc_is_staff()");
    expect(code).toContain("acc_post_entry(");
    expect(code).toContain("acc_to_base_minor(");
    expect(code).toMatch(/No bank record for the account used here/);
    // Never a direct write to the ledger.
    expect(code).not.toMatch(/insert into acc_journal_line/i);
    expect(code).not.toMatch(/insert into acc_journal_entry/i);
  });

  it("refuses the same file twice while its import is still live", () => {
    expect(code).toMatch(/where sha256 = p_sha256 and status = 'active'/i);
    expect(code).toMatch(/already been imported/i);
  });

  it("leaves no batch behind for an import that posted nothing", () => {
    expect(code).toMatch(/if v_imported = 0 then[\s\S]*?delete from acc_import_batch where id = v_batch/i);
  });

  it("undoes a transactions batch by voiding entries and deleting bank lines", () => {
    const undo = code.slice(code.indexOf("function acc_void_import_batch"));
    expect(undo).toMatch(/update acc_journal_entry[\s\S]*?set status = 'void'/i);
    // The bank lines must go: the dedupe index would otherwise refuse every row
    // of the corrected file this undo exists to make room for.
    expect(undo).toMatch(/if v_source = 'transactions' then/i);
    expect(undo).toMatch(/delete from acc_bank_transaction where transaction_batch_id = p_batch_id/i);
    // And a ledger batch must not lose bank lines it never created.
    const guarded = undo.indexOf("if v_source = 'transactions' then");
    expect(undo.indexOf("delete from acc_bank_transaction")).toBeGreaterThan(guarded);
  });

  it("keeps the reconciliation with the line it reconciles", () => {
    const undo = code.slice(code.indexOf("function acc_void_import_batch"));
    const recs = undo.indexOf("delete from acc_reconciliation");
    const lines = undo.indexOf("delete from acc_bank_transaction");
    expect(recs).toBeGreaterThan(-1);
    // Reconciliations first: the other order trips the foreign key.
    expect(recs).toBeLessThan(lines);
  });

  it("is gated, and reaches every company", () => {
    expect(code).toMatch(
      /revoke all on function acc_import_transactions\(jsonb, uuid, text, text, int\) from public/i,
    );
    expect(code).toMatch(/revoke all on function acc_void_import_batch\(uuid, text\) from public/i);

    const plan = planCompanySchema([{ file, sql }], "co_probe");
    expect(plan.skipped).toEqual([]);
    expect(plan.statements.join("\n")).toContain("set search_path = co_probe");
  });
});
