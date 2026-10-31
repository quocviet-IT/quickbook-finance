import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

const DIR = join(process.cwd(), "supabase/migrations");
const FILE = "0185_add_colleague_not_any_account.sql";
const raw = readFileSync(join(DIR, FILE), "utf8").replace(/\r/g, "");
/** Without its prose, so naming a thing in a comment never reads as doing it. */
const strip = (text: string) =>
  text
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const sql = norm(strip(raw).replace(/\/\*\*[\s\S]*?\*\//g, ""));

describe("0185: Add existing account finds colleagues only", () => {
  const plan = planCompanySchema([{ file: FILE, sql: raw }], "co_example");
  const company = norm(strip(plan.statements.join("\n")));
  const held = norm(plan.skipped.map((s) => s.sql).join("\n"));

  it("drops the email lookup in every company", () => {
    expect(company).toContain("drop function if exists acc_add_existing_user(text, acc_app_role)");
    expect(company).toContain("set search_path = co_example");
  });

  it("builds find_colleague once, in the register, and never in a company", () => {
    expect(company).not.toContain("find_colleague");
    expect(held).toContain("create or replace function onebook.find_colleague(p_company_id uuid, p_email text)");
  });

  it("asks the company's own users.manage before looking anything up", () => {
    const body = sql.slice(sql.indexOf("create or replace function onebook.find_colleague"));
    const permission = body.indexOf("acc_has_permission(%l)");
    const lookup = body.indexOf("from auth.users");
    expect(permission).toBeGreaterThan(0);
    expect(lookup).toBeGreaterThan(permission);
    expect(body).toContain("'users.manage'");
  });

  it("finds a person only on this company's list or beside the caller elsewhere", () => {
    expect(sql).toContain("me.id = $2 and me.status in (''invited'', ''active'')");
    expect(sql).toContain("using v_target, auth.uid()");
    // No message tells an unknown address from a known one: the only answers are a row or none.
    expect(sql).not.toMatch(/no onebook sign-in/);
  });

  it("is for signed-in people only", () => {
    expect(sql).toContain("revoke all on function onebook.find_colleague(uuid, text) from public, anon;");
    expect(sql).toContain("grant execute on function onebook.find_colleague(uuid, text) to authenticated;");
  });

  it("is the last migration to define acc_add_existing_user, so nothing later brings it back", () => {
    const later = readdirSync(DIR)
      .filter((name) => name.endsWith(".sql") && name > FILE)
      .filter((name) => /create or replace function acc_add_existing_user\b/i.test(strip(readFileSync(join(DIR, name), "utf8"))));
    expect(later).toEqual([]);
  });
});
