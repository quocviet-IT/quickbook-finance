import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

const file = "0110_inactive_breaks_the_tie.sql";
const sql = readFileSync(join(process.cwd(), "supabase", "migrations", file), "utf8");

/** Assertions about code must not be satisfied by prose that mentions it. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}
const code = stripComments(sql);

describe("inactive breaks the tie migration", () => {
  it("narrows a name match to the live accounts, but only when there is a tie", () => {
    // Narrowing unconditionally would break a file that names an account
    // somebody has since deactivated — which resolves today, unambiguously.
    const narrowing = code.slice(code.indexOf("if coalesce(array_length(v_codes, 1), 0) > 1"));
    expect(narrowing).toMatch(/and a\.status = 'active'/);
    expect(narrowing).toMatch(/if coalesce\(array_length\(v_live, 1\), 0\) = 1 then/);
    expect(narrowing).toMatch(/v_codes := v_live;/);
  });

  it("keeps the precedence and the archived exclusion", () => {
    const byCode = code.indexOf("acc_normalize_ref(a.account_code) = v_key");
    const byPair = code.indexOf("a.account_code || ' - ' || a.name");
    const byName = code.indexOf("acc_normalize_ref(a.name) = v_key");
    expect(byCode).toBeGreaterThan(-1);
    expect(byPair).toBeGreaterThan(byCode);
    expect(byName).toBeGreaterThan(byPair);
    // Archived is excluded everywhere a candidate is gathered.
    expect(code.match(/a\.status <> 'archived'/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("still refuses two live accounts of one name", () => {
    expect(code).toContain("'ambiguous'");
    const resolver = code.slice(code.indexOf("function acc_resolve_account_ref"));
    expect(resolver).toMatch(/if m\.matched_by = 'ambiguous' then[\s\S]*?raise exception/i);
  });

  it("names both ways out of an ambiguity, not just the one", () => {
    // Telling somebody to edit the file is no help when the file is a
    // customer's export they are not allowed to change.
    const resolver = code.slice(code.indexOf("function acc_resolve_account_ref"));
    expect(resolver).toMatch(/write the account code in the/i);
    expect(resolver).toMatch(/make the one you do not use inactive/i);
    expect(resolver).toMatch(/active accounts/i);
  });

  it("is gated, and reaches every company", () => {
    expect(code).toMatch(/revoke all on function acc_account_ref_matches\(text\[\]\) from public/i);
    expect(code).toMatch(/revoke all on function acc_resolve_account_ref\(text\) from public/i);

    const plan = planCompanySchema([{ file, sql }], "co_probe");
    expect(plan.skipped).toEqual([]);
    expect(plan.statements.join("\n")).toContain("set search_path = co_probe");
  });
});
