import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Comments stripped as tests/unit/migration-grants.test.ts strips them (CRLF-safe). */
function body(): string {
  const raw = readFileSync(join(process.cwd(), "supabase/migrations/0125_chart_of_accounts_structure.sql"), "utf8");
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

describe("0125 chart of accounts structure", () => {
  const sql = body();

  it("adds the non-current liability type after current liabilities, and never uses it in the same file", () => {
    expect(sql).toMatch(/alter type acc_account_type add value if not exists 'long_term_liability' after 'current_liability'/i);
    expect(sql.match(/long_term_liability/g)?.length).toBe(1);
  });

  it("adds an explicit contra flag, backfilled only for the system contra accounts", () => {
    expect(sql).toMatch(/add column if not exists is_contra boolean not null default false/i);
    expect(sql).toMatch(/detail_type ~\* '\^\\s\*contra\\M'/i);
    expect(sql).toMatch(/account_code = '1190' and name ilike 'allowance%'/i);
  });

  it("changes no code, name, type or parent of an existing account", () => {
    const updates = [...sql.matchAll(/update\s+acc_account\s+set\s+([\s\S]*?)\bwhere\b/gi)].map((m) => m[1]);
    expect(updates.length).toBe(2);
    for (const set of updates) {
      expect(set).not.toMatch(/\b(account_code|name|account_type|parent_account_id)\s*=/i);
    }
  });

  it("checks a sub-account's type only when a parent or a type is written", () => {
    expect(sql).toMatch(/before insert or update of parent_account_id, account_type on acc_account/i);
    expect(sql).toMatch(/A sub-account must have the same type as its parent/);
  });

  it("lets a company request name its chart, replacing the four-argument function", () => {
    expect(sql).toMatch(/add column if not exists chart_template text not null default 'standard'/i);
    expect(sql).toMatch(/check \(chart_template in \('standard', 'retail_jewelry'\)\)/i);
    expect(sql).toMatch(/drop function if exists onebook\.request_company\(text, text, boolean, int\)/i);
    expect(sql).toMatch(/p_chart_template text default 'standard'/i);
    expect(sql).toMatch(/revoke all on function onebook\.request_company\(text, text, boolean, int, text\) from public, anon/i);
    expect(sql).toMatch(/grant execute on function onebook\.request_company\(text, text, boolean, int, text\)\s+to authenticated, service_role/i);
  });
});
