import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  join(process.cwd(), "supabase", "migrations", "0103_unresolved_account_refs.sql"),
  "utf8",
);
const code = sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");

describe("0103_unresolved_account_refs", () => {
  it("answers with the same resolver the import itself uses", () => {
    expect(code).toMatch(/acc_resolve_account_ref\(/);
  });

  it("reads only — it must never create an account it could not find", () => {
    expect(code).not.toMatch(/insert\s+into\s+acc_account/i);
    expect(code).not.toMatch(/update\s+acc_account/i);
  });

  it("is a stable read, not a write path", () => {
    expect(code).toMatch(/language sql stable/);
  });

  it("is closed to anonymous callers", () => {
    expect(code).toMatch(/revoke all on function acc_unresolved_account_refs/);
    expect(code).toMatch(/grant execute on function acc_unresolved_account_refs/);
  });
});
