import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHART_TEMPLATES } from "@/lib/domain/chart-templates";

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

const sql154 = strip(read("0154_cash_count.sql"));

describe("0152 the cash_count journal source", () => {
  it("holds only the enum value", () => {
    const statements = strip(read("0152_cash_count_source.sql")).split(";").map((s) => s.trim()).filter(Boolean);
    expect(statements).toEqual(["alter type acc_journal_source add value if not exists 'cash_count'"]);
  });

  it("is the only migration that adds it, and nothing else in 0153 or 0154 alters the type", () => {
    expect(sql154).not.toMatch(/alter type/i);
    expect(strip(read("0153_cash_over_and_short.sql"))).not.toMatch(/alter type/i);
  });
});

describe("0153 account 7510 Cash Over and Short", () => {
  const sql = strip(read("0153_cash_over_and_short.sql"));

  it("is one insert, and only where the code is free", () => {
    const statements = sql.split(";").map((s) => s.trim()).filter(Boolean);
    expect(statements).toHaveLength(2); // set search_path, then the insert
    expect(statements[0]).toBe("set search_path = public");
    expect(statements[1]).toMatch(/^insert into acc_account/i);
    expect(statements[1]).toMatch(/on conflict \(account_code\) do nothing$/i);
    expect(sql).not.toMatch(/\b(update|delete)\b/i);
  });

  it("inserts the account the template carries: same code, name, type and cash-flow role", () => {
    expect(sql).toMatch(/select '7510', 'Cash Over and Short', 'other_expense', code, true, 'active', 'operating'\s+from acc_currency where is_base/i);
    const t = CHART_TEMPLATES.retail_jewelry.accounts.find((a) => a.code === "7510");
    expect(t).toMatchObject({ name: "Cash Over and Short", type: "other_expense", system: true, cashFlowRole: "operating" });
  });
});

