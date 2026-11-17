import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

const FILE = "0201_undo_import_ignores_suggestions.sql";
const raw = readFileSync(join(process.cwd(), "supabase", "migrations", FILE), "utf8");

// Comments stripped and line endings made one, so a sentence in a comment can never satisfy an assertion.
const sql = raw
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split(/\r?\n/)
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");
const flat = sql.replace(/\s+/g, " ").toLowerCase();

function body(name: string): string {
  const start = flat.indexOf(`create or replace function ${name}(`);
  expect(start, name).toBeGreaterThanOrEqual(0);
  const end = flat.indexOf("$$;", flat.indexOf("$$", start) + 2);
  return flat.slice(start, end);
}

describe("0201: a suggested match no longer stops a statement import being undone", () => {
  it("counts a line as locked only when it is matched, coded or ignored, or has an approved match", () => {
    const locked = body("acc_bank_import_batch_locked_lines");
    expect(locked).toContain("t.status <> 'unmatched'");
    expect(locked).toContain("r.bank_transaction_id = t.id and r.status = 'approved'");
    // The old rule, any match row at all, is gone.
    expect(locked).not.toMatch(/exists \(select 1 from acc_reconciliation r where r\.bank_transaction_id = t\.id\)\)/);
  });

  it("keeps the membership check 0166 gave the count", () => {
    expect(body("acc_bank_import_batch_locked_lines")).toContain("select acc_assert_member();");
  });

  it("is the rule a bank-feed sync's undo already uses", () => {
    const sync = readFileSync(join(process.cwd(), "supabase", "migrations", "0137_bank_feed_disconnect_undo.sql"), "utf8")
      .replace(/\s+/g, " ")
      .toLowerCase();
    expect(sync).toContain("m.bank_transaction_id = t.id and m.status = 'approved'");
  });

  it("locks the import, its matches and then its lines before it counts, so an approval cannot slip in", () => {
    const undo = body("acc_undo_bank_statement_import");
    const batch = undo.indexOf("where id = p_batch_id and status = 'active' for update");
    const matches = undo.indexOf("perform 1 from acc_reconciliation");
    const lines = undo.indexOf("perform 1 from acc_bank_transaction where import_batch_id = p_batch_id for update");
    const count = undo.indexOf("v_locked := acc_bank_import_batch_locked_lines(p_batch_id)");
    expect(batch).toBeGreaterThan(0);
    expect(matches).toBeGreaterThan(batch);
    expect(lines).toBeGreaterThan(matches);
    expect(count).toBeGreaterThan(lines);
  });

  it("still refuses a matched line in the same words, and records the suggestions that went with the lines", () => {
    const undo = body("acc_undo_bank_statement_import");
    expect(undo).toContain("line(s) of this import have already been matched to the ledger.");
    expect(undo).toContain("'suggestions_withdrawn', v_suggested");
    expect(undo).toContain("if not acc_is_staff() then");
    expect(undo).toContain("say why this import is being undone");
  });

  it("keeps the undo's grants", () => {
    expect(flat).toContain("revoke all on function acc_undo_bank_statement_import(uuid, text) from public, anon;");
    expect(flat).toContain("grant execute on function acc_undo_bank_statement_import(uuid, text) to authenticated, service_role;");
  });

  it("is replayed whole into every company schema", () => {
    const plan = planCompanySchema([{ file: FILE, sql: raw }], "co_probe");
    expect(plan.skipped).toEqual([]);
    expect(plan.statements.length).toBe(5);
  });
});
