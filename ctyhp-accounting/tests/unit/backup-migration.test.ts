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

  it("guards the policy so a second application does not fail", () => {
    // Postgres has no `create policy if not exists`. Without the drop, an
    // operator re-applying this file by hand through the SQL Editor — the
    // fallback path this repository uses when the Postgres port is blocked —
    // gets "policy already exists" instead of a clean no-op.
    expect(body).toMatch(/drop policy if exists acc_backup_read on acc_backup/i);
  });

  it("grants the register to the roles that read and write it, and nobody else", () => {
    // 0080 revoked default privileges on every future table in this schema, so
    // a bare `create table` leaves authenticated and service_role with nothing
    // — the table exists but every query against it fails "permission denied".
    // A new company's blanket grant sweep papers over this for companies
    // created after this ships; every company that already exists does not
    // get that sweep and stays locked out until this migration grants it.
    expect(body).toMatch(/revoke all on table acc_backup from public,\s*anon/i);
    expect(body).toMatch(/grant select on table acc_backup to authenticated/i);
    expect(body).toMatch(/grant all\s+on table acc_backup to service_role/i);
  });
});
