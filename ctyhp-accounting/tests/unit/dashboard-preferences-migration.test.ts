import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

// Comments stripped as migration-grants.test.ts does (CRLF-safe, block comments
// too), so a sentence in a comment can never satisfy an assertion.
function stripComments(raw: string): string {
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

const FILE = "0198_dashboard_preferences.sql";
const raw = readFileSync(join(process.cwd(), "supabase/migrations", FILE), "utf8");
const sql = stripComments(raw);
const flat = sql.replace(/\s+/g, " ").toLowerCase();
const SIGNATURE = "onebook.save_dashboard_preference(uuid, jsonb, boolean, uuid[], boolean)";

/** The function's body, between its dollar quotes. */
const body = (() => {
  const match = /create or replace function onebook\.save_dashboard_preference\([\s\S]*?as \$\$([\s\S]*?)\$\$;/i.exec(sql);
  return (match?.[1] ?? "").replace(/\s+/g, " ").toLowerCase();
})();

describe("0198 dashboard preferences", () => {
  it("creates one global table, a row per person per company", () => {
    expect(flat).toContain("create table if not exists onebook.dashboard_preference (");
    expect(flat).toContain("user_id uuid not null references auth.users (id) on delete cascade");
    expect(flat).toContain("company_id uuid not null references onebook.company (id) on delete cascade");
    expect(flat).toContain("primary key (user_id, company_id)");
    expect(flat).toContain("overview jsonb,");
    expect(flat).toContain("watchlist uuid[] not null default '{}'");
    expect(flat).toContain("privacy boolean not null default false");
  });

  it("bounds the layout's size and the watchlist's length in the table itself", () => {
    expect(flat).toContain(
      "check (overview is null or (jsonb_typeof(overview) = 'object' and pg_column_size(overview) <= 4096))",
    );
    expect(flat).toContain("constraint dashboard_preference_watchlist_size check (cardinality(watchlist) <= 10)");
  });

  it("enables row-level security", () => {
    expect(flat).toContain("alter table onebook.dashboard_preference enable row level security");
  });

  it("lets the browser read its own row and nothing else: no insert, update or delete grant", () => {
    expect(flat).toContain("revoke all on onebook.dashboard_preference from public, anon, authenticated");
    const grants = flat.match(/grant [^;]+;/g) ?? [];
    const onTables = grants.filter((g) => !g.includes("function"));
    expect([...onTables].sort()).toEqual(
      [
        "grant select on onebook.dashboard_preference to authenticated;",
        "grant all on onebook.dashboard_preference to service_role;",
      ].sort(),
    );
    expect(flat).not.toMatch(/grant [^;]*\b(insert|update|delete)\b[^;]* to authenticated/);
  });

  it("has one policy, for reading, scoped to the signed-in owner", () => {
    const policies = flat.match(/create policy [^;]+;/g) ?? [];
    expect(policies).toEqual([
      "create policy dashboard_preference_select on onebook.dashboard_preference for select to authenticated using (user_id = (select auth.uid()));",
    ]);
  });

  it("saves through a security-definer function with a fixed search_path, callable only when signed in", () => {
    expect(flat).toContain(
      "create or replace function onebook.save_dashboard_preference( p_company uuid, p_overview jsonb, p_reset_overview boolean, p_watchlist uuid[], p_privacy boolean ) returns void",
    );
    expect(flat).toContain("language plpgsql security definer set search_path = onebook, public");
    expect(flat).toContain(`revoke all on function ${SIGNATURE} from public, anon`);
    expect(flat).toContain(`grant execute on function ${SIGNATURE} to authenticated`);
  });

  it("refuses a signed-out caller and one who is not a member of the company", () => {
    expect(body).toContain("v_user uuid := auth.uid()");
    expect(body).toMatch(/if v_user is null then raise exception '[^']+' using errcode = '42501'/);
    expect(body).toContain("from onebook.company_member where company_id = p_company and user_id = v_user");
    expect(body).toContain("not a member of this company");
    expect(body.match(/errcode = '42501'/g)).toHaveLength(2);
  });

  it("checks a layout's shape: an object of three lists of at most 20 short strings", () => {
    expect(body).toContain("jsonb_typeof(p_overview) <> 'object'");
    expect(body).toContain("foreach v_key in array array['order', 'shown', 'wide'] loop");
    expect(body).toContain("jsonb_typeof(v_list) <> 'array'");
    expect(body).toContain("jsonb_array_length(v_list) > 20");
    expect(body).toContain("jsonb_typeof(e.item) <> 'string' or length(e.item #>> '{}') > 40");
    // Only the three lists are kept, whatever else was sent.
    expect(body).toContain("jsonb_build_object( 'order', p_overview -> 'order', 'shown', p_overview -> 'shown', 'wide', p_overview -> 'wide' )");
  });

  it("checks the watchlist: at most 10 accounts, none of them missing", () => {
    expect(body).toContain("cardinality(p_watchlist) > 10");
    expect(body).toContain("array_position(p_watchlist, null) is not null");
    // Four refusals of the input: the layout's kind, its lists, their length and items; two of the watchlist.
    expect(body.match(/errcode = '22023'/g)).toHaveLength(6);
  });

  it("upserts the person's row, keeping what is not given, resetting the layout only when asked", () => {
    expect(body).toContain("v_reset boolean := coalesce(p_reset_overview, false)");
    expect(body).toContain("on conflict (user_id, company_id) do update");
    expect(body).toContain("when v_reset then null when v_overview is not null then v_overview else d.overview end");
    expect(body).toContain("watchlist = coalesce(p_watchlist, d.watchlist)");
    expect(body).toContain("privacy = coalesce(p_privacy, d.privacy)");
    expect(body).toContain("updated_at = now()");
    // The row is always the caller's own: the browser never names the person.
    expect(body).toMatch(/values \( v_user, p_company,/);
  });

  it("is safe to run again, and every statement stays out of a company schema", () => {
    expect(sql).not.toMatch(/create\s+(?:unique\s+)?(?:table|index)\s+(?!if not exists)/i);
    const lines = sql.split("\n");
    lines.forEach((line, i) => {
      const m = /create policy (\w+) on (\S+)/i.exec(line);
      if (!m) return;
      expect(lines[i - 1].trim().toLowerCase()).toBe(`drop policy if exists ${m[1]} on ${m[2]};`.toLowerCase());
    });
    expect(flat).not.toMatch(/create function/);
    // migrate.mjs replays a migration into each company schema; everything here is the register's.
    const plan = planCompanySchema([{ file: FILE, sql: raw }], "co_probe");
    expect(plan.statements.map((s) => stripComments(s).trim().toLowerCase())).toEqual(["set search_path = co_probe"]);
    expect(plan.skipped.length).toBeGreaterThanOrEqual(8);
  });

  it("ends by reloading the API schema", () => {
    expect(flat.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });
});
