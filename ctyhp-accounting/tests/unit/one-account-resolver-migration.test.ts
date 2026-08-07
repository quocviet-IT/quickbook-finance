import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

const file = "0107_one_account_resolver.sql";
const sql = readFileSync(join(process.cwd(), "supabase", "migrations", file), "utf8");

/** Assertions about code must not be satisfied by prose that mentions it. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}
const code = stripComments(sql);

describe("one account resolver migration", () => {
  it("exposes the batch form, gated like every other import function", () => {
    expect(code).toMatch(/create or replace function acc_account_ref_matches\s*\(/i);
    expect(code).toMatch(/revoke all on function acc_account_ref_matches\(text\[\]\) from public/i);
    expect(code).toMatch(
      /grant execute on function acc_account_ref_matches\(text\[\]\)\s*\n?\s*to authenticated, service_role/i,
    );
  });

  it("keeps the precedence the single-reference form always had", () => {
    // Code first, then code with name, then the bare name. Reordering these
    // silently moves money: "1000" is a bank and "1000 Cash on Hand" may not be.
    const byCode = code.indexOf("acc_normalize_ref(a.account_code) = v_key");
    const byPair = code.indexOf("a.account_code || ' - ' || a.name");
    const byName = code.indexOf("acc_normalize_ref(a.name) = v_key");
    expect(byCode).toBeGreaterThan(-1);
    expect(byPair).toBeGreaterThan(byCode);
    expect(byName).toBeGreaterThan(byPair);
  });

  it("refuses to choose between two accounts sharing one name", () => {
    expect(code).toContain("'ambiguous'");
    // The candidates travel with the verdict: a reader told only that something
    // is ambiguous cannot act, and the code is the way out of the ambiguity.
    expect(code).toMatch(/candidate_codes\s*:=/);
    expect(code).toMatch(/array_agg\(a\.account_code order by a\.account_code\)/i);
  });

  it("leaves one resolver, with the single-reference form reading the batch", () => {
    expect(code).toMatch(
      /create or replace function acc_resolve_account_ref\(p_ref text\) returns uuid/i,
    );
    expect(code).toMatch(/from acc_account_ref_matches\(array\[p_ref\]\)/i);
    // The old body searched acc_account itself. Two searches is the bug.
    expect(code).not.toMatch(/create or replace function acc_resolve_account_ref[\s\S]*?from acc_account\b/i);
  });

  it("keeps the unresolved list off the form that can now raise", () => {
    // `acc_resolve_account_ref` raises on an ambiguous name, and a filter that
    // calls it would take the whole listing down with it.
    const unresolved = code.slice(code.indexOf("function acc_unresolved_account_refs"));
    expect(unresolved).toContain("acc_account_ref_matches(p_refs)");
    expect(unresolved).not.toContain("acc_resolve_account_ref(ref)");
  });

  it("reaches every company", () => {
    const plan = planCompanySchema([{ file, sql }], "co_probe");
    expect(plan.skipped).toEqual([]);
    const statements = plan.statements.join("\n");
    expect(statements).toContain("acc_account_ref_matches");
    expect(statements).toContain("set search_path = co_probe");
  });
});
