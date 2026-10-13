import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXPORT_TABLES } from "@/lib/domain/company-export";

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

/** The text of one `create table if not exists <name> (` statement, up to its closing `);`. */
function tableText(sql: string, name: string): string {
  const start = sql.search(new RegExp(`create table if not exists ${name} \\(`, "i"));
  expect(start, `${name} is created`).toBeGreaterThanOrEqual(0);
  return sql.slice(start, sql.indexOf("\n);", start) + 3);
}

const sql = strip(read("0141_estimates.sql"));
const estimate = tableText(sql, "acc_estimate");
const line = tableText(sql, "acc_estimate_line");
const save = functionText(sql, "acc_save_estimate");
const decline = functionText(sql, "acc_set_estimate_declined");
const remove = functionText(sql, "acc_delete_estimate");
const convert = functionText(sql, "acc_create_invoice_from_estimate");
const FUNCTIONS: Array<[string, string]> = [
  ["acc_save_estimate", save],
  ["acc_set_estimate_declined", decline],
  ["acc_delete_estimate", remove],
  ["acc_create_invoice_from_estimate", convert],
];
/** "Converted" everywhere: a linked invoice that is not void, named by its number or as a draft. */
const LIVE_INVOICE =
  /select coalesce\(i\.invoice_number, 'a draft invoice'\) into v_live\s+from acc_invoice i\s+where i\.estimate_id = p_estimate_id and i\.status <> 'void'\s+limit 1/i;

