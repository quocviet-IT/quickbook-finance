import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase", "migrations", "0104_feedback_files_every_company.sql"),
  "utf8",
);
const code = sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");

describe("0104_feedback_files_every_company", () => {
  it("looks for the report in every company, not only the first one", () => {
    expect(code).toMatch(/onebook\.company/);
    expect(code).toMatch(/execute format\(/);
  });

  it("quotes every schema it interpolates", () => {
    // The register constrains schema_name to a plain identifier, and %I quotes
    // it anyway. Both, because building SQL out of a table is where injections
    // come from — %s here would be the hole.
    expect((code.match(/format\(/g) ?? []).length).toBeGreaterThan(0);
    expect(code).toMatch(/%I/);
    const placeholders = code.match(/%[a-zA-Z]/g) ?? [];
    expect(new Set(placeholders)).toEqual(new Set(["%I"]));
  });

  it("repairs both buckets, because both had the same fault", () => {
    expect(code).toMatch(/feedback-screenshots/);
    expect(code).toMatch(/feedback-attachments/);
  });

  it("keeps the reader's permission answered by the company that owns the file", () => {
    expect(code).toMatch(/acc_has_permission/);
    expect(code).toMatch(/reporter_id/);
  });

  it("still refuses a path that is not a report id and a file", () => {
    expect(code).toMatch(/array_length\(v_parts, 1\) <> 2/);
  });

  it("leaves the feedback tables alone — this is a storage fault", () => {
    expect(code).not.toMatch(/insert\s+into\s+acc_feedback/i);
    expect(code).not.toMatch(/delete\s+from\s+acc_feedback/i);
  });
});
