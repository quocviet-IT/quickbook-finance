import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Comments stripped as migration-grants.test.ts does (CRLF-safe, block comments
// too), so a sentence in a comment can never satisfy an assertion.
function stripComments(raw: string): string {
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

const sql = stripComments(
  readFileSync(join(process.cwd(), "supabase/migrations/0190_abacus_conversations.sql"), "utf8"),
);
const flat = sql.replace(/\s+/g, " ").toLowerCase();

describe("0190 Abacus conversations", () => {
  it("creates both global tables", () => {
    expect(flat).toContain("create table if not exists onebook.ai_conversation (");
    expect(flat).toContain("create table if not exists onebook.ai_message (");
  });

  it("enables row-level security on both", () => {
    expect(flat).toContain("alter table onebook.ai_conversation enable row level security");
    expect(flat).toContain("alter table onebook.ai_message enable row level security");
  });

  it("grants exactly what the browser needs", () => {
    expect(flat).toContain("revoke all on onebook.ai_conversation from public, anon, authenticated");
    expect(flat).toContain("revoke all on onebook.ai_message from public, anon, authenticated");
    const grants = flat.match(/grant [^;]+;/g) ?? [];
    const onTables = grants.filter((g) => !g.includes("function"));
    expect([...onTables].sort()).toEqual(
      [
        "grant select, delete on onebook.ai_conversation to authenticated;",
        "grant select on onebook.ai_message to authenticated;",
        "grant update (rating) on onebook.ai_message to authenticated;",
        "grant all on onebook.ai_conversation to service_role;",
        "grant all on onebook.ai_message to service_role;",
      ].sort(),
    );
  });

  it("lets the browser change only the rating, never the answer", () => {
    expect(flat).toContain("grant update (rating) on onebook.ai_message");
    expect(flat).not.toMatch(/grant update on onebook\.ai_message/);
  });

  it("has no insert policy and no insert grant", () => {
    expect(flat).not.toMatch(/create policy \w+ on onebook\.ai_\w+ for insert/);
    expect(flat).not.toMatch(/grant [^;]*insert[^;]* to authenticated/);
  });

  it("scopes every policy to the signed-in owner", () => {
    const policies = flat.match(/create policy [^;]+;/g) ?? [];
    expect(policies).toHaveLength(4);
    for (const policy of policies) expect(policy).toContain("user_id = (select auth.uid())");
    expect(flat).toMatch(
      /create policy ai_message_update[^;]*using \(user_id = \(select auth\.uid\(\)\)\) with check \(user_id = \(select auth\.uid\(\)\)\)/,
    );
  });

  it("saves through a security-definer function with a fixed search_path", () => {
    expect(flat).toMatch(/create or replace function onebook\.save_ai_exchange\(/);
    expect(flat).toContain("language plpgsql security definer set search_path = onebook, public");
    expect(flat).toContain(
      "revoke all on function onebook.save_ai_exchange(uuid, uuid, text, text, text, text) from public, anon",
    );
    expect(flat).toContain(
      "grant execute on function onebook.save_ai_exchange(uuid, uuid, text, text, text, text) to authenticated",
    );
  });

  it("checks sign-in, membership and ownership", () => {
    expect(flat).toContain("v_user uuid := auth.uid()");
    expect(flat).toContain("sign in to save a conversation");
    expect(flat).toContain("from onebook.company_member where company_id = p_company and user_id = v_user");
    expect(flat).toContain("not a member of this company");
    expect(flat).toContain("id = p_conversation and user_id = v_user and company_id = p_company");
    expect(flat).toContain("that conversation is not yours");
    expect(flat.match(/errcode = '42501'/g)).toHaveLength(3);
  });

  it("keeps the 20 most recent conversations per person per company", () => {
    expect(flat).toContain("order by updated_at desc, id desc limit 20");
    expect(flat).toContain(
      "delete from onebook.ai_conversation where user_id = v_user and company_id = p_company",
    );
  });

  it("is safe to run again in every company schema", () => {
    expect(sql).not.toMatch(/create\s+(?:unique\s+)?(?:table|index)\s+(?!if not exists)/i);
    const lines = sql.split("\n");
    lines.forEach((line, i) => {
      const m = /create policy (\w+) on (\S+)/i.exec(line);
      if (!m) return;
      expect(lines[i - 1].trim().toLowerCase()).toBe(`drop policy if exists ${m[1]} on ${m[2]};`.toLowerCase());
    });
    expect(flat).not.toMatch(/create function/);
  });

  it("ends by reloading the API schema", () => {
    expect(flat.trimEnd().endsWith("notify pgrst, 'reload schema';")).toBe(true);
  });
});