describe("0141 estimates: shape", () => {
  it("starts with the schema search path and qualifies nothing with public.", () => {
    expect(sql).toMatch(/^\s*set search_path = public;/i);
    expect(sql).not.toMatch(/\bpublic\.\w/i);
  });

  it("creates exactly the two tables and the four functions", () => {
    const tables = [...sql.matchAll(/create table (?:if not exists )?(\w+)/gi)].map((m) => m[1]);
    expect(tables).toEqual(["acc_estimate", "acc_estimate_line"]);
    const created = [...sql.matchAll(/create or replace function (\w+)\(/gi)].map((m) => m[1]);
    expect(created.sort()).toEqual([
      "acc_create_invoice_from_estimate",
      "acc_delete_estimate",
      "acc_save_estimate",
      "acc_set_estimate_declined",
    ]);
  });

  it("can be run twice: every object is created only if missing, or dropped first", () => {
    expect(sql).not.toMatch(/create table (?!if not exists)/i);
    expect(sql).not.toMatch(/create (unique )?index (?!if not exists)/i);
    expect(sql).not.toMatch(/\bcreate function\b/i);
    expect(sql).toMatch(/add column if not exists estimate_id/i);
    for (const [, name] of sql.matchAll(/create trigger (\w+)/gi)) {
      expect(sql, name).toMatch(new RegExp(`drop trigger if exists ${name} on`, "i"));
    }
    for (const [, name] of sql.matchAll(/create policy (\w+)/gi)) {
      expect(sql, name).toMatch(new RegExp(`drop policy if exists ${name} on`, "i"));
    }
    expect(sql).toMatch(/values \('estimate', 'EST-', 1\)\s+on conflict \(key\) do nothing/i);
    expect(sql).toMatch(/on conflict \(sequence_key\) do update/i);
  });
});

describe("0141 the estimate", () => {
  it("has a number that is required and unique, assigned by the database", () => {
    expect(estimate).toMatch(/estimate_number\s+text not null unique/i);
  });

  it("belongs to a customer, with a date and a Valid until that is never before it", () => {
    expect(estimate).toMatch(/customer_id\s+uuid not null references acc_customer \(id\)/i);
    expect(estimate).toMatch(/estimate_date\s+date not null/i);
    expect(estimate).toMatch(/expiry_date\s+date not null/i);
    expect(estimate).toMatch(/constraint acc_estimate_expiry_ck check \(expiry_date >= estimate_date\)/i);
  });

  it("is in USD, under the same named check every currency column carries (0051)", () => {
    expect(estimate).toMatch(/currency_code\s+text not null default 'USD' references acc_currency \(code\)/i);
    expect(estimate).toMatch(/constraint acc_usd_currency_check check \(currency_code = 'USD'\)/i);
  });

  it("stores the totals the database works out, and they add up", () => {
    for (const column of ["subtotal_minor", "tax_minor", "total_minor"]) {
      expect(estimate).toMatch(new RegExp(`\\b${column}\\s+bigint not null default 0`, "i"));
    }
    expect(estimate).toMatch(/total_minor = subtotal_minor \+ tax_minor/i);
  });

  it("stores only Declined: a nullable time, and a status word the database holds equal to it", () => {
    expect(estimate).toMatch(/declined_at\s+timestamptz,/i);
    expect(estimate).toMatch(/status\s+text not null default 'open',/i);
    expect(estimate).toMatch(
      /constraint acc_estimate_status_ck\s+check \(status in \('open', 'declined'\) and \(status = 'declined'\) = \(declined_at is not null\)\)/i,
    );
    expect(estimate).not.toMatch(/expired|converted/i);
  });

  it("keeps status a plain column: the backup restore loads every exported column back as written", () => {
    expect(estimate).not.toMatch(/generated always/i);
  });

  it("carries the creation and change stamps", () => {
    expect(estimate).toMatch(/created_by\s+uuid references auth\.users \(id\)/i);
    expect(estimate).toMatch(/created_at\s+timestamptz not null default now\(\)/i);
    expect(estimate).toMatch(/updated_by\s+uuid references auth\.users \(id\)/i);
    expect(estimate).toMatch(/updated_at\s+timestamptz not null default now\(\)/i);
  });

  it("has the customer and date indexes the list reads by", () => {
    expect(sql).toMatch(/create index if not exists acc_estimate_customer_idx on acc_estimate \(customer_id\)/i);
    expect(sql).toMatch(/create index if not exists acc_estimate_date_idx on acc_estimate \(estimate_date desc, estimate_number desc\)/i);
  });
});

describe("0141 the estimate line", () => {
  it("has an invoice line's columns", () => {
    const invoiceLine = tableText(
      strip(read("0005_invoicing.sql")).replace(/create table acc_invoice_line/i, "create table if not exists acc_invoice_line"),
      "acc_invoice_line",
    );
    const columns = (text: string) =>
      [...text.matchAll(/^\s+(\w+)\s+(uuid|int|text|numeric|bigint)\b/gim)].map((m) => m[1]).filter((c) => c !== "id");
    const expected = columns(invoiceLine)
      .map((c) => (c === "invoice_id" ? "estimate_id" : c))
      .concat("item_id") // added to acc_invoice_line by 0014
      .sort();
    expect(expected).toHaveLength(11);
    expect(columns(line).sort()).toEqual(expected);
  });

  it("goes with its estimate, and keeps the invoice line's types and references", () => {
    expect(line).toMatch(/estimate_id\s+uuid not null references acc_estimate \(id\) on delete cascade/i);
    expect(line).toMatch(/item_id\s+uuid references acc_item \(id\)/i);
    expect(line).toMatch(/quantity\s+numeric\(20, 4\) not null check \(quantity > 0\)/i);
    expect(line).toMatch(/unit_price_minor\s+bigint not null check \(unit_price_minor >= 0\)/i);
    expect(line).toMatch(/income_account_id\s+uuid not null references acc_account \(id\)/i);
    expect(line).toMatch(/tax_code_id\s+uuid references acc_tax_code \(id\)/i);
    expect(line).toMatch(/constraint acc_estimate_line_order_uq unique \(estimate_id, line_order\)/i);
  });
});

describe("0141 the invoice made from an estimate", () => {
  it("links back by a nullable foreign key", () => {
    expect(sql).toMatch(/alter table acc_invoice\s+add column if not exists estimate_id uuid references acc_estimate \(id\);/i);
  });

  it("allows at most one invoice that is not void per estimate", () => {
    expect(sql).toMatch(
      /create unique index if not exists acc_invoice_estimate_live_uq\s+on acc_invoice \(estimate_id\) where estimate_id is not null and status <> 'void'/i,
    );
  });

  it("indexes every link, void ones included, for the delete rule", () => {
    expect(sql).toMatch(/create index if not exists acc_invoice_estimate_idx\s+on acc_invoice \(estimate_id\) where estimate_id is not null/i);
  });
});

describe("0141 access: read as invoices are read, written only through the functions", () => {
  it.each(["acc_estimate", "acc_estimate_line"])("%s: row-level security with the invoices' read policy", (table) => {
    expect(sql).toMatch(new RegExp(`alter table ${table} enable row level security`, "i"));
    expect(sql).toMatch(
      new RegExp(`create policy ${table}_read on ${table}\\s+for select using \\(acc_current_role\\(\\) is not null\\)`, "i"),
    );
    // The invoices' read policy, word for word but for the name: staff and viewers alike.
    const invoices = strip(read("0005_invoicing.sql"));
    expect(invoices).toMatch(/create policy acc_invoice_read on acc_invoice for select using \(acc_current_role\(\) is not null\)/i);
  });

  it("has no write policy on either table", () => {
    const policies = [...sql.matchAll(/create policy (\w+) on (\w+)\s+for (\w+)/gi)].map((m) => `${m[1]} ${m[3].toLowerCase()}`);
    expect(policies.sort()).toEqual(["acc_estimate_line_read select", "acc_estimate_read select"]);
    expect(sql).not.toMatch(/create policy[^;]*\bfor (insert|update|delete|all)\b/i);
  });

  it.each(["acc_estimate", "acc_estimate_line"])(
    "%s: signed-in users may only read; the service role keeps everything; anon nothing (the 0139 pattern)",
    (table) => {
      expect(sql).toMatch(new RegExp(`revoke all on ${table} from public, anon;`, "i"));
      expect(sql).toMatch(new RegExp(`revoke insert, update, delete, truncate on ${table} from authenticated;`, "i"));
      expect(sql).toMatch(new RegExp(`grant select on ${table} to authenticated;`, "i"));
      expect(sql).toMatch(new RegExp(`grant all on ${table} to service_role;`, "i"));
      expect(sql).not.toMatch(new RegExp(`grant (insert|update|delete|all)[^;]* on ${table} to [^;]*\\bauthenticated\\b`, "i"));
      expect(sql).not.toMatch(new RegExp(`grant [^;]* on ${table} to [^;]*\\banon\\b`, "i"));
      // The write rights are taken back after the anon revoke, and before the read grant.
      const takeBack = sql.indexOf(`revoke insert, update, delete, truncate on ${table} from authenticated`);
      expect(takeBack).toBeGreaterThan(sql.indexOf(`revoke all on ${table} from public, anon`));
      expect(takeBack).toBeLessThan(sql.indexOf(`grant select on ${table} to authenticated`));
      // The same four statements the stock count tables carry.
      const stockCount = strip(read("0139_stock_count.sql"));
      expect(stockCount).toMatch(/revoke insert, update, delete, truncate on acc_stock_count from authenticated;/i);
      expect(stockCount).toMatch(/grant select on acc_stock_count to authenticated;/i);
    },
  );

  it("stamps the actor, audits the header and guards its number", () => {
    expect(sql).toMatch(/create trigger acc_estimate_actor_stamp\s+before insert or update on acc_estimate\s+for each row execute function acc_stamp_actor\(\)/i);
    expect(sql).toMatch(/create trigger acc_estimate_atomic_audit\s+after insert or update or delete on acc_estimate\s+for each row execute function acc_audit_row_change\(\)/i);
    expect(sql).toMatch(
      /create trigger acc_estimate_number_guard\s+before update or delete on acc_estimate\s+for each row execute function acc_guard_document_number\('estimate_number'\)/i,
    );
  });
});

describe("0141 the EST- sequence", () => {
  it("has its acc_sequence row", () => {
    expect(sql).toMatch(/insert into acc_sequence \(key, prefix, next_value\)\s+values \('estimate', 'EST-', 1\)/i);
  });

  it("is registered for the Number Sequence report, with the status word as its status column", () => {
    expect(sql).toMatch(
      /insert into acc_number_source\s+\(sequence_key, label, table_name, number_column, date_column, status_column\)\s+values\s+\('estimate', 'Estimates', 'acc_estimate', 'estimate_number', 'estimate_date', 'status'\)/i,
    );
    expect(sql).not.toMatch(/'estimate_date', 'declined_at'/i);
  });

  it("the guard trigger is named as 0066 names it, so 0066's loop would attach the same one", () => {
    const loop = strip(read("0066_document_number_integrity.sql"));
    expect(loop).toMatch(/v_table \|\| '_number_guard'/);
    expect(sql).toMatch(/drop trigger if exists acc_estimate_number_guard on acc_estimate/i);
  });

  it("numbers only a new estimate, after every line has been checked", () => {
    expect(save.match(/acc_next_number\('estimate'\)/gi)).toHaveLength(1);
    expect(save).toMatch(/if p_estimate_id is null then\s+v_number := acc_next_number\('estimate'\)/i);
    expect(save.indexOf("acc_next_number('estimate')")).toBeGreaterThan(save.indexOf("end loop"));
    expect(sql).not.toMatch(/update acc_estimate\s+set[^;]*estimate_number/i);
  });
});

describe("0141 the functions: who may call them", () => {
  it.each(FUNCTIONS)("%s is security definer with a fixed search_path", (_name, text) => {
    const header = text.slice(0, text.indexOf("$$"));
    expect(header).toMatch(/security definer/i);
    expect(header).toMatch(/set search_path = public/i);
  });

  it.each(FUNCTIONS)("%s requires staff before anything else", (_name, text) => {
    expect(text).toMatch(/begin\s+if not acc_is_staff\(\) then\s+raise exception 'Not authorized to/i);
  });

  it.each([
    "acc_save_estimate\\(uuid, uuid, date, date, text, text, jsonb\\)",
    "acc_set_estimate_declined\\(uuid, boolean\\)",
    "acc_delete_estimate\\(uuid\\)",
    "acc_create_invoice_from_estimate\\(uuid, uuid, date, date, text, text, jsonb\\)",
  ])("%s: revoked from public and anon, executable by signed-in users and the service role", (sig) => {
    expect(sql).toMatch(new RegExp(`revoke all on function ${sig} from public, anon;`, "i"));
    expect(sql).toMatch(new RegExp(`grant execute on function ${sig} to authenticated, service_role;`, "i"));
  });

  it("each grant matches the function's real parameter list", () => {
    const types = (text: string) =>
      [...text.slice(text.indexOf("("), text.indexOf(")")).matchAll(/p_\w+\s+(\w+)/g)].map((m) => m[1]).join(", ");
    expect(types(save)).toBe("uuid, uuid, date, date, text, text, jsonb");
    expect(types(decline)).toBe("uuid, boolean");
    expect(types(remove)).toBe("uuid");
    expect(types(convert)).toBe("uuid, uuid, date, date, text, text, jsonb");
  });

  it("returns the documented shapes", () => {
    expect(save).toMatch(/\) returns jsonb/i);
    expect(save).toMatch(
      /jsonb_build_object\(\s+'id', v_id,\s+'estimate_number', v_number,\s+'subtotal_minor', v_subtotal,\s+'tax_minor', v_tax_total,\s+'total_minor', v_subtotal \+ v_tax_total\)/i,
    );
    expect(decline).toMatch(/returns jsonb/i);
    expect(decline).toMatch(/'id', p_estimate_id,\s+'estimate_number', v_est\.estimate_number,\s+'declined_at', v_declined/i);
    expect(remove).toMatch(/returns jsonb/i);
    expect(remove).toMatch(/jsonb_build_object\('id', p_estimate_id, 'estimate_number', v_est\.estimate_number\)/i);
    expect(convert).toMatch(/\) returns uuid/i);
    expect(convert).toMatch(/return v_invoice;/i);
  });
});

