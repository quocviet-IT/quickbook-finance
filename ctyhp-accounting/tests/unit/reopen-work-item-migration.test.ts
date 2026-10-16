import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

const FILE = "0148_reopen_resolved_work_item.sql";

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
const start = sql.search(/create or replace function acc_set_work_item_state\(/i);
const fn = sql.slice(start, sql.indexOf("end $$;", start) + 7);
const reopen = fn.slice(fn.search(/elsif v_current\.lifecycle = 'resolved' then/i), fn.search(/\n  else\n/i));

describe("0148 reopen a resolved work item: shape", () => {
  it("starts with the schema search path and qualifies nothing with public.", () => {
    expect(sql).toMatch(/^\s*set search_path = public;/i);
    expect(sql).not.toMatch(/\bpublic\.\w/i);
  });

  it("replaces acc_set_work_item_state with its signature unchanged, idempotently", () => {
    const created = [...sql.matchAll(/create (?:or replace )?function (\w+)\(([^)]*)\)/gi)];
    expect(created.map((m) => m[1])).toEqual(["acc_set_work_item_state"]);
    expect(created[0][2].replace(/\s+/g, " ").trim()).toBe(
      "p_key text, p_lifecycle text, p_owner_id uuid, p_due_date date, p_reason text, " +
        "p_expected_version int, p_blocks_close boolean default false",
    );
    expect(sql).not.toMatch(/\bcreate function\b/i);
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
    expect(joined).toMatch(/function acc_set_work_item_state\(/i);
    expect(joined).toMatch(/revoke all on function acc_set_work_item_state\(text, text, uuid, date, text, int, boolean\)/i);
    expect(joined).toMatch(/drop function if exists acc_retire_work_items\(text\[\]\)/i);
  });
});

describe("0148 reopen a resolved work item: the function", () => {
  it("returns int and is a security definer with the search path pinned", () => {
    const header = fn.slice(0, fn.indexOf("$$"));
    expect(header).toMatch(/returns int\b/i);
    expect(header).toMatch(/security definer/i);
    expect(header).toMatch(/set search_path = public/i);
  });

  it("keeps every other refusal, in the same order and wording as 0118", () => {
    const order = [
      "Not authorized to change work",
      "A work item key is required",
      "Work is resolved by the books, not by hand",
      "This blocks the period close and cannot be dismissed",
      "Say why this is being dismissed",
    ];
    let at = -1;
    for (const message of order) {
      const next = fn.indexOf(`'${message}'`);
      expect(next, message).toBeGreaterThan(at);
      expect(read("supabase/migrations/0118_work_item_state.sql")).toContain(`'${message}'`);
      at = next;
    }
    expect(fn).toMatch(/if not acc_is_staff\(\) then/i);
    const stale = "'This item has been changed by someone else. Reload and try again'";
    expect(fn.split(stale).length - 1).toBe(3);
    expect(read("supabase/migrations/0118_work_item_state.sql").split(stale).length - 1).toBe(2);
  });

  it("locks the row it reads, so two callers cannot both reopen it", () => {
    expect(fn).toMatch(
      /select \* into v_current from acc_work_item_state where work_key = p_key for update;/i,
    );
    expect(fn.indexOf("for update")).toBeLessThan(fn.search(/elsif v_current\.lifecycle = 'resolved'/i));
  });

  it("explains what a null version means", () => {
    expect(raw).toMatch(/null `p_expected_version` means "I believe there is no active row"/i);
  });

  it("no longer raises on a resolved row", () => {
    expect(fn).not.toMatch(/already resolved/i);
    expect(fn).not.toMatch(/its exception has cleared/i);
  });

  it("reopens a resolved row only when no version is sent", () => {
    expect(reopen).toMatch(/if p_expected_version is not null then\s+raise exception 'This item has been changed by someone else/i);
    expect(reopen).toMatch(/set lifecycle = p_lifecycle,/i);
    expect(reopen).toMatch(/owner_id = p_owner_id,/i);
    expect(reopen).toMatch(/due_date = p_due_date,/i);
    expect(reopen).toMatch(/dismiss_reason = case when p_lifecycle = 'dismissed' then v_reason else null end,/i);
    expect(reopen).toMatch(/version = version \+ 1,/i);
    expect(reopen).toMatch(/returning version into v_version;/i);
    expect(reopen).toMatch(/v_reopened := true;/i);
    expect(reopen).not.toMatch(/\binsert\b|\bdelete\b/i);
  });

  it("still refuses an active row with a null or wrong version", () => {
    expect(fn).toMatch(/if p_expected_version is null or v_current\.version <> p_expected_version then/i);
  });

  it("writes the audit row as an update, with reopened true in after_json", () => {
    expect(fn).toMatch(/case when v_current\.work_key is null then 'insert' else 'update' end/i);
    expect(fn).toMatch(/case when v_reopened then jsonb_build_object\('reopened', true\) else '\{\}'::jsonb end/i);
  });

  it("is revoked from public and anon and granted to signed-in users and the service role", () => {
    expect(sql).toMatch(
      /revoke all on function acc_set_work_item_state\(text, text, uuid, date, text, int, boolean\)\s+from public, anon;/i,
    );
    expect(sql).toMatch(
      /grant execute on function acc_set_work_item_state\(text, text, uuid, date, text, int, boolean\)\s+to authenticated, service_role;/i,
    );
    const oldGrants = strip(read("supabase/migrations/0118_work_item_state.sql"));
    expect(oldGrants).toMatch(
      /revoke all on function acc_set_work_item_state\(text, text, uuid, date, text, int, boolean\)\s+from public, anon;/i,
    );
  });
});

describe("0148 reopen a resolved work item: the retires", () => {
  it("drops the one-argument retire, and only that", () => {
    const drops = [...sql.matchAll(/\bdrop\s+(\w+)(?:\s+if exists)?\s+([^;]+);/gi)].map((m) => `${m[1]} ${m[2].trim()}`);
    expect(drops).toEqual(["function acc_retire_work_items(text[])"]);
    expect(sql).toMatch(/drop function if exists acc_retire_work_items\(text\[\]\);/i);
  });

  it("leaves the two-argument retire untouched", () => {
    expect(sql).not.toMatch(/acc_retire_work_items\(text\[\],\s*text\[\]\)/i);
    expect(sql).not.toMatch(/p_prefixes/i);
    const scoped = strip(read("supabase/migrations/0147_scoped_work_item_retire.sql"));
    expect(scoped).toMatch(/create or replace function acc_retire_work_items\(\s*p_live_keys text\[\],\s*p_prefixes text\[\]/i);
    expect(scoped).not.toMatch(/\bdrop\b/i);
  });
});
