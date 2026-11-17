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

const FILE = "0200_dashboard_card_choices.sql";
const raw = readFileSync(join(process.cwd(), "supabase/migrations", FILE), "utf8");
const sql = stripComments(raw);
const flat = sql.replace(/\s+/g, " ").toLowerCase();
const SIGNATURE = "onebook.save_dashboard_cards(uuid, jsonb)";

/** The function's body, between its dollar quotes. */
const body = (() => {
  const match = /create or replace function onebook\.save_dashboard_cards\([\s\S]*?as \$\$([\s\S]*?)\$\$;/i.exec(sql);
  return (match?.[1] ?? "").replace(/\s+/g, " ").toLowerCase();
})();

describe("0200 dashboard card choices", () => {
  it("adds the choices to the person's row, an empty object until one is made", () => {
    expect(flat).toContain("alter table onebook.dashboard_preference add column if not exists cards jsonb not null default '{}'::jsonb;");
  });

  it("bounds the choices' kind and size in the table, and adds that check again safely", () => {
    expect(flat).toContain("alter table onebook.dashboard_preference drop constraint if exists dashboard_preference_cards_shape;");
    expect(flat).toContain(
      "alter table onebook.dashboard_preference add constraint dashboard_preference_cards_shape check (jsonb_typeof(cards) = 'object' and pg_column_size(cards) <= 2048);",
    );
    // The drop comes first, so a second run replaces the check rather than failing on it.
    expect(flat.indexOf("drop constraint if exists dashboard_preference_cards_shape")).toBeLessThan(
      flat.indexOf("add constraint dashboard_preference_cards_shape"),
    );
  });

  it("is safe to run again: nothing is created that a second run would trip over", () => {
    expect(flat).not.toMatch(/create\s+(?:unique\s+)?(?:table|index)\s+(?!if not exists)/);
    expect(flat).not.toMatch(/add column (?!if not exists)/);
    expect(flat).not.toMatch(/add constraint (?!dashboard_preference_cards_shape)/);
    expect(flat).not.toMatch(/create function/);
    expect(flat).toContain("create or replace function onebook.save_dashboard_cards(");
  });

  it("leaves save_dashboard_preference exactly as 0198 made it: no new signature beside it", () => {
    expect(flat).not.toContain("save_dashboard_preference");
    expect(flat).not.toMatch(/drop function/);
    // Nothing about the table's other columns, its policy or its grants changes.
    expect(flat).not.toMatch(/\b(overview|watchlist|privacy)\b/);
    expect(flat).not.toMatch(/create policy|drop policy|alter policy/);
    expect(flat).not.toMatch(/grant [^;]* on onebook\.dashboard_preference/);
  });

  it("saves through a security-definer function with a fixed search_path, callable only when signed in", () => {
    expect(flat).toContain("create or replace function onebook.save_dashboard_cards(p_company uuid, p_cards jsonb) returns void");
    expect(flat).toContain("language plpgsql security definer set search_path = onebook, public");
    expect(flat).toContain(`revoke all on function ${SIGNATURE} from public, anon;`);
    expect(flat).toContain(`grant execute on function ${SIGNATURE} to authenticated;`);
    const grants = flat.match(/grant [^;]+;/g) ?? [];
    expect(grants).toEqual([`grant execute on function ${SIGNATURE} to authenticated;`]);
  });

  it("refuses a signed-out caller and one who is not a member of the company, as save_dashboard_preference does", () => {
    expect(body).toContain("v_user uuid := auth.uid()");
    expect(body).toMatch(/if v_user is null then raise exception '[^']+' using errcode = '42501'/);
    expect(body).toContain("from onebook.company_member where company_id = p_company and user_id = v_user");
    expect(body).toContain("not a member of this company");
    expect(body.match(/errcode = '42501'/g)).toHaveLength(2);
    // The same words and checks as 0198's function.
    const preferences = stripComments(readFileSync(join(process.cwd(), "supabase/migrations/0198_dashboard_preferences.sql"), "utf8"))
      .replace(/\s+/g, " ")
      .toLowerCase();
    expect(preferences).toContain("raise exception 'sign in to save your dashboard' using errcode = '42501'");
    expect(body).toContain("raise exception 'sign in to save your dashboard' using errcode = '42501'");
  });

  it("checks the choices: an object of at most 16 keys of at most 40 characters, each a short string or a number", () => {
    expect(body).toContain("if p_cards is null or jsonb_typeof(p_cards) <> 'object' then");
    expect(body).toContain("(select count(*) from jsonb_object_keys(p_cards)) > 16");
    expect(body).toContain("from jsonb_each(p_cards) as e(key, value)");
    expect(body).toContain("length(e.key) > 40");
    expect(body).toContain(
      "not ( (jsonb_typeof(e.value) = 'string' and length(e.value #>> '{}') <= 20) or jsonb_typeof(e.value) = 'number' )",
    );
    // Three refusals of the input: its kind, its size, a key or value.
    expect(body.match(/errcode = '22023'/g)).toHaveLength(3);
  });

  it("upserts the person's own row, changing only the choices and when they were saved", () => {
    expect(body).toContain("insert into onebook.dashboard_preference (user_id, company_id, cards, updated_at) values (v_user, p_company, p_cards, now())");
    expect(body).toContain("on conflict (user_id, company_id) do update set cards = excluded.cards, updated_at = now();");
    // Nothing else of the row is named, so a new row takes the table's defaults and an old one keeps its values.
    expect(body).not.toMatch(/\b(overview|watchlist|privacy)\b/);
  });

  it("keeps every statement out of a company schema", () => {
    // migrate.mjs replays a migration into each company schema; everything here is the register's.
    const plan = planCompanySchema([{ file: FILE, sql: raw }], "co_probe");
    expect(plan.statements.map((s) => stripComments(s).trim().toLowerCase())).toEqual(["set search_path = co_probe"]);
    expect(plan.skipped.length).toBe(7);
    // The same when the file is checked out with \r\n line endings.
    const crlf = planCompanySchema([{ file: FILE, sql: raw.replace(/\r?\n/g, "\r\n") }], "co_probe");
    expect(crlf.statements.map((s) => stripComments(s).trim().toLowerCase())).toEqual(["set search_path = co_probe"]);
  });

  it("ends by reloading the API schema", () => {
    expect(flat.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });
});
