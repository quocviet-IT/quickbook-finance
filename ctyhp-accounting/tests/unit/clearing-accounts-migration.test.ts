import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

const FILE = "0145_clearing_accounts.sql";

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
const standing = functionText(sql, "acc_clearing_standing");

describe("0145 clearing accounts: shape", () => {
  it("starts with the schema search path and qualifies nothing with public.", () => {
    expect(sql).toMatch(/^\s*set search_path = public;/i);
    expect(sql).not.toMatch(/\bpublic\.\w/i);
  });

  it("defines the one function, and creates no table, type, index, trigger or policy", () => {
    const created = [...sql.matchAll(/create or replace function (\w+)\(/gi)].map((m) => m[1]);
    expect(created).toEqual(["acc_clearing_standing"]);
    expect(sql).not.toMatch(/\bcreate function\b/i);
    expect(sql).not.toMatch(/create (table|type|index|unique index|trigger|policy)\b/i);
    expect(sql).not.toMatch(/\bdrop (table|column|function|policy|index|trigger)\b/i);
  });

  it("writes nothing beyond the backfill", () => {
    expect(sql).not.toMatch(/\b(insert into|delete from)\b/i);
    expect([...sql.matchAll(/\bupdate\s+(\w+)\s+set\b/gi)].map((m) => m[1])).toEqual(["acc_account"]);
    expect(sql).not.toMatch(/acc_post_entry|acc_post_manual_journal/i);
  });

  it("runs whole in every company schema", () => {
    const plan = planCompanySchema([{ file: FILE, sql: raw }], "co_example");
    expect(plan.skipped).toEqual([]);
    const joined = plan.statements.join("\n");
    expect(joined).toMatch(/set search_path = co_example/);
    expect(joined).not.toMatch(/set search_path = public/);
    expect(joined).toMatch(/alter table acc_account add column if not exists is_clearing/i);
  });
});

describe("0145 the tick", () => {
  it("adds is_clearing as a not null boolean defaulting to false, only if absent", () => {
    expect(sql).toMatch(/alter table acc_account add column if not exists is_clearing boolean not null default false;/i);
  });

  it("backfills the accounts already treated as clearing, current assets only", () => {
    const update = sql.slice(sql.search(/update acc_account/i), sql.indexOf(";", sql.search(/update acc_account/i)));
    expect(update).toMatch(/set is_clearing = true/i);
    expect(update).toMatch(/account_type = 'current_asset'/i);
    expect(update).toMatch(/detail_type in \('undeposited_funds', 'transfer_clearing'\)/i);
    expect(update).toMatch(/name ilike '%undeposited%'/i);
  });

  it("runs the backfill before the type rule, so no existing row can break it", () => {
    expect(sql.search(/update acc_account/i)).toBeLessThan(sql.search(/add constraint acc_account_clearing_type_ck/i));
  });

  it("refuses the tick on any type but current asset and current liability, and can be run again", () => {
    expect(sql).toMatch(/drop constraint if exists acc_account_clearing_type_ck;/i);
    expect(sql).toMatch(
      /add constraint acc_account_clearing_type_ck\s+check \(not is_clearing or account_type in \('current_asset', 'current_liability'\)\);/i,
    );
  });
});

describe("0145 acc_clearing_standing", () => {
  it("returns the documented columns, in order", () => {
    const columns = [
      "account_id uuid",
      "balance_minor bigint",
      "last_movement_date date",
      "open_count integer",
      "open_oldest_date date",
      "open_minor bigint",
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
    expect(read("supabase/migrations/0144_bank_standing.sql")).toContain(
      "if not (acc_is_staff() or coalesce(acc_current_role() = 'viewer', false)) then",
    );
  });

  it("is revoked from public and anon and granted to signed-in users and the service role", () => {
    expect(sql).toMatch(/revoke all on function acc_clearing_standing\(date\) from public, anon;/i);
    expect(sql).toMatch(/grant execute on function acc_clearing_standing\(date\) to authenticated, service_role;/i);
  });

  it("reads only ticked accounts and only posted lines dated on or before the date", () => {
    expect(standing).toMatch(/from acc_account a\s+where a\.is_clearing/i);
    expect(standing).toMatch(/e\.status = 'posted' and e\.entry_date <= p_as_of/i);
  });

  it("signs a line as the pairing does: a debit is positive", () => {
    expect(standing).toContain("case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end");
  });

  it("clears the oldest first by date, then entry, then line, with a running total (no loop)", () => {
    expect(standing).toMatch(/order by p\.dated, p\.entry_no, p\.line_no, p\.line_id/i);
    expect(standing).toMatch(/rows between unbounded preceding and current row/i);
    expect(standing).not.toMatch(/\b(loop|foreach|for\s+\w+\s+in)\b/i);
  });

  it("takes items from the side the balance stands on, and clears them with the other side", () => {
    expect(standing).toMatch(/sign\(p\.signed_minor\) = sign\(s\.bal\)/i);
    expect(standing).toMatch(/i\.running_minor > case when s\.bal > 0 then s\.credits else s\.debits end/i);
  });

  it("gives a zero balance no open items, and open_minor the absolute balance", () => {
    expect(standing).toMatch(/s\.bal <> 0/i);
    expect(standing).toMatch(/abs\(coalesce\(s\.bal, 0\)\)::bigint/i);
  });

  it("gives one row per ticked account, in a stable order, with integer counts", () => {
    expect(standing).toMatch(/from ticked t\s+left join totals s[\s\S]*?left join open_items o/i);
    expect(standing).toMatch(/order by t\.code, t\.acct;/i);
    expect(standing).toMatch(/count\(\*\)::integer/i);
  });
});
