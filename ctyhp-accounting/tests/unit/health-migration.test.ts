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

const hardeningFile = "0113_health_probe_hardening.sql";
const hardening = readFileSync(
  join(process.cwd(), "supabase", "migrations", hardeningFile),
  "utf8",
);

/**
 * The SQL with its prose removed.
 *
 * A migration's header explains why it exists, which means it names the very
 * things the assertions forbid. Matching against the comments would fail a file
 * for describing the hazard it closes.
 *
 * Splitting on `\r?\n` rather than `\n` is what makes this work on a Windows
 * checkout. `core.autocrlf` writes the file with CRLF; a line then ends `…\r`,
 * and `.` in `--.*$` does not match `\r`, so the comment survives stripping and
 * the file fails for the sentence explaining what it forbids. It passed on CI
 * only because Linux checks the file out with LF — a test that is green on the
 * server and red on the author's machine is one people learn to ignore.
 */
function code(sql: string): string {
  return sql
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

describe("health probe hardening migration", () => {
  it("runs as its caller with a pinned search_path", () => {
    // The only function an unauthenticated caller may execute. Running it as
    // the owner instead is what would turn a later edit that reads something
    // real into privilege escalation.
    expect(code(hardening)).toMatch(/security invoker/i);
    expect(code(hardening)).not.toMatch(/security definer/i);
    expect(code(hardening)).toMatch(/set search_path\s*=/i);
  });

  it("still opens nothing beyond the one function", () => {
    expect(hardening).not.toMatch(/grant[^;]*on\s+table[^;]*anon/i);
    expect(hardening).not.toMatch(/grant[^;]*on\s+all\s+(tables|functions)[^;]*anon/i);
    expect(hardening).not.toMatch(/onebook\.company/i);
  });

  it("is held back from company schemas, like the migration it amends", () => {
    const plan = planCompanySchema([{ file: hardeningFile, sql: hardening }], "co_example");
    expect(plan.statements).toEqual([]);
    expect(plan.skipped.length).toBeGreaterThan(0);
  });
});
