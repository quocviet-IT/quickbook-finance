import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

const FILE = "0147_scoped_work_item_retire.sql";

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
const start = sql.search(/create or replace function acc_retire_work_items\(/i);
const fn = sql.slice(start, sql.indexOf("end $$;", start) + 7);

describe("0147 scoped work-item retire: shape", () => {
  it("starts with the schema search path and qualifies nothing with public.", () => {
    expect(sql).toMatch(/^\s*set search_path = public;/i);
    expect(sql).not.toMatch(/\bpublic\.\w/i);
  });

  it("defines only the two-argument overload, idempotently", () => {
    const created = [...sql.matchAll(/create (?:or replace )?function (\w+)\(([^)]*)\)/gi)];
    expect(created.map((m) => m[1])).toEqual(["acc_retire_work_items"]);
    expect(created[0][2].replace(/\s+/g, " ").trim()).toBe("p_live_keys text[], p_prefixes text[]");
    expect(sql).toMatch(/create or replace function acc_retire_work_items/i);
    expect(sql).not.toMatch(/\bcreate function\b/i);
    expect(sql).not.toMatch(/\bdrop\b/i);
  });

  it("leaves the one-argument version untouched", () => {
    expect(sql).not.toMatch(/acc_retire_work_items\(\s*p_live_keys text\[\]\s*\)/i);
    expect(sql).not.toMatch(/function acc_retire_work_items\(text\[\]\)/i);
    expect(sql).not.toMatch(/acc_retire_work_items\(text\[\]\)/i);
    const original = strip(read("supabase/migrations/0118_work_item_state.sql"));
    expect(original).toMatch(/create or replace function acc_retire_work_items\(p_live_keys text\[\]\)/i);
  });

  it("creates no table, type, index, trigger or policy", () => {
    expect(sql).not.toMatch(/create (table|type|index|unique index|trigger|policy)\b/i);
    expect(sql).not.toMatch(/\balter\b/i);
  });

  it("runs whole in every company schema", () => {
    const plan = planCompanySchema([{ file: FILE, sql: raw }], "co_example");
    expect(plan.skipped).toEqual([]);
    const joined = plan.statements.join("\n");
    expect(joined).toMatch(/set search_path = co_example/);
    expect(joined).not.toMatch(/set search_path = public/);
    expect(joined).toMatch(/function acc_retire_work_items\(p_live_keys text\[\], p_prefixes text\[\]\)/i);
    expect(joined).toMatch(/revoke all on function acc_retire_work_items\(text\[\], text\[\]\)/i);
  });
});

describe("0147 scoped work-item retire: the function", () => {
  it("returns int and is a security definer with the search path pinned", () => {
    const header = fn.slice(0, fn.indexOf("$$"));
    expect(header).toMatch(/returns int\b/i);
    expect(header).toMatch(/security definer/i);
    expect(header).toMatch(/set search_path = public/i);
  });

  it("has the same role check as the one-argument version: any signed-in role, nobody else", () => {
    expect(fn).toMatch(/if acc_current_role\(\) is null then\s+raise exception 'Not authorized';/i);
    expect(read("supabase/migrations/0118_work_item_state.sql")).toContain("if acc_current_role() is null then");
  });

  it("resolves only active rows, outside the live keys, whose key starts with one of the prefixes", () => {
    expect(fn).toMatch(/set lifecycle = 'resolved', resolved_at = now\(\)/i);
    expect(fn).toMatch(/s\.lifecycle <> 'resolved'/i);
    expect(fn).toMatch(/not \(s\.work_key = any \(coalesce\(p_live_keys, array\[\]::text\[\]\)\)\)/i);
    expect(fn).toMatch(/unnest\(coalesce\(p_prefixes, array\[\]::text\[\]\)\)/i);
    expect(fn).toMatch(/starts_with\(s\.work_key, p\)/i);
  });

  it("matches a prefix literally, never as a LIKE pattern, and an empty prefix matches nothing", () => {
    expect(fn).not.toMatch(/\blike\b|\bilike\b|\bsimilar to\b|~/i);
    expect(fn).toMatch(/length\(p\) > 0/i);
  });

  it("is revoked from public and anon and granted to signed-in users and the service role", () => {
    expect(sql).toMatch(/revoke all on function acc_retire_work_items\(text\[\], text\[\]\) from public, anon;/i);
    expect(sql).toMatch(/grant execute on function acc_retire_work_items\(text\[\], text\[\]\) to authenticated, service_role;/i);
  });
});
