import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Comments stripped as tests/unit/migration-grants.test.ts strips them (CRLF-safe). */
function body(file: string): string {
  const raw = readFileSync(join(process.cwd(), "supabase/migrations", file), "utf8");
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

/** The `returns table (…)` column list, names and types, whitespace-normalised. */
function returnedColumns(sql: string): string[] {
  const match = sql.match(/returns table \(([\s\S]*?)\)\s*language/i);
  if (!match) throw new Error("no returns table clause");
  return match[1]
    .split(",")
    .map((c) => c.trim().replace(/\s+/g, " "))
    .filter(Boolean);
}

describe("0128 acc_transaction_list", () => {
  const next = body("0128_transaction_list_linear.sql");
  const previous = body("0105_transaction_list_accounts.sql");

  it("returns exactly the columns 0105 returned, in the same order", () => {
    expect(returnedColumns(next)).toEqual(returnedColumns(previous));
  });

  it("keeps the parameters and the order", () => {
    expect(next).toMatch(/acc_transaction_list\(\s*p_from date,\s*p_to\s+date\s*\)/);
    expect(next).toMatch(/order by e\.entry_date, e\.entry_number;\s*\$\$;/);
  });

  it("asks nothing per entry: no subquery reaches back to the outer entry", () => {
    // 0105's quadratic shape: `(select … where journal_entry_id = e.id …)`.
    expect(next).not.toMatch(/where\s+\w*\.?journal_entry_id\s*=\s*e\.id/i);
  });

  it("keeps the grants", () => {
    expect(next).toMatch(/revoke all on function acc_transaction_list\(date, date\) from public, anon;/);
    expect(next).toMatch(/grant execute on function acc_transaction_list\(date, date\) to authenticated;/);
  });
});
