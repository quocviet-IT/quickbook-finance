import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

const FILE = "0135_keep_statement_files.sql";
const sql = readFileSync(join(process.cwd(), "supabase", "migrations", FILE), "utf8");
/** The migration without its prose, so naming a thing in a comment never reads as doing it. */
const code = sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");

describe("0135_keep_statement_files", () => {
  it("never posts: keeping a file moves no balance", () => {
    expect(code).not.toMatch(/acc_post_entry/);
    expect(code).not.toMatch(/insert\s+into\s+acc_journal_(entry|line)/i);
  });

  it("grants no storage policy to a browser session", () => {
    expect(code).not.toMatch(/create policy[\s\S]{0,200}on storage\.objects/i);
  });

  it("checks the folder in both functions that register a file", () => {
    for (const fn of ["acc_register_saved_report", "acc_keep_statement_file"]) {
      const body = code.slice(code.indexOf(`create or replace function ${fn}(`));
      expect(body.slice(0, body.indexOf("$$;")), fn).toMatch(/acc_saved_report_path_is_ours\(p_storage_path\)/);
    }
  });

  it("checks the folder against the schema the function runs in, not a register it cannot read", () => {
    expect(code).toMatch(/split_part\(p_path, '\/', 1\) = current_schema\(\)/);
    expect(code).not.toMatch(/onebook\./);
  });

  it("closes every function it grants to anon", () => {
    const granted = [...code.matchAll(/grant execute on function (acc_\w+)\(/g)].map((m) => m[1]);
    expect(granted.length).toBeGreaterThan(5);
    for (const fn of granted) {
      expect(code, fn).toMatch(new RegExp(`revoke all on function ${fn}\\([^)]*\\) from public, anon`));
    }
  });

  it("sets the file pointer only behind the trigger's gate", () => {
    const opened = code.match(/set_config\('acc\.statement_file_change', 'on', true\)/g) ?? [];
    const closed = code.match(/set_config\('acc\.statement_file_change', '', true\)/g) ?? [];
    expect(opened.length).toBe(4);
    expect(closed.length).toBe(opened.length);
  });

  it("holds the bucket change back from company schemas and runs everything else in each", () => {
    const plan = planCompanySchema([{ file: FILE, sql }], "co_example");
    expect(plan.skipped.map((s) => s.sql).join("\n")).toMatch(/update storage\.buckets/);
    expect(plan.statements.join("\n")).toMatch(/set search_path = co_example/);
    expect(plan.statements.join("\n")).not.toMatch(/storage\.buckets/);
  });
});
