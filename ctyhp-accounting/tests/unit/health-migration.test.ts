import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

const file = "0112_health_probe.sql";
const sql = readFileSync(join(process.cwd(), "supabase", "migrations", file), "utf8");

describe("health probe migration", () => {
  it("creates a function that takes nothing and returns a constant", () => {
    expect(sql).toMatch(/create or replace function onebook\.health\(\)\s+returns text/i);
    expect(sql).toMatch(/select 'ok'/i);
    // No table, no argument, nothing to parameterise: that is what makes it
    // safe to expose to an unauthenticated caller.
    expect(sql).not.toMatch(/\bfrom\s+(acc_|onebook\.)/i);
  });

  it("grants the schema usage anon did not have", () => {
    // Migration 0081 gave usage to authenticated and service_role only, so
    // execute on the function alone fails before reaching it.
    expect(sql).toMatch(/grant usage on schema onebook to anon/i);
  });

  it("revokes from public before granting to anon", () => {
    const revoke = sql.search(/revoke all on function onebook\.health\(\) from public/i);
    const grant = sql.search(/grant execute on function onebook\.health\(\)[^;]*anon/i);
    expect(revoke, "the revoke is missing").toBeGreaterThan(-1);
    expect(grant, "the grant is missing").toBeGreaterThan(-1);
    expect(revoke).toBeLessThan(grant);
  });

  it("opens nothing else in the schema", () => {
    // Usage on the schema is wider than one function, so this pins the blast
    // radius: no table and no other function may be granted to anon here.
    expect(sql).not.toMatch(/grant[^;]*on\s+table[^;]*anon/i);
    expect(sql).not.toMatch(/grant[^;]*on\s+all\s+(tables|functions)[^;]*anon/i);
    expect(sql).not.toMatch(/onebook\.company/i);
  });

  it("is held back from company schemas, because the register is not per company", () => {
    // scopeOf() classifies any statement naming onebook. as global. Running the
    // real planner proves it rather than assuming it: replaying this per company
    // would keep rewriting one shared function.
    const plan = planCompanySchema([{ file, sql }], "co_example");
    expect(plan.statements).toEqual([]);
    expect(plan.skipped.length).toBeGreaterThan(0);
  });
});