describe("0154 the cash count table", () => {
  it("has the spec's columns and checks", () => {
    expect(sql154).toMatch(/create table if not exists acc_cash_count \(/i);
    expect(sql154).toMatch(/account_id\s+uuid not null references acc_account \(id\)/i);
    expect(sql154).toMatch(/counted_on\s+date not null/i);
    expect(sql154).toMatch(/counted_minor\s+bigint not null check \(counted_minor >= 0\)/i);
    expect(sql154).toMatch(/book_minor\s+bigint not null/i);
    expect(sql154).toMatch(/difference_minor\s+bigint not null/i);
    expect(sql154).toMatch(/offset_account_id\s+uuid not null references acc_account \(id\)/i);
    expect(sql154).toMatch(/memo\s+text check \(memo is null or length\(memo\) <= 500\)/i);
    expect(sql154).toMatch(/check \(status in \('posted', 'pending_approval', 'rejected'\)\)/i);
    expect(sql154).toMatch(/journal_entry_id\s+uuid references acc_journal_entry \(id\)/i);
    expect(sql154).toMatch(/approval_request_id\s+uuid references acc_approval_request \(id\)/i);
    expect(sql154).toMatch(/created_by\s+uuid references auth\.users \(id\)/i);
    expect(sql154).toMatch(/check \(difference_minor = counted_minor - book_minor\)/i);
    expect(sql154).toMatch(/check \(status <> 'posted' or \(\(difference_minor = 0\) = \(journal_entry_id is null\)\)\)/i);
  });

  it("enables row level security with a staff-and-viewer read policy and no write policy", () => {
    expect(sql154).toMatch(/alter table acc_cash_count enable row level security/i);
    expect(sql154).toMatch(
      /create policy acc_cash_count_read on acc_cash_count\s+for select using \(acc_is_staff\(\) or coalesce\(acc_current_role\(\) = 'viewer', false\)\)/i,
    );
    expect(sql154).not.toMatch(/create policy[^;]*\bfor (insert|update|delete|all)\b/i);
  });

  it("grants read to signed-in users, everything to the service role, nothing to anon", () => {
    expect(sql154).toMatch(/revoke all on acc_cash_count from public, anon/i);
    expect(sql154).toMatch(/revoke insert, update, delete, truncate on acc_cash_count from authenticated/i);
    expect(sql154).toMatch(/grant select on acc_cash_count to authenticated/i);
    expect(sql154).toMatch(/grant all on acc_cash_count to service_role/i);
    expect(sql154).not.toMatch(/grant (insert|update|delete)[^;]*on acc_cash_count to/i);
    // the revoke of the default write rights comes after the revoke from public and before the select grant
    const revokeAll = sql154.indexOf("revoke all on acc_cash_count from public, anon");
    const revokeWrite = sql154.indexOf("revoke insert, update, delete, truncate on acc_cash_count from authenticated");
    expect(revokeWrite).toBeGreaterThan(revokeAll);
    expect(sql154.indexOf("grant select on acc_cash_count to authenticated")).toBeGreaterThan(revokeWrite);
  });

  it("stamps actors and audits every write, as 0139 does", () => {
    expect(sql154).toMatch(/before insert or update on acc_cash_count\s+for each row execute function acc_stamp_actor\(\)/i);
    expect(sql154).toMatch(/after insert or update or delete on acc_cash_count\s+for each row execute function acc_audit_row_change\(\)/i);
  });

  it("adds the cash_count approval policy, disabled, with the default threshold stock count uses", () => {
    expect(sql154).toMatch(
      /insert into acc_approval_policy \(action_key, label, description\)\s+values \('cash_count', 'Cash count', '[^']+'\)\s+on conflict \(action_key\) do nothing/i,
    );
    // the columns that make it off are left to their defaults (0036): enabled false, threshold 0
    const policy036 = strip(read("0036_access_control.sql"));
    expect(policy036).toMatch(/enabled\s+boolean not null default false/i);
    expect(policy036).toMatch(/threshold_minor\s+bigint not null default 0/i);
    // the stock count policy row is inserted the same way, with no threshold of its own
    expect(policy036).toMatch(/\('inventory_adjustment',\s+'Inventory adjustment',\s+'[^']+'\)/);
    expect(sql154).not.toMatch(/threshold_minor\s*=|enabled\s*=\s*true/i);
  });
});

describe("0154 the functions", () => {
  const NAMES = [
    "acc_cash_book_minor",
    "acc_cash_count_post_entry",
    "acc_post_cash_count",
    "acc_post_pending_cash_count",
    "acc_cash_count_request_closed",
    "acc_cash_accounts_standing",
    "acc_approve_request",
  ];

  it.each(NAMES)("%s is security definer with a fixed search_path", (name) => {
    const text = functionText(sql154, name);
    const header = text.slice(0, text.indexOf("$$"));
    expect(header).toMatch(/security definer/i);
    expect(header).toMatch(/set search_path = public/i);
  });

  it("every function the migration creates is on that list", () => {
    const created = [...sql154.matchAll(/create or replace function (\w+)\(/gi)].map((m) => m[1]);
    expect(created.sort()).toEqual([...NAMES].sort());
  });

  it("grants execute on the callable functions and withholds the internal ones", () => {
    for (const sig of [
      "acc_cash_book_minor\\(uuid, date\\)",
      "acc_post_cash_count\\(uuid, date, bigint, uuid, text\\)",
      "acc_cash_accounts_standing\\(date\\)",
    ]) {
      expect(sql154).toMatch(new RegExp(`revoke all on function ${sig} from public, anon`, "i"));
      expect(sql154).toMatch(new RegExp(`grant execute on function ${sig} to authenticated, service_role`, "i"));
    }
    for (const sig of [
      "acc_cash_count_post_entry\\(uuid, uuid, date, uuid, bigint\\)",
      "acc_post_pending_cash_count\\(uuid\\)",
      "acc_cash_count_request_closed\\(\\)",
    ]) {
      expect(sql154).toMatch(new RegExp(`revoke all on function ${sig} from public, anon, authenticated`, "i"));
      expect(sql154).not.toMatch(new RegExp(`grant execute on function ${sig}`, "i"));
    }
  });

  it("recording a count is staff only and runs its checks in order", () => {
    const post = functionText(sql154, "acc_post_cash_count");
    const order = [
      "acc_is_staff()",
      "Choose the cash account to count",
      "Enter the date of the count",
      "Enter the amount counted",
      "The amount counted cannot be negative",
      "account_type <> 'bank'",
      "detail_type is distinct from 'cash_on_hand'",
      "v_cash.status <> 'active'",
      "v_cash.currency_code is distinct from v_base",
      "Choose an active cash on hand account in the base currency",
      "The offset account must be an active account you can post to",
      "The offset account must differ from the cash account",
      "(now() at time zone s.time_zone)::date",
      "A cash count cannot be dated after today",
      "acc_is_period_closed(p_counted_on)",
      "acc_cash_book_minor(p_account_id, p_counted_on)",
      "acc_approval_required('cash_count', abs(v_diff)) and not acc_in_approval_dispatch()",
      "acc_submit_for_approval(",
      "acc_cash_count_post_entry(v_id",
      "'posted', v_entry",
      "values ('acc_journal_entry', v_entry, 'post'",
    ];
    let last = -1;
    for (const needle of order) {
      const at = post.indexOf(needle);
      expect(at, needle).toBeGreaterThan(last);
      last = at;
    }
  });

  it("the account must be bank-type cash on hand, the template's account 1000", () => {
    const t = CHART_TEMPLATES.retail_jewelry.accounts.find((a) => a.code === "1000");
    expect(t).toMatchObject({ type: "bank", detailType: "cash_on_hand" });
  });

  it("the company's today is read in its time zone, never the server's date, before the future check", () => {
    const post = functionText(sql154, "acc_post_cash_count");
    expect(post).toMatch(/from acc_company_setting_version s order by s\.version desc limit 1/i);
    expect(post.indexOf("coalesce(\n    (select (now() at time zone")).toBeGreaterThan(-1);
  });

  it("an approved count is applied by the dispatch alone, and the book is read the same way at both entry points", () => {
    const pending = functionText(sql154, "acc_post_pending_cash_count");
    expect(pending).toMatch(/if not acc_in_approval_dispatch\(\) then\s+raise exception/i);
    expect(pending).toMatch(/v_count\.status <> 'pending_approval'/i);
    expect(pending).toMatch(/acc_cash_book_minor\(v_count\.account_id, v_count\.counted_on\)/i);
    expect(pending).toMatch(/set status = 'posted', book_minor = v_book, difference_minor = v_diff, journal_entry_id = v_entry/i);
  });

  it("a zero difference never needs approval and posts no entry", () => {
    const post = functionText(sql154, "acc_post_cash_count");
    expect(post).toMatch(/if v_diff <> 0 and acc_approval_required\(/i);
    expect(post).toMatch(/if v_diff <> 0 then\s+v_entry := acc_cash_count_post_entry/i);
  });

  it("the book balance is base currency, signed by side as acc_ledger_balances does, posted entries only", () => {
    const book = functionText(sql154, "acc_cash_book_minor");
    expect(book).toMatch(/sum\(case when jl\.debit_minor > 0 then jl\.amount_base_minor else 0 end\)/i);
    expect(book).toMatch(/sum\(case when jl\.credit_minor > 0 then jl\.amount_base_minor else 0 end\)/i);
    expect(book).toMatch(/e\.status = 'posted'/i);
    expect(book).toMatch(/e\.entry_date <= p_on/i);
    expect(sql154).not.toMatch(/sum\([^)]*(debit_minor|credit_minor)\s*-/i);
  });

  it("an overage debits cash and credits the offset; a shortage the reverse", () => {
    const entry = functionText(sql154, "acc_cash_count_post_entry");
    const over = entry.slice(entry.indexOf("if p_difference_minor > 0"), entry.indexOf("else"));
    expect(over.indexOf("'account_id', p_account_id, 'debit_minor', v_amount")).toBeGreaterThan(-1);
    expect(over.indexOf("'account_id', p_offset_account_id, 'debit_minor', 0, 'credit_minor', v_amount")).toBeGreaterThan(
      over.indexOf("'account_id', p_account_id, 'debit_minor', v_amount"),
    );
    const short = entry.slice(entry.indexOf("else"), entry.indexOf("end if"));
    expect(short.indexOf("'account_id', p_offset_account_id, 'debit_minor', v_amount")).toBeGreaterThan(-1);
    expect(short.indexOf("'account_id', p_account_id, 'debit_minor', 0, 'credit_minor', v_amount")).toBeGreaterThan(
      short.indexOf("'account_id', p_offset_account_id, 'debit_minor', v_amount"),
    );
    expect(entry).toMatch(/'cash_count', p_count_id, v_currency, v_lines/);
  });

  it("a rejected or cancelled request marks its count rejected", () => {
    const text = functionText(sql154, "acc_cash_count_request_closed");
    expect(text).toMatch(/new\.action_key = 'cash_count'/i);
    expect(text).toMatch(/new\.status in \('rejected', 'cancelled'\)/i);
    expect(text).toMatch(/set status = 'rejected'/i);
    expect(text).toMatch(/and status = 'pending_approval'/i);
    expect(sql154).toMatch(/create trigger acc_approval_request_cash_count\s+after update on acc_approval_request/i);
  });

  it("the standing read is for staff and viewers and counts only posted counts", () => {
    const text = functionText(sql154, "acc_cash_accounts_standing");
    expect(text).toMatch(/acc_is_staff\(\) or coalesce\(acc_current_role\(\) = 'viewer', false\)/i);
    expect(text).toMatch(/k\.status = 'posted' and k\.counted_on <= p_as_of/i);
    expect(text).toMatch(/order by k\.counted_on desc, k\.created_at desc, k\.id desc/i);
    expect(text).toMatch(/a\.account_type = 'bank' and a\.detail_type = 'cash_on_hand' and a\.status = 'active'/i);
    expect(text).toMatch(/\(p_as_of - c\.counted_on\)::integer/i);
  });
});

describe("0154 acc_approve_request is 0139's, plus one branch", () => {
  const old = functionText(strip(read("0139_stock_count.sql")), "acc_approve_request");
  const next = functionText(sql154, "acc_approve_request");
  const NEW_BRANCH = `  elsif v_req.action_key = 'cash_count' then
    v_result := acc_post_pending_cash_count((v_p ->> 'cash_count_id')::uuid);
`;

  it("is the latest definition before this migration", () => {
    const between = readdirSync(join(process.cwd(), "supabase/migrations")).filter((n) => /^\d{4}_/.test(n) && n.slice(0, 4) > "0139" && n.slice(0, 4) < "0154");
    expect(between.length).toBeGreaterThan(10);
    for (const name of between) expect(read(name), name).not.toMatch(/create or replace function acc_approve_request\(/i);
  });

  it("keeps every dispatch branch of 0139", () => {
    const branches = [...old.matchAll(/v_req\.action_key = '(\w+)'/g)].map((m) => m[1]);
    for (const key of branches) expect(next).toContain(`v_req.action_key = '${key}'`);
    expect(next).toMatch(/raise exception 'No dispatch defined for %'/);
    expect(branches).toContain("inventory_adjustment");
    expect(branches).toContain("vendor_tax_profile");
  });

  it("is identical to 0139 once the new branch is taken out", () => {
    expect(next).toContain(NEW_BRANCH);
    expect(next.replace(NEW_BRANCH, "")).toBe(old);
  });

  it("tests for cash_count before the final else", () => {
    expect(next.indexOf("'cash_count'")).toBeGreaterThan(next.indexOf("'vendor_tax_profile'"));
    expect(next.indexOf("'cash_count'")).toBeLessThan(next.indexOf("No dispatch defined"));
  });
});
