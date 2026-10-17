import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCompanySchema } from "@/lib/domain/schema-template";

const FILE = "0150_reconcile_integrity.sql";

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

function fn(sql: string, name: string): string {
  const start = sql.search(new RegExp(`create or replace function ${name}\\(`, "i"));
  return sql.slice(start, sql.indexOf("\n$$;", start) + 4);
}

function columns(body: string): string[] {
  return body
    .slice(body.indexOf("returns table (") + 15, body.indexOf(")\nlanguage"))
    .split(",")
    .map((c) => c.trim().replace(/\s+/g, " "));
}

const raw = read(`supabase/migrations/${FILE}`);
const sql = strip(raw);
const changes = fn(sql, "acc_reconciliation_changes");
const legs = fn(sql, "acc_transfer_legs");

describe("0150 reconcile integrity: shape", () => {
  it("starts with the schema search path and qualifies nothing with public.", () => {
    expect(sql).toMatch(/^\s*set search_path = public;/i);
    expect(sql).not.toMatch(/\bpublic\.\w/i);
  });

  it("creates exactly the two read functions, idempotently", () => {
    const created = [...sql.matchAll(/create (?:or replace )?function (\w+)\(/gi)].map((m) => m[1]);
    expect(created).toEqual(["acc_reconciliation_changes", "acc_transfer_legs"]);
    expect(sql).not.toMatch(/\bcreate function\b/i);
  });

  it("changes no existing function, table, type or policy", () => {
    const earlier = readdirSync(join(process.cwd(), "supabase/migrations"))
      .filter((f) => f < FILE && f.endsWith(".sql"))
      .map((f) => strip(read(`supabase/migrations/${f}`)))
      .join("\n");
    for (const name of ["acc_reconciliation_changes", "acc_transfer_legs"]) {
      expect(earlier).not.toMatch(new RegExp(`function ${name}\\(`, "i"));
    }
    expect(sql).not.toMatch(/create (table|type|index|unique index|trigger|policy)\b/i);
    expect(sql).not.toMatch(/\balter\b/i);
    expect(sql).not.toMatch(/\bdrop\b/i);
    expect(sql).not.toMatch(/\b(insert into|update|delete from)\b/i);
  });

  it("runs whole in every company schema, nothing skipped", () => {
    const plan = planCompanySchema([{ file: FILE, sql: raw }], "co_example");
    expect(plan.skipped).toEqual([]);
    const joined = plan.statements.join("\n");
    expect(joined).toMatch(/set search_path = co_example/);
    expect(joined).not.toMatch(/set search_path = public/);
    expect(joined).toMatch(/function acc_reconciliation_changes\(/i);
    expect(joined).toMatch(/function acc_transfer_legs\(/i);
    expect(joined).toMatch(/revoke all on function acc_transfer_legs\(\)/i);
  });
});

describe.each([
  ["acc_reconciliation_changes", changes, "Not authorized to read changes to reconciliations"],
  ["acc_transfer_legs", legs, "Not authorized to read transfers"],
])("0150 %s: access", (name, body, message) => {
  it("is a stable security definer with the search path pinned", () => {
    const header = body.slice(0, body.indexOf("$$"));
    expect(header).toMatch(/security definer/i);
    expect(header).toMatch(/\bstable\b/i);
    expect(header).toMatch(/set search_path = public/i);
  });

  it("lets staff or a viewer read and refuses anyone else, before reading anything", () => {
    expect(body).toContain(
      `if not (acc_is_staff() or coalesce(acc_current_role() = 'viewer', false)) then\n    raise exception '${message}';`,
    );
    expect(body.indexOf("acc_is_staff()")).toBeLessThan(body.indexOf("return query"));
  });

  it("is revoked from public and anon and granted to signed-in users and the service role", () => {
    expect(sql).toContain(`revoke all on function ${name}() from public, anon;`);
    expect(sql).toContain(`grant execute on function ${name}() to authenticated, service_role;`);
  });
});

describe("0150 acc_reconciliation_changes", () => {
  it("returns the agreed columns, in order", () => {
    expect(columns(changes)).toEqual([
      "change_key text",
      "reconciliation_id uuid",
      "bank_account_id uuid",
      "statement_ending_date date",
      "completed_at timestamptz",
      "kind text",
      "entry_id uuid",
      "entry_number text",
      "entry_date date",
      "signed_minor bigint",
      "reversal_entry_id uuid",
      "reversal_entry_number text",
      "difference_minor bigint",
    ]);
  });

  it("reads only completed reconciliations", () => {
    expect(changes).toMatch(/where r\.status = 'completed'/i);
  });

  it("names the four kinds", () => {
    for (const kind of ["voided", "reversed", "added", "drift"]) expect(changes).toContain(`'${kind}'`);
  });

  it("voided follows the 0026 rule: a ticked line of a void entry", () => {
    expect(changes).toMatch(/where t\.estatus = 'void'/i);
  });

  it("reversed joins the reversal link to a posted reversal of a posted original", () => {
    expect(changes).toMatch(/join acc_journal_reversal_link k on k\.original_entry_id = t\.eid/i);
    expect(changes).toMatch(/x\.id = k\.reversal_entry_id and x\.status = 'posted'/i);
    expect(changes).toMatch(/where t\.estatus = 'posted'/i);
  });

  it("added is a posted, unticked entry on the bank ledger account, inside the period, posted after sign-off", () => {
    expect(changes).toMatch(/l\.account_id = c\.gl_id/i);
    expect(changes).toMatch(/e\.status = 'posted'/i);
    expect(changes).toMatch(/e\.entry_date <= c\.ending/i);
    expect(changes).toMatch(/c\.prev_ending is null or e\.entry_date > c\.prev_ending/i);
    expect(changes).toMatch(/e\.posted_at > c\.done_at/i);
    expect(changes).toMatch(/not exists \(select 1 from acc_reconciliation_line rl where rl\.journal_line_id = l\.id\)/i);
    expect(changes).toMatch(/p\.statement_ending_date < r\.statement_ending_date/i);
  });

  it("drift mirrors sign-off: the saved ending against beginning plus the cleared total acc_complete_reconciliation uses", () => {
    expect(changes).toMatch(/c\.saved_ending <> c\.beginning \+ acc_recon_cleared_total\(c\.rid\)/i);
    expect(changes).toMatch(/c\.saved_ending - \(c\.beginning \+ acc_recon_cleared_total\(c\.rid\)\)/i);
    const complete = strip(read("supabase/migrations/0026_bank_reconciliation_functions.sql"));
    expect(complete).toMatch(/v_diff := v_rec\.statement_ending_balance_minor - \(v_rec\.beginning_balance_minor \+ v_cleared\)/i);
    expect(complete).toMatch(/v_cleared := acc_recon_cleared_total\(p_reconciliation_id\)/i);
    expect(strip(read("supabase/migrations/0027_recon_cleared_total_posted.sql"))).toMatch(/e\.status = 'posted'/i);
  });

  it("signs a bank line as the reconciliation does: a debit is money in", () => {
    expect(changes).toMatch(/case when l\.debit_minor > 0 then l\.amount_base_minor else -l\.amount_base_minor end/i);
  });

  it("orders by reconciliation, then a unique key, in the C collation", () => {
    expect(changes).toMatch(/order by u\.rid, \(u\.kind \|\| ':' \|\| u\.rid::text \|\| ':' \|\| coalesce\(u\.eid::text, ''\)\) collate "C";/i);
    expect(changes).toMatch(/select u\.kind \|\| ':' \|\| u\.rid::text \|\| ':' \|\| coalesce\(u\.eid::text, ''\),/i);
  });
});

describe("0150 acc_transfer_legs", () => {
  it("returns the agreed columns, in order", () => {
    expect(columns(legs)).toEqual([
      "row_key text",
      "row_kind text",
      "entry_id uuid",
      "entry_number text",
      "entry_date date",
      "bank_account_id uuid",
      "journal_line_id uuid",
      "signed_minor bigint",
      "ticked_reconciliation_id uuid",
      "ticked_statement_date date",
      "covered_through date",
      "reversed_by_entry_id uuid",
      "reversed_by_entry_number text",
      "reversal_of_entry_id uuid",
      "reversal_of_entry_number text",
      "candidate_source text",
      "candidate_id uuid",
      "candidate_bank_account_id uuid",
      "candidate_date date",
      "candidate_entry_id uuid",
      "candidate_entry_number text",
    ]);
  });

  it("takes posted entries with exactly two bank lines, one debit, on two bank accounts", () => {
    expect(legs).toMatch(/e\.status = 'posted'/i);
    expect(legs).toMatch(/s\.n = 2 and s\.debits = 1 and s\.banks = 2/i);
    expect(legs).toMatch(/join acc_bank_account ba on ba\.account_id = l\.account_id/i);
  });

  it("returns an entry with more than two bank lines as skipped", () => {
    expect(legs).toMatch(/'skipped:' \|\| e\.id::text, 'skipped'::text/i);
    expect(legs).toMatch(/where s\.n > 2/i);
  });

  it("reads the tick only from a completed reconciliation", () => {
    expect(legs).toMatch(/r\.id = rl\.reconciliation_id and r\.status = 'completed'/i);
  });

  it("carries the reversal link both ways, to a posted reversal", () => {
    expect(legs).toMatch(/k\.original_entry_id = b\.eid/i);
    expect(legs).toMatch(/k\.reversal_entry_id = b\.eid/i);
    expect(legs).toMatch(/x\.id = k\.reversal_entry_id and x\.status = 'posted'/i);
  });

  it("gives evidence only for an open leg: unticked, the other leg ticked, the account's statements reach the entry date", () => {
    const open = legs.slice(legs.search(/open_legs as \(/i), legs.search(/evidence as \(/i));
    expect(open).toMatch(/g\.tick_rid is null/i);
    expect(open).toMatch(/g\.through >= g\.edate/i);
    expect(open).toMatch(/o\.eid = g\.eid and o\.lid <> g\.lid and o\.tick_rid is not null/i);
  });

  it("finds evidence on other accounts only: held statement lines, then posted ledger lines, same signed amount within 7 days", () => {
    const evidence = legs.slice(legs.search(/evidence as \(/i), legs.search(/everything as \(/i));
    expect(evidence).toMatch(/s\.amount_minor = o\.signed and not s\.set_aside and abs\(s\.txn_date - o\.edate\) <= 7/i);
    expect(evidence).toMatch(/r\.status = 'completed' and r\.bank_account_id <> o\.bid/i);
    expect(evidence).toMatch(/b\.signed = o\.signed and b\.bid <> o\.bid and b\.eid <> o\.eid and abs\(b\.edate - o\.edate\) <= 7/i);
  });

  it("never reads the bank transactions, whose backfilled lines would only echo the ledger", () => {
    expect(legs).not.toMatch(/acc_bank_transaction/i);
  });

  it("orders by kind, entry date, then a unique row key, in the C collation", () => {
    expect(legs).toMatch(/order by x\.rk collate "C", x\.edate, x\.k collate "C";/i);
    expect(legs).toContain("'leg:' || g.lid::text");
    expect(legs).toContain("'candidate:' || o.lid::text || ':' || v.src || ':' || v.cid::text");
    expect(legs).toContain("'skipped:' || e.id::text");
  });
});