describe("0141 Converted locks the estimate", () => {
  it.each(FUNCTIONS)("%s locks the estimate before it reads the invoices", (_name, text) => {
    expect(text).toMatch(/select \* into v_est from acc_estimate where id = p_estimate_id for update;/i);
    expect(text).toMatch(LIVE_INVOICE);
    expect(text.indexOf("for update")).toBeLessThan(text.search(LIVE_INVOICE));
  });

  it("an edit is refused, naming the estimate and its invoice", () => {
    expect(save).toMatch(/'% has been turned into an invoice \(%\), so it can no longer be edited\.',\s+v_est\.estimate_number, v_live/i);
  });

  it("declining and reopening are refused", () => {
    expect(decline).toMatch(/'% has been turned into an invoice \(%\), so it cannot be marked declined\.'/i);
    expect(decline).toMatch(/'% has been turned into an invoice \(%\), so it cannot be reopened\.'/i);
  });

  it("deleting is refused", () => {
    expect(remove).toMatch(/'% has been turned into an invoice \(%\), so it cannot be deleted\.'/i);
  });
});

describe("0141 saving an estimate", () => {
  it("refuses what an invoice draft would refuse, in the estimate's words", () => {
    for (const message of [
      "Choose an active customer for the estimate.",
      "Choose the estimate date.",
      "Valid until cannot be before the estimate date.",
      "Estimates are in US dollars (USD) only.",
      "An estimate needs at least one line.",
      "Line %: the quantity must be more than zero.",
      "Line %: enter a unit price.",
      "Line %: the unit price cannot be negative.",
      "Line %: choose an income account.",
      "Line %: the account must be an active income account.",
      "Line %: the tax code must be an active sales tax code.",
      "Line %: the item was not found.",
    ]) {
      expect(save, message).toContain(`'${message}'`);
    }
  });

  it("requires an active customer, as the invoice draft does", () => {
    expect(save).toMatch(/not exists \(select 1 from acc_customer where id = p_customer_id and is_active\)/i);
  });

  it("defaults Valid until to the estimate date plus 30 days", () => {
    expect(save).toMatch(/v_expiry := coalesce\(p_expiry_date, p_estimate_date \+ 30\)/i);
    expect(save).toMatch(/if v_expiry < p_estimate_date then/i);
  });

  it("allows only an active income posting account, the invoice form's rule", () => {
    expect(save).toMatch(/where id = v_account and account_type = 'income'\s+and is_posting_account and status = 'active'/i);
    const rule = readFileSync(join(process.cwd(), "lib/domain/accounts.ts"), "utf8");
    expect(rule).toMatch(/account\.account_type === "income" &&\s+account\.is_posting_account &&\s+account\.status === "active"/);
  });

  it("allows only an active sales tax code, as the invoice draft does", () => {
    expect(save).toMatch(/from acc_tax_code\s+where id = v_tax_code and is_active and direction = 'sales'/i);
  });

  it("works out each line with the invoice draft's own two roundings", () => {
    const draft = functionText(strip(read("0058_atomic_documents_and_audit.sql")), "acc_create_draft_invoice");
    for (const formula of [
      /v_line_sub := round\(v_quantity \* v_unit_price\)::bigint;/i,
      /v_line_tax := round\(v_line_sub \* v_tax_rate \/ 100\)::bigint;/i,
    ]) {
      expect(draft).toMatch(formula);
      expect(save).toMatch(formula);
    }
    expect(save).toMatch(/v_quantity := round\(\(v_line ->> 'quantity'\)::numeric, 4\);/i);
  });

  it("checks every line before writing anything", () => {
    const loopEnd = save.indexOf("end loop");
    for (const write of ["insert into acc_estimate\n", "update acc_estimate", "delete from acc_estimate_line", "insert into acc_estimate_line"]) {
      expect(save.indexOf(write), write).toBeGreaterThan(loopEnd);
    }
  });

  it("an edit replaces the lines and keeps the number", () => {
    expect(save).toMatch(/v_number := v_est\.estimate_number;/i);
    expect(save).toMatch(/delete from acc_estimate_line where estimate_id = v_id;/i);
    expect(save).not.toMatch(/declined_at/i);
    const update = save.match(/update acc_estimate\s+set[^;]*;/i)?.[0] ?? "";
    expect(update).toMatch(/subtotal_minor = v_subtotal/i);
    expect(update).not.toMatch(/\bstatus\b/i);
  });
});

