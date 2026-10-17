import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

const FILE = "0151_reversed_change_settles.sql";
const NAME = "acc_reconciliation_changes";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8").replace(/\r/g, "");
}

function strip(raw: string): string {
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/--.*$/, ""))
    .join("\n");
}

function fn(text: string): string {
  const start = text.search(new RegExp(`create or replace function ${NAME}\\(`, "i"));
  return text.slice(start, text.indexOf("\n$$;", start) + 4);
}

const raw = read(`supabase/migrations/${FILE}`);
const sql = strip(raw);
const body = fn(sql);
const rawBody = fn(raw);
const original = fn(read("supabase/migrations/0150_reconcile_integrity.sql"));

describe("0151 reversed change settles: shape", () => {
  it("starts with the search path, qualifies nothing with public., and replaces only the one function", () => {
    expect(sql).toMatch(/^\s*set search_path = public;/i);
    expect(sql).not.toMatch(/\bpublic\.\w/i);
    const created = [...sql.matchAll(/create (?:or replace )?function (\w+)\(/gi)].map((m) => m[1]);
    expect(created).toEqual([NAME]);
    expect(sql).not.toMatch(/\bcreate function\b/i);
    expect(sql).not.toMatch(/create (table|type|index|unique index|trigger|policy)\b/i);
    expect(sql).not.toMatch(/\b(alter|drop|insert into|update|delete from)\b/i);
  });

  it("runs whole in every company schema, nothing skipped", () => {
    const plan = planCompanySchema([{ file: FILE, sql: raw }], "co_example");
    expect(plan.skipped).toEqual([]);
    const joined = plan.statements.join("\n");
    expect(joined).toMatch(/set search_path = co_example/);
    expect(joined).not.toMatch(/set search_path = public/);
    expect(joined).toMatch(new RegExp(`function ${NAME}\\(`, "i"));
    expect(joined).toMatch(new RegExp(`revoke all on function ${NAME}\\(\\)`, "i"));
  });
});

describe("0151 acc_reconciliation_changes: access", () => {
  it("is a stable security definer with the search path pinned", () => {
    const header = body.slice(0, body.indexOf("$$"));
    expect(header).toMatch(/security definer/i);
    expect(header).toMatch(/\bstable\b/i);
    expect(header).toMatch(/set search_path = public/i);
  });

  it("lets staff or a viewer read and refuses anyone else, before reading anything", () => {
    expect(body).toContain(
      "if not (acc_is_staff() or coalesce(acc_current_role() = 'viewer', false)) then\n    raise exception 'Not authorized to read changes to reconciliations';",
    );
    expect(body.indexOf("acc_is_staff()")).toBeLessThan(body.indexOf("return query"));
  });

  it("is revoked from public and anon and granted to signed-in users and the service role", () => {
    expect(sql).toContain(`revoke all on function ${NAME}() from public, anon;`);
    expect(sql).toContain(`grant execute on function ${NAME}() to authenticated, service_role;`);
  });
});

describe("0151 keeps 0150 and adds one condition", () => {
  const returns = (text: string) => text.slice(text.indexOf("returns table ("), text.indexOf("\nlanguage"));

  it("returns the same type as 0150", () => {
    expect(returns(body)).toBe(returns(strip(original)));
  });

  it("is identical to 0150 once the new not-exists block and the changed comment line are removed", () => {
    const start = rawBody.indexOf("       and not exists (\n         select 1\n           from acc_journal_line xl");
    expect(start).toBeGreaterThan(0);
    const endMarker = "          where xl.journal_entry_id = x.id\n       )\n";
    const end = rawBody.indexOf(endMarker, start);
    expect(end).toBeGreaterThan(start);
    expect(rawBody.split("and not exists (\n         select 1\n           from acc_journal_line xl").length - 1).toBe(1);
    const without = (rawBody.slice(0, start) + rawBody.slice(end + endMarker.length)).replace(
      "-- reversed, until the reversal itself is reconciled",
      "-- reversed",
    );
    expect(without).toBe(original);
  });

  it("settles a reversed row only when a line of the reversing entry is ticked on a completed reconciliation", () => {
    expect(body).toMatch(/from acc_journal_line xl\s+join acc_reconciliation_line xrl on xrl\.journal_line_id = xl\.id/i);
    expect(body).toMatch(/join acc_statement_reconciliation xr on xr\.id = xrl\.reconciliation_id and xr\.status = 'completed'\s+where xl\.journal_entry_id = x\.id/i);
  });
});
