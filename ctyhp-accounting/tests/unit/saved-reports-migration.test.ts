import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase", "migrations", "0101_saved_reports.sql"),
  "utf8",
);

/**
 * The migration without its prose. The header says out loud that this feature
 * does not post, and naming `acc_post_entry` to say so must not read as calling
 * it — the assertion below is about executable SQL only.
 */
const code = sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");

describe("0101_saved_reports", () => {
  it("never posts — this is the promise the whole feature makes", () => {
    expect(code).not.toMatch(/acc_post_entry/);
    expect(code).not.toMatch(/insert\s+into\s+acc_journal_line/i);
    expect(code).not.toMatch(/insert\s+into\s+acc_journal_entry/i);
    expect(code).not.toMatch(/insert\s+into\s+acc_bank_transaction/i);
  });

  it("gates writing on documents.manage rather than a role name", () => {
    expect(sql).toMatch(/acc_has_permission\('documents\.manage'\)/);
  });

  it("lets every role that may read a document read a saved report", () => {
    expect(sql).toMatch(/acc_has_permission\('documents\.read'\)/);
  });

  it("gives the table no insert, update or delete policy", () => {
    expect(sql).not.toMatch(/create policy[\s\S]{0,120}for\s+insert\s+[\s\S]{0,80}acc_saved_report/i);
    expect(sql).not.toMatch(/on acc_saved_report\s+for (insert|update|delete)/i);
  });

  it("refuses a hard delete by archiving instead", () => {
    expect(sql).toMatch(/status = 'archived'/);
    expect(sql).not.toMatch(/delete\s+from\s+acc_saved_report/i);
  });

  it("keeps one active row per file, so the same report cannot be saved twice", () => {
    expect(sql).toMatch(
      /create unique index[\s\S]{0,60}acc_saved_report_sha_idx[\s\S]{0,120}where status = 'active'/,
    );
  });

  it("registers the bucket privately", () => {
    expect(sql).toMatch(/insert into storage\.buckets/);
    expect(sql).toMatch(/'onebook-reports'/);
  });

  it("grants no storage policy to a browser session", () => {
    expect(sql).not.toMatch(/create policy[\s\S]{0,200}on storage\.objects/);
  });
});