describe("0141 declining and reopening", () => {
  it("declining twice keeps the first time; reopening clears it", () => {
    expect(decline).toMatch(/v_declined := case when p_declined then coalesce\(v_est\.declined_at, now\(\)\) end;/i);
    expect(decline).toMatch(/if v_declined is distinct from v_est\.declined_at then\s+update acc_estimate\s+set declined_at = v_declined,/i);
  });

  it("sets the status word in the same statement as the time", () => {
    expect(decline).toMatch(
      /set declined_at = v_declined,\s+status = case when v_declined is null then 'open' else 'declined' end,/i,
    );
    const writes = [...sql.matchAll(/update acc_estimate\s+set[^;]*;/gi)].map((m) => m[0]);
    for (const write of writes.filter((w) => /declined_at|status/i.test(w))) {
      expect(write, "declined_at and status change together").toMatch(/declined_at = [\s\S]*status = /i);
    }
  });
});

describe("0141 deleting an estimate", () => {
  it("is refused once any invoice, void or not, has been made from it", () => {
    expect(remove).toMatch(/if exists \(select 1 from acc_invoice i where i\.estimate_id = p_estimate_id\) then/i);
    expect(remove).toMatch(/'% has had an invoice made from it\. Mark it declined instead\.',\s+v_est\.estimate_number/i);
  });

  it("writes the freed number to the gap notes, before the row goes", () => {
    expect(remove).toMatch(/insert into acc_number_gap_note \(sequence_key, number_value, reason, noted_by\)\s+values \('estimate', v_digits::bigint,/i);
    expect(remove).toMatch(/on conflict \(sequence_key, number_value\) do nothing/i);
    expect(remove.indexOf("insert into acc_number_gap_note")).toBeLessThan(remove.indexOf("delete from acc_estimate where id = p_estimate_id"));
  });

  it("the refusals come before any change", () => {
    const lastRefusal = remove.indexOf("Mark it declined instead");
    expect(remove.indexOf("insert into acc_number_gap_note")).toBeGreaterThan(lastRefusal);
    expect(remove.indexOf("delete from acc_estimate")).toBeGreaterThan(lastRefusal);
  });
});

describe("0141 turning an estimate into an invoice", () => {
  it("takes the invoice draft's own fields after the estimate", () => {
    const draft = functionText(strip(read("0058_atomic_documents_and_audit.sql")), "acc_create_draft_invoice");
    const params = (text: string) => [...text.slice(text.indexOf("("), text.indexOf(")")).matchAll(/(p_\w+)\s+\w+/g)].map((m) => m[1]);
    expect(params(convert)).toEqual(["p_estimate_id", ...params(draft).filter((p) => p !== "p_recurring_run_id")]);
  });

  it("refuses in the documented words", () => {
    expect(convert).toMatch(/'% is marked declined\. Reopen it before turning it into an invoice\.'/i);
    expect(convert).toMatch(/'% has already been turned into an invoice \(%\)\.',\s+v_est\.estimate_number, v_live/i);
    expect(convert).toMatch(/'% is for %\. The invoice made from it must be for the same customer\.'/i);
    expect(convert).toMatch(/if p_customer_id is distinct from v_est\.customer_id then/i);
  });

  it("works in the documented order: lock, declined, already converted, customer, draft, link", () => {
    const at = (needle: string | RegExp) => (typeof needle === "string" ? convert.indexOf(needle) : convert.search(needle));
    const order = [
      at("for update"),
      at("v_est.declined_at is not null"),
      at(LIVE_INVOICE),
      at("p_customer_id is distinct from v_est.customer_id"),
      at("acc_create_draft_invoice("),
      at("update acc_invoice set estimate_id = p_estimate_id where id = v_invoice"),
    ];
    expect(order.every((n) => n >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("makes the draft through acc_create_draft_invoice, never a copy of it", () => {
    expect(convert).toMatch(
      /v_invoice := acc_create_draft_invoice\(\s+p_customer_id, p_issue_date, p_due_date, p_currency, p_memo, p_lines\);/i,
    );
    expect(convert).not.toMatch(/insert into acc_invoice/i);
    expect(convert).not.toMatch(/round\(/i);
    expect(convert).not.toMatch(/acc_tax_code/i);
  });
});

describe("0141 nothing posts", () => {
  it("no function touches the ledger", () => {
    expect(sql).not.toMatch(/acc_post_entry|acc_journal_entry|acc_journal_line|acc_issue_invoice/i);
  });
});

describe("0141 travels with the company export and backup", () => {
  it("lists both tables, after what they reference and before the invoice that references them", () => {
    const at = (t: string) => EXPORT_TABLES.indexOf(t);
    expect(at("acc_estimate")).toBeGreaterThan(-1);
    for (const referenced of ["acc_customer", "acc_item", "acc_account", "acc_tax_code", "acc_currency"]) {
      expect(at("acc_estimate"), referenced).toBeGreaterThan(at(referenced));
    }
    expect(at("acc_estimate_line")).toBeGreaterThan(at("acc_estimate"));
    expect(at("acc_invoice")).toBeGreaterThan(at("acc_estimate_line"));
  });
});
