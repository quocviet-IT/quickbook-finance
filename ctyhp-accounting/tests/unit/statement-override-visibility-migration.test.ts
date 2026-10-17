import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

const FILE = "0149_statement_override_visibility.sql";
const IMPORT_SIGNATURE = "acc_import_bank_statement_proved(uuid, text, jsonb, jsonb)";

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

/** The import function as written, comments included, from its create to its closing $$;. */
function importFunction(raw: string): string {
  const start = raw.search(/create or replace function acc_import_bank_statement_proved\(/i);
  const end = raw.indexOf("\n$$;", start);
  return raw.slice(start, end + 4);
}

const raw = read(`supabase/migrations/${FILE}`);
const sql = strip(raw);
const importFn = importFunction(raw);
const importSql = strip(importFn);

const overridesStart = sql.search(/create or replace function acc_statement_overrides\(/i);
const overrides = sql.slice(overridesStart, sql.indexOf("\n$$;", overridesStart) + 4);

describe("0149 statement override visibility: shape", () => {
  it("starts with the schema search path and qualifies nothing with public.", () => {
    expect(sql).toMatch(/^\s*set search_path = public;/i);
    expect(sql).not.toMatch(/\bpublic\.\w/i);
  });

  it("replaces the import function and creates the overrides function, both idempotently", () => {
    const created = [...sql.matchAll(/create (?:or replace )?function (\w+)\(/gi)].map((m) => m[1]);
    expect(created).toEqual(["acc_import_bank_statement_proved", "acc_statement_overrides"]);
    expect(sql).not.toMatch(/\bcreate function\b/i);
  });

  it("creates no table, type, index, trigger or policy and changes no table", () => {
    expect(sql).not.toMatch(/create (table|type|index|unique index|trigger|policy)\b/i);
    expect(sql).not.toMatch(/\balter\b/i);
    expect(sql).not.toMatch(/\bdrop\b/i);
  });

  it("runs whole in every company schema, nothing skipped", () => {
    const plan = planCompanySchema([{ file: FILE, sql: raw }], "co_example");
    expect(plan.skipped).toEqual([]);
    const joined = plan.statements.join("\n");
    expect(joined).toMatch(/set search_path = co_example/);
    expect(joined).not.toMatch(/set search_path = public/);
    expect(joined).toMatch(/function acc_statement_overrides\(/i);
    expect(joined).toMatch(/function acc_import_bank_statement_proved\(/i);
    expect(joined).toMatch(/revoke all on function acc_statement_overrides\(\)/i);
  });
});

describe("0149 the import function keeps 0143 and adds the prior check", () => {
  const original = importFunction(read("supabase/migrations/0143_statement_proof.sql"));

  it("keeps the signature, the definer and the search path", () => {
    const header = importSql.slice(0, importSql.indexOf("$$"));
    expect(header.replace(/\s+/g, " ")).toContain(
      "acc_import_bank_statement_proved( p_bank_account_id uuid, p_filename text, p_rows jsonb, p_proof jsonb ) returns table (inserted int, skipped int, batch_id uuid)",
    );
    expect(header).toMatch(/security definer/i);
    expect(header).toMatch(/set search_path = public/i);
  });

  it("is identical to its 0143 definition once the new block is taken out", () => {
    const begin = importFn.indexOf("  -- 0149: begin prior opening check\n");
    const endMarker = "  -- 0149: end prior opening check\n";
    const end = importFn.indexOf(endMarker);
    expect(begin).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(begin);
    expect(importFn.split("-- 0149: begin").length - 1).toBe(1);
    const without = importFn.slice(0, begin) + importFn.slice(end + endMarker.length);
    expect(without).toBe(original);
  });

  it("puts the block after the opening basis is validated and before the closing basis is read", () => {
    const at = importFn.indexOf("-- 0149: begin prior opening check");
    expect(at).toBeGreaterThan(importFn.indexOf("Say where the opening balance came from"));
    expect(at).toBeLessThan(importFn.indexOf("v_closing_basis := v_proof ->> 'closing_basis';"));
  });

  it("asserts a prior opening equals the closing of the newest completed reconciliation", () => {
    const block = importSql.slice(importSql.search(/if v_opening_basis = 'prior' then/i));
    expect(block).toMatch(/from acc_statement_reconciliation r/i);
    expect(block).toMatch(/r\.bank_account_id = p_bank_account_id and r\.status = 'completed'/i);
    expect(block).toMatch(/order by r\.statement_ending_date desc, r\.completed_at desc nulls last, r\.id desc\s+limit 1/i);
    expect(block).toMatch(/r\.statement_ending_balance_minor/i);
    expect(block).toMatch(/if v_opening <> v_prior_close then/i);
  });

  it("uses the exact message, with the amount formatted as 0132 formats money", () => {
    expect(importSql).toContain("'The opening must be the closing of the last reconciliation, %.'");
    expect(importSql).toMatch(/to_char\(v_prior_close \/ 100\.0, 'FM999,999,999,990\.00'\)/);
    expect(read("supabase/migrations/0132_reconcile_from_statement.sql")).toContain("to_char(v_balance / 100.0, 'FM999,999,999,990.00')");
  });

  it("refuses a prior opening when the account has no completed reconciliation", () => {
    expect(importSql).toMatch(/if v_prior_found is null then\s+raise exception 'The opening cannot be the closing of the last reconciliation: this account has none\.'/i);
  });

  it("checks nothing for the other bases", () => {
    expect(importSql).toMatch(/if v_opening_basis = 'prior' then/i);
    expect(importSql.match(/v_prior_close/g)?.length).toBeGreaterThan(0);
  });

  it("restates the grants exactly as 0143 did", () => {
    const grants = [
      `revoke all on function ${IMPORT_SIGNATURE} from public, anon;`,
      `grant execute on function ${IMPORT_SIGNATURE} to authenticated, service_role;`,
    ];
    for (const g of grants) {
      expect(sql).toContain(g);
      expect(strip(read("supabase/migrations/0143_statement_proof.sql"))).toContain(g);
    }
  });
});

describe("0149 acc_statement_overrides", () => {
  it("returns the agreed columns, in order", () => {
    const columns = overrides
      .slice(overrides.indexOf("returns table (") + 15, overrides.indexOf(")\nlanguage"))
      .split(",")
      .map((c) => c.trim().replace(/\s+/g, " "));
    expect(columns).toEqual([
      "batch_id uuid",
      "bank_account_id uuid",
      "filename text",
      "imported_at timestamptz",
      "overridden_by uuid",
      "override_reason text",
      "out_by_minor bigint",
      "statement_opening_minor bigint",
      "statement_closing_minor bigint",
      "first_line_date date",
      "last_line_date date",
      "settled_by_reconciliation_id uuid",
      "settled_through date",
    ]);
  });

  it("is a stable security definer with the search path pinned", () => {
    const header = overrides.slice(0, overrides.indexOf("$$"));
    expect(header).toMatch(/security definer/i);
    expect(header).toMatch(/\bstable\b/i);
    expect(header).toMatch(/set search_path = public/i);
  });

  it("lets staff or a viewer read and refuses anyone else", () => {
    expect(overrides).toMatch(/if not \(acc_is_staff\(\) or coalesce\(acc_current_role\(\) = 'viewer', false\)\) then\s+raise exception 'Not authorized to read statements imported out of balance';/i);
    expect(overrides.indexOf("acc_is_staff()")).toBeLessThan(overrides.indexOf("return query"));
  });

  it("returns active batches that carry an override, and only those", () => {
    expect(overrides).toMatch(/where b\.status = 'active'\s+and b\.overridden_by is not null/i);
  });

  it("takes the line dates from the batch's own lines", () => {
    expect(overrides).toMatch(/min\(t\.txn_date\) as first_date, max\(t\.txn_date\) as last_date/i);
    expect(overrides).toMatch(/from acc_bank_transaction t\s+where t\.import_batch_id = b\.id/i);
  });

  it("settles by the earliest completed reconciliation of the same account ending on or after the last line", () => {
    expect(overrides).toMatch(/r\.bank_account_id = b\.bank_account_id/i);
    expect(overrides).toMatch(/r\.status = 'completed'/i);
    expect(overrides).toMatch(/r\.statement_ending_date >= d\.last_date/i);
    expect(overrides).toMatch(/order by r\.statement_ending_date, r\.completed_at nulls last, r\.id\s+limit 1/i);
    expect(overrides).toMatch(/left join lateral/i);
  });

  it("orders by imported_at then batch id, so a caller can page", () => {
    expect(overrides).toMatch(/order by b\.imported_at, b\.id;/i);
  });

  it("is revoked from public and anon and granted to signed-in users and the service role", () => {
    expect(sql).toMatch(/revoke all on function acc_statement_overrides\(\) from public, anon;/i);
    expect(sql).toMatch(/grant execute on function acc_statement_overrides\(\) to authenticated, service_role;/i);
  });
});
