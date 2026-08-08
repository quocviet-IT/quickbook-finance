import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

const file = "0109_undo_bank_statement_import.sql";
const sql = readFileSync(join(process.cwd(), "supabase", "migrations", file), "utf8");

/** Assertions about code must not be satisfied by prose that mentions it. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}
const code = stripComments(sql);

describe("undo bank statement import migration", () => {
  it("keeps the batch after it is undone, with who and why", () => {
    // Deleting the batch row too would erase the fact that the import happened,
    // which is what somebody asking "where did those lines go" needs to find.
    expect(code).toMatch(/add column if not exists status text not null default 'active'/i);
    expect(code).toMatch(/add column if not exists voided_by uuid/i);
    expect(code).toMatch(/add column if not exists void_reason text/i);
    expect(code).toMatch(/check \(status in \('active', 'voided'\)\)/i);
  });

  it("counts the lines that block an undo in one place", () => {
    // The screen disables the button from this count and the function refuses
    // on it. Two counts would eventually disagree, and the button would lie.
    expect(code).toMatch(/create or replace function acc_bank_import_batch_locked_lines\(p_batch_id uuid\)/i);
    expect(code).toMatch(/t\.status <> 'unmatched'/);
    expect(code).toMatch(/from acc_reconciliation r where r\.bank_transaction_id = t\.id/i);

    const undo = code.slice(code.indexOf("function acc_undo_bank_statement_import"));
    expect(undo).toContain("acc_bank_import_batch_locked_lines(p_batch_id)");
    const listing = code.slice(code.indexOf("function acc_bank_statement_imports"));
    expect(listing).toContain("acc_bank_import_batch_locked_lines(b.id)");
  });

  it("refuses to remove a line the ledger points at", () => {
    const undo = code.slice(
      code.indexOf("function acc_undo_bank_statement_import"),
      code.indexOf("function acc_delete_bank_transaction"),
    );
    expect(undo).toMatch(/if v_locked > 0 then[\s\S]*?raise exception/i);
    // The refusal has to come before the delete, or it is not a refusal.
    expect(undo.indexOf("if v_locked > 0")).toBeLessThan(
      undo.indexOf("delete from acc_bank_transaction"),
    );

    const single = code.slice(code.indexOf("function acc_delete_bank_transaction"));
    expect(single).toMatch(/if v_row\.status <> 'unmatched' then/i);
    expect(single).toMatch(/exists \(select 1 from acc_reconciliation where bank_transaction_id = p_id\)/i);
  });

  it("asks for a reason and keeps it", () => {
    expect(code).toMatch(/Say why this import is being undone/);
    expect(code).toMatch(/length\(btrim\(coalesce\(p_reason, ''\)\)\) < 10/);
    // Both write the reason somewhere a reader can find it later.
    expect(code.match(/insert into acc_audit_log/g)?.length).toBe(2);
  });

  it("is gated, and reaches every company", () => {
    for (const signature of [
      "acc_bank_import_batch_locked_lines\\(uuid\\)",
      "acc_bank_statement_imports\\(uuid\\)",
      "acc_undo_bank_statement_import\\(uuid, text\\)",
      "acc_delete_bank_transaction\\(uuid, text\\)",
    ]) {
      expect(code).toMatch(new RegExp(`revoke all on function ${signature} from public`, "i"));
    }
    expect(code.match(/acc_is_staff\(\)/g)?.length).toBe(2);

    const plan = planCompanySchema([{ file, sql }], "co_probe");
    expect(plan.skipped).toEqual([]);
    expect(plan.statements.join("\n")).toContain("set search_path = co_probe");
  });
});
