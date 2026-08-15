import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(join(process.cwd(), "supabase/migrations/0114_backups.sql"), "utf8");
// A Windows checkout ends lines with \r\n, and `.` does not match \r — a
// comment stripper written as /--.*$/ removes nothing here and every assertion
// below passes on a sentence in a comment. This has bitten this repository
// twice.
const body = sql
  .split(/\r?\n/)
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");

describe("the backups migration", () => {
  it("creates the register in the company's own schema", () => {
    expect(body).toMatch(/create table if not exists acc_backup/i);
  });

  it("records what a restore has to check against", () => {
    for (const column of [
      "taken_at",
      "content_hash",
      "storage_path",
      "size_bytes",
      "schema_version",
      "control_totals",
      "status",
      "skip_reason",
    ]) {
      expect(body, `acc_backup is missing ${column}`).toContain(column);
    }
  });

  it("allows a skipped night to carry no file", () => {
    // A night where nothing changed is recorded, and has no storage path.
    expect(body).toMatch(/storage_path\s+text\b(?!\s+not null)/i);
  });

  it("refuses two snapshots of the same content on the same day", () => {
    expect(body).toMatch(/unique\s*\(\s*taken_at\s*,\s*content_hash\s*\)/i);
  });

  it("adds the permission that restoring takes", () => {
    expect(body).toContain("company.restore");
    // Restoring copies a whole book into a new company, so it is governed like
    // the other things that shape a company rather than like reading a report.
    // [\s\S] rather than `.` with the `/s` flag: this repo's tsconfig targets
    // ES2017, and the dotAll flag is only legal from ES2018 — the literal
    // brief regex fails `tsc --noEmit` here. [\s\S] matches the same set of
    // characters (any character, newlines included) without the flag.
    expect(body).toMatch(/'company\.restore'[\s\S]*'Governance'/);
  });

  it("enables row-level security, like every other company table", () => {
    expect(body).toMatch(/alter table acc_backup enable row level security/i);
  });
});
