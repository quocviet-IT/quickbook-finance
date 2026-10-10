import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function read(file: string): string {
  return readFileSync(join(process.cwd(), "supabase/migrations", file), "utf8").replace(/\r/g, "");
}

/** Block and line comments removed, \r already gone. */
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

const sql139 = strip(read("0139_stock_count.sql"));

describe("0138 the stock_count journal source", () => {
  const sql = strip(read("0138_stock_count_source.sql"));
  it("holds only the enum value", () => {
    const statements = sql.split(";").map((s) => s.trim()).filter(Boolean);
    expect(statements).toEqual(["alter type acc_journal_source add value if not exists 'stock_count'"]);
  });
});

describe("0139 stock count tables", () => {
  it("creates both tables with the spec's columns and checks", () => {
    expect(sql139).toMatch(/create table if not exists acc_stock_count \(/i);
    expect(sql139).toMatch(/create table if not exists acc_stock_count_line \(/i);
    expect(sql139).toMatch(/check \(status in \('draft', 'pending_approval', 'posted'\)\)/i);
    expect(sql139).toMatch(/quantity\s+numeric\(20,4\) not null default 0 check \(quantity >= 0\)/i);
    expect(sql139).toMatch(/unit_cost_minor bigint not null default 0 check \(unit_cost_minor >= 0\)/i);
    expect(sql139).toMatch(/sells_for_minor bigint check \(sells_for_minor is null or sells_for_minor >= 0\)/i);
    expect(sql139).toMatch(/length\(btrim\(name\)\) between 1 and 200/i);
    expect(sql139).toMatch(/stock_count_id\s+uuid not null references acc_stock_count \(id\) on delete cascade/i);
    expect(sql139).toMatch(/counted_minor\s+bigint/i);
    expect(sql139).toMatch(/journal_entry_id\s+uuid references acc_journal_entry \(id\)/i);
    expect(sql139).toMatch(/approval_request_id\s+uuid references acc_approval_request \(id\)/i);
  });

  it("enables row level security with a read policy and no write policy", () => {
    expect(sql139).toMatch(/alter table acc_stock_count enable row level security/i);
    expect(sql139).toMatch(/alter table acc_stock_count_line enable row level security/i);
    expect(sql139).toMatch(/create policy acc_stock_count_read on acc_stock_count\s+for select using \(acc_current_role\(\) is not null\)/i);
    expect(sql139).toMatch(/create policy acc_stock_count_line_read on acc_stock_count_line\s+for select using \(acc_current_role\(\) is not null\)/i);
    expect(sql139).not.toMatch(/create policy[^;]*\bfor (insert|update|delete|all)\b/i);
  });

  it("grants read to signed-in users, everything to the service role, nothing to anon", () => {
    for (const table of ["acc_stock_count", "acc_stock_count_line"]) {
      expect(sql139).toMatch(new RegExp(`revoke all on ${table} from public, anon`, "i"));
      expect(sql139).toMatch(new RegExp(`grant select on ${table} to authenticated`, "i"));
      expect(sql139).toMatch(new RegExp(`grant all on ${table} to service_role`, "i"));
      expect(sql139).not.toMatch(new RegExp(`grant (insert|update|delete)[^;]*on ${table} to`, "i"));
      expect(sql139).toMatch(new RegExp(`revoke insert, update, delete, truncate on ${table} from authenticated`, "i"));
      // the revoke comes after the grants-from-defaults are taken back and before the select grant
      expect(sql139.indexOf(`revoke insert, update, delete, truncate on ${table} from authenticated`))
        .toBeGreaterThan(sql139.indexOf(`revoke all on ${table} from public, anon`));
    }
  });

  it("stamps actors, audits the header and seeds the SC- sequence", () => {
    expect(sql139).toMatch(/before insert or update on acc_stock_count\s+for each row execute function acc_stamp_actor\(\)/i);
    expect(sql139).toMatch(/after insert or update or delete on acc_stock_count\s+for each row execute function acc_audit_row_change\(\)/i);
    expect(sql139).toMatch(/insert into acc_sequence \(key, prefix, next_value\)\s+values \('stock_count', 'SC-', 1\)\s+on conflict \(key\) do nothing/i);
  });
});

describe("0139 stock count functions", () => {
  const NAMES = [
    "acc_inventory_account_ids",
    "acc_stock_count_default_accounts",
    "acc_create_stock_count",
    "acc_save_stock_count",
    "acc_post_stock_count",
    "acc_mark_stock_count_pending",
    "acc_stock_count_request_closed",
    "acc_approve_request",
  ];

  it.each(NAMES)("%s is security definer with a fixed search_path", (name) => {
    const text = functionText(sql139, name);
    const header = text.slice(0, text.indexOf("$$"));
    expect(header).toMatch(/security definer/i);
    expect(header).toMatch(/set search_path = public/i);
  });

  it("every function the migration creates is on that list", () => {
    const created = [...sql139.matchAll(/create or replace function (\w+)\(/gi)].map((m) => m[1]);
    expect(created.sort()).toEqual([...NAMES].sort());
  });

  it("grants execute on the callable functions and withholds the trigger function", () => {
    for (const sig of [
      "acc_inventory_account_ids\\(\\)",
      "acc_stock_count_default_accounts\\(\\)",
      "acc_create_stock_count\\(date\\)",
      "acc_save_stock_count\\(uuid, date, text, jsonb\\)",
      "acc_post_stock_count\\(uuid, uuid, uuid\\)",
      "acc_mark_stock_count_pending\\(uuid, uuid\\)",
    ]) {
      expect(sql139).toMatch(new RegExp(`revoke all on function ${sig} from public, anon`, "i"));
      expect(sql139).toMatch(new RegExp(`grant execute on function ${sig} to authenticated, service_role`, "i"));
    }
    expect(sql139).toMatch(/revoke all on function acc_stock_count_request_closed\(\) from public, anon, authenticated/i);
  });

  it("the inventory-account rule mirrors pickInventoryAccounts", () => {
    const text = functionText(sql139, "acc_inventory_account_ids");
    expect(text).toMatch(/i\.is_inventory and i\.inventory_account_id is not null/i);
    expect(text).toMatch(/a\.cash_flow_role = 'operating_inventory'/i);
    expect(text).toMatch(/a\.account_type = 'current_asset' and a\.name ~\* 'inventory\|stock'/i);
    expect(text).toMatch(/where not exists \(select 1 from by_item_or_role\)/i);
  });

  it("the default accounts follow the spec's order", () => {
    const text = functionText(sql139, "acc_stock_count_default_accounts");
    const adjust = text.indexOf("inventory\\s*adjust");
    const writedown = text.indexOf("acc_active_inventory_writedown_account()");
    const lowest = text.lastIndexOf("a.account_type = 'cost_of_goods_sold'");
    expect(adjust).toBeGreaterThan(0);
    expect(writedown).toBeGreaterThan(adjust);
    expect(lowest).toBeGreaterThan(writedown);
    expect(text).toMatch(/order by a\.account_code, a\.id/i);
  });

  it("create and save are staff-only, and save is a draft-only, all-or-nothing replace", () => {
    expect(functionText(sql139, "acc_create_stock_count")).toMatch(/if not acc_is_staff\(\)/i);
    const save = functionText(sql139, "acc_save_stock_count");
    expect(save).toMatch(/if not acc_is_staff\(\)/i);
    expect(save).toMatch(/v_count\.status <> 'draft'/i);
    expect(save).toMatch(/2000/);
    expect(save).toMatch(/a name is required/i);
    expect(save).toMatch(/the quantity cannot be negative/i);
    expect(save).toMatch(/the cost each cannot be negative/i);
    expect(save).toMatch(/sells for cannot be negative/i);
    expect(save.indexOf("delete from acc_stock_count_line")).toBeGreaterThan(save.lastIndexOf("end loop"));
  });

  it("the post RPC runs its guards in the spec's order", () => {
    const post = functionText(sql139, "acc_post_stock_count");
    const order = [
      "acc_is_staff()",
      "acc_has_permission('inventory.adjust')",
      "waiting for approval",
      "tracks stock item by item; adjust items on the Products & Services page",
      "not in (select acc_inventory_account_ids())",
      "active cost of sales account",
      "round(l.quantity * l.unit_cost_minor)",
      "e.entry_date <= v_count.as_of",
      "The count already agrees with the books.",
      "acc_approval_required('inventory_adjustment', v_amount)",
      "acc_assert_postable(v_lines)",
      "acc_post_entry(v_count.as_of, v_desc, 'stock_count', p_id",
      "insert into acc_adjusting_entry",
      "set status = 'posted'",
      "values ('acc_journal_entry', v_entry, 'post'",
    ];
    let last = -1;
    for (const needle of order) {
      const at = post.indexOf(needle);
      expect(at, needle).toBeGreaterThan(last);
      last = at;
    }
  });

  it("the book value is in base currency, signed by side as acc_ledger_balances does", () => {
    const post = functionText(sql139, "acc_post_stock_count");
    expect(post).toMatch(/sum\(case when jl\.debit_minor > 0 then jl\.amount_base_minor else 0 end\)/i);
    expect(post).toMatch(/sum\(case when jl\.credit_minor > 0 then jl\.amount_base_minor else 0 end\)/i);
    expect(post).not.toMatch(/jl\.debit_minor - jl\.credit_minor/i);
    expect(post).toMatch(/e\.status = 'posted'/i);
    // the same rule as the report function it mirrors
    const ledger = strip(read("0009_reporting.sql"));
    expect(ledger).toMatch(/sum\(case when l\.debit_minor\s+> 0 then l\.amount_base_minor else 0 end\)/i);
    expect(ledger).toMatch(/sum\(case when l\.credit_minor > 0 then l\.amount_base_minor else 0 end\)/i);
    // no other sum over ledger lines in the migration works in transaction currency
    expect(sql139).not.toMatch(/sum\([^)]*(debit_minor|credit_minor)\s*-/i);
  });

  it("the approval guard reads the way isApprovalRequiredError expects", () => {
    const post = functionText(sql139, "acc_post_stock_count");
    expect(post).toMatch(/and not acc_in_approval_dispatch\(\) then\s+raise exception 'A stock count of this size requires approval; submit it for approval instead'/i);
    const message = "A stock count of this size requires approval; submit it for approval instead";
    expect(/requires approval;\s*submit it for approval instead/i.test(message)).toBe(true);
  });

  it("refuses to post for a company that tracks items, using active inventory items", () => {
    expect(functionText(sql139, "acc_post_stock_count")).toMatch(/exists \(select 1 from acc_item where is_inventory and is_active\)/i);
  });

  it("a request that is rejected or cancelled returns its count to draft", () => {
    const text = functionText(sql139, "acc_stock_count_request_closed");
    expect(text).toMatch(/new\.status in \('rejected', 'cancelled'\)/i);
    expect(text).toMatch(/set status = 'draft', approval_request_id = null/i);
    expect(sql139).toMatch(/create trigger acc_approval_request_stock_count\s+after update on acc_approval_request/i);
  });

  it("marking a count pending checks the request belongs to it", () => {
    const text = functionText(sql139, "acc_mark_stock_count_pending");
    expect(text).toMatch(/if not acc_is_staff\(\)/i);
    expect(text).toMatch(/Stock count not found/);
    expect(text).toMatch(/v_count\.status <> 'draft'/i);
    expect(text).toMatch(/not found\s+or v_req\.action_key <> 'inventory_adjustment'\s+or v_req\.status <> 'pending'/i);
    // every refusal comes before the one update
    expect(text.indexOf("update acc_stock_count")).toBeGreaterThan(text.indexOf("not a pending request for this stock count"));
    expect(text.match(/update acc_stock_count/gi)).toHaveLength(1);
    expect(text).toMatch(/v_req\.action_key <> 'inventory_adjustment'/i);
    expect(text).toMatch(/v_req\.payload ->> 'stock_count_id' is distinct from p_id::text/i);
    expect(text).toMatch(/set status = 'pending_approval', approval_request_id = p_request_id/i);
  });
});

describe("0139 acc_approve_request is 0039's, plus one branch", () => {
  const old = functionText(strip(read("0039_vendor_tax_functions.sql")), "acc_approve_request");
  const next = functionText(sql139, "acc_approve_request");
  const NEW_BRANCH = `  elsif v_req.action_key = 'inventory_adjustment' and v_p ->> 'stock_count_id' is not null then
    v_result := acc_post_stock_count(
      (v_p ->> 'stock_count_id')::uuid, (v_p ->> 'inventory_account_id')::uuid,
      (v_p ->> 'offset_account_id')::uuid);
`;

  it("keeps every dispatch branch of 0039", () => {
    const branches = [...old.matchAll(/v_req\.action_key = '(\w+)'/g)].map((m) => m[1]);
    expect(branches).toEqual([
      "manual_journal",
      "write_off",
      "inventory_adjustment",
      "period_reopen",
      "reconciliation_reopen",
      "vendor_tax_profile",
    ]);
    for (const key of branches) expect(next).toContain(`v_req.action_key = '${key}'`);
    expect(next).toMatch(/raise exception 'No dispatch defined for %'/);
  });

  it("is identical to 0039 once the new branch is taken out", () => {
    expect(next).toContain(NEW_BRANCH);
    expect(next.replace(NEW_BRANCH, "")).toBe(old);
  });

  it("tests for the count before the item branch", () => {
    expect(next.indexOf("v_p ->> 'stock_count_id' is not null")).toBeLessThan(next.indexOf("acc_adjust_inventory("));
  });
});
