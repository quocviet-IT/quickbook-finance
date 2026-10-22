import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

const FILE = "0158_reconciliation_report_lines.sql";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8").replace(/\r/g, "");
}

/** Block and line comments removed, so naming a thing in prose never reads as doing it. */
function strip(raw: string): string {
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

const raw = read(`supabase/migrations/${FILE}`);
const sql = strip(raw);
const workspace = strip(read("supabase/migrations/0132_reconcile_from_statement.sql"));

describe("0158 reconciliation report lines", () => {
  it("adds one new function and changes nothing that exists", () => {
    const created = [...sql.matchAll(/create (?:or replace )?function (\w+)\(/gi)].map((m) => m[1]);
    expect(created).toEqual(["acc_reconciliation_report_lines"]);
    expect(sql).not.toMatch(/\b(drop|alter|insert|update|delete|truncate)\b/i);
    expect(workspace).toMatch(/create function acc_reconciliation_lines\(/);
  });

  it("only reads, as the caller, and is not offered to anonymous callers", () => {
    expect(sql).toMatch(/language sql stable as \$\$/);
    expect(sql).not.toMatch(/security definer/i);
    expect(sql).toMatch(/revoke all on function acc_reconciliation_report_lines\(uuid\) from public, anon;/);
    expect(sql).toMatch(/grant execute on function acc_reconciliation_report_lines\(uuid\) to authenticated, service_role;/);
  });

  it("keeps a line a later statement cleared, leaving out only what this one or an earlier one cleared", () => {
    expect(sql).toMatch(/r2\.status = 'completed' and r2\.id <> p_reconciliation_id\s+and r2\.statement_ending_date <= \(select statement_ending_date from rec\)/);
    expect(sql).toMatch(/e\.status = 'posted'/);
    expect(sql).toMatch(/e\.entry_date <= \(select statement_ending_date from rec\)/);
  });

  it("can be applied to every company's own schema", () => {
    const plan = planCompanySchema([{ file: FILE, sql: raw }], "co_example");
    expect(plan.skipped).toEqual([]);
    expect(plan.statements.join("\n")).toContain("acc_reconciliation_report_lines");
  });
});
