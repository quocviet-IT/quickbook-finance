import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Migration 0124, read as text. The promise it makes — marking an entry moves
 * it between two columns of one report and changes no figure — is checked here
 * against the SQL itself, and on the real database by
 * scripts/verify-adjusting-entries.mjs.
 */
const RAW = readFileSync("supabase/migrations/0124_adjusting_entries.sql", "utf8");

/** The SQL without comments, lower-cased, so a word in a comment can neither pass nor fail a check. */
const SQL = RAW.replace(/\/\*[\s\S]*?\*\//g, "")
  .split(/\r?\n/)
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n")
  .toLowerCase();

describe("0124 adjusting entries migration", () => {
  it("writes to no table but the marks and the audit log", () => {
    const targets = [...SQL.matchAll(/\b(?:insert\s+into|delete\s+from|update)\s+([a-z_][a-z0-9_.]*)/g)].map(
      (m) => m[1],
    );
    expect(targets.length).toBeGreaterThan(0);
    expect(new Set(targets)).toEqual(new Set(["acc_adjusting_entry", "acc_audit_log"]));
  });

  it("changes no posting function and no ledger table", () => {
    expect(SQL).not.toMatch(/function\s+acc_post_/);
    expect(SQL).not.toMatch(/acc_post_entry\s*\(/);
    expect(SQL).not.toMatch(/alter\s+table\s+acc_journal_(entry|line)\b/);
  });

  it("gives the marks a read policy and no write policy", () => {
    expect(SQL).toMatch(/alter table acc_adjusting_entry enable row level security/);
    expect(SQL).toMatch(/create policy acc_adjusting_entry_read on acc_adjusting_entry\s+for select/);
    expect(SQL).not.toMatch(/\bfor\s+(insert|update|delete|all)\b/);
  });

  it("marks depreciation as it is inserted, and nothing else", () => {
    expect(SQL).toMatch(
      /after insert on acc_journal_entry\s+for each row\s+when \(new\.source_type = 'depreciation'\)/,
    );
  });

  it("asks before touching a closed period, in the form the screen reads", () => {
    expect(SQL.match(/raise exception 'closed_period:%:%'/g)).toHaveLength(2);
  });

  it("lets only a signed-in session call the two functions", () => {
    for (const fn of ["acc_mark_adjusting(uuid, text, boolean)", "acc_unmark_adjusting(uuid, boolean)"]) {
      expect(SQL).toContain(`revoke all on function ${fn} from public, anon;`);
      expect(SQL).toContain(`grant execute on function ${fn} to authenticated;`);
    }
  });
});
