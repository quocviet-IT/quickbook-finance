import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

const FILE = "0144_bank_standing.sql";

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

/** The text of one `create or replace function <name>(` statement, up to its closing `$$;`. */
function functionText(sql: string, name: string): string {
  const start = sql.search(new RegExp(`create or replace function ${name}\\(`, "i"));
  expect(start, `${name} is defined`).toBeGreaterThanOrEqual(0);
  const end = sql.indexOf("$$;", sql.indexOf("$$", start) + 2);
  return sql.slice(start, end + 3);
}

const raw = read(`supabase/migrations/${FILE}`);
const sql = strip(raw);
const standing = functionText(sql, "acc_bank_standing");
const unreconciled = functionText(sql, "acc_unreconciled_bank");
const original = functionText(strip(read("supabase/migrations/0030_cashflow_dashboard.sql")), "acc_unreconciled_bank");

describe("0144 bank standing: shape", () => {
  it("defines the new function and redefines acc_unreconciled_bank, and nothing else", () => {
    const created = [...sql.matchAll(/create or replace function (\w+)\(/gi)].map((m) => m[1]);
    expect(created.sort()).toEqual(["acc_bank_standing", "acc_unreconciled_bank"]);
  });

  it("starts with the schema search path, qualifies nothing with public., and is additive", () => {
    expect(sql).toMatch(/^\s*set search_path = public;/i);
    expect(sql).not.toMatch(/\bpublic\.\w/i);
    expect(sql).not.toMatch(/create (table|type|index|unique index|trigger|policy)\b/i);
    expect(sql).not.toMatch(/\bcreate function\b/i);
    expect(sql).not.toMatch(/\bdrop (table|column|function|policy|index|trigger)\b/i);
    expect(sql).not.toMatch(/\balter table\b/i);
  });

  it("runs whole in every company schema", () => {
    const plan = planCompanySchema([{ file: FILE, sql: raw }], "co_example");
    expect(plan.skipped).toEqual([]);
    const joined = plan.statements.join("\n");
    expect(joined).toMatch(/set search_path = co_example/);
    expect(joined).not.toMatch(/set search_path = public/);
  });

  it("writes nothing", () => {
    expect(sql).not.toMatch(/\b(insert into|delete from)\b/i);
    expect(sql).not.toMatch(/\bupdate\s+\w+\s+set\b/i);
    expect(sql).not.toMatch(/acc_post_entry|acc_post_manual_journal/i);
  });
});

describe("0144 acc_bank_standing", () => {
  it("returns the documented columns, in order", () => {
    const columns = [
      "bank_account_id uuid",
      "last_completed_id uuid",
      "last_completed_date date",
      "last_closing_minor bigint",
      "last_brought_forward boolean",
      "since_count integer",
      "since_net_minor bigint",
      "earlier_open_count integer",
      "earlier_open_net_minor bigint",
      "void_ticked_count integer",
      "void_ticked_minor bigint",
      "void_reconciliation_date date",
      "book_minor bigint",
    ];
    const header = standing.slice(0, standing.indexOf("language"));
    const found = [...header.matchAll(/^\s+(\w+ \w+),?$/gm)].map((m) => m[1]);
    expect(found).toEqual(columns);
  });

  it("is a stable security definer with the search path pinned", () => {
    const header = standing.slice(0, standing.indexOf("$$"));
    expect(header).toMatch(/\bstable\b/i);
    expect(header).toMatch(/security definer/i);
    expect(header).toMatch(/set search_path = public/i);
  });

  it("lets staff or a viewer read and refuses anyone else, a missing role included", () => {
    expect(standing).toMatch(
      /if not \(acc_is_staff\(\) or coalesce\(acc_current_role\(\) = 'viewer', false\)\) then\s+raise exception 'Not authorized/i,
    );
  });

  it("is revoked from public and anon and granted to signed-in users and the service role", () => {
    expect(sql).toMatch(/revoke all on function acc_bank_standing\(date\) from public, anon;/i);
    expect(sql).toMatch(/grant execute on function acc_bank_standing\(date\) to authenticated, service_role;/i);
  });

  it("starts from acc_bank_account, so Cash on Hand never appears (0072)", () => {
    expect(standing).toMatch(/from acc_bank_account b\s/i);
    expect(standing).not.toMatch(/account_type = 'bank'/i);
    expect(read("supabase/migrations/0072_bank_account_detail_types.sql")).toMatch(/cash_on_hand/);
  });

  it("holds a line as 0133 and 0142 do: a COMPLETED reconciliation ticks it", () => {
    expect(standing).toMatch(/r\.status = 'completed'/i);
    expect(standing).toMatch(/rl\.journal_line_id = l\.id/i);
    expect(read("supabase/migrations/0133_bank_open_lines.sql")).toMatch(/r\.status = 'completed'/i);
  });

  it("counts only posted lines, dated on or before the date", () => {
    expect(standing).toMatch(/e\.status = 'posted' and e\.entry_date <= p_as_of/i);
  });

  it("signs a line as the pairing does: a debit to the bank is money in", () => {
    expect(standing).toContain("case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end");
    expect(read("supabase/migrations/0142_reconciliation_history.sql")).toContain(
      "case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end",
    );
  });

  it("reads the closing from the statement ending balance, and the brought-forward mark from the session", () => {
    expect(standing).toMatch(/r\.statement_ending_balance_minor as closing_minor/i);
    expect(standing).toMatch(/r\.brought_forward as carried/i);
  });

  it("takes the latest completed reconciliation that ends by the date", () => {
    expect(standing).toMatch(/distinct on \(r\.bank_account_id\)/i);
    expect(standing).toMatch(/r\.status = 'completed' and r\.statement_ending_date <= p_as_of/i);
    expect(standing).toMatch(/order by r\.bank_account_id, r\.statement_ending_date desc, r\.created_at desc, r\.id desc/i);
  });

  it("follows the 0026 discrepancy rule, for all accounts at once", () => {
    expect(read("supabase/migrations/0026_bank_reconciliation_functions.sql")).toMatch(
      /r\.status = 'completed' and e\.status = 'void'/i,
    );
    expect(standing).toMatch(/r\.status = 'completed' and r\.statement_ending_date <= p_as_of and e\.status = 'void'/i);
    expect(standing).toMatch(/max\(r\.statement_ending_date\) as latest_on/i);
  });

  it("reads the bank ledger lines once", () => {
    expect(standing.match(/join acc_journal_line l on l\.account_id = k\.gl_id/gi)).toHaveLength(1);
  });

  it("gives one row per bank account, in a stable order", () => {
    expect(standing).toMatch(/from banks k\s+left join last_done d[\s\S]*?left join standing s[\s\S]*?left join voided v/i);
    expect(standing).toMatch(/order by k\.made_at, k\.bank_id;/i);
  });
});

describe("0144 acc_unreconciled_bank", () => {
  it("keeps 0030's signature, return shape and invoker security", () => {
    const head = (t: string) => t.slice(0, t.indexOf("$$")).replace(/\s+/g, " ");
    expect(head(unreconciled)).toBe(head(original));
    expect(head(unreconciled)).not.toMatch(/security definer/i);
  });

  it("differs from 0030 only by leaving out Cash on Hand", () => {
    const without = unreconciled.replace(/\s+and a\.detail_type is distinct from 'cash_on_hand'/i, "");
    expect(without.replace(/\s+/g, " ")).toBe(original.replace(/\s+/g, " "));
    expect(unreconciled).toMatch(/and a\.detail_type is distinct from 'cash_on_hand'/i);
  });

  it("does not touch its grants", () => {
    expect(sql).not.toMatch(/(grant|revoke)[^;]*acc_unreconciled_bank/i);
  });
});
