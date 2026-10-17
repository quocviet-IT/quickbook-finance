import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMPARISON_GROUPS } from "@/lib/domain/balance-comparison";

const DIR = join(process.cwd(), "supabase/migrations");
const FILE = "0156_balance_comparison_external_group.sql";

function strip(raw: string): string {
  return raw
    .replace(/\r/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

const raw = readFileSync(join(DIR, FILE), "utf8").replace(/\r/g, "");
const sql = strip(raw);
const fn = sql.slice(sql.search(/create or replace function acc_save_balance_comparison\(/i));

describe("0156 keeps the group of an account only the other system has", () => {
  it("is the only migration numbered 0156, follows 0155 and says why in its header", () => {
    const names = readdirSync(DIR).filter((n) => /^\d{4}_/.test(n));
    expect(names.filter((n) => n.startsWith("0156_"))).toEqual([FILE]);
    expect(names).toContain("0155_balance_comparison.sql");
    expect(raw).toMatch(/0155 kept no group/);
    expect(raw).toMatch(/user approved/);
    expect(sql).toMatch(/^\s*set search_path = public;/m);
  });

  it("adds one nullable column, idempotently", () => {
    expect(sql).toMatch(/alter table acc_balance_comparison_line add column if not exists external_group text;/i);
  });

  it("checks the group against the five keys the screen uses, set exactly when there is no account", () => {
    expect(sql).toMatch(/drop constraint if exists acc_balance_comparison_line_group_ck;/i);
    const check = sql.match(/add constraint acc_balance_comparison_line_group_ck\s+check \(([\s\S]*?)\);/i)![1];
    for (const g of COMPARISON_GROUPS) expect(check).toContain(`'${g.key}'`);
    expect([...check.matchAll(/'(\w+)'/g)].map((m) => m[1])).toEqual(COMPARISON_GROUPS.map((g) => g.key));
    // A null group must fail the check, not pass it as an unknown "in" result.
    expect(check).toMatch(/account_id is null and external_group is not null\s+and external_group in/i);
    expect(check).toMatch(/account_id is not null and external_group is null/i);
  });

  it("replaces the save function with the same signature, security definer, search path and staff check", () => {
    const header = fn.slice(0, fn.indexOf("$$"));
    expect(header).toMatch(
      /acc_save_balance_comparison\(\s*p_as_of\s+date,\s*p_compared_with\s+text,\s*p_note\s+text,\s*p_lines\s+jsonb\s*\) returns integer/i,
    );
    expect(header).toMatch(/security definer/i);
    expect(header).toMatch(/set search_path = public/i);
    expect(fn).toMatch(/if not acc_is_staff\(\) then raise exception 'Not authorized to save a balance comparison'/i);
  });

  it("refuses an external line without a known group, and an account line with one", () => {
    expect(fn).toMatch(/Choose a group for an account only the other system has/);
    expect(fn).toMatch(/v_group not in \('asset', 'liability', 'equity', 'income', 'expense'\)/i);
    expect(fn).toMatch(/A figure for an account here takes no group/);
  });

  it("stores the group for an external line only", () => {
    expect(fn).toMatch(/case when v_acct is null then v_group end/i);
  });

  it("keeps everything else 0155 refused", () => {
    for (const message of [
      "Choose the date to compare at",
      "Enter the name of the other system",
      "The figures must be a list",
      "Each figure must be an object",
      "A figure must be a whole number of cents",
      "A figure is too large",
      "Choose an active account for each figure",
      "An account appears twice",
      "An account code appears twice",
      "An account only the other system has needs a code and a name",
      "A figure is for an account here or one only the other system has, not both",
    ]) {
      expect(fn, message).toContain(message);
    }
    expect(fn).toMatch(/delete from acc_balance_comparison_line where as_of = p_as_of;/i);
  });

  it("re-states the grants", () => {
    expect(sql).toMatch(/revoke all on function acc_save_balance_comparison\(date, text, text, jsonb\) from public, anon;/i);
    expect(sql).toMatch(
      /grant execute on function acc_save_balance_comparison\(date, text, text, jsonb\) to authenticated, service_role;/i,
    );
  });

  it("never qualifies a name with public. where schema retargeting cannot rewrite it", () => {
    expect(sql).not.toMatch(/\bpublic\./i);
  });
});
