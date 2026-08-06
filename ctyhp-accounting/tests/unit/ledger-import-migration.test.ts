import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase", "migrations", "0102_import_ledger_batches.sql"),
  "utf8",
);
const code = sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");

describe("0102_import_ledger_batches", () => {
  it("posts only through acc_post_entry", () => {
    expect(code).toMatch(/acc_post_entry\(/);
    expect(code).not.toMatch(/insert\s+into\s+acc_journal_line/i);
    expect(code).not.toMatch(/insert\s+into\s+acc_journal_entry/i);
  });

  it("uses source types that already exist, adding no enum value", () => {
    expect(code).toMatch(/'manual'/);
    expect(code).toMatch(/'opening_balance'/);
    expect(code).not.toMatch(/alter type acc_journal_source/i);
  });

  it("refuses anyone who is not staff", () => {
    expect((code.match(/acc_is_staff\(\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("keeps one live batch per file", () => {
    expect(code).toMatch(
      /create unique index[\s\S]{0,60}acc_import_batch_sha_idx[\s\S]{0,120}where status = 'active'/,
    );
  });

  it("gives the batch tables no write policy", () => {
    expect(code).not.toMatch(/on acc_import_batch\s+for (insert|update|delete)/i);
    expect(code).not.toMatch(/on acc_import_batch_entry\s+for (insert|update|delete)/i);
  });

  it("undoes by voiding, never by deleting", () => {
    expect(code).toMatch(/status = 'void'/);
    expect(code).not.toMatch(/delete\s+from\s+acc_journal/i);
  });

  it("teaches account matching about the dash Wave writes", () => {
    expect(code).toMatch(/acc_normalize_ref/);
    expect(code).toMatch(/translate\(/);
  });
});
