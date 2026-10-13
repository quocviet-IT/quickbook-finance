# Estimates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship release 2.02, Estimates. An estimate is a price promised to a customer, kept outside the books, and turned into a draft invoice when the customer accepts. It brings the mockup's p36 estimates into OneBook with OneBook's own invoice lines.

**Architecture:**
- **Database:** migration 0141 adds `acc_estimate` and `acc_estimate_line` (read-only to `authenticated`), `acc_invoice.estimate_id` (at most one live invoice per estimate), the `EST-` sequence, and four SECURITY DEFINER functions:
  - `acc_save_estimate`;
  - `acc_set_estimate_declined`;
  - `acc_delete_estimate`;
  - `acc_create_invoice_from_estimate`, which locks the estimate, calls `acc_create_draft_invoice` and links the result.
- **Pure logic:**
  - `lib/domain/estimates.ts`: the states, actions, messages and invoice prefill;
  - `lib/domain/estimate-document.ts`: the PDF model.
- **Services and actions:**
  - `lib/services/estimates.ts` and `app/(app)/estimates/actions.ts`;
  - the invoice create action routes a draft made from an estimate through the new function;
  - the invoice detail carries its estimate.
- **Screens:**
  - Sales › Estimates, with a list and a form modal;
  - the Invoices page opens New invoice filled from `?estimate=`;
  - the shared line editor `components/SalesLineItems.tsx`;
  - the shared PDF renderer.

**Tech Stack:**
- Next.js 16 App Router, React 19, Ant Design 6, Zod 4
- Supabase/PostgREST, one schema per company; plpgsql
- jsPDF in the browser
- vitest

**Source of truth:**
- **Spec:** `docs/superpowers/specs/2026-10-12-estimates-design.md`, including its "Amendments from pre-building".
- **Code:** every file in this plan was first built and run on a local pre-build branch. There it passed:
  - typecheck, lint, unit tests (329 files), build and bundle budget;
  - the rolled-back verification script against the live functions (224 of 224);
  - a smoke on the sample company PC-Test against the live database, in light, dark and phone.
- **How the code is given here:**
  - New files are given whole.
  - Edits to existing files are find/replace pairs that reproduce the pre-build exactly when applied in order.
  - A file rewritten by more than half is given whole.

**Do not "improve" the given code while transcribing it.** It has been verified against the real database and in a browser. If something looks wrong, stop and report it instead of changing it.

## Global Constraints

- **Copy:**
  - US English, with names and sentences exactly as the spec gives them.
  - Keep typographic characters (’ “ ” —) exactly as given. Never turn ’ into ' or — into -.
- **Money:**
  - Base-currency minor units.
  - Line subtotal `round(quantity × unit price)`; line tax `round(subtotal × rate / 100)`. These are the same rules as invoices.
- **States:**
  - Converted means an invoice that is not void is linked.
  - Declined is stored.
  - Expired means not declined, not converted, and the company's today is after Valid until; the expiry day itself is still Open.
  - Open otherwise.
- **Valid until:** defaults to the estimate date + 30 days.
- **Numbering:** `EST-000001`, from its own sequence, assigned on first save, never edited.
- **Dates:** in the company's time zone, from the server. Never use `new Date().toISOString()` for "today".
- **Reads:** every list read pages past PostgREST's silent 1,000-row cap, in a total order ending in a unique column.
- **Tables:**
  - Every list goes through `DataTable` or `ReportTable`. Never import antd's `Table` in a new screen.
  - No `scroll={{ x }}`. Columns fit the 1280 box.
  - No literal `pageSize` pinning.
- **JSX:** never put an HTML entity (`&apos;`, `&quot;`) right after an element.
- **Server Components:** `page.tsx` never reads Ant Design sub-components.
- **Forms opened by `?new=1`:** use `useInitiallyOpen`.
- **Migration 0141:**
  - Unqualified names, with `set search_path = public;` at the top.
  - SECURITY DEFINER with a pinned `search_path`.
  - Executable by `authenticated` and `service_role`, and revoked from `public` and `anon`.
  - Already live on all six companies, applied by the controller with the user's approval. Never run `scripts/migrate.mjs`, `provision-company` or `verify:estimates` from an implementer task.
- **Database:** implementer tasks touch no database.
- **Test data:** the repository is public, so tests use invented data only.
- **Commits:**
  - Stage files by name, never `git add -A` / `git add .`.
  - Never stage `.claude/settings.json`.
  - Use exactly `git commit -m "<message>"`, with NO Co-Authored-By trailer and no mention of Claude or AI.
- **Gates:**
  - Run them from `ctyhp-accounting/`.
  - If tsc complains about stale `.next/types`, delete `.next/types` and rerun.
  - Read the pass/fail lines in full; never pipe them through `tail` or `head`.

---

### Task 1: Migration 0141 — estimates, their lines, and the link to the invoice made from one

**Files:**
- Test (create): `ctyhp-accounting/tests/unit/estimates-migration.test.ts`
- Create: `ctyhp-accounting/supabase/migrations/0141_estimates.sql`
- Create: `ctyhp-accounting/scripts/verify-estimates.mjs`
- Modify: `ctyhp-accounting/package.json`
- Modify: `ctyhp-accounting/lib/domain/company-export.ts`

**Interfaces:**
- Consumes (existing): `acc_create_draft_invoice` (0058), `acc_invoice`, `acc_customer`, `acc_account`, `acc_tax_code`, `acc_item`, `acc_sequence` and `acc_next_number`, `acc_number_source` and the number guard (0066), `acc_number_gap_note` (0106), `acc_stamp_actor`, the audit trigger, `acc_is_staff()`.
- Produces:
  - Tables `acc_estimate` (with `status` reading `open` or `declined`, kept equal to `declined_at` by a check constraint) and `acc_estimate_line`, read-only to `authenticated`; `acc_invoice.estimate_id`, with at most one invoice that is not void per estimate.
  - `acc_save_estimate(...)`, `acc_set_estimate_declined(p_estimate_id, p_declined)`, `acc_delete_estimate(p_estimate_id)`, `acc_create_invoice_from_estimate(p_estimate_id, …the draft invoice's fields and lines…)`: the exact signatures are in the SQL below.
  - The `EST-` sequence and its Number Sequence report row; `acc_estimate` and `acc_estimate_line` in `EXPORT_TABLES`.
  - `npm run verify:estimates` (rolled-back checks; the controller runs it).

- [ ] **Step 1: Create `ctyhp-accounting/tests/unit/estimates-migration.test.ts`** with exactly this content:

```ts
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
```

- [ ] **Step 2: Run the tests to see them fail**

```bash
npx vitest run tests/unit/estimates-migration.test.ts
```

Expected: FAIL — `supabase/migrations/0141_estimates.sql` does not exist yet.

- [ ] **Step 3: Create `ctyhp-accounting/supabase/migrations/0141_estimates.sql`** with exactly this content:

```sql
-- ============================================================================
-- 0141  Estimates: a price promised to a customer, and the invoice made from one
--
-- An estimate sits outside the books. It has a customer and lines shaped
-- exactly like an invoice's (item, description, quantity, unit price, income
-- account, sales tax code), so turning one into an invoice loses nothing.
-- Nothing here posts: only the invoice made from an estimate posts, when it is
-- issued, as every invoice does.
--
-- State is worked out when read; only Declined is stored.
--   Converted  an invoice that is not void carries this estimate's id
--   Declined   declined_at is set
--   Expired    neither, and the company's today is after expiry_date. The app
--              decides this: today depends on the company's time zone.
--   Open       otherwise
-- The stored half also has a word, status = 'open' or 'declined', for the
-- Number Sequence report's status column. A check holds it equal to
-- declined_at at all times. It is a plain column rather than a generated one
-- because the backup restore loads every exported column back as written, and
-- Postgres refuses a value for a generated column. Converted and Expired are
-- never stored.
--
-- Four functions, all security definer and staff only:
--   acc_save_estimate                 create, or replace the header and lines
--   acc_set_estimate_declined         mark declined, or reopen
--   acc_delete_estimate               only an estimate that never had an invoice
--   acc_create_invoice_from_estimate  the draft invoice, linked, in one go
--
-- The conversion makes the draft by calling acc_create_draft_invoice (0058)
-- itself, so an invoice made from an estimate is checked and totalled by the
-- same function as every other invoice draft. The estimate's own totals use
-- that function's two roundings, line by line:
--   line subtotal = round(quantity * unit price)
--   line tax      = round(line subtotal * rate / 100)
-- The quantity is first rounded to the four places its column keeps, so the
-- invoice made from the stored lines comes to the same total.
--
-- Numbering: EST-000001 from its own sequence, assigned on the first save and
-- never changed. The sequence is registered for the Number Sequence report and
-- guarded like every numbered document (0066). An estimate may be deleted when
-- it never had an invoice, so the delete writes the freed number to
-- acc_number_gap_note, as deleting a payment does (0106), and the report still
-- adds up.
--
-- Access: every member of the company reads, as invoices are read (0005).
-- Nobody writes these tables directly. The tables have a read policy and no
-- write policy, and signed-in users hold SELECT only, as acc_adjusting_entry
-- (0124) and acc_stock_count (0139) do. An application session writes only
-- through the four functions, so the Converted lock and the totals the database
-- works out cannot be stepped around.
-- ============================================================================

set search_path = public;

-- ----------------------------------------------------------------------------
-- 1. The estimate and its lines
-- ----------------------------------------------------------------------------
create table if not exists acc_estimate (
  id               uuid primary key default gen_random_uuid(),
  estimate_number  text not null unique,
  customer_id      uuid not null references acc_customer (id),
  estimate_date    date not null,
  expiry_date      date not null,
  currency_code    text not null default 'USD' references acc_currency (code),
  memo             text,
  subtotal_minor   bigint not null default 0,
  tax_minor        bigint not null default 0,
  total_minor      bigint not null default 0,
  declined_at      timestamptz,
  status           text not null default 'open',
  created_by       uuid references auth.users (id),
  created_at       timestamptz not null default now(),
  updated_by       uuid references auth.users (id),
  updated_at       timestamptz not null default now(),
  constraint acc_estimate_expiry_ck check (expiry_date >= estimate_date),
  constraint acc_usd_currency_check check (currency_code = 'USD'),
  constraint acc_estimate_totals_ck
    check (subtotal_minor >= 0 and tax_minor >= 0 and total_minor = subtotal_minor + tax_minor),
  constraint acc_estimate_status_ck
    check (status in ('open', 'declined') and (status = 'declined') = (declined_at is not null))
);

create index if not exists acc_estimate_customer_idx on acc_estimate (customer_id);
create index if not exists acc_estimate_date_idx on acc_estimate (estimate_date desc, estimate_number desc);

create table if not exists acc_estimate_line (
  id                  uuid primary key default gen_random_uuid(),
  estimate_id         uuid not null references acc_estimate (id) on delete cascade,
  line_order          int not null default 0,
  item_id             uuid references acc_item (id),
  description         text not null default '',
  quantity            numeric(20, 4) not null check (quantity > 0),
  unit_price_minor    bigint not null check (unit_price_minor >= 0),
  income_account_id   uuid not null references acc_account (id),
  tax_code_id         uuid references acc_tax_code (id),
  line_subtotal_minor bigint not null default 0,
  line_tax_minor      bigint not null default 0,
  line_total_minor    bigint not null default 0,
  constraint acc_estimate_line_order_uq unique (estimate_id, line_order)
);

-- ----------------------------------------------------------------------------
-- 2. The invoice made from an estimate. At most one invoice that is not void
--    per estimate; a voided one keeps its link, which is how the delete rule
--    knows the estimate has had an invoice.
-- ----------------------------------------------------------------------------
alter table acc_invoice
  add column if not exists estimate_id uuid references acc_estimate (id);

create index if not exists acc_invoice_estimate_idx
  on acc_invoice (estimate_id) where estimate_id is not null;
create unique index if not exists acc_invoice_estimate_live_uq
  on acc_invoice (estimate_id) where estimate_id is not null and status <> 'void';

-- ----------------------------------------------------------------------------
-- 3. Actor stamps, the audit trail and the number guard, on the header. The
--    lines are replaced wholesale by every save, so the header's audit row is
--    the record of who changed the estimate.
-- ----------------------------------------------------------------------------
drop trigger if exists acc_estimate_actor_stamp on acc_estimate;
create trigger acc_estimate_actor_stamp
  before insert or update on acc_estimate
  for each row execute function acc_stamp_actor();

drop trigger if exists acc_estimate_atomic_audit on acc_estimate;
create trigger acc_estimate_atomic_audit
  after insert or update or delete on acc_estimate
  for each row execute function acc_audit_row_change();

drop trigger if exists acc_estimate_number_guard on acc_estimate;
create trigger acc_estimate_number_guard
  before update or delete on acc_estimate
  for each row execute function acc_guard_document_number('estimate_number');

-- ----------------------------------------------------------------------------
-- 4. Row-level security and grants: read as invoices are read, written only
--    through the functions below (the 0124 and 0139 pattern)
-- ----------------------------------------------------------------------------
alter table acc_estimate enable row level security;
alter table acc_estimate_line enable row level security;

drop policy if exists acc_estimate_read on acc_estimate;
create policy acc_estimate_read on acc_estimate
  for select using (acc_current_role() is not null);
drop policy if exists acc_estimate_line_read on acc_estimate_line;
create policy acc_estimate_line_read on acc_estimate_line
  for select using (acc_current_role() is not null);

-- No insert, update or delete policy: an application session writes these
-- tables only through the functions below.
revoke all on acc_estimate from public, anon;
revoke all on acc_estimate_line from public, anon;
-- Schema public hands authenticated write rights on every new table through
-- Supabase's default privileges. These tables are written only by the
-- security definer functions below, so take those rights back.
revoke insert, update, delete, truncate on acc_estimate from authenticated;
revoke insert, update, delete, truncate on acc_estimate_line from authenticated;
grant select on acc_estimate to authenticated;
grant select on acc_estimate_line to authenticated;
grant all on acc_estimate to service_role;
grant all on acc_estimate_line to service_role;

-- ----------------------------------------------------------------------------
-- 5. The EST- sequence and its place in the Number Sequence report
-- ----------------------------------------------------------------------------
insert into acc_sequence (key, prefix, next_value)
values ('estimate', 'EST-', 1)
on conflict (key) do nothing;

insert into acc_number_source
  (sequence_key, label, table_name, number_column, date_column, status_column)
values
  ('estimate', 'Estimates', 'acc_estimate', 'estimate_number', 'estimate_date', 'status')
on conflict (sequence_key) do update
  set label = excluded.label,
      table_name = excluded.table_name,
      number_column = excluded.number_column,
      date_column = excluded.date_column,
      status_column = excluded.status_column;

-- ----------------------------------------------------------------------------
-- 6. Save: create an estimate with its lines, or replace an existing one's.
--    p_estimate_id null creates; p_expiry_date null means the estimate date
--    plus 30 days. Every line is checked before anything is written, and a new
--    estimate is numbered only once all of it has passed.
--    Returns { id, estimate_number, subtotal_minor, tax_minor, total_minor }.
-- ----------------------------------------------------------------------------
create or replace function acc_save_estimate(
  p_estimate_id   uuid,
  p_customer_id   uuid,
  p_estimate_date date,
  p_expiry_date   date,
  p_currency      text,
  p_memo          text,
  p_lines         jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_est        acc_estimate;
  v_id         uuid;
  v_number     text;
  v_live       text;
  v_expiry     date;
  v_memo       text := nullif(btrim(coalesce(p_memo, '')), '');
  v_line       jsonb;
  v_n          bigint;
  v_rows       jsonb := '[]'::jsonb;
  v_quantity   numeric;
  v_unit_price bigint;
  v_account    uuid;
  v_tax_code   uuid;
  v_item       uuid;
  v_tax_rate   numeric;
  v_line_sub   bigint;
  v_line_tax   bigint;
  v_subtotal   bigint := 0;
  v_tax_total  bigint := 0;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to save estimates';
  end if;

  -- An edit locks the estimate first, so a conversion cannot slip in between
  -- this check and the save.
  if p_estimate_id is not null then
    select * into v_est from acc_estimate where id = p_estimate_id for update;
    if not found then
      raise exception 'Estimate not found';
    end if;
    select coalesce(i.invoice_number, 'a draft invoice') into v_live
      from acc_invoice i
     where i.estimate_id = p_estimate_id and i.status <> 'void'
     limit 1;
    if v_live is not null then
      raise exception '% has been turned into an invoice (%), so it can no longer be edited.',
        v_est.estimate_number, v_live;
    end if;
  end if;

  if p_customer_id is null
     or not exists (select 1 from acc_customer where id = p_customer_id and is_active) then
    raise exception 'Choose an active customer for the estimate.';
  end if;
  if p_estimate_date is null then
    raise exception 'Choose the estimate date.';
  end if;
  v_expiry := coalesce(p_expiry_date, p_estimate_date + 30);
  if v_expiry < p_estimate_date then
    raise exception 'Valid until cannot be before the estimate date.';
  end if;
  if coalesce(p_currency, 'USD') <> 'USD' then
    raise exception 'Estimates are in US dollars (USD) only.';
  end if;
  if jsonb_typeof(coalesce(p_lines, 'null'::jsonb)) <> 'array'
     or jsonb_array_length(p_lines) = 0 then
    raise exception 'An estimate needs at least one line.';
  end if;

  for v_line, v_n in
    select e.value, e.ordinality
      from jsonb_array_elements(p_lines) with ordinality as e(value, ordinality)
     order by e.ordinality
  loop
    v_quantity := round((v_line ->> 'quantity')::numeric, 4);
    v_unit_price := (v_line ->> 'unit_price_minor')::bigint;
    v_account := nullif(v_line ->> 'income_account_id', '')::uuid;
    v_tax_code := nullif(v_line ->> 'tax_code_id', '')::uuid;
    v_item := nullif(v_line ->> 'item_id', '')::uuid;

    if v_quantity is null or v_quantity <= 0 then
      raise exception 'Line %: the quantity must be more than zero.', v_n;
    end if;
    if v_unit_price is null then
      raise exception 'Line %: enter a unit price.', v_n;
    end if;
    if v_unit_price < 0 then
      raise exception 'Line %: the unit price cannot be negative.', v_n;
    end if;
    if v_account is null then
      raise exception 'Line %: choose an income account.', v_n;
    end if;
    -- The rule the invoice form applies to its account list
    -- (isSalesRevenueAccount, lib/domain/accounts.ts): a sale credits
    -- operating revenue.
    if not exists (
      select 1 from acc_account
       where id = v_account and account_type = 'income'
         and is_posting_account and status = 'active'
    ) then
      raise exception 'Line %: the account must be an active income account.', v_n;
    end if;
    v_tax_rate := 0;
    if v_tax_code is not null then
      select rate_percent into v_tax_rate
        from acc_tax_code
       where id = v_tax_code and is_active and direction = 'sales';
      if not found then
        raise exception 'Line %: the tax code must be an active sales tax code.', v_n;
      end if;
    end if;
    if v_item is not null and not exists (select 1 from acc_item where id = v_item) then
      raise exception 'Line %: the item was not found.', v_n;
    end if;

    v_line_sub := round(v_quantity * v_unit_price)::bigint;
    v_line_tax := round(v_line_sub * v_tax_rate / 100)::bigint;
    v_subtotal := v_subtotal + v_line_sub;
    v_tax_total := v_tax_total + v_line_tax;

    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'line_order', v_n - 1,
      'item_id', v_item,
      'description', coalesce(v_line ->> 'description', ''),
      'quantity', v_quantity,
      'unit_price_minor', v_unit_price,
      'income_account_id', v_account,
      'tax_code_id', v_tax_code,
      'line_subtotal_minor', v_line_sub,
      'line_tax_minor', v_line_tax,
      'line_total_minor', v_line_sub + v_line_tax));
  end loop;

  if p_estimate_id is null then
    v_number := acc_next_number('estimate');
    insert into acc_estimate
      (estimate_number, customer_id, estimate_date, expiry_date, currency_code, memo,
       subtotal_minor, tax_minor, total_minor, created_by)
    values
      (v_number, p_customer_id, p_estimate_date, v_expiry, 'USD', v_memo,
       v_subtotal, v_tax_total, v_subtotal + v_tax_total, auth.uid())
    returning id into v_id;
  else
    v_id := p_estimate_id;
    v_number := v_est.estimate_number;
    update acc_estimate
       set customer_id = p_customer_id,
           estimate_date = p_estimate_date,
           expiry_date = v_expiry,
           memo = v_memo,
           subtotal_minor = v_subtotal,
           tax_minor = v_tax_total,
           total_minor = v_subtotal + v_tax_total,
           updated_at = now()
     where id = v_id;
    delete from acc_estimate_line where estimate_id = v_id;
  end if;

  insert into acc_estimate_line
    (estimate_id, line_order, item_id, description, quantity, unit_price_minor,
     income_account_id, tax_code_id, line_subtotal_minor, line_tax_minor, line_total_minor)
  select v_id, r.line_order, r.item_id, r.description, r.quantity, r.unit_price_minor,
         r.income_account_id, r.tax_code_id, r.line_subtotal_minor, r.line_tax_minor,
         r.line_total_minor
    from jsonb_to_recordset(v_rows) as r(
      line_order int, item_id uuid, description text, quantity numeric,
      unit_price_minor bigint, income_account_id uuid, tax_code_id uuid,
      line_subtotal_minor bigint, line_tax_minor bigint, line_total_minor bigint);

  return jsonb_build_object(
    'id', v_id,
    'estimate_number', v_number,
    'subtotal_minor', v_subtotal,
    'tax_minor', v_tax_total,
    'total_minor', v_subtotal + v_tax_total);
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. Mark declined (p_declined true) or reopen (false). Declining twice keeps
--    the first time it was declined.
--    Returns { id, estimate_number, declined_at }.
-- ----------------------------------------------------------------------------
create or replace function acc_set_estimate_declined(p_estimate_id uuid, p_declined boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_est      acc_estimate;
  v_live     text;
  v_declined timestamptz;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to change estimates';
  end if;
  if p_declined is null then
    raise exception 'Say whether the estimate is declined or reopened.';
  end if;

  select * into v_est from acc_estimate where id = p_estimate_id for update;
  if not found then
    raise exception 'Estimate not found';
  end if;
  select coalesce(i.invoice_number, 'a draft invoice') into v_live
    from acc_invoice i
   where i.estimate_id = p_estimate_id and i.status <> 'void'
   limit 1;
  if v_live is not null then
    if p_declined then
      raise exception '% has been turned into an invoice (%), so it cannot be marked declined.',
        v_est.estimate_number, v_live;
    end if;
    raise exception '% has been turned into an invoice (%), so it cannot be reopened.',
      v_est.estimate_number, v_live;
  end if;

  v_declined := case when p_declined then coalesce(v_est.declined_at, now()) end;
  if v_declined is distinct from v_est.declined_at then
    update acc_estimate
       set declined_at = v_declined,
           status = case when v_declined is null then 'open' else 'declined' end,
           updated_at = now()
     where id = p_estimate_id;
  end if;

  return jsonb_build_object(
    'id', p_estimate_id,
    'estimate_number', v_est.estimate_number,
    'declined_at', v_declined);
end;
$$;

-- ----------------------------------------------------------------------------
-- 8. Delete an estimate and its lines. Refused once any invoice, void or not,
--    has been made from it: that history stays, and declining is the way to
--    set the estimate aside.
--    Returns { id, estimate_number }.
-- ----------------------------------------------------------------------------
create or replace function acc_delete_estimate(p_estimate_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_est    acc_estimate;
  v_live   text;
  v_prefix text;
  v_digits text;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to delete estimates';
  end if;

  select * into v_est from acc_estimate where id = p_estimate_id for update;
  if not found then
    raise exception 'Estimate not found';
  end if;
  select coalesce(i.invoice_number, 'a draft invoice') into v_live
    from acc_invoice i
   where i.estimate_id = p_estimate_id and i.status <> 'void'
   limit 1;
  if v_live is not null then
    raise exception '% has been turned into an invoice (%), so it cannot be deleted.',
      v_est.estimate_number, v_live;
  end if;
  if exists (select 1 from acc_invoice i where i.estimate_id = p_estimate_id) then
    raise exception '% has had an invoice made from it. Mark it declined instead.',
      v_est.estimate_number;
  end if;

  -- Account for the number before the row that holds it goes.
  select prefix into v_prefix from acc_sequence where key = 'estimate';
  if v_prefix is not null and left(v_est.estimate_number, length(v_prefix)) = v_prefix then
    v_digits := substring(v_est.estimate_number from length(v_prefix) + 1);
    if v_digits ~ '^[0-9]{1,18}$' then
      if v_digits::bigint > 0 then
        insert into acc_number_gap_note (sequence_key, number_value, reason, noted_by)
        values ('estimate', v_digits::bigint,
                'Estimate ' || v_est.estimate_number
                || ' was deleted. An estimate is not in the books, so nothing else changed.',
                auth.uid())
        on conflict (sequence_key, number_value) do nothing;
      end if;
    end if;
  end if;

  delete from acc_estimate where id = p_estimate_id;

  return jsonb_build_object('id', p_estimate_id, 'estimate_number', v_est.estimate_number);
end;
$$;

-- ----------------------------------------------------------------------------
-- 9. Turn an estimate into a draft invoice, in one transaction. The fields and
--    lines are the New invoice form's, which may differ from the estimate's;
--    only the customer must match. Returns the new invoice's id.
-- ----------------------------------------------------------------------------
create or replace function acc_create_invoice_from_estimate(
  p_estimate_id uuid,
  p_customer_id uuid,
  p_issue_date  date,
  p_due_date    date,
  p_currency    text,
  p_memo        text,
  p_lines       jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_est      acc_estimate;
  v_live     text;
  v_customer text;
  v_invoice  uuid;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to create invoices';
  end if;

  -- 1. Lock the estimate. A second conversion waits here, then sees the first.
  select * into v_est from acc_estimate where id = p_estimate_id for update;
  if not found then
    raise exception 'Estimate not found';
  end if;

  -- 2. Declined.
  if v_est.declined_at is not null then
    raise exception '% is marked declined. Reopen it before turning it into an invoice.',
      v_est.estimate_number;
  end if;

  -- 3. Already turned into an invoice that is not void.
  select coalesce(i.invoice_number, 'a draft invoice') into v_live
    from acc_invoice i
   where i.estimate_id = p_estimate_id and i.status <> 'void'
   limit 1;
  if v_live is not null then
    raise exception '% has already been turned into an invoice (%).',
      v_est.estimate_number, v_live;
  end if;

  -- 4. The same customer.
  if p_customer_id is distinct from v_est.customer_id then
    select c.name into v_customer from acc_customer c where c.id = v_est.customer_id;
    raise exception '% is for %. The invoice made from it must be for the same customer.',
      v_est.estimate_number, v_customer;
  end if;

  -- 5. The draft, through the function every invoice draft goes through.
  v_invoice := acc_create_draft_invoice(
    p_customer_id, p_issue_date, p_due_date, p_currency, p_memo, p_lines);

  -- 6. The link. acc_invoice_estimate_live_uq is the last word on "one".
  update acc_invoice set estimate_id = p_estimate_id where id = v_invoice;

  return v_invoice;
end;
$$;

-- ----------------------------------------------------------------------------
-- 10. Who may call them
-- ----------------------------------------------------------------------------
revoke all on function acc_save_estimate(uuid, uuid, date, date, text, text, jsonb) from public, anon;
revoke all on function acc_set_estimate_declined(uuid, boolean) from public, anon;
revoke all on function acc_delete_estimate(uuid) from public, anon;
revoke all on function acc_create_invoice_from_estimate(uuid, uuid, date, date, text, text, jsonb) from public, anon;
grant execute on function acc_save_estimate(uuid, uuid, date, date, text, text, jsonb) to authenticated, service_role;
grant execute on function acc_set_estimate_declined(uuid, boolean) to authenticated, service_role;
grant execute on function acc_delete_estimate(uuid) to authenticated, service_role;
grant execute on function acc_create_invoice_from_estimate(uuid, uuid, date, date, text, text, jsonb) to authenticated, service_role;
```

- [ ] **Step 4: Create `ctyhp-accounting/scripts/verify-estimates.mjs`** with exactly this content:

```js
/**
 * Behavioural verification of migration 0141 (Estimates) on every company.
 *
 * Every schema gets ONE short transaction that is ALWAYS rolled back, with
 * lock_timeout and statement_timeout set. 0141 is applied inside it (retargeted
 * to the schema, as scripts/migrate.mjs does), so nothing is left behind.
 *
 *  - In every schema: structure only. The tables, columns, checks, indexes,
 *    policies, grants, triggers, the EST- sequence and its registry row, and
 *    the four functions, read in one query.
 *  - In co_pc (the sample company) only: the behaviour. Estimates are saved,
 *    edited, declined, reopened, turned into invoices, voided and deleted there,
 *    for invented customers and tax codes, on dates in 2099. Nothing posts.
 *
 * 0141 adds a column to acc_invoice, which takes that table's strongest lock
 * until the transaction ends. The migration is therefore sent in one round trip
 * and the structure read in one more, so a real company's invoices are held
 * for as little time as possible. The behaviour, which takes longer, runs only
 * on the sample company.
 *
 * Prints counts and pass/fail lines only.
 *
 * Run alone, never beside another database script:
 *   node --env-file=.env.local scripts/verify-estimates.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0141_estimates.sql";
const MIGRATION = readFileSync(new URL(`../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const SAMPLE = "co_pc";
const OUTSIDER = "00000000-0000-0000-0000-000000000000";
const FUNCTIONS = [
  "acc_save_estimate(uuid,uuid,date,date,text,text,jsonb)",
  "acc_set_estimate_declined(uuid,boolean)",
  "acc_delete_estimate(uuid)",
  "acc_create_invoice_from_estimate(uuid,uuid,date,date,text,text,jsonb)",
];

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const killer = setTimeout(() => {
  console.error("HARD TIMEOUT");
  process.exit(2);
}, 5 * 60 * 1000);
await client.connect();

const totals = [];
let passed = 0;
let failed = 0;
function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}
const one = async (sql, params) => (await client.query(sql, params)).rows[0];
const all = async (sql, params) => (await client.query(sql, params)).rows;
const as = (userId) =>
  client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
/** Runs `sql`, expecting a refusal holding `expect`; the savepoint puts everything back as it was. */
async function refused(label, sql, params, expect) {
  await client.query("savepoint refusal");
  try {
    await client.query(sql, params);
    check(label, false, "it was accepted");
  } catch (error) {
    check(label, expect instanceof RegExp ? expect.test(error.message) : error.message.includes(expect), error.message);
  } finally {
    await client.query("rollback to savepoint refusal");
  }
}
/** Runs `body` as the database owner, then goes back to being `userId`. */
async function asOwner(userId, body) {
  await client.query("reset role");
  try {
    return await body();
  } finally {
    await client.query("set local role authenticated");
    await as(userId);
  }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------
// Structure, in every schema: one query, so a real company's acc_invoice is
// locked for as short a time as possible.
// ---------------------------------------------------------------------------
const FACTS = `
select jsonb_build_object(
  'tables', (
    select jsonb_object_agg(c.relname, jsonb_build_object(
             'rls', c.relrowsecurity,
             'read', has_table_privilege('authenticated', c.oid, 'select'),
             'write', has_table_privilege('authenticated', c.oid, 'insert')
                   or has_table_privilege('authenticated', c.oid, 'update')
                   or has_table_privilege('authenticated', c.oid, 'delete')
                   or has_table_privilege('authenticated', c.oid, 'truncate'),
             'anon', has_table_privilege('anon', c.oid, 'select')
                  or has_table_privilege('anon', c.oid, 'insert')
                  or has_table_privilege('anon', c.oid, 'update')
                  or has_table_privilege('anon', c.oid, 'delete'),
             'service', has_table_privilege('service_role', c.oid, 'select')
                    and has_table_privilege('service_role', c.oid, 'insert')
                    and has_table_privilege('service_role', c.oid, 'update')
                    and has_table_privilege('service_role', c.oid, 'delete'),
             'columns', (select jsonb_agg(a.attname order by a.attnum)
                           from pg_attribute a
                          where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped)))
      from pg_class c
     where c.relnamespace = $1::text::regnamespace and c.relname in ('acc_estimate', 'acc_estimate_line')),
  'checks', (
    select jsonb_agg(k.conname order by k.conname)
      from pg_constraint k
     where k.conrelid = to_regclass($1::text || '.acc_estimate') and k.contype = 'c'),
  'link', (
    select jsonb_build_object('nullable', not a.attnotnull,
                              'references', k.confrelid = to_regclass($1::text || '.acc_estimate'))
      from pg_attribute a
      left join pg_constraint k
        on k.conrelid = a.attrelid and k.contype = 'f' and k.conkey = array[a.attnum]
     where a.attrelid = to_regclass($1::text || '.acc_invoice') and a.attname = 'estimate_id' and not a.attisdropped),
  'cascade', (
    select k.confdeltype::text
      from pg_constraint k
     where k.conrelid = to_regclass($1::text || '.acc_estimate_line')
       and k.confrelid = to_regclass($1::text || '.acc_estimate') and k.contype = 'f'),
  'indexes', (
    select jsonb_object_agg(c.relname, jsonb_build_object(
             'table', t.relname, 'unique', i.indisunique, 'pred', pg_get_expr(i.indpred, i.indrelid)))
      from pg_index i
      join pg_class c on c.oid = i.indexrelid
      join pg_class t on t.oid = i.indrelid
     where c.relnamespace = $1::text::regnamespace
       and c.relname in ('acc_invoice_estimate_live_uq', 'acc_invoice_estimate_idx',
                         'acc_estimate_customer_idx', 'acc_estimate_date_idx')),
  'policies', (
    select jsonb_agg(p.policyname || ':' || p.cmd order by p.policyname)
      from pg_policies p
     where p.schemaname = $1::text and p.tablename in ('acc_estimate', 'acc_estimate_line')),
  'triggers', (
    select jsonb_agg(t.tgname order by t.tgname)
      from pg_trigger t
     where t.tgrelid = to_regclass($1::text || '.acc_estimate') and not t.tgisinternal),
  'sequence', (select prefix from acc_sequence where key = 'estimate'),
  'source', (
    select jsonb_build_array(label, table_name, number_column, date_column, status_column)
      from acc_number_source where sequence_key = 'estimate'),
  'functions', (
    select jsonb_object_agg(f.sig, case when p.oid is null then null else jsonb_build_object(
             'definer', p.prosecdef,
             'path', (select s from unnest(p.proconfig) s where s like 'search_path=%'),
             'anon', has_function_privilege('anon', p.oid, 'execute'),
             'member', has_function_privilege('authenticated', p.oid, 'execute'),
             'service', has_function_privilege('service_role', p.oid, 'execute'),
             'public', exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                                where x.grantee = 0 and x.privilege_type = 'EXECUTE')) end)
      from unnest($2::text[]) as f(sig)
      left join pg_proc p on p.oid = to_regprocedure($1::text || '.' || f.sig))
) as facts`;

function structure(schema, facts) {
  const tables = facts.tables ?? {};
  const columns = {
    acc_estimate: [
      "id", "estimate_number", "customer_id", "estimate_date", "expiry_date", "currency_code", "memo",
      "subtotal_minor", "tax_minor", "total_minor", "declined_at", "status", "created_by", "created_at", "updated_by",
      "updated_at",
    ],
    acc_estimate_line: [
      "id", "estimate_id", "line_order", "item_id", "description", "quantity", "unit_price_minor",
      "income_account_id", "tax_code_id", "line_subtotal_minor", "line_tax_minor", "line_total_minor",
    ],
  };
  for (const [table, expected] of Object.entries(columns)) {
    const t = tables[table];
    check(`${table} exists with row-level security on`, Boolean(t) && t.rls === true);
    check(`${table} has its ${expected.length} columns`, Boolean(t) && same(t.columns, expected), JSON.stringify(t?.columns));
    check(`${table}: signed-in users may only read, the service role keeps everything, anon nothing`,
      Boolean(t) && t.read && !t.write && t.service && !t.anon,
      JSON.stringify(t && { read: t.read, write: t.write, service: t.service, anon: t.anon }));
  }
  check("the estimate's checks: Valid until, status held to declined_at, totals that add up, USD",
    same(facts.checks, ["acc_estimate_expiry_ck", "acc_estimate_status_ck", "acc_estimate_totals_ck", "acc_usd_currency_check"]),
    JSON.stringify(facts.checks));
  check("acc_invoice.estimate_id is nullable and references acc_estimate",
    facts.link?.nullable === true && facts.link?.references === true, JSON.stringify(facts.link));
  check("an estimate's lines go with it", facts.cascade === "c", JSON.stringify(facts.cascade));

  const idx = facts.indexes ?? {};
  const live = idx.acc_invoice_estimate_live_uq;
  check("at most one invoice that is not void per estimate (partial unique index)",
    Boolean(live) && live.table === "acc_invoice" && live.unique &&
      /estimate_id IS NOT NULL/i.test(live.pred ?? "") && /status <> 'void'/i.test(live.pred ?? ""), JSON.stringify(live));
  check("every link is indexed, void ones included",
    idx.acc_invoice_estimate_idx?.table === "acc_invoice" && !idx.acc_invoice_estimate_idx.unique, JSON.stringify(idx.acc_invoice_estimate_idx));
  check("the estimate list's customer and date indexes exist",
    idx.acc_estimate_customer_idx?.table === "acc_estimate" && idx.acc_estimate_date_idx?.table === "acc_estimate");

  check("a read policy and no write policy, on both tables",
    same(facts.policies, ["acc_estimate_line_read:SELECT", "acc_estimate_read:SELECT"]), JSON.stringify(facts.policies));
  check("the header has its actor-stamp, audit and number-guard triggers",
    same(facts.triggers, ["acc_estimate_actor_stamp", "acc_estimate_atomic_audit", "acc_estimate_number_guard"]), JSON.stringify(facts.triggers));
  check("the EST- sequence row exists", facts.sequence === "EST-", JSON.stringify(facts.sequence));
  check("the sequence is registered for the Number Sequence report, with status as its status column",
    same(facts.source, ["Estimates", "acc_estimate", "estimate_number", "estimate_date", "status"]), JSON.stringify(facts.source));

  for (const sig of FUNCTIONS) {
    const f = facts.functions?.[sig];
    check(`${sig} exists, security definer, search_path pinned to ${schema}`,
      Boolean(f) && f.definer && f.path === `search_path=${schema}`, JSON.stringify(f));
    check(`${sig} is closed to anon and public, open to signed-in users and the service role`,
      Boolean(f) && !f.anon && !f.public && f.member && f.service, JSON.stringify(f));
  }
}

// ---------------------------------------------------------------------------
// Behaviour, in the sample company only
// ---------------------------------------------------------------------------
async function behaviour() {
  const admin = await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`);
  const income = await one(
    `select id from acc_account where account_type = 'income' and is_posting_account and status = 'active' order by account_code limit 1`,
  );
  const expense = await one(
    `select id from acc_account where account_type = 'expense' and is_posting_account and status = 'active' order by account_code limit 1`,
  );
  if (!admin || !income || !expense) {
    console.log("  (no active administrator, income account or expense account; behaviour checks skipped)");
    return;
  }

  // Invented customers and tax codes, made as the owner inside this rolled-back transaction.
  await as(admin.id);
  const stamp = Date.now();
  const customerA = (await one(`insert into acc_customer (name) values ('Verify Estimate Customer A') returning id`)).id;
  const customerB = (await one(`insert into acc_customer (name) values ('Verify Estimate Customer B') returning id`)).id;
  const salesTax = (await one(
    `insert into acc_tax_code (code, name, rate_percent, direction) values ($1, 'Verify estimate sales tax', 8.25, 'sales') returning id`,
    [`VERIFY-EST-S-${stamp}`],
  )).id;
  const purchaseTax = (await one(
    `insert into acc_tax_code (code, name, rate_percent, direction) values ($1, 'Verify estimate purchase tax', 5, 'purchase') returning id`,
    [`VERIFY-EST-P-${stamp}`],
  )).id;
  await client.query("set local role authenticated");
  await as(admin.id);

  const SAVE = `select acc_save_estimate($1, $2, $3::date, $4::date, 'USD', $5, $6::jsonb) as r`;
  const DECLINE = `select acc_set_estimate_declined($1, $2) as r`;
  const DELETE = `select acc_delete_estimate($1) as r`;
  const CONVERT = `select acc_create_invoice_from_estimate($1, $2, $3::date, $4::date, 'USD', $5, $6::jsonb) as id`;
  const save = (id, customer, date, expiry, memo, lines) =>
    one(SAVE, [id, customer, date, expiry, memo, JSON.stringify(lines)]).then((x) => x.r);
  const decline = (id, declined) => one(DECLINE, [id, declined]).then((x) => x.r);
  const convert = (id, customer, lines, memo = "Verify invoice from an estimate") =>
    one(CONVERT, [id, customer, "2099-01-15", "2099-02-14", memo, JSON.stringify(lines)]).then((x) => x.id);
  const line = (quantity, price, tax = null, description = "Verify estimate line") => ({
    description, quantity, unit_price_minor: price, income_account_id: income.id, tax_code_id: tax, item_id: null,
  });
  const header = (id) =>
    one(
      `select estimate_number, customer_id, estimate_date::text as estimate_date, expiry_date::text as expiry_date,
              memo, currency_code, subtotal_minor::text as sub, tax_minor::text as tax, total_minor::text as total,
              declined_at is not null as declined, status, created_by
         from acc_estimate where id = $1`,
      [id],
    );
  const LINE_FIELDS = `description, quantity::text as quantity, unit_price_minor::text as price, income_account_id,
                       tax_code_id, item_id, line_subtotal_minor::text as sub, line_tax_minor::text as tax,
                       line_total_minor::text as total`;
  const estimateLines = (id) =>
    all(`select id, line_order, ${LINE_FIELDS} from acc_estimate_line where estimate_id = $1 order by line_order`, [id]);
  /** The estimate's lines as the New invoice form would hand them over. */
  const asForm = async (id) =>
    (await one(
      `select jsonb_agg(jsonb_build_object('description', description, 'quantity', quantity,
                'unit_price_minor', unit_price_minor, 'income_account_id', income_account_id,
                'tax_code_id', tax_code_id, 'item_id', item_id) order by line_order) as lines
         from acc_estimate_line where estimate_id = $1`,
      [id],
    )).lines;
  const nextValue = () =>
    asOwner(admin.id, async () => Number((await one(`select next_value::text as v from acc_sequence where key = 'estimate'`)).v));
  const liveInvoices = async (id) =>
    (await one(`select count(*)::int as n from acc_invoice where estimate_id = $1 and status <> 'void'`, [id])).n;
  const auditRows = (id, action) =>
    asOwner(admin.id, async () =>
      (await one(`select count(*)::int as n from acc_audit_log where table_name = 'acc_estimate' and record_id = $1 and action = $2`, [id, action])).n);

  // ---- 1. save
  console.log("  saving");
  const start = await nextValue();
  const threeLines = [line(2, 12345, salesTax), line(1.5, 1000), line(1, 200, salesTax)];
  const first = await save(null, customerA, "2099-01-10", null, "  Verify note printed at the foot  ", threeLines);
  const num = first.estimate_number;
  check("a new estimate is numbered from the EST- sequence", num === `EST-${String(start).padStart(6, "0")}`);
  check("…and the sequence moves on by one", (await nextValue()) === start + 1);
  check("the totals are worked out line by line with the invoice's rounding (8.25% on 24,690 and on 200)",
    Number(first.subtotal_minor) === 26390 && Number(first.tax_minor) === 2054 && Number(first.total_minor) === 28444,
    JSON.stringify([first.subtotal_minor, first.tax_minor, first.total_minor]));
  let h = await header(first.id);
  check("the stored header holds the same totals", h.sub === "26390" && h.tax === "2054" && h.total === "28444");
  check("Valid until defaults to the estimate date plus 30 days", h.expiry_date === "2099-02-09", h.expiry_date);
  check("the note is kept, trimmed; USD; created by the person saving", h.memo === "Verify note printed at the foot" &&
    h.currency_code === "USD" && h.created_by === admin.id && h.customer_id === customerA && !h.declined);
  check("a new estimate's status is open", h.status === "open", h.status);
  const savedLines = await estimateLines(first.id);
  check("the lines are stored in order with their amounts and tax",
    same(savedLines.map((l) => [l.line_order, l.quantity, l.sub, l.tax, l.total]), [
      [0, "2.0000", "24690", "2037", "26727"],
      [1, "1.5000", "1500", "0", "1500"],
      [2, "1.0000", "200", "17", "217"],
    ]), JSON.stringify(savedLines.map((l) => [l.line_order, l.quantity, l.sub, l.tax, l.total])));
  check("creating the estimate is in the audit trail, for recent activity", (await auditRows(first.id, "insert")) === 1);

  // ---- 2. edit
  console.log("  editing");
  const oldIds = savedLines.map((l) => l.id);
  const edited = await save(first.id, customerA, "2099-01-10", "2099-03-01", "Verify note, edited", [line(4, 2500, salesTax, "Verify edited line")]);
  check("an edit keeps the id and the number", edited.id === first.id && edited.estimate_number === num);
  check("…takes no new number", (await nextValue()) === start + 1);
  const editedLines = await estimateLines(first.id);
  check("…replaces the lines",
    editedLines.length === 1 && editedLines[0].description === "Verify edited line" && !oldIds.includes(editedLines[0].id));
  check("…and works the totals out again",
    Number(edited.subtotal_minor) === 10000 && Number(edited.tax_minor) === 825 && Number(edited.total_minor) === 10825);
  h = await header(first.id);
  check("…keeping the Valid until it was given", h.expiry_date === "2099-03-01" && h.memo === "Verify note, edited");

  console.log("  refusals on save");
  const saveArgs = (lines, overrides = {}) => {
    const a = { id: null, customer: customerA, date: "2099-01-10", expiry: null, ...overrides };
    return [a.id, a.customer, a.date, a.expiry, null, JSON.stringify(lines)];
  };
  await refused("Valid until before the estimate date", SAVE, saveArgs([line(1, 100)], { expiry: "2099-01-09" }),
    "Valid until cannot be before the estimate date.");
  await refused("no lines", SAVE, saveArgs([]), "An estimate needs at least one line.");
  await refused("a quantity of zero", SAVE, saveArgs([line(0, 100)]), "Line 1: the quantity must be more than zero.");
  await refused("a negative unit price", SAVE, saveArgs([line(1, 100), line(1, -1)]), "Line 2: the unit price cannot be negative.");
  await refused("an account that is not income", SAVE, saveArgs([{ ...line(1, 100), income_account_id: expense.id }]),
    "Line 1: the account must be an active income account.");
  await refused("a purchase tax code", SAVE, saveArgs([line(1, 100, purchaseTax)]), "Line 1: the tax code must be an active sales tax code.");
  await refused("an unknown customer", SAVE, saveArgs([line(1, 100)], { customer: OUTSIDER }), "Choose an active customer for the estimate.");
  await refused("an unknown estimate", SAVE, saveArgs([line(1, 100)], { id: OUTSIDER }), "Estimate not found");
  check("…and no refusal took a number", (await nextValue()) === start + 1);

  // ---- 3. decline and reopen
  console.log("  declining and reopening");
  const declined = await decline(first.id, true);
  check("marking declined sets the time and names the estimate", declined.declined_at !== null && declined.estimate_number === num);
  check("…and its status reads declined", (await header(first.id)).status === "declined");
  const updatesBefore = await auditRows(first.id, "update");
  await decline(first.id, true);
  check("declining again changes nothing", (await auditRows(first.id, "update")) === updatesBefore);
  const whileDeclined = await save(first.id, customerA, "2099-01-10", null, null, threeLines);
  h = await header(first.id);
  check("a declined estimate can still be edited, and stays declined",
    Number(whileDeclined.total_minor) === 28444 && h.declined && h.expiry_date === "2099-02-09");
  await refused("a declined estimate cannot be turned into an invoice", CONVERT,
    [first.id, customerA, "2099-01-15", "2099-02-14", null, JSON.stringify(threeLines)],
    `${num} is marked declined. Reopen it before turning it into an invoice.`);
  const reopened = await decline(first.id, false);
  h = await header(first.id);
  check("reopening clears it, and its status reads open again", reopened.declined_at === null && !h.declined && h.status === "open");
  await client.query("reset role");
  await refused("the status cannot drift from declined_at, even for the owner",
    `update acc_estimate set status = 'declined' where id = $1`, [first.id], "acc_estimate_status_ck");
  await client.query("set local role authenticated");
  await as(admin.id);

  // ---- 4. convert
  console.log("  turning it into an invoice");
  const form = await asForm(first.id);
  const invoiceId = await convert(first.id, customerA, form);
  const inv = await one(
    `select status::text as status, customer_id, estimate_id, invoice_number, created_by,
            subtotal_minor::text as sub, tax_total_minor::text as tax, total_minor::text as total,
            balance_due_minor::text as due
       from acc_invoice where id = $1`,
    [invoiceId],
  );
  h = await header(first.id);
  check("a draft invoice is made, linked to the estimate, with no number yet",
    inv.status === "draft" && inv.estimate_id === first.id && inv.invoice_number === null, JSON.stringify([inv.status, inv.invoice_number]));
  check("…for the estimate's customer, by the person converting it", inv.customer_id === customerA && inv.created_by === admin.id);
  check("…with the estimate's subtotal, tax and total",
    inv.sub === h.sub && inv.tax === h.tax && inv.total === h.total && inv.due === h.total, JSON.stringify([inv.sub, inv.tax, inv.total]));
  const invoiceLines = await all(`select ${LINE_FIELDS} from acc_invoice_line where invoice_id = $1 order by line_order`, [invoiceId]);
  const fromEstimate = await all(`select ${LINE_FIELDS} from acc_estimate_line where estimate_id = $1 order by line_order`, [first.id]);
  check("…and the estimate's lines, field for field", invoiceLines.length === 3 && same(invoiceLines, fromEstimate));
  check("the estimate now has one live invoice", (await liveInvoices(first.id)) === 1);

  // ---- 5. a second conversion
  await refused("a second conversion is refused, naming the draft", CONVERT,
    [first.id, customerA, "2099-01-15", "2099-02-14", null, JSON.stringify(form)],
    `${num} has already been turned into an invoice (a draft invoice).`);
  await client.query("savepoint numbered");
  // Issuing would post; the number is set as the owner instead, to see the refusal name it.
  await asOwner(admin.id, () => client.query(`update acc_invoice set invoice_number = 'INV-VERIFY-EST' where id = $1`, [invoiceId]));
  await refused("…and names the invoice once it has a number", CONVERT,
    [first.id, customerA, "2099-01-15", "2099-02-14", null, JSON.stringify(form)],
    `${num} has already been turned into an invoice (INV-VERIFY-EST).`);
  await client.query("rollback to savepoint numbered");
  const other = (await one(
    `select acc_create_draft_invoice($1, '2099-01-15'::date, '2099-02-14'::date, 'USD', null, $2::jsonb) as id`,
    [customerA, JSON.stringify([line(1, 100)])],
  )).id;
  await refused("the index refuses a second live invoice on one estimate", `update acc_invoice set estimate_id = $1 where id = $2`,
    [first.id, other], "acc_invoice_estimate_live_uq");

  // ---- 6. converted locks the estimate
  console.log("  converted locks it");
  await refused("an edit is refused", SAVE, [first.id, customerA, "2099-01-10", null, null, JSON.stringify(threeLines)],
    `${num} has been turned into an invoice (a draft invoice), so it can no longer be edited.`);
  await refused("declining is refused", DECLINE, [first.id, true],
    `${num} has been turned into an invoice (a draft invoice), so it cannot be marked declined.`);
  await refused("reopening is refused", DECLINE, [first.id, false],
    `${num} has been turned into an invoice (a draft invoice), so it cannot be reopened.`);
  await refused("deleting is refused", DELETE, [first.id],
    `${num} has been turned into an invoice (a draft invoice), so it cannot be deleted.`);
  // A staff member, signed in, writing the tables directly instead of through the functions.
  await refused("a staff member cannot insert into acc_estimate directly",
    `insert into acc_estimate (estimate_number, customer_id, estimate_date, expiry_date) values ('EST-DIRECT', $1, '2099-01-01', '2099-01-02')`,
    [customerA], "permission denied");
  await refused("…nor update it directly", `update acc_estimate set memo = 'Verify direct write' where id = $1`, [first.id],
    "permission denied");
  await refused("…nor delete it directly", `delete from acc_estimate where id = $1`, [first.id], "permission denied");
  await refused("…nor write its lines directly", `delete from acc_estimate_line where estimate_id = $1`, [first.id],
    "permission denied");
  // Were direct writes ever opened up again, the number guard would still hold.
  await client.query("savepoint opened_up");
  await asOwner(admin.id, () =>
    client.query(`grant update, delete on acc_estimate to authenticated;
                  create policy acc_estimate_verify_open on acc_estimate for all using (true) with check (true)`));
  await refused("…and behind that, the number guard stops a direct delete", `delete from acc_estimate where id = $1`, [first.id],
    "has been numbered and cannot be deleted");
  await refused("…and a direct change of number", `update acc_estimate set estimate_number = 'EST-999999' where id = $1`, [first.id],
    "cannot be changed");
  await client.query("rollback to savepoint opened_up");

  // ---- 7. void the invoice: Open again
  console.log("  voiding the invoice");
  await one(`select acc_void_invoice($1)`, [invoiceId]);
  check("with the invoice void, no live invoice is linked: the estimate reads Open", (await liveInvoices(first.id)) === 0);
  check("…the void invoice keeps its link",
    (await one(`select estimate_id from acc_invoice where id = $1`, [invoiceId])).estimate_id === first.id);
  const reEdited = await save(first.id, customerA, "2099-01-10", null, "Verify note after the void", threeLines);
  check("…it can be edited again", reEdited.estimate_number === num);
  const declinedAgain = await decline(first.id, true);
  await decline(first.id, false);
  check("…declined and reopened again", declinedAgain.declined_at !== null);
  const secondInvoice = await convert(first.id, customerA, await asForm(first.id));
  check("…and turned into an invoice again", secondInvoice !== invoiceId && (await liveInvoices(first.id)) === 1);

  // ---- 8. delete
  console.log("  deleting");
  await one(`select acc_void_invoice($1)`, [secondInvoice]);
  await refused("an estimate that has had an invoice cannot be deleted", DELETE, [first.id],
    `${num} has had an invoice made from it. Mark it declined instead.`);
  const fresh = await save(null, customerA, "2099-01-20", null, null, [line(1, 5000), line(2, 75, salesTax)]);
  const gone = await one(DELETE, [fresh.id]).then((x) => x.r);
  check("a fresh estimate deletes, and says which", gone.estimate_number === fresh.estimate_number);
  check("…with its lines",
    (await one(`select (select count(*) from acc_estimate where id = $1)::int + (select count(*) from acc_estimate_line where estimate_id = $1)::int as n`,
      [fresh.id])).n === 0);
  const noted = await asOwner(admin.id, () =>
    one(`select reason from acc_number_gap_note where sequence_key = 'estimate' and number_value = $1`,
      [Number(fresh.estimate_number.slice("EST-".length))]));
  check("…and its number is written to the gap notes, so the Number Sequence report adds up",
    Boolean(noted) && noted.reason.includes(fresh.estimate_number));
  check("…and the delete is in the audit trail", (await auditRows(fresh.id, "delete")) === 1);
  const catalog = await one(`select label, prefix from acc_sequence_catalog() where sequence_key = 'estimate'`);
  const reportStatus = async () => {
    const documents = await all(`select number_value::text as n, document_status from acc_sequence_documents('estimate')`);
    return new Map(documents.map((d) => [Number(d.n), d.document_status]));
  };
  let statuses = await reportStatus();
  check("the Number Sequence report lists estimates, without the deleted one",
    catalog?.label === "Estimates" && catalog?.prefix === "EST-" &&
      statuses.has(Number(num.slice(4))) && !statuses.has(Number(fresh.estimate_number.slice(4))),
    JSON.stringify(catalog));
  check("…and its Status reads open", statuses.get(Number(num.slice(4))) === "open", String(statuses.get(Number(num.slice(4)))));
  await decline(first.id, true);
  statuses = await reportStatus();
  check("…or declined, never a raw time", statuses.get(Number(num.slice(4))) === "declined", String(statuses.get(Number(num.slice(4)))));
  await decline(first.id, false);
  await refused("an unknown estimate cannot be deleted", DELETE, [OUTSIDER], "Estimate not found");

  // ---- 9. another customer
  console.log("  another customer");
  const third = await save(null, customerA, "2099-02-01", null, null, [line(1, 700)]);
  await refused("an invoice for another customer is refused", CONVERT,
    [third.id, customerB, "2099-02-02", "2099-03-04", null, JSON.stringify(await asForm(third.id))],
    `${third.estimate_number} is for Verify Estimate Customer A. The invoice made from it must be for the same customer.`);
  check("…and nothing was made", (await liveInvoices(third.id)) === 0);
  await refused("an unknown estimate cannot be turned into an invoice", CONVERT,
    [OUTSIDER, customerA, "2099-02-02", "2099-03-04", null, JSON.stringify([line(1, 700)])], "Estimate not found");

  // ---- 10. who may
  console.log("  who may");
  // A viewer made out of the administrator inside this rolled-back transaction.
  await client.query("savepoint as_viewer");
  await asOwner(admin.id, () => client.query(`update acc_app_user set role = 'viewer' where id = $1`, [admin.id]));
  check("a viewer can read estimates", (await one(`select count(*)::int as n from acc_estimate where id = $1`, [third.id])).n === 1);
  await refused("a viewer cannot save", SAVE, saveArgs([line(1, 100)]), "Not authorized to save estimates");
  await refused("a viewer cannot decline", DECLINE, [third.id, true], "Not authorized to change estimates");
  await refused("a viewer cannot delete", DELETE, [third.id], "Not authorized to delete estimates");
  await refused("a viewer cannot turn one into an invoice", CONVERT,
    [third.id, customerA, "2099-02-02", "2099-03-04", null, JSON.stringify([line(1, 700)])], "Not authorized to create invoices");
  await refused("a viewer cannot write the table directly",
    `insert into acc_estimate (estimate_number, customer_id, estimate_date, expiry_date) values ('EST-VIEWER', $1, '2099-01-01', '2099-01-02')`,
    [customerA], "permission denied");
  await client.query("rollback to savepoint as_viewer");
  await as(OUTSIDER);
  check("an outsider reads no estimates", (await one(`select count(*)::int as n from acc_estimate`)).n === 0);
  await refused("an outsider cannot save", SAVE, saveArgs([line(1, 100)]), "Not authorized");
  await refused("an outsider cannot turn one into an invoice", CONVERT,
    [third.id, customerA, "2099-02-02", "2099-03-04", null, JSON.stringify([line(1, 700)])], "Not authorized");
  await as(admin.id);
}

// ---------------------------------------------------------------------------
const { rows: companies } = await client.query(
  `select schema_name from onebook.company where status = 'active' order by display_order, schema_name`,
);

try {
  for (const { schema_name: schema } of companies) {
    console.log(`\n${schema}`);
    const before = { passed, failed };
    await client.query("begin");
    try {
      await client.query("set local lock_timeout = '3s'");
      await client.query("set local statement_timeout = '60s'");
      await client.query(`set local search_path = ${schema}, extensions`);
      // One round trip each. A newline before every semicolon, so a statement
      // ending in a line comment cannot swallow the next one.
      const sql = schema === "public"
        ? MIGRATION
        : planCompanySchema([{ file: FILE, sql: MIGRATION }], schema).statements.join("\n;\n");
      await client.query(sql);
      console.log("  (0141 applied inside the transaction, never committed)");
      await client.query(sql);
      check("applying 0141 a second time is harmless", true);
      await client.query(`set local search_path = ${schema}, extensions`);
      const { facts } = await one(FACTS, [schema, FUNCTIONS]);
      structure(schema, facts);
      if (schema === SAMPLE) await behaviour();
    } catch (error) {
      failed += 1;
      console.log(`  FAIL ${schema} stopped: ${error.message}`);
    } finally {
      await client.query("rollback");
    }
    totals.push({ schema, passed: passed - before.passed, failed: failed - before.failed });
  }
} finally {
  clearTimeout(killer);
  await client.end();
}
console.log("");
for (const t of totals) console.log(`${t.schema}: ${t.passed} passed, ${t.failed} failed`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 5: Edit `ctyhp-accounting/package.json`** — apply this 1 find/replace edit (its find string occurs exactly once):

Edit 1 of 1 — find:

```json
    "verify:stock-count": "node --env-file=.env.local scripts/verify-stock-count.mjs",
    "verify:balance-entries": "node --env-file=.env.local scripts/verify-balance-entries.mjs"
  },
```

replace with:

```json
    "verify:stock-count": "node --env-file=.env.local scripts/verify-stock-count.mjs",
    "verify:balance-entries": "node --env-file=.env.local scripts/verify-balance-entries.mjs",
    "verify:estimates": "node --env-file=.env.local scripts/verify-estimates.mjs"
  },
```

- [ ] **Step 6: Edit `ctyhp-accounting/lib/domain/company-export.ts`** — apply this 1 find/replace edit (its find string occurs exactly once):

Edit 1 of 1 — find:

```ts
  "acc_1099_box",
  "acc_invoice",
```

replace with:

```ts
  "acc_1099_box",
  // Estimates (0141): a customer, items, income accounts and tax codes; the
  // invoice made from one points back at it, so they come before acc_invoice.
  "acc_estimate",
  "acc_estimate_line",
  "acc_invoice",
```

- [ ] **Step 7: Do not touch the database**

Migration 0141 is already live on all six companies (the controller applied it with the user's approval). Do not run `scripts/migrate.mjs`, `provision-company`, `npm run verify:estimates` or anything else that connects to the database. The controller runs the verification script alone in Task 5.

- [ ] **Step 8: Run the gates**

Run from `ctyhp-accounting/` and read the pass/fail lines in full (never pipe through `tail`/`head`):

```bash
npx tsc --noEmit -p .
npx eslint "tests/unit/estimates-migration.test.ts" "lib/domain/company-export.ts"
npx vitest run tests/unit/estimates-migration.test.ts tests/unit/migration-grants.test.ts tests/unit/schema-template.test.ts tests/unit/company-export.test.ts tests/unit/company-export-order.test.ts tests/unit/backup-restore.test.ts
```

Expected: tsc exits 0 with no output; eslint reports 0 errors and 0 warnings for these files; estimates-migration: 66 tests passing; migration-grants (39), schema-template (27), company-export (21), company-export-order (4) and backup-restore (46) pass.

- [ ] **Step 9: Commit**

```bash
git add "ctyhp-accounting/tests/unit/estimates-migration.test.ts" "ctyhp-accounting/supabase/migrations/0141_estimates.sql" "ctyhp-accounting/scripts/verify-estimates.mjs" "ctyhp-accounting/package.json" "ctyhp-accounting/lib/domain/company-export.ts"
git commit -m "feat(estimates): estimates and the link to the invoice made from one (migration 0141)"
```

Stage by file name only (never `git add -A` / `git add .`). No Co-Authored-By trailer; no mention of Claude or AI in the message.

---

### Task 2: The estimate's states, its printable model, services and actions, and the invoice made from one

**Files:**
- Test (create): `ctyhp-accounting/tests/unit/estimates.test.ts`
- Test (create): `ctyhp-accounting/tests/unit/estimate-document.test.ts`
- Test (create): `ctyhp-accounting/tests/unit/estimates-service.test.ts`
- Test (create): `ctyhp-accounting/tests/unit/estimates-actions.test.ts`
- Test (modify): `ctyhp-accounting/tests/unit/detail-reads-one-request.test.ts`
- Modify: `ctyhp-accounting/lib/db/types.ts`
- Modify: `ctyhp-accounting/lib/domain/schemas.ts`
- Modify: `ctyhp-accounting/lib/domain/invoice-document.ts`
- Create: `ctyhp-accounting/lib/domain/estimates.ts`
- Create: `ctyhp-accounting/lib/domain/estimate-document.ts`
- Create: `ctyhp-accounting/lib/services/estimates.ts`
- Modify: `ctyhp-accounting/lib/services/invoicing.ts`
- Modify: `ctyhp-accounting/lib/services/dashboard.ts`
- Create: `ctyhp-accounting/app/(app)/estimates/actions.ts`
- Modify: `ctyhp-accounting/app/(app)/invoices/actions.ts`

**Interfaces:**
- Consumes: Task 1's four functions and tables; existing `computeInvoiceLine` / `sumInvoiceTotals` (`lib/domain/money`), `toMinorUnits`, `addIsoDays`, `readAllPages`, the actions' `guard` / `canWrite`, `invoiceLineInputSchema`.
- Produces:
  - `lib/domain/estimates.ts` (pure): `EstimateState`, `estimateState`, `defaultExpiryDate`, `estimateActions`, the filter pills and labels, the message helpers (saved, deleted, declined, reopened, deleteConfirm, deleteRefused, alreadyConverted, declinedCannotConvert, expiredConfirm, invoiceCreated, fromEstimate), the form-line mapping, live totals, `estimateToInvoicePrefill`, `estimateConversionHref`, `InvoiceFormFromEstimate`, `invoiceFormFromEstimate`.
  - `lib/domain/estimate-document.ts`: `buildEstimateDocument`, the closing line, the file name. `lib/domain/invoice-document.ts` shares its seller, bill-to, lines and totals helpers and exports `PrintedDocument`; the invoice output is unchanged.
  - `lib/services/estimates.ts`: paged reads and the four RPCs; `getInvoiceEstimate` / `InvoiceEstimateLink` in `lib/services/invoicing.ts`.
  - `app/(app)/estimates/actions.ts` (list, detail, document, save, decline, reopen, delete, prefill); `createInvoiceAction` routes on `estimateId`; `getInvoiceDetailAction` returns `estimate`.
  - Schemas `estimateLineInputSchema`, `estimateIdSchema`, `estimateSaveSchema`, `invoiceCreateWithEstimateSchema`; types `EstimateRow`, `EstimateLineRow`; `acc_estimate` in recent activity.

- [ ] **Step 1: Create `ctyhp-accounting/tests/unit/estimates.test.ts`** with exactly this content:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ESTIMATE_FILTERS,
  ESTIMATE_STATES,
  ESTIMATE_STATE_LABELS,
  countEstimatesByFilter,
  defaultExpiryDate,
  estimateActions,
  estimateInFilter,
  estimateLineToFormLine,
  estimateMessages,
  estimateState,
  estimateStateOf,
  estimateToInvoicePrefill,
  formLineToLineInput,
  formLinesTotals,
  type EstimateLineValues,
  type EstimateState,
} from "@/lib/domain/estimates";
import { computeInvoiceLine, sumInvoiceTotals } from "@/lib/domain/money";
import { invoiceLineInputSchema } from "@/lib/domain/schemas";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/0141_estimates.sql"),
  "utf8",
);

const ACCOUNT = "0f6b3c8e-1111-4111-8111-000000000001";
const TAX = "0f6b3c8e-2222-4222-8222-000000000002";
const ITEM = "0f6b3c8e-3333-4333-8333-000000000003";

describe("estimateState", () => {
  const base = { declinedAt: null, expiryDate: "2026-11-11", hasLiveInvoice: false };

  it("is Open before the expiry date", () => {
    expect(estimateState(base, "2026-10-12")).toBe("open");
  });

  it("is still Open on the expiry day itself", () => {
    expect(estimateState(base, "2026-11-11")).toBe("open");
  });

  it("is Expired from the day after the expiry date", () => {
    expect(estimateState(base, "2026-11-12")).toBe("expired");
  });

  it("expires across a year end", () => {
    expect(estimateState({ ...base, expiryDate: "2026-12-31" }, "2026-12-31")).toBe("open");
    expect(estimateState({ ...base, expiryDate: "2026-12-31" }, "2027-01-01")).toBe("expired");
  });

  it("is Declined when declined, before or after the expiry date: Declined wins over Expired", () => {
    const declined = { ...base, declinedAt: "2026-10-20T15:04:00+00:00" };
    expect(estimateState(declined, "2026-10-21")).toBe("declined");
    expect(estimateState(declined, "2026-12-01")).toBe("declined");
  });

  it("is Converted when a live invoice was made from it, whatever else is true", () => {
    expect(estimateState({ ...base, hasLiveInvoice: true }, "2026-10-12")).toBe("converted");
    expect(estimateState({ ...base, hasLiveInvoice: true }, "2027-06-01")).toBe("converted");
    expect(
      estimateState({ ...base, hasLiveInvoice: true, declinedAt: "2026-10-20T15:04:00+00:00" }, "2027-06-01"),
    ).toBe("converted");
  });

  it("reads Open again once the invoice made from it is voided (no live invoice left)", () => {
    // A voided invoice keeps its link, but the list reports no live invoice.
    expect(estimateState({ ...base, hasLiveInvoice: false }, "2026-10-12")).toBe("open");
  });

  it("refuses a timestamp for today, which would move the expiry day a day early", () => {
    // "2026-11-11" < "2026-11-11T05:00:00.000Z" as strings: the trap this guards.
    expect(() => estimateState(base, "2026-11-11T05:00:00.000Z")).toThrow(/YYYY-MM-DD/);
  });

  it("refuses a date that is not on the calendar", () => {
    expect(() => estimateState(base, "2026-02-30")).toThrow(/YYYY-MM-DD/);
    expect(() => estimateState({ ...base, expiryDate: "11/11/2026" }, "2026-10-12")).toThrow(/YYYY-MM-DD/);
  });
});

describe("estimateStateOf", () => {
  it("reads the state straight off a list row", () => {
    const row = { declined_at: null, expiry_date: "2026-10-01", live_invoice: null };
    expect(estimateStateOf(row, "2026-10-02")).toBe("expired");
    expect(estimateStateOf({ ...row, live_invoice: { id: "x" } }, "2026-10-02")).toBe("converted");
    expect(estimateStateOf({ ...row, declined_at: "2026-09-30T10:00:00+00:00" }, "2026-10-02")).toBe("declined");
  });
});

describe("defaultExpiryDate", () => {
  it.each([
    ["2026-10-12", "2026-11-11"],
    ["2026-01-31", "2026-03-02"],
    ["2026-02-01", "2026-03-03"],
    ["2028-02-01", "2028-03-02"],
    ["2026-12-15", "2027-01-14"],
  ])("is %s plus 30 days: %s", (date, expected) => {
    expect(defaultExpiryDate(date)).toBe(expected);
  });

  it("refuses anything that is not a calendar date", () => {
    expect(() => defaultExpiryDate("2026-13-01")).toThrow(/YYYY-MM-DD/);
    expect(() => defaultExpiryDate("")).toThrow(/YYYY-MM-DD/);
  });
});

describe("estimateActions", () => {
  it("follows the spec's table for someone who can write", () => {
    expect(estimateActions("open", true)).toEqual({
      edit: true, convert: true, confirmConvert: false, decline: true, reopen: false, delete: true, pdf: true,
    });
    expect(estimateActions("expired", true)).toEqual({
      edit: true, convert: true, confirmConvert: true, decline: true, reopen: false, delete: true, pdf: true,
    });
    expect(estimateActions("declined", true)).toEqual({
      edit: true, convert: false, confirmConvert: false, decline: false, reopen: true, delete: true, pdf: true,
    });
    expect(estimateActions("converted", true)).toEqual({
      edit: false, convert: false, confirmConvert: false, decline: false, reopen: false, delete: false, pdf: true,
    });
  });

  it("leaves a read-only role the PDF and nothing else, in every state", () => {
    for (const state of ESTIMATE_STATES) {
      expect(estimateActions(state, false)).toEqual({
        edit: false, convert: false, confirmConvert: false, decline: false, reopen: false, delete: false, pdf: true,
      });
    }
  });

  it("offers delete whenever it is not converted", () => {
    for (const state of ESTIMATE_STATES) {
      expect(estimateActions(state, true).delete).toBe(state !== "converted");
    }
  });

  it("asks before converting only an expired estimate", () => {
    for (const state of ESTIMATE_STATES) {
      expect(estimateActions(state, true).confirmConvert).toBe(state === "expired");
    }
  });
});

describe("labels and filter pills", () => {
  it("labels every state", () => {
    expect(ESTIMATE_STATE_LABELS).toEqual({
      open: "Open",
      expired: "Expired",
      declined: "Declined",
      converted: "Converted",
    });
  });

  it("offers the pills All, Open, Expired, Declined, Converted, in that order", () => {
    expect(ESTIMATE_FILTERS.map((pill) => pill.label)).toEqual([
      "All", "Open", "Expired", "Declined", "Converted",
    ]);
    expect(ESTIMATE_FILTERS.map((pill) => pill.key)).toEqual([
      "all", "open", "expired", "declined", "converted",
    ]);
  });

  it("counts each pill, and All counts every estimate", () => {
    const states: EstimateState[] = ["open", "open", "expired", "converted", "declined", "open"];
    expect(countEstimatesByFilter(states)).toEqual({
      all: 6, open: 3, expired: 1, declined: 1, converted: 1,
    });
    expect(countEstimatesByFilter([])).toEqual({ all: 0, open: 0, expired: 0, declined: 0, converted: 0 });
  });

  it("keeps a row in All and in its own state's pill only", () => {
    expect(estimateInFilter("expired", "all")).toBe(true);
    expect(estimateInFilter("expired", "expired")).toBe(true);
    expect(estimateInFilter("expired", "open")).toBe(false);
  });
});

describe("estimateMessages", () => {
  it("says exactly what the spec says", () => {
    expect(estimateMessages.deleteConfirm("EST-000001")).toBe(
      "Delete EST-000001? It is not in the books, so nothing else changes.",
    );
    expect(estimateMessages.deleteRefused("EST-000001")).toBe(
      "EST-000001 has had an invoice made from it. Mark it declined instead.",
    );
    expect(estimateMessages.alreadyConverted("EST-000001", "INV-000123")).toBe(
      "EST-000001 has already been turned into an invoice (INV-000123).",
    );
    expect(estimateMessages.alreadyConverted("EST-000001", null)).toBe(
      "EST-000001 has already been turned into an invoice (a draft invoice).",
    );
    expect(estimateMessages.declined("EST-000001")).toBe("EST-000001 marked declined.");
    expect(estimateMessages.reopened("EST-000001")).toBe("EST-000001 reopened.");
    expect(estimateMessages.expiredConfirm("EST-000001", "2026-10-01")).toBe(
      "EST-000001 expired on 2026-10-01. Turn it into an invoice anyway?",
    );
    expect(estimateMessages.fromEstimate("EST-000001")).toBe("From estimate EST-000001");
    expect(estimateMessages.invoiceCreated("EST-000001")).toBe(
      "Draft invoice created from EST-000001. Check it over, then issue it.",
    );
  });

  it("uses the database's own words for the refusals both sides can give", () => {
    // Postgres fills each % in order; "%" in, "%" out shows the templates are equal.
    expect(migration).toContain(`'${estimateMessages.deleteRefused("%")}'`);
    expect(migration).toContain(`'${estimateMessages.alreadyConverted("%", "%")}'`);
    expect(migration).toContain(`'${estimateMessages.declinedCannotConvert("%")}'`);
    expect(migration).toContain("coalesce(i.invoice_number, 'a draft invoice')");
  });
});

const storedLines: EstimateLineValues[] = [
  {
    line_order: 1,
    item_id: null,
    description: "Install brass shelf brackets",
    quantity: 2.5,
    unit_price_minor: 4_250,
    income_account_id: ACCOUNT,
    tax_code_id: null,
  },
  {
    line_order: 0,
    item_id: ITEM,
    description: "Walnut shelf, 90 cm",
    quantity: 3,
    unit_price_minor: 1_999,
    income_account_id: ACCOUNT,
    tax_code_id: TAX,
  },
];

describe("estimateToInvoicePrefill", () => {
  const estimate = {
    id: "0f6b3c8e-4444-4444-8444-000000000004",
    estimate_number: "EST-000007",
    customer_id: "0f6b3c8e-5555-4555-8555-000000000005",
    declined_at: null,
    live_invoice: null,
  };

  it("fills the customer and every line, in the estimate's order, with the price in dollars", () => {
    expect(estimateToInvoicePrefill(estimate, storedLines)).toEqual({
      estimateId: estimate.id,
      estimateNumber: "EST-000007",
      values: {
        customer_id: estimate.customer_id,
        lines: [
          {
            item_id: ITEM,
            description: "Walnut shelf, 90 cm",
            quantity: 3,
            unit_price: 19.99,
            income_account_id: ACCOUNT,
            tax_code_id: TAX,
          },
          {
            item_id: null,
            description: "Install brass shelf brackets",
            quantity: 2.5,
            unit_price: 42.5,
            income_account_id: ACCOUNT,
            tax_code_id: null,
          },
        ],
      },
      blocked: null,
    });
  });

  it("loses nothing: the form submits exactly the lines the estimate stores", () => {
    const prefill = estimateToInvoicePrefill(estimate, storedLines);
    const submitted = prefill.values.lines.map(formLineToLineInput);
    expect(submitted).toEqual([
      {
        description: "Walnut shelf, 90 cm",
        quantity: 3,
        unit_price_minor: 1_999,
        income_account_id: ACCOUNT,
        tax_code_id: TAX,
        item_id: ITEM,
      },
      {
        description: "Install brass shelf brackets",
        quantity: 2.5,
        unit_price_minor: 4_250,
        income_account_id: ACCOUNT,
        tax_code_id: null,
        item_id: null,
      },
    ]);
    for (const line of submitted) {
      expect(invoiceLineInputSchema.safeParse(line).success).toBe(true);
    }
  });

  it("brings every whole-cent price back to the same cents", () => {
    for (let cents = 0; cents <= 250_000; cents += 1) {
      const form = estimateLineToFormLine({ ...storedLines[0], unit_price_minor: cents });
      if (formLineToLineInput(form).unit_price_minor !== cents) {
        throw new Error(`${cents} cents came back as ${formLineToLineInput(form).unit_price_minor}`);
      }
    }
  });

  it("says why instead when the estimate has already become an invoice", () => {
    const issued = { ...estimate, live_invoice: { invoice_number: "INV-000123" } };
    expect(estimateToInvoicePrefill(issued, storedLines).blocked).toBe(
      "EST-000007 has already been turned into an invoice (INV-000123).",
    );
    const draft = { ...estimate, live_invoice: { invoice_number: null } };
    expect(estimateToInvoicePrefill(draft, storedLines).blocked).toBe(
      "EST-000007 has already been turned into an invoice (a draft invoice).",
    );
  });

  it("says why instead when the estimate is declined", () => {
    const declined = { ...estimate, declined_at: "2026-10-20T15:04:00+00:00" };
    expect(estimateToInvoicePrefill(declined, storedLines).blocked).toBe(
      "EST-000007 is marked declined. Reopen it before turning it into an invoice.",
    );
  });
});

describe("formLinesTotals", () => {
  const rates: Record<string, number> = { [TAX]: 6.25 };
  const rateOf = (id: string | null | undefined) => (id ? rates[id] ?? 0 : 0);

  it("works out subtotal, sales tax and total as the invoice does", () => {
    // 3 × $19.99 = $59.97; 6.25% of 5,997 cents = 374.8125, rounded to 375.
    expect(
      formLinesTotals(
        [{ quantity: 3, unit_price: 19.99, tax_code_id: TAX, income_account_id: ACCOUNT }],
        rateOf,
      ),
    ).toEqual({ subtotalMinor: 5_997, taxTotalMinor: 375, totalMinor: 6_372 });
  });

  it("rounds each line before adding the lines up, not the total", () => {
    // Each line: 1,001 cents, tax 62.5625 → 63. Two lines: 126, where rounding
    // the total instead would give 125.
    const line = { quantity: 1, unit_price: 10.01, tax_code_id: TAX };
    expect(formLinesTotals([line, line], rateOf)).toEqual({
      subtotalMinor: 2_002,
      taxTotalMinor: 126,
      totalMinor: 2_128,
    });
  });

  it("matches the invoice helpers line for line, fractional quantities included", () => {
    const lines = [
      { quantity: 2.5, unit_price: 10.01, tax_code_id: TAX },
      { quantity: 0.333, unit_price: 7.77, tax_code_id: null },
    ];
    const expected = sumInvoiceTotals([
      computeInvoiceLine({ quantity: 2.5, unitPriceMinor: 1_001, taxRatePercent: 6.25 }),
      computeInvoiceLine({ quantity: 0.333, unitPriceMinor: 777, taxRatePercent: 0 }),
    ]);
    expect(formLinesTotals(lines, rateOf)).toEqual(expected);
    expect(expected.subtotalMinor).toBe(2_503 + 259);
  });

  it("leaves out lines the form has not finished: no quantity, a negative price, an empty row", () => {
    expect(
      formLinesTotals(
        [
          undefined,
          null,
          { quantity: 0, unit_price: 50 },
          { quantity: 1, unit_price: -5 },
          { quantity: 2, unit_price: 12.5 },
        ],
        rateOf,
      ),
    ).toEqual({ subtotalMinor: 2_500, taxTotalMinor: 0, totalMinor: 2_500 });
  });

  it("is zero for an empty form", () => {
    expect(formLinesTotals([], rateOf)).toEqual({ subtotalMinor: 0, taxTotalMinor: 0, totalMinor: 0 });
  });
});
```

- [ ] **Step 2: Create `ctyhp-accounting/tests/unit/estimate-document.test.ts`** with exactly this content:

```ts
import { describe, expect, it } from "vitest";
import {
  ESTIMATE_CLOSING_LINE,
  buildEstimateDocument,
  estimateDocumentFileName,
  type EstimateDocumentSource,
} from "@/lib/domain/estimate-document";
import { buildInvoiceDocument } from "@/lib/domain/invoice-document";

const company = {
  legal_name: "Larkspur Joinery LLC",
  dba_name: "Larkspur Woodworks",
  address_line1: "41 Example Avenue",
  address_line2: null,
  city: "Springfield",
  region: "OR",
  postal_code: "97477",
  country: "United States",
  ein_ref: "00-0000000",
};

const customer = {
  name: "Marisol Ortega",
  email: "marisol@example.com",
  contact_name: null,
  phone: "+1 555 0100",
  address_line1: "7 Sample Lane",
  address_line2: "Unit 2",
  city: "Eugene",
  region: "OR",
  postal_code: "97401",
  country: null,
};

// 3 × $19.99 = $59.97 at 6.25% → $3.75 tax; 2.5 × $42.50 = $106.25 untaxed.
const source: EstimateDocumentSource = {
  estimate: {
    estimate_number: "EST-000001",
    estimate_date: "2026-10-12",
    expiry_date: "2026-11-11",
    currency_code: "USD",
    subtotal_minor: 16_622,
    tax_minor: 375,
    total_minor: 16_997,
    memo: "  Prices hold for 30 days. Delivery within two weeks of acceptance.  ",
  },
  lines: [
    {
      line_order: 1,
      description: "Install brass shelf brackets",
      quantity: 2.5,
      unit_price_minor: 4_250,
      line_subtotal_minor: 10_625,
      line_tax_minor: 0,
      line_total_minor: 10_625,
    },
    {
      line_order: 0,
      description: "Walnut shelf, 90 cm",
      quantity: 3,
      unit_price_minor: 1_999,
      line_subtotal_minor: 5_997,
      line_tax_minor: 375,
      line_total_minor: 6_372,
    },
  ],
  customer,
  company,
};

describe("buildEstimateDocument", () => {
  it("titles the estimate with its number", () => {
    expect(buildEstimateDocument(source).title).toBe("Estimate EST-000001");
  });

  it("shows the estimate date and Valid until", () => {
    expect(buildEstimateDocument(source).meta).toEqual([
      { label: "Estimate date", value: "2026-10-12" },
      { label: "Valid until", value: "2026-11-11" },
    ]);
  });

  it("lists description, quantity, unit price and amount, in line order", () => {
    expect(buildEstimateDocument(source).lines).toEqual([
      { description: "Walnut shelf, 90 cm", quantity: "3", unitPrice: "$19.99", amount: "$59.97" },
      { description: "Install brass shelf brackets", quantity: "2.5", unitPrice: "$42.50", amount: "$106.25" },
    ]);
  });

  it("totals Subtotal, Sales tax and Total, with nothing paid or due", () => {
    expect(buildEstimateDocument(source).totals).toEqual([
      { label: "Subtotal", amount: "$166.22" },
      { label: "Sales tax", amount: "$3.75" },
      { label: "Total", amount: "$169.97" },
    ]);
  });

  it("leaves out a zero Sales tax row, as the invoice does", () => {
    const untaxed = buildEstimateDocument({
      ...source,
      estimate: { ...source.estimate, subtotal_minor: 10_625, tax_minor: 0, total_minor: 10_625 },
      lines: [source.lines[0]],
    });
    expect(untaxed.totals.map((total) => total.label)).toEqual(["Subtotal", "Total"]);
  });

  it("prints the note, then always the closing line", () => {
    const doc = buildEstimateDocument(source);
    expect(doc.memo).toBe("Prices hold for 30 days. Delivery within two weeks of acceptance.");
    expect(doc.footer).toBe("This is a quotation, not an invoice. Nothing is owed on it.");
    expect(ESTIMATE_CLOSING_LINE).toBe(doc.footer);
  });

  it("keeps the closing line when there is no note", () => {
    const doc = buildEstimateDocument({ ...source, estimate: { ...source.estimate, memo: "   " } });
    expect(doc.memo).toBeNull();
    expect(doc.footer).toBe(ESTIMATE_CLOSING_LINE);
  });

  it("names the file after the number and the customer", () => {
    expect(buildEstimateDocument(source).fileName).toBe("Estimate EST-000001 Marisol Ortega.pdf");
  });

  it("is never watermarked", () => {
    expect(buildEstimateDocument(source).watermark).toBeNull();
  });

  it("prints the seller and bill-to blocks exactly as the invoice does", () => {
    const invoice = buildInvoiceDocument({
      invoice: {
        invoice_number: "INV-000001",
        issue_date: "2026-10-12",
        due_date: null,
        currency_code: "USD",
        subtotal_minor: 16_622,
        tax_total_minor: 375,
        total_minor: 16_997,
        balance_due_minor: 16_997,
        status: "issued",
        memo: null,
      },
      lines: source.lines,
      customer,
      company,
    });
    const estimate = buildEstimateDocument(source);
    expect(estimate.seller).toEqual(invoice.seller);
    expect(estimate.billTo).toEqual(invoice.billTo);
    expect(estimate.seller).toEqual({
      displayName: "Larkspur Woodworks",
      legalLine: "Larkspur Joinery LLC",
      lines: ["41 Example Avenue", "Springfield, OR 97477", "United States"],
    });
    expect(estimate.billTo).toEqual({
      name: "Marisol Ortega",
      lines: ["7 Sample Lane", "Unit 2", "Eugene, OR 97401", "+1 555 0100", "marisol@example.com"],
    });
  });

  it("never prints the employer identification number", () => {
    expect(JSON.stringify(buildEstimateDocument(source))).not.toContain("00-0000000");
  });

  it("refuses to print lines that do not add up to the total", () => {
    expect(() =>
      buildEstimateDocument({ ...source, estimate: { ...source.estimate, total_minor: 16_998 } }),
    ).toThrow("Estimate line total 16997 does not match the estimate total 16998");
  });
});

describe("estimateDocumentFileName", () => {
  it("drops characters a file system refuses from the customer's name", () => {
    expect(estimateDocumentFileName("EST-000042", "Rivera / Sons: Cabinets?")).toBe(
      "Estimate EST-000042 Rivera Sons Cabinets.pdf",
    );
    expect(estimateDocumentFileName("EST-000042", 'A<b>c|d*e"f\\g')).toBe("Estimate EST-000042 A b c d e f g.pdf");
  });

  it("collapses runs of spaces and trims", () => {
    expect(estimateDocumentFileName("EST-000042", "  Two   Spaces  ")).toBe(
      "Estimate EST-000042 Two Spaces.pdf",
    );
  });

  it("keeps just the number when the name has nothing printable", () => {
    expect(estimateDocumentFileName("EST-000042", " / ")).toBe("Estimate EST-000042.pdf");
  });
});
```

- [ ] **Step 3: Create `ctyhp-accounting/tests/unit/estimates-service.test.ts`** with exactly this content:

```ts
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/services/access", () => ({ searchAudit: vi.fn() }));

import {
  EstimatesError,
  createInvoiceFromEstimate,
  deleteEstimate,
  getEstimateDetail,
  getEstimateDocumentSource,
  getEstimateInvoicePrefill,
  listEstimates,
  liveInvoiceOf,
  saveEstimate,
  setEstimateDeclined,
  type EstimateLinkedInvoice,
} from "@/lib/services/estimates";
import { InvoicingError, createDraftInvoice, getInvoiceEstimate } from "@/lib/services/invoicing";
import { describeAuditActivity } from "@/lib/services/dashboard";
import { estimateSaveSchema, invoiceCreateSchema } from "@/lib/domain/schemas";

/**
 * A stub client that answers the way PostgREST does: `.range(from, to)` is
 * inclusive at both ends, `.eq` filters, and an embedded resource is already
 * inside each row. Every select, order, range and RPC call is recorded.
 */
type Row = Record<string, unknown>;

interface World {
  tables: Record<string, Row[]>;
  /** A table whose reads fail. */
  fail?: string;
  rpc?: Record<string, { data?: unknown; error?: { message: string } }>;
}

interface Calls {
  selects: { table: string; columns: string }[];
  orders: { table: string; column: string; ascending: boolean | undefined }[];
  ranges: Record<string, [number, number][]>;
  rpc: { name: string; args: Record<string, unknown> }[];
}

function stubClient(world: World): { sb: SupabaseClient; calls: Calls } {
  const calls: Calls = { selects: [], orders: [], ranges: {}, rpc: [] };
  const sb = {
    from(table: string) {
      const eqs: Record<string, unknown> = {};
      const rows = () =>
        (world.tables[table] ?? []).filter((row) =>
          Object.entries(eqs).every(([column, value]) => row[column] === value),
        );
      const failure = () =>
        world.fail === table ? { data: null, error: { message: `${table} is unreachable` } } : null;
      const builder: Record<string, unknown> = {
        select(columns: string) {
          calls.selects.push({ table, columns });
          return builder;
        },
        eq(column: string, value: unknown) {
          eqs[column] = value;
          return builder;
        },
        order(column: string, options?: { ascending?: boolean }) {
          calls.orders.push({ table, column, ascending: options?.ascending });
          return builder;
        },
        limit: () => builder,
        async range(from: number, to: number) {
          (calls.ranges[table] ??= []).push([from, to]);
          return failure() ?? { data: rows().slice(from, to + 1), error: null };
        },
        async maybeSingle() {
          return failure() ?? { data: rows()[0] ?? null, error: null };
        },
        async single() {
          const found = rows()[0];
          return failure() ?? (found ? { data: found, error: null } : { data: null, error: { message: "no rows" } });
        },
      };
      return builder;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.rpc.push({ name, args });
      const answer = world.rpc?.[name] ?? {};
      return { data: answer.data ?? null, error: answer.error ?? null };
    },
  };
  return { sb: sb as unknown as SupabaseClient, calls };
}

const CUSTOMER = "8d1f0a52-0000-4000-8000-0000000000c1";
const ACCOUNT = "8d1f0a52-0000-4000-8000-0000000000a1";
const TAX = "8d1f0a52-0000-4000-8000-0000000000e1";

function estimateRow(n: number, extra: Row = {}): Row {
  return {
    id: `est-${n}`,
    estimate_number: `EST-${String(n).padStart(6, "0")}`,
    customer_id: CUSTOMER,
    estimate_date: "2026-10-01",
    expiry_date: "2026-10-31",
    currency_code: "USD",
    memo: null,
    subtotal_minor: 10_000,
    tax_minor: 625,
    total_minor: 10_625,
    declined_at: null,
    status: "open",
    created_by: null,
    created_at: "2026-10-01T09:00:00+00:00",
    updated_by: null,
    updated_at: "2026-10-01T09:00:00+00:00",
    acc_customer: { name: "Harbor Lane Bakery" },
    acc_invoice: [],
    ...extra,
  };
}

function lineRow(estimateId: string, order: number, extra: Row = {}): Row {
  return {
    id: `${estimateId}-line-${order}`,
    estimate_id: estimateId,
    line_order: order,
    item_id: null,
    description: `Line ${order + 1}`,
    quantity: 1,
    unit_price_minor: 100,
    income_account_id: ACCOUNT,
    tax_code_id: null,
    line_subtotal_minor: 100,
    line_tax_minor: 0,
    line_total_minor: 100,
    ...extra,
  };
}

const voidInvoice: EstimateLinkedInvoice = {
  id: "inv-void",
  invoice_number: null,
  status: "void",
  issue_date: "2026-10-02",
  created_at: "2026-10-02T10:00:00+00:00",
};
const draftInvoice: EstimateLinkedInvoice = {
  id: "inv-draft",
  invoice_number: null,
  status: "draft",
  issue_date: "2026-10-05",
  created_at: "2026-10-05T10:00:00+00:00",
};
const issuedInvoice: EstimateLinkedInvoice = {
  id: "inv-issued",
  invoice_number: "INV-000123",
  status: "issued",
  issue_date: "2026-10-05",
  created_at: "2026-10-05T10:00:00+00:00",
};

describe("listEstimates", () => {
  it("pages past PostgREST's 1,000-row cap, newest first by a total order", async () => {
    const rows = Array.from({ length: 1_001 }, (_, i) => estimateRow(1_001 - i));
    const { sb, calls } = stubClient({ tables: { acc_estimate: rows } });
    const list = await listEstimates(sb);
    expect(list).toHaveLength(1_001);
    expect(calls.ranges.acc_estimate).toEqual([
      [0, 999],
      [1_000, 1_999],
    ]);
    // Date, then the unique number: no row can straddle two pages.
    expect(calls.orders.filter((o) => o.table === "acc_estimate")).toEqual([
      { table: "acc_estimate", column: "estimate_date", ascending: false },
      { table: "acc_estimate", column: "estimate_number", ascending: false },
      { table: "acc_estimate", column: "estimate_date", ascending: false },
      { table: "acc_estimate", column: "estimate_number", ascending: false },
    ]);
  });

  it("asks for the customer's name and the invoices made from each estimate", async () => {
    const { sb, calls } = stubClient({ tables: { acc_estimate: [estimateRow(1)] } });
    await listEstimates(sb);
    const columns = calls.selects.find((s) => s.table === "acc_estimate")?.columns ?? "";
    expect(columns).toContain("acc_customer(name)");
    expect(columns).toContain("acc_invoice(id,invoice_number,status");
  });

  it("carries the customer name, the totals, and the live invoice: not void", async () => {
    const { sb } = stubClient({
      tables: {
        acc_estimate: [
          estimateRow(3, { acc_invoice: [issuedInvoice, voidInvoice] }),
          estimateRow(2, { acc_invoice: [voidInvoice] }),
          estimateRow(1, { acc_customer: null }),
        ],
      },
    });
    const [converted, voidedOnly, plain] = await listEstimates(sb);
    expect(converted).toMatchObject({
      estimate_number: "EST-000003",
      customer_name: "Harbor Lane Bakery",
      subtotal_minor: 10_000,
      tax_minor: 625,
      total_minor: 10_625,
      live_invoice: issuedInvoice,
    });
    expect(converted).not.toHaveProperty("acc_invoice");
    expect(converted).not.toHaveProperty("acc_customer");
    expect(voidedOnly.live_invoice).toBeNull();
    expect(plain.customer_name).toBe("—");
    expect(plain.live_invoice).toBeNull();
  });

  it("passes a failed read through as its own error", async () => {
    const { sb } = stubClient({ tables: {}, fail: "acc_estimate" });
    await expect(listEstimates(sb)).rejects.toThrow(EstimatesError);
    await expect(listEstimates(sb)).rejects.toThrow("acc_estimate is unreachable");
  });
});

describe("liveInvoiceOf", () => {
  it("picks the one invoice that is not void, draft or issued", () => {
    expect(liveInvoiceOf([voidInvoice, draftInvoice])).toEqual(draftInvoice);
    expect(liveInvoiceOf([issuedInvoice, voidInvoice])).toEqual(issuedInvoice);
    expect(liveInvoiceOf([voidInvoice])).toBeNull();
    expect(liveInvoiceOf([])).toBeNull();
  });
});

describe("getEstimateDetail", () => {
  it("reads the header, every page of lines, and every invoice made from it, oldest first", async () => {
    const lines = Array.from({ length: 1_002 }, (_, i) => lineRow("est-9", i));
    const { sb, calls } = stubClient({
      tables: {
        acc_estimate: [estimateRow(9, { id: "est-9", acc_invoice: [draftInvoice, voidInvoice] })],
        acc_estimate_line: [...lines, lineRow("est-other", 0)],
      },
    });
    const detail = await getEstimateDetail(sb, "est-9");
    expect(detail.estimate.estimate_number).toBe("EST-000009");
    expect(detail.estimate.live_invoice).toEqual(draftInvoice);
    expect(detail.invoices.map((i) => i.id)).toEqual(["inv-void", "inv-draft"]);
    expect(detail.lines).toHaveLength(1_002);
    expect(calls.ranges.acc_estimate_line).toEqual([
      [0, 999],
      [1_000, 1_999],
    ]);
    expect(calls.orders).toContainEqual({ table: "acc_estimate_line", column: "line_order", ascending: undefined });
  });

  it("says when there is no such estimate", async () => {
    const { sb } = stubClient({ tables: { acc_estimate: [] } });
    await expect(getEstimateDetail(sb, "missing")).rejects.toThrow("Estimate not found");
  });
});

describe("getEstimateInvoicePrefill", () => {
  it("fills the New invoice form from the estimate and its lines", async () => {
    const { sb } = stubClient({
      tables: {
        acc_estimate: [estimateRow(4, { id: "est-4" })],
        acc_estimate_line: [
          lineRow("est-4", 1, { unit_price_minor: 4_250, quantity: 2.5 }),
          lineRow("est-4", 0, { unit_price_minor: 1_999, quantity: 3, tax_code_id: TAX }),
        ],
      },
    });
    const prefill = await getEstimateInvoicePrefill(sb, "est-4");
    expect(prefill).toEqual({
      estimateId: "est-4",
      estimateNumber: "EST-000004",
      values: {
        customer_id: CUSTOMER,
        lines: [
          { item_id: null, description: "Line 1", quantity: 3, unit_price: 19.99, income_account_id: ACCOUNT, tax_code_id: TAX },
          { item_id: null, description: "Line 2", quantity: 2.5, unit_price: 42.5, income_account_id: ACCOUNT, tax_code_id: null },
        ],
      },
      blocked: null,
    });
  });

  it("says why instead when a live invoice was already made from it", async () => {
    const { sb } = stubClient({
      tables: { acc_estimate: [estimateRow(4, { id: "est-4", acc_invoice: [voidInvoice, issuedInvoice] })] },
    });
    expect((await getEstimateInvoicePrefill(sb, "est-4"))?.blocked).toBe(
      "EST-000004 has already been turned into an invoice (INV-000123).",
    );
  });

  it("is null when there is no such estimate", async () => {
    const { sb } = stubClient({ tables: { acc_estimate: [] } });
    expect(await getEstimateInvoicePrefill(sb, "missing")).toBeNull();
  });
});

describe("getEstimateDocumentSource", () => {
  const settings = {
    legal_name: "Larkspur Joinery LLC",
    dba_name: null,
    address_line1: null,
    address_line2: null,
    city: null,
    region: null,
    postal_code: null,
    country: null,
  };
  const customer = {
    name: "Harbor Lane Bakery",
    email: null,
    contact_name: null,
    phone: null,
    address_line1: null,
    address_line2: null,
    city: null,
    region: null,
    postal_code: null,
    country: null,
  };

  it("reads the estimate with its customer, its lines and the company in one go", async () => {
    const { sb } = stubClient({
      tables: {
        acc_estimate: [estimateRow(5, { id: "est-5", acc_customer: customer })],
        acc_estimate_line: [lineRow("est-5", 0)],
        acc_company_setting_version: [settings],
      },
    });
    const source = await getEstimateDocumentSource(sb, "est-5");
    expect(source.customer).toEqual(customer);
    expect(source.company).toEqual(settings);
    expect(source.lines).toHaveLength(1);
    expect(source.estimate).toMatchObject({ estimate_number: "EST-000005", expiry_date: "2026-10-31" });
    expect(source.estimate).not.toHaveProperty("acc_customer");
  });

  it("refuses to print without company settings", async () => {
    const { sb } = stubClient({
      tables: { acc_estimate: [estimateRow(5, { id: "est-5", acc_customer: customer })] },
    });
    await expect(getEstimateDocumentSource(sb, "est-5")).rejects.toThrow(
      "Company settings are required before an estimate can be printed. Set them in Settings → Company.",
    );
  });
});

describe("estimate writes go through the database's functions, refusals unchanged", () => {
  const input = estimateSaveSchema.parse({
    customer_id: CUSTOMER,
    estimate_date: "2026-10-12",
    memo: "",
    lines: [{ quantity: 2, unit_price_minor: 1_500, income_account_id: ACCOUNT, tax_code_id: TAX }],
  });

  it("saves with every argument the function takes, and returns its figures", async () => {
    const { sb, calls } = stubClient({
      tables: {},
      rpc: {
        acc_save_estimate: {
          data: { id: "est-new", estimate_number: "EST-000010", subtotal_minor: 3_000, tax_minor: 188, total_minor: 3_188 },
        },
      },
    });
    const saved = await saveEstimate(sb, null, input);
    expect(saved).toEqual({
      id: "est-new",
      estimate_number: "EST-000010",
      subtotal_minor: 3_000,
      tax_minor: 188,
      total_minor: 3_188,
    });
    expect(calls.rpc).toEqual([
      {
        name: "acc_save_estimate",
        args: {
          p_estimate_id: null,
          p_customer_id: CUSTOMER,
          p_estimate_date: "2026-10-12",
          p_expiry_date: null,
          p_currency: "USD",
          p_memo: null,
          p_lines: [
            {
              description: "",
              quantity: 2,
              unit_price_minor: 1_500,
              income_account_id: ACCOUNT,
              tax_code_id: TAX,
              item_id: null,
            },
          ],
        },
      },
    ]);
  });

  it("edits by id, with the expiry date given", async () => {
    const { sb, calls } = stubClient({
      tables: {},
      rpc: { acc_save_estimate: { data: { id: "est-1", estimate_number: "EST-000001", subtotal_minor: 0, tax_minor: 0, total_minor: 0 } } },
    });
    await saveEstimate(sb, "est-1", { ...input, expiry_date: "2026-12-01" });
    expect(calls.rpc[0].args).toMatchObject({ p_estimate_id: "est-1", p_expiry_date: "2026-12-01" });
  });

  it.each([
    ["save", (sb: SupabaseClient) => saveEstimate(sb, "est-1", input), "acc_save_estimate",
      "EST-000001 has been turned into an invoice (INV-000123), so it can no longer be edited."],
    ["decline", (sb: SupabaseClient) => setEstimateDeclined(sb, "est-1", true), "acc_set_estimate_declined",
      "EST-000001 has been turned into an invoice (a draft invoice), so it cannot be marked declined."],
    ["delete", (sb: SupabaseClient) => deleteEstimate(sb, "est-1"), "acc_delete_estimate",
      "EST-000001 has had an invoice made from it. Mark it declined instead."],
    ["convert", (sb: SupabaseClient) => createInvoiceFromEstimate(sb, "est-1", invoiceCreateSchema.parse({
      customer_id: CUSTOMER, lines: [{ quantity: 1, unit_price_minor: 1, income_account_id: ACCOUNT }],
    })), "acc_create_invoice_from_estimate",
      "EST-000001 has already been turned into an invoice (INV-000123)."],
  ])("passes the database's refusal to %s through word for word", async (_name, call, rpc, words) => {
    const { sb } = stubClient({ tables: {}, rpc: { [rpc]: { error: { message: words } } } });
    const error = await call(sb).then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(EstimatesError);
    expect((error as Error).message).toBe(words);
  });

  it("declines and reopens by the flag", async () => {
    const { sb, calls } = stubClient({
      tables: {},
      rpc: { acc_set_estimate_declined: { data: { id: "est-1", estimate_number: "EST-000001", declined_at: null } } },
    });
    expect(await setEstimateDeclined(sb, "est-1", false)).toEqual({
      id: "est-1",
      estimate_number: "EST-000001",
      declined_at: null,
    });
    await setEstimateDeclined(sb, "est-1", true);
    expect(calls.rpc.map((c) => c.args)).toEqual([
      { p_estimate_id: "est-1", p_declined: false },
      { p_estimate_id: "est-1", p_declined: true },
    ]);
  });

  it("deletes by id and returns the freed number", async () => {
    const { sb, calls } = stubClient({
      tables: {},
      rpc: { acc_delete_estimate: { data: { id: "est-1", estimate_number: "EST-000001" } } },
    });
    expect(await deleteEstimate(sb, "est-1")).toEqual({ id: "est-1", estimate_number: "EST-000001" });
    expect(calls.rpc).toEqual([{ name: "acc_delete_estimate", args: { p_estimate_id: "est-1" } }]);
  });
});

describe("createInvoiceFromEstimate", () => {
  const input = invoiceCreateSchema.parse({
    customer_id: CUSTOMER,
    issue_date: "2026-10-12",
    due_date: "2026-11-11",
    memo: "Thanks",
    lines: [
      { description: "Walnut shelf", quantity: 3, unit_price_minor: 1_999, income_account_id: ACCOUNT, tax_code_id: TAX },
    ],
  });

  it("passes the invoice fields exactly as createDraftInvoice does, plus the estimate", async () => {
    const draft = stubClient({
      tables: { acc_invoice: [{ id: "inv-new" }] },
      rpc: { acc_create_draft_invoice: { data: "inv-new" } },
    });
    await createDraftInvoice(draft.sb, input);
    // Everything but the recurring run, which only a recurring schedule passes.
    const draftArgs = { ...draft.calls.rpc[0].args };
    expect(draftArgs.p_recurring_run_id).toBeNull();
    delete draftArgs.p_recurring_run_id;

    const converted = stubClient({ tables: {}, rpc: { acc_create_invoice_from_estimate: { data: "inv-new" } } });
    expect(await createInvoiceFromEstimate(converted.sb, "est-1", input)).toBe("inv-new");
    expect(converted.calls.rpc).toEqual([
      { name: "acc_create_invoice_from_estimate", args: { p_estimate_id: "est-1", ...draftArgs } },
    ]);
  });
});

describe("getInvoiceEstimate", () => {
  it("names the estimate an invoice was made from", async () => {
    const { sb, calls } = stubClient({
      tables: {
        acc_invoice: [
          { id: "inv-1", estimate_id: "est-1", acc_estimate: { id: "est-1", estimate_number: "EST-000001" } },
          { id: "inv-2", estimate_id: null, acc_estimate: null },
        ],
      },
    });
    expect(await getInvoiceEstimate(sb, "inv-1")).toEqual({ id: "est-1", estimate_number: "EST-000001" });
    expect(await getInvoiceEstimate(sb, "inv-2")).toBeNull();
    expect(await getInvoiceEstimate(sb, "inv-missing")).toBeNull();
    expect(calls.selects[0]).toEqual({ table: "acc_invoice", columns: "estimate_id,acc_estimate(id,estimate_number)" });
  });

  it("passes a failed read through as an invoicing error", async () => {
    const { sb } = stubClient({ tables: {}, fail: "acc_invoice" });
    await expect(getInvoiceEstimate(sb, "inv-1")).rejects.toThrow(InvoicingError);
  });
});

describe("dashboard recent activity", () => {
  it("reads an estimate's audit row as an Estimate, with its number, linking to /estimates", () => {
    expect(
      describeAuditActivity({
        id: "audit-9",
        table_name: "acc_estimate",
        record_id: "est-3",
        action: "insert",
        actor_id: "user-1",
        actor_email: "estimator@example.com",
        before_json: null,
        after_json: { estimate_number: "EST-000003", total_minor: 10_625 },
        created_at: "2026-10-12T09:00:00.000Z",
      }),
    ).toEqual({
      id: "audit-9",
      occurredAt: "2026-10-12T09:00:00.000Z",
      actor: "estimator@example.com",
      verb: "Created",
      entity: "Estimate",
      reference: "EST-000003",
      href: "/estimates",
      category: "sales",
    });
  });
});
```

- [ ] **Step 4: Create `ctyhp-accounting/tests/unit/estimates-actions.test.ts`** with exactly this content:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUserRole: vi.fn(),
  revalidatePath: vi.fn(),
  companyClock: vi.fn(),
  listEstimates: vi.fn(),
  getEstimateDetail: vi.fn(),
  getEstimateDocumentSource: vi.fn(),
  getEstimateInvoicePrefill: vi.fn(),
  saveEstimate: vi.fn(),
  setEstimateDeclined: vi.fn(),
  deleteEstimate: vi.fn(),
  createInvoiceFromEstimate: vi.fn(),
  createDraftInvoice: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/db/server", () => ({ createSupabaseServerClient: mocks.createClient }));
vi.mock("@/lib/auth", () => ({
  getUserRole: mocks.getUserRole,
  canWrite: (role: string | null) => role === "admin" || role === "accountant",
}));
vi.mock("@/lib/services/report-context", () => ({ companyClock: mocks.companyClock }));
vi.mock("@/lib/services/access", () => ({ searchAudit: vi.fn() }));
vi.mock("@/lib/services/settlements", () => ({ listInvoiceSettlements: vi.fn() }));
vi.mock("@/lib/services/estimates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/estimates")>()),
  listEstimates: mocks.listEstimates,
  getEstimateDetail: mocks.getEstimateDetail,
  getEstimateDocumentSource: mocks.getEstimateDocumentSource,
  getEstimateInvoicePrefill: mocks.getEstimateInvoicePrefill,
  saveEstimate: mocks.saveEstimate,
  setEstimateDeclined: mocks.setEstimateDeclined,
  deleteEstimate: mocks.deleteEstimate,
  createInvoiceFromEstimate: mocks.createInvoiceFromEstimate,
}));
vi.mock("@/lib/services/invoicing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/services/invoicing")>()),
  createDraftInvoice: mocks.createDraftInvoice,
}));

import {
  declineEstimateAction,
  deleteEstimateAction,
  getEstimateDetailAction,
  getEstimateDocumentAction,
  getEstimateInvoicePrefillAction,
  listEstimatesAction,
  reopenEstimateAction,
  saveEstimateAction,
} from "@/app/(app)/estimates/actions";
import { createInvoiceAction } from "@/app/(app)/invoices/actions";
import { EstimatesError } from "@/lib/services/estimates";
import {
  estimateIdSchema,
  estimateLineInputSchema,
  estimateSaveSchema,
  invoiceCreateSchema,
  invoiceCreateWithEstimateSchema,
  invoiceLineInputSchema,
} from "@/lib/domain/schemas";

const sb = { name: "company client" };
const DENIED = "You do not have permission to perform this action";
const EST = "3c9a7e10-0000-4000-8000-000000000001";
const CUSTOMER = "3c9a7e10-0000-4000-8000-0000000000c1";
const ACCOUNT = "3c9a7e10-0000-4000-8000-0000000000a1";

const saveInput = {
  customer_id: CUSTOMER,
  estimate_date: "2026-10-12",
  expiry_date: "2026-11-11",
  memo: "Delivery within two weeks of acceptance.",
  lines: [{ description: "Oak bench", quantity: 1, unit_price_minor: 45_000, income_account_id: ACCOUNT }],
};

const invoiceInput = {
  customer_id: CUSTOMER,
  issue_date: "2026-10-12",
  due_date: "2026-11-11",
  memo: null,
  lines: [{ description: "Oak bench", quantity: 2, unit_price_minor: 45_000, income_account_id: ACCOUNT }],
};

function row(n: number, extra: Record<string, unknown> = {}) {
  return {
    id: `est-${n}`,
    estimate_number: `EST-00000${n}`,
    expiry_date: "2026-10-31",
    declined_at: null,
    live_invoice: null,
    customer_name: "Juniper Street Studio",
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createClient.mockResolvedValue(sb);
  mocks.getUserRole.mockResolvedValue("accountant");
  mocks.companyClock.mockResolvedValue({ today: "2026-11-01", timeZone: "America/Chicago" });
});

describe("estimate schemas", () => {
  it("takes an estimate line exactly as an invoice line", () => {
    expect(estimateLineInputSchema).toBe(invoiceLineInputSchema);
  });

  it("takes a full estimate, and defaults the currency to USD", () => {
    const parsed = estimateSaveSchema.parse(saveInput);
    expect(parsed.currency_code).toBe("USD");
    expect(parsed.lines[0]).toEqual({ ...saveInput.lines[0] });
  });

  it("leaves Valid until to the database when it is not given", () => {
    expect(estimateSaveSchema.safeParse({ ...saveInput, expiry_date: null }).success).toBe(true);
    expect(estimateSaveSchema.safeParse({ ...saveInput, expiry_date: undefined }).success).toBe(true);
  });

  it("accepts Valid until on the estimate date itself", () => {
    expect(estimateSaveSchema.safeParse({ ...saveInput, expiry_date: "2026-10-12" }).success).toBe(true);
  });

  it.each([
    ["no estimate date", { estimate_date: undefined }, "Choose the estimate date."],
    ["a date not on the calendar", { estimate_date: "2026-02-30" }, "Choose the estimate date."],
    ["Valid until before the date", { expiry_date: "2026-10-11" }, "Valid until cannot be before the estimate date."],
    ["no customer", { customer_id: "" }, "Select a customer"],
    ["no lines", { lines: [] }, "Add at least one line item"],
    ["another currency", { currency_code: "EUR" }, "Only USD is supported"],
    ["a zero quantity", { lines: [{ ...saveInput.lines[0], quantity: 0 }] }, "Quantity must be greater than 0"],
  ])("refuses %s", (_name, change, message) => {
    const result = estimateSaveSchema.safeParse({ ...saveInput, ...change });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(message);
  });

  it("takes an estimate id only as a uuid", () => {
    expect(estimateIdSchema.safeParse(EST).success).toBe(true);
    expect(estimateIdSchema.safeParse("est-1").success).toBe(false);
  });

  it("validates the invoice fields the same way with or without an estimate", () => {
    const plain = invoiceCreateSchema.parse(invoiceInput);
    expect(invoiceCreateWithEstimateSchema.parse(invoiceInput)).toEqual(plain);
    expect(invoiceCreateWithEstimateSchema.parse({ ...invoiceInput, estimateId: EST })).toEqual({
      ...plain,
      estimateId: EST,
    });
    expect(invoiceCreateWithEstimateSchema.safeParse({ ...invoiceInput, estimateId: "nope" }).success).toBe(false);
  });
});

describe("guards: only writers change estimates", () => {
  beforeEach(() => mocks.getUserRole.mockResolvedValue("viewer"));

  it.each([
    ["save", () => saveEstimateAction(null, saveInput)],
    ["decline", () => declineEstimateAction(EST)],
    ["reopen", () => reopenEstimateAction(EST)],
    ["delete", () => deleteEstimateAction(EST)],
    ["the invoice prefill", () => getEstimateInvoicePrefillAction(EST)],
  ])("refuses %s to a read-only role, and touches nothing", async (_name, act) => {
    expect(await act()).toEqual({ ok: false, error: DENIED });
    for (const write of [
      mocks.saveEstimate,
      mocks.setEstimateDeclined,
      mocks.deleteEstimate,
      mocks.getEstimateInvoicePrefill,
    ]) {
      expect(write).not.toHaveBeenCalled();
    }
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("lets a read-only role see the list and print the PDF", async () => {
    mocks.listEstimates.mockResolvedValue([]);
    expect((await listEstimatesAction()).ok).toBe(true);
    mocks.getEstimateDocumentSource.mockRejectedValue(new EstimatesError("Estimate not found"));
    expect(await getEstimateDocumentAction(EST)).toEqual({ ok: false, error: "Estimate not found" });
    expect(mocks.getEstimateDocumentSource).toHaveBeenCalledWith(sb, EST);
  });
});

describe("listEstimatesAction", () => {
  it("gives each row its state on the company's today", async () => {
    mocks.listEstimates.mockResolvedValue([
      row(1),
      row(2, { expiry_date: "2026-11-01" }),
      row(3, { declined_at: "2026-10-20T10:00:00+00:00" }),
      row(4, { live_invoice: { id: "inv-1", invoice_number: null, status: "draft" } }),
    ]);
    const result = await listEstimatesAction();
    expect(result.ok).toBe(true);
    expect(result.data?.today).toBe("2026-11-01");
    expect(result.data?.estimates.map((r) => [r.estimate_number, r.state])).toEqual([
      ["EST-000001", "expired"],
      ["EST-000002", "open"],
      ["EST-000003", "declined"],
      ["EST-000004", "converted"],
    ]);
    expect(mocks.companyClock).toHaveBeenCalledWith(sb);
  });

  it("reports a failed read as an error", async () => {
    mocks.listEstimates.mockRejectedValue(new EstimatesError("acc_estimate is unreachable"));
    expect(await listEstimatesAction()).toEqual({ ok: false, error: "acc_estimate is unreachable" });
  });
});

describe("getEstimateDetailAction", () => {
  it("adds the state and the day it was worked out for", async () => {
    mocks.getEstimateDetail.mockResolvedValue({ estimate: row(1), lines: [], invoices: [] });
    const result = await getEstimateDetailAction(EST);
    expect(result).toEqual({
      ok: true,
      data: { estimate: row(1), lines: [], invoices: [], state: "expired", today: "2026-11-01" },
    });
    expect(mocks.getEstimateDetail).toHaveBeenCalledWith(sb, EST);
  });

  it("refuses an id that is not one", async () => {
    expect(await getEstimateDetailAction("est-1")).toEqual({ ok: false, error: "Estimate not found" });
    expect(mocks.getEstimateDetail).not.toHaveBeenCalled();
  });
});

describe("saveEstimateAction", () => {
  it("creates with the parsed input, and refreshes the list and the dashboard", async () => {
    const saved = { id: EST, estimate_number: "EST-000001", subtotal_minor: 45_000, tax_minor: 0, total_minor: 45_000 };
    mocks.saveEstimate.mockResolvedValue(saved);
    expect(await saveEstimateAction(null, saveInput)).toEqual({ ok: true, data: saved });
    expect(mocks.saveEstimate).toHaveBeenCalledWith(sb, null, estimateSaveSchema.parse(saveInput));
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual(["/estimates", "/dashboard"]);
  });

  it("edits by id", async () => {
    mocks.saveEstimate.mockResolvedValue({ id: EST });
    await saveEstimateAction(EST, saveInput);
    expect(mocks.saveEstimate).toHaveBeenCalledWith(sb, EST, expect.any(Object));
  });

  it("refuses invalid input with the schema's words, and saves nothing", async () => {
    expect(await saveEstimateAction(null, { ...saveInput, expiry_date: "2026-10-01" })).toEqual({
      ok: false,
      error: "Valid until cannot be before the estimate date.",
    });
    expect(await saveEstimateAction("not-an-id", saveInput)).toEqual({ ok: false, error: "Estimate not found" });
    expect(mocks.saveEstimate).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("passes the database's refusal through", async () => {
    const words = "EST-000001 has been turned into an invoice (INV-000123), so it can no longer be edited.";
    mocks.saveEstimate.mockRejectedValue(new EstimatesError(words));
    expect(await saveEstimateAction(EST, saveInput)).toEqual({ ok: false, error: words });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("declineEstimateAction and reopenEstimateAction", () => {
  it("decline sets the flag, reopen clears it", async () => {
    mocks.setEstimateDeclined.mockResolvedValue({ id: EST, estimate_number: "EST-000001", declined_at: "x" });
    expect((await declineEstimateAction(EST)).ok).toBe(true);
    expect((await reopenEstimateAction(EST)).ok).toBe(true);
    expect(mocks.setEstimateDeclined.mock.calls).toEqual([
      [sb, EST, true],
      [sb, EST, false],
    ]);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/estimates");
  });

  it("passes a refusal through", async () => {
    const words = "EST-000001 has been turned into an invoice (a draft invoice), so it cannot be marked declined.";
    mocks.setEstimateDeclined.mockRejectedValue(new EstimatesError(words));
    expect(await declineEstimateAction(EST)).toEqual({ ok: false, error: words });
  });
});

describe("deleteEstimateAction", () => {
  it("deletes and returns the number", async () => {
    mocks.deleteEstimate.mockResolvedValue({ id: EST, estimate_number: "EST-000001" });
    expect(await deleteEstimateAction(EST)).toEqual({
      ok: true,
      data: { id: EST, estimate_number: "EST-000001" },
    });
    expect(mocks.deleteEstimate).toHaveBeenCalledWith(sb, EST);
  });

  it("shows the database's words when it refuses", async () => {
    const words = "EST-000001 has had an invoice made from it. Mark it declined instead.";
    mocks.deleteEstimate.mockRejectedValue(new EstimatesError(words));
    expect(await deleteEstimateAction(EST)).toEqual({ ok: false, error: words });
  });
});

describe("getEstimateInvoicePrefillAction", () => {
  it("returns the prefill for a writer", async () => {
    const prefill = { estimateId: EST, estimateNumber: "EST-000001", values: { customer_id: CUSTOMER, lines: [] }, blocked: null };
    mocks.getEstimateInvoicePrefill.mockResolvedValue(prefill);
    expect(await getEstimateInvoicePrefillAction(EST)).toEqual({ ok: true, data: prefill });
  });

  it("says when there is no such estimate", async () => {
    mocks.getEstimateInvoicePrefill.mockResolvedValue(null);
    expect(await getEstimateInvoicePrefillAction(EST)).toEqual({ ok: false, error: "Estimate not found" });
  });
});

describe("getEstimateDocumentAction", () => {
  it("builds the printable model on the server", async () => {
    mocks.getEstimateDocumentSource.mockResolvedValue({
      estimate: {
        estimate_number: "EST-000001",
        estimate_date: "2026-10-12",
        expiry_date: "2026-11-11",
        currency_code: "USD",
        subtotal_minor: 45_000,
        tax_minor: 0,
        total_minor: 45_000,
        memo: null,
      },
      lines: [{ line_order: 0, description: "Oak bench", quantity: 1, unit_price_minor: 45_000, line_subtotal_minor: 45_000, line_tax_minor: 0, line_total_minor: 45_000 }],
      customer: { name: "Juniper Street Studio", email: null, contact_name: null, phone: null, address_line1: null, address_line2: null, city: null, region: null, postal_code: null, country: null },
      company: { legal_name: "Larkspur Joinery LLC", dba_name: null, address_line1: null, address_line2: null, city: null, region: null, postal_code: null, country: null },
    });
    const result = await getEstimateDocumentAction(EST);
    expect(result.ok).toBe(true);
    expect(result.data?.title).toBe("Estimate EST-000001");
    expect(result.data?.fileName).toBe("Estimate EST-000001 Juniper Street Studio.pdf");
  });
});

describe("createInvoiceAction routes by the estimate it carries", () => {
  it("without an estimate, makes the draft as before and refreshes only /invoices", async () => {
    mocks.createDraftInvoice.mockResolvedValue({ id: "inv-1" });
    expect(await createInvoiceAction(invoiceInput)).toEqual({ ok: true, data: { id: "inv-1" } });
    expect(mocks.createDraftInvoice).toHaveBeenCalledWith(sb, invoiceCreateSchema.parse(invoiceInput));
    expect(mocks.createInvoiceFromEstimate).not.toHaveBeenCalled();
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual(["/invoices"]);
  });

  it("treats a null estimate as none", async () => {
    mocks.createDraftInvoice.mockResolvedValue({ id: "inv-1" });
    await createInvoiceAction({ ...invoiceInput, estimateId: null });
    expect(mocks.createDraftInvoice).toHaveBeenCalledTimes(1);
    expect(mocks.createInvoiceFromEstimate).not.toHaveBeenCalled();
  });

  it("with an estimate, makes and links the draft in one call, and refreshes estimates and the dashboard too", async () => {
    mocks.createInvoiceFromEstimate.mockResolvedValue("inv-2");
    expect(await createInvoiceAction({ ...invoiceInput, estimateId: EST })).toEqual({
      ok: true,
      data: { id: "inv-2" },
    });
    // The invoice fields go through exactly as they would without the estimate.
    expect(mocks.createInvoiceFromEstimate).toHaveBeenCalledWith(sb, EST, invoiceCreateSchema.parse(invoiceInput));
    expect(mocks.createDraftInvoice).not.toHaveBeenCalled();
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      "/invoices",
      "/estimates",
      "/dashboard",
    ]);
  });

  it("validates the invoice input the same way with an estimate", async () => {
    const result = await createInvoiceAction({ ...invoiceInput, lines: [], estimateId: EST });
    expect(result).toEqual({ ok: false, error: "Add at least one line item" });
    expect(mocks.createInvoiceFromEstimate).not.toHaveBeenCalled();
  });

  it("refuses an estimate id that is not one", async () => {
    const result = await createInvoiceAction({ ...invoiceInput, estimateId: "est-1" });
    expect(result).toEqual({ ok: false, error: "The estimate this invoice is made from was not found" });
    expect(mocks.createInvoiceFromEstimate).not.toHaveBeenCalled();
    expect(mocks.createDraftInvoice).not.toHaveBeenCalled();
  });

  it("shows the database's refusal in the form", async () => {
    const words = "EST-000001 has already been turned into an invoice (a draft invoice).";
    mocks.createInvoiceFromEstimate.mockRejectedValue(new EstimatesError(words));
    expect(await createInvoiceAction({ ...invoiceInput, estimateId: EST })).toEqual({ ok: false, error: words });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("is refused to a read-only role either way", async () => {
    mocks.getUserRole.mockResolvedValue("viewer");
    expect(await createInvoiceAction({ ...invoiceInput, estimateId: EST })).toEqual({ ok: false, error: DENIED });
    expect(await createInvoiceAction(invoiceInput)).toEqual({ ok: false, error: DENIED });
    expect(mocks.createInvoiceFromEstimate).not.toHaveBeenCalled();
    expect(mocks.createDraftInvoice).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Edit `ctyhp-accounting/tests/unit/detail-reads-one-request.test.ts`** — apply these 8 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 8 — find:

```ts
  getInvoiceLines: vi.fn(),
  listInvoiceSettlements: vi.fn(),
```

replace with:

```ts
  getInvoiceLines: vi.fn(),
  getInvoiceEstimate: vi.fn(),
  listInvoiceSettlements: vi.fn(),
```

Edit 2 of 8 — find:

```ts
  getInvoiceLines: mocks.getInvoiceLines,
}));
```

replace with:

```ts
  getInvoiceLines: mocks.getInvoiceLines,
  getInvoiceEstimate: mocks.getInvoiceEstimate,
}));
```

Edit 3 of 8 — find:

```ts
    mocks.searchAudit.mockResolvedValue([{ id: "audit-1" }]);
  });
```

replace with:

```ts
    mocks.searchAudit.mockResolvedValue([{ id: "audit-1" }]);
    mocks.getInvoiceEstimate.mockResolvedValue({ id: "est-1", estimate_number: "EST-000001" });
  });
```

Edit 4 of 8 — find:

```ts

  it("reads lines, settlements and the change history on one client", async () => {
    const detail = await getInvoiceDetailAction("inv-1", true);
```

replace with:

```ts

  it("reads lines, settlements, the change history and the estimate it came from on one client", async () => {
    const detail = await getInvoiceDetailAction("inv-1", true);
```

Edit 5 of 8 — find:

```ts
    expect(mocks.listInvoiceSettlements).toHaveBeenCalledWith(sb, "inv-1");
    expect(mocks.searchAudit).toHaveBeenCalledWith(
```

replace with:

```ts
    expect(mocks.listInvoiceSettlements).toHaveBeenCalledWith(sb, "inv-1");
    expect(mocks.getInvoiceEstimate).toHaveBeenCalledWith(sb, "inv-1");
    expect(mocks.searchAudit).toHaveBeenCalledWith(
```

Edit 6 of 8 — find:

```ts
      audit: { ok: true, data: [{ id: "audit-1" }] },
    });
```

replace with:

```ts
      audit: { ok: true, data: [{ id: "audit-1" }] },
      estimate: { ok: true, data: { id: "est-1", estimate_number: "EST-000001" } },
    });
```

Edit 7 of 8 — find:

```ts
      estimate: { ok: true, data: { id: "est-1", estimate_number: "EST-000001" } },
    });
  });

```

replace with:

```ts
      estimate: { ok: true, data: { id: "est-1", estimate_number: "EST-000001" } },
    });
  });

  it("reads no estimate for an invoice not made from one, and keeps that read's failure to itself", async () => {
    mocks.getInvoiceEstimate.mockResolvedValueOnce(null);
    expect((await getInvoiceDetailAction("inv-1", false)).estimate).toEqual({ ok: true, data: null });
    mocks.getInvoiceEstimate.mockRejectedValueOnce(new Error("estimate unavailable"));
    const detail = await getInvoiceDetailAction("inv-1", false);
    expect(detail.estimate).toEqual({ ok: false, error: "estimate unavailable" });
    expect(detail.lines).toEqual({ ok: true, data: [{ id: "line-1" }] });
  });

```

Edit 8 of 8 — find:

```ts
    const failed = { ok: false, error: "This account does not belong to any company." };
    expect(detail).toEqual({ lines: failed, settlements: failed, audit: failed });
    expect(mocks.getInvoiceLines).not.toHaveBeenCalled();
```

replace with:

```ts
    const failed = { ok: false, error: "This account does not belong to any company." };
    expect(detail).toEqual({ lines: failed, settlements: failed, audit: failed, estimate: failed });
    expect(mocks.getInvoiceLines).not.toHaveBeenCalled();
```

- [ ] **Step 6: Run the tests to see them fail**

```bash
npx vitest run tests/unit/estimates.test.ts tests/unit/estimate-document.test.ts tests/unit/estimates-service.test.ts tests/unit/estimates-actions.test.ts tests/unit/detail-reads-one-request.test.ts
```

Expected: FAIL — `lib/domain/estimates.ts`, `lib/domain/estimate-document.ts` and `lib/services/estimates.ts` do not exist yet.

- [ ] **Step 7: Edit `ctyhp-accounting/lib/db/types.ts`** — apply this 1 find/replace edit (its find string occurs exactly once):

Edit 1 of 1 — find:

```ts
  item_id: string | null;
  line_subtotal_minor: number;
```

replace with:

```ts
  item_id: string | null;
  line_subtotal_minor: number;
  line_tax_minor: number;
  line_total_minor: number;
}

/**
 * A price promised to a customer (migration 0141). Not in the books: nothing
 * posts until an invoice made from it is issued. Only Declined is stored;
 * Converted and Expired are worked out when read (lib/domain/estimates.ts).
 */
export interface EstimateRow {
  id: string;
  estimate_number: string;
  customer_id: string;
  /** YYYY-MM-DD. */
  estimate_date: string;
  /** YYYY-MM-DD; "Valid until". Never before the estimate date. */
  expiry_date: string;
  currency_code: "USD";
  /** Printed at the foot. */
  memo: string | null;
  subtotal_minor: number;
  tax_minor: number;
  total_minor: number;
  declined_at: string | null;
  /** Always agrees with declined_at; kept for the Number Sequence report. */
  status: "open" | "declined";
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
}

/** The same shape as an invoice line, so turning an estimate into an invoice loses nothing. */
export interface EstimateLineRow {
  id: string;
  estimate_id: string;
  line_order: number;
  item_id: string | null;
  description: string;
  quantity: number;
  unit_price_minor: number;
  income_account_id: string;
  tax_code_id: string | null;
  line_subtotal_minor: number;
```

- [ ] **Step 8: Edit `ctyhp-accounting/lib/domain/schemas.ts`** — apply this 1 find/replace edit (its find string occurs exactly once):

Edit 1 of 1 — find:

```ts
export type InvoiceCreateInput = z.infer<typeof invoiceCreateSchema>;

```

replace with:

```ts
export type InvoiceCreateInput = z.infer<typeof invoiceCreateSchema>;

/**
 * The New invoice form's input, which may carry the estimate the form was
 * opened from. The invoice fields are validated exactly as above; with an
 * estimate, the draft is made and linked by acc_create_invoice_from_estimate.
 */
export const invoiceCreateWithEstimateSchema = invoiceCreateSchema.extend({
  estimateId: z.uuid("The estimate this invoice is made from was not found").optional().nullable(),
});

// --- Estimates ---
/** An estimate line is an invoice line, so turning an estimate into an invoice loses nothing. */
export const estimateLineInputSchema = invoiceLineInputSchema;
export type EstimateLineInput = z.infer<typeof estimateLineInputSchema>;

/** An estimate's id, for every action that names one. */
export const estimateIdSchema = z.uuid("Estimate not found");

/**
 * Create or edit an estimate. The number is the database's, assigned on the
 * first save. A missing "Valid until" means the estimate date plus 30 days,
 * which the database fills in. Amounts are worked out by the database.
 */
export const estimateSaveSchema = z
  .object({
    customer_id: z.uuid("Select a customer"),
    currency_code: usdCurrencySchema.default(USD_CURRENCY_CODE),
    estimate_date: z.iso.date("Choose the estimate date."),
    expiry_date: z.iso.date("Enter a valid Valid until date.").optional().nullable(),
    memo: z.string().trim().max(500).optional().nullable(),
    lines: z.array(estimateLineInputSchema).min(1, "Add at least one line item"),
  })
  .refine((value) => !value.expiry_date || value.expiry_date >= value.estimate_date, {
    message: "Valid until cannot be before the estimate date.",
    path: ["expiry_date"],
  });
export type EstimateSaveInput = z.infer<typeof estimateSaveSchema>;

```

- [ ] **Step 9: Replace the whole of `ctyhp-accounting/lib/domain/invoice-document.ts`** (most of it changes) with exactly this content:

```ts
/**
 * The printable form of an invoice: what a customer sees on paper.
 *
 * Pure. It turns stored minor units and raw rows into the exact strings the
 * renderer draws, so what gets printed is decided here — and tested here —
 * rather than inside a PDF library call.
 *
 * The seller block, the bill-to block, the line rows, the balance check and
 * the totals rows are shared with the estimate (lib/domain/estimate-document),
 * so the two documents print a company, a customer and a line the same way.
 */
import { USD_DECIMAL_PLACES } from "@/lib/domain/currency";
import { formatMoney } from "@/lib/format";

export interface PostalParty {
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country: string | null;
}

/** The customer a document is addressed to. */
export type DocumentCustomer = PostalParty & {
  name: string;
  email: string | null;
  contact_name: string | null;
  phone: string | null;
};

/** The company a document comes from: the current settings row. */
export type DocumentCompany = PostalParty & {
  legal_name: string;
  dba_name: string | null;
  /** Accepted so callers can pass the settings row as-is; never printed. */
  ein_ref?: string | null;
};

/** One stored line, as an invoice or an estimate keeps it. */
export interface DocumentSourceLine {
  line_order: number;
  description: string;
  quantity: number;
  unit_price_minor: number;
  line_subtotal_minor: number;
  line_tax_minor: number;
  line_total_minor: number;
}

export interface InvoiceDocumentSource {
  invoice: {
    invoice_number: string | null;
    issue_date: string;
    due_date: string | null;
    currency_code: string;
    subtotal_minor: number;
    tax_total_minor: number;
    total_minor: number;
    balance_due_minor: number;
    status: string;
    memo: string | null;
  };
  lines: DocumentSourceLine[];
  customer: DocumentCustomer;
  company: DocumentCompany;
}

export interface InvoiceDocumentLine {
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
}

export interface DocumentSeller {
  displayName: string;
  /** The legal name, shown only when it differs from the trading name. */
  legalLine: string | null;
  lines: string[];
}

export interface DocumentBillTo {
  name: string;
  lines: string[];
}

export interface DocumentTotal {
  label: string;
  amount: string;
}

/** What the shared renderer (lib/client/invoice-pdf) draws, whatever the document. */
export interface PrintedDocument {
  title: string;
  /** Drawn across the page so the copy cannot be mistaken; null for none. */
  watermark: string | null;
  seller: DocumentSeller;
  billTo: DocumentBillTo;
  meta: Array<{ label: string; value: string }>;
  lines: InvoiceDocumentLine[];
  totals: DocumentTotal[];
  memo: string | null;
}

export interface InvoiceDocument extends PrintedDocument {
  status: string;
  /** DRAFT or VOID. */
  watermark: string | null;
}

/** Address lines with every missing part dropped — no gaps, no stray commas. */
export function formatPostalAddress(party: PostalParty): string[] {
  const cityLine = [party.city, [party.region, party.postal_code].filter(Boolean).join(" ")]
    .filter((part) => part && part.trim())
    .join(", ");
  return [party.address_line1, party.address_line2, cityLine, party.country]
    .map((line) => line?.trim() ?? "")
    .filter((line) => line.length > 0);
}

function quantityText(quantity: number): string {
  return Number.isInteger(quantity) ? String(quantity) : String(quantity);
}

/** The trading name first, the legal name beneath it only when they differ. */
export function documentSeller(company: DocumentCompany): DocumentSeller {
  return {
    displayName: company.dba_name?.trim() || company.legal_name,
    legalLine: company.dba_name?.trim() ? company.legal_name : null,
    lines: formatPostalAddress(company),
  };
}

/** The customer's address, then whichever contact details differ from their name. */
export function documentBillTo(customer: DocumentCustomer): DocumentBillTo {
  const addressLines = formatPostalAddress(customer);
  const contactLines = [customer.contact_name, customer.phone, customer.email]
    .map((value) => value?.trim() ?? "")
    .filter((value) => value.length > 0 && value !== customer.name);
  return { name: customer.name, lines: [...addressLines, ...contactLines] };
}

/**
 * The stored lines in their order, checked against the document's total.
 *
 * A printed document that contradicts the ledger is worse than no document,
 * so a mismatch throws rather than printing. `noun` names the document in the
 * message ("Invoice", "Estimate").
 */
export function linesMatchingTotal<L extends DocumentSourceLine>(
  lines: readonly L[],
  totalMinor: number,
  noun: string,
): L[] {
  const ordered = [...lines].sort((a, b) => a.line_order - b.line_order);
  const lineTotal = ordered.reduce((sum, line) => sum + line.line_total_minor, 0);
  if (lineTotal !== totalMinor) {
    throw new Error(
      `${noun} line total ${lineTotal} does not match the ${noun.toLowerCase()} total ${totalMinor}`,
    );
  }
  return ordered;
}

/** Description, quantity, unit price and amount, as the customer reads them. */
export function documentLines(
  lines: readonly DocumentSourceLine[],
  money: (minor: number) => string,
): InvoiceDocumentLine[] {
  return lines.map((line) => ({
    description: line.description.trim() || "—",
    quantity: quantityText(line.quantity),
    unitPrice: money(line.unit_price_minor),
    amount: money(line.line_subtotal_minor),
  }));
}

/** Subtotal, Sales tax (only when there is any) and Total. */
export function documentTotals(
  amounts: { subtotalMinor: number; taxMinor: number; totalMinor: number },
  money: (minor: number) => string,
): DocumentTotal[] {
  const totals: DocumentTotal[] = [{ label: "Subtotal", amount: money(amounts.subtotalMinor) }];
  if (amounts.taxMinor !== 0) {
    totals.push({ label: "Sales tax", amount: money(amounts.taxMinor) });
  }
  totals.push({ label: "Total", amount: money(amounts.totalMinor) });
  return totals;
}

export function buildInvoiceDocument(source: InvoiceDocumentSource): InvoiceDocument {
  const { invoice, customer, company } = source;
  const decimals = USD_DECIMAL_PLACES;
  const money = (minor: number) => formatMoney(minor, invoice.currency_code, decimals);

  const lines = linesMatchingTotal(source.lines, invoice.total_minor, "Invoice");

  const paidMinor = invoice.total_minor - invoice.balance_due_minor;
  const totals = documentTotals(
    {
      subtotalMinor: invoice.subtotal_minor,
      taxMinor: invoice.tax_total_minor,
      totalMinor: invoice.total_minor,
    },
    money,
  );
  if (paidMinor > 0) {
    totals.push({ label: "Paid to date", amount: money(paidMinor) });
  }
  totals.push({ label: "Balance due", amount: money(invoice.balance_due_minor) });

  return {
    title: invoice.invoice_number ? `Invoice ${invoice.invoice_number}` : "Draft invoice",
    status: invoice.status,
    watermark:
      invoice.status === "draft" ? "DRAFT" : invoice.status === "void" ? "VOID" : null,
    seller: documentSeller(company),
    billTo: documentBillTo(customer),
    meta: [
      { label: "Issue date", value: invoice.issue_date },
      { label: "Due date", value: invoice.due_date ?? "On receipt" },
    ],
    lines: documentLines(lines, money),
    totals,
    memo: invoice.memo?.trim() || null,
  };
}

export function invoiceDocumentFileName(
  invoiceNumber: string | null,
  issueDate = "",
): string {
  const stem = invoiceNumber
    ? invoiceNumber.toLowerCase().replace(/[^a-z0-9]+/g, "-")
    : `draft-${issueDate}`;
  return `invoice-${stem}.pdf`;
}
```

- [ ] **Step 10: Create `ctyhp-accounting/lib/domain/estimates.ts`** with exactly this content:

```ts
/**
 * Estimates: a price promised to a customer, outside the books.
 *
 * Pure. Which state an estimate is in, what may be done to it in that state,
 * the words the screens show, and how an estimate fills the New invoice form
 * are decided here so the list, the form, the invoice page and the tests all
 * read them from one place.
 *
 * Only Declined is stored (migration 0141). Converted and Expired are worked
 * out when read: Converted from the invoice made from the estimate, Expired
 * from the company's today, which depends on its time zone and so is never
 * the database's date.
 */
import { USD_DECIMAL_PLACES } from "@/lib/domain/currency";
import { computeInvoiceLine, sumInvoiceTotals, type InvoiceTotals } from "@/lib/domain/money";
import { addIsoDays } from "@/lib/domain/work-queue";
import { toMinorUnits } from "@/lib/format";

// --- State ------------------------------------------------------------------

export const ESTIMATE_STATES = ["open", "expired", "declined", "converted"] as const;
export type EstimateState = (typeof ESTIMATE_STATES)[number];

export const ESTIMATE_STATE_LABELS: Record<EstimateState, string> = {
  open: "Open",
  expired: "Expired",
  declined: "Declined",
  converted: "Converted",
};

/** How long an estimate is valid by default: "Valid until" is the date plus this many days. */
export const ESTIMATE_VALID_DAYS = 30;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar day written YYYY-MM-DD; "2026-02-30" is not one. */
function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function requireIsoDate(value: string, label: string): void {
  if (!isIsoDate(value)) {
    throw new Error(`${label} must be a YYYY-MM-DD date, received "${value}"`);
  }
}

export interface EstimateStateInput {
  /** When it was marked declined; null when it is not. */
  declinedAt: string | null;
  /** "Valid until", YYYY-MM-DD. */
  expiryDate: string;
  /** An invoice that is not void has been made from it. */
  hasLiveInvoice: boolean;
}

/**
 * The state an estimate is in on the company's `today` (YYYY-MM-DD).
 *
 * Converted wins over everything, because the invoice made from it is the
 * fact that matters. Declined wins over Expired: the customer's answer says
 * more than the calendar. Expired starts the day after "Valid until"; the
 * expiry day itself is still Open. Dates are YYYY-MM-DD, so string order is
 * date order.
 */
export function estimateState(input: EstimateStateInput, today: string): EstimateState {
  requireIsoDate(today, "today");
  requireIsoDate(input.expiryDate, "expiryDate");
  if (input.hasLiveInvoice) return "converted";
  if (input.declinedAt) return "declined";
  if (input.expiryDate < today) return "expired";
  return "open";
}

/** The same, read straight off a list or detail row. */
export function estimateStateOf(
  row: { declined_at: string | null; expiry_date: string; live_invoice: object | null },
  today: string,
): EstimateState {
  return estimateState(
    { declinedAt: row.declined_at, expiryDate: row.expiry_date, hasLiveInvoice: row.live_invoice !== null },
    today,
  );
}

/** "Valid until" when nobody sets it: the estimate date plus 30 days. */
export function defaultExpiryDate(estimateDate: string): string {
  requireIsoDate(estimateDate, "estimateDate");
  return addIsoDays(estimateDate, ESTIMATE_VALID_DAYS);
}

// --- What each state allows -------------------------------------------------

export interface EstimateActions {
  edit: boolean;
  /** Turn into an invoice. */
  convert: boolean;
  /** Turning it into an invoice asks first, because the price has lapsed. */
  confirmConvert: boolean;
  /** Mark declined. */
  decline: boolean;
  reopen: boolean;
  /**
   * Offered whenever it is not converted. The database still refuses an
   * estimate that has ever had an invoice made from it, and the screen shows
   * its words.
   */
  delete: boolean;
  /** Download PDF: anyone who can see the estimate. */
  pdf: boolean;
}

const WRITE_ACTIONS: Record<EstimateState, Omit<EstimateActions, "pdf">> = {
  open: { edit: true, convert: true, confirmConvert: false, decline: true, reopen: false, delete: true },
  expired: { edit: true, convert: true, confirmConvert: true, decline: true, reopen: false, delete: true },
  declined: { edit: true, convert: false, confirmConvert: false, decline: false, reopen: true, delete: true },
  converted: { edit: false, convert: false, confirmConvert: false, decline: false, reopen: false, delete: false },
};

const NO_WRITES: Omit<EstimateActions, "pdf"> = {
  edit: false,
  convert: false,
  confirmConvert: false,
  decline: false,
  reopen: false,
  delete: false,
};

/**
 * The actions a state allows (the spec's table). Actions that change
 * something show only to people who can write; read-only roles keep the PDF.
 */
export function estimateActions(state: EstimateState, canWrite: boolean): EstimateActions {
  return { ...(canWrite ? WRITE_ACTIONS[state] : NO_WRITES), pdf: true };
}

// --- The list's filter pills ------------------------------------------------

export type EstimateFilter = "all" | EstimateState;

export const ESTIMATE_FILTERS: ReadonlyArray<{ key: EstimateFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "open", label: ESTIMATE_STATE_LABELS.open },
  { key: "expired", label: ESTIMATE_STATE_LABELS.expired },
  { key: "declined", label: ESTIMATE_STATE_LABELS.declined },
  { key: "converted", label: ESTIMATE_STATE_LABELS.converted },
];

export function estimateInFilter(state: EstimateState, filter: EstimateFilter): boolean {
  return filter === "all" || filter === state;
}

/** The count on each pill. */
export function countEstimatesByFilter(states: Iterable<EstimateState>): Record<EstimateFilter, number> {
  const counts: Record<EstimateFilter, number> = {
    all: 0,
    open: 0,
    expired: 0,
    declined: 0,
    converted: 0,
  };
  for (const state of states) {
    counts.all += 1;
    counts[state] += 1;
  }
  return counts;
}

// --- Words ------------------------------------------------------------------

/**
 * What the screens say, given the estimate's number. Where the database says
 * the same thing (a refusal), the words are the database's own, letter for
 * letter, so a refusal reads the same whichever side catches it.
 */
export const estimateMessages = {
  deleteConfirm: (estimateNumber: string) =>
    `Delete ${estimateNumber}? It is not in the books, so nothing else changes.`,
  deleteRefused: (estimateNumber: string) =>
    `${estimateNumber} has had an invoice made from it. Mark it declined instead.`,
  /** `invoiceNumber` is null while the invoice is still a draft. */
  alreadyConverted: (estimateNumber: string, invoiceNumber: string | null) =>
    `${estimateNumber} has already been turned into an invoice (${invoiceNumber ?? "a draft invoice"}).`,
  declinedCannotConvert: (estimateNumber: string) =>
    `${estimateNumber} is marked declined. Reopen it before turning it into an invoice.`,
  declined: (estimateNumber: string) => `${estimateNumber} marked declined.`,
  reopened: (estimateNumber: string) => `${estimateNumber} reopened.`,
  /** `validUntil` is the estimate's "Valid until" date, as the screen shows dates. */
  expiredConfirm: (estimateNumber: string, validUntil: string) =>
    `${estimateNumber} expired on ${validUntil}. Turn it into an invoice anyway?`,
  /** Above the New invoice form, and on the invoice's detail. */
  fromEstimate: (estimateNumber: string) => `From estimate ${estimateNumber}`,
  invoiceCreated: (estimateNumber: string) =>
    `Draft invoice created from ${estimateNumber}. Check it over, then issue it.`,
} as const;

// --- Form lines -------------------------------------------------------------

/**
 * A line as the New invoice form and the estimate form hold it: the unit
 * price in major units, the way the money input shows it.
 */
export interface DocumentFormLine {
  item_id?: string | null;
  description?: string;
  quantity?: number;
  /** Major units (dollars), as typed. */
  unit_price?: number;
  income_account_id?: string;
  tax_code_id?: string | null;
}

/** A stored estimate line, as far as the forms need it. */
export interface EstimateLineValues {
  line_order: number;
  item_id: string | null;
  description: string;
  quantity: number;
  unit_price_minor: number;
  income_account_id: string;
  tax_code_id: string | null;
}

/** A filled-in form line: every field the invoice line carries. */
export interface FilledFormLine {
  item_id: string | null;
  description: string;
  quantity: number;
  /** Major units. */
  unit_price: number;
  income_account_id: string;
  tax_code_id: string | null;
}

/** What a line saves as: the invoice line's input, with the price in minor units. */
export interface DocumentLineInput {
  description: string;
  quantity: number;
  unit_price_minor: number;
  income_account_id: string;
  tax_code_id: string | null;
  item_id: string | null;
}

const MINOR_PER_MAJOR = 10 ** USD_DECIMAL_PLACES;

/** A stored line, in the form's terms. */
export function estimateLineToFormLine(line: EstimateLineValues): FilledFormLine {
  return {
    item_id: line.item_id ?? null,
    description: line.description,
    quantity: Number(line.quantity),
    unit_price: Number(line.unit_price_minor) / MINOR_PER_MAJOR,
    income_account_id: line.income_account_id,
    tax_code_id: line.tax_code_id ?? null,
  };
}

/**
 * A form line, in the terms the server takes. The same conversion the New
 * invoice form makes when it submits.
 */
export function formLineToLineInput(line: DocumentFormLine): DocumentLineInput {
  return {
    description: line.description ?? "",
    quantity: Number(line.quantity),
    unit_price_minor: toMinorUnits(Number(line.unit_price ?? 0), USD_DECIMAL_PLACES),
    income_account_id: line.income_account_id ?? "",
    tax_code_id: line.tax_code_id || null,
    item_id: line.item_id || null,
  };
}

/**
 * Subtotal, sales tax and total for a form's live display, worked out exactly
 * as the New invoice form works out its own: a line counts once it has a
 * quantity above zero and a price of zero or more, and each line is rounded
 * by the invoice's own rule before the lines are added up. The server's
 * figures are the ones saved.
 */
export function formLinesTotals(
  lines: ReadonlyArray<DocumentFormLine | null | undefined>,
  taxRatePercentOf: (taxCodeId: string | null | undefined) => number,
): InvoiceTotals {
  const computed = lines
    .filter(
      (line): line is DocumentFormLine =>
        line != null && (line.quantity ?? 0) > 0 && (line.unit_price ?? 0) >= 0,
    )
    .map((line) =>
      computeInvoiceLine({
        quantity: Number(line.quantity ?? 0),
        unitPriceMinor: toMinorUnits(Number(line.unit_price ?? 0), USD_DECIMAL_PLACES),
        taxRatePercent: taxRatePercentOf(line.tax_code_id),
      }),
    );
  return sumInvoiceTotals(computed);
}

// --- Turning an estimate into an invoice ------------------------------------

export interface EstimatePrefillSource {
  id: string;
  estimate_number: string;
  customer_id: string;
  declined_at: string | null;
  /** The invoice made from it that is not void, if there is one. */
  live_invoice: { invoice_number: string | null } | null;
}

/** What the New invoice form opens with when it is opened from an estimate. */
export interface EstimateInvoicePrefill {
  estimateId: string;
  estimateNumber: string;
  /** Initial values for the New invoice form: the customer and the lines. */
  values: {
    customer_id: string;
    lines: FilledFormLine[];
  };
  /**
   * Set when the estimate cannot be turned into an invoice now: the words to
   * show instead of opening the form. The database refuses the same cases.
   */
  blocked: string | null;
}

/**
 * The New invoice form's initial values, from an estimate and its lines: the
 * customer, and every line with its item, description, quantity, unit price,
 * income account and tax code, in the estimate's order. The issue and due
 * dates are left to the form, which sets them as it always does.
 */
export function estimateToInvoicePrefill(
  estimate: EstimatePrefillSource,
  lines: readonly EstimateLineValues[],
): EstimateInvoicePrefill {
  const ordered = [...lines].sort((a, b) => a.line_order - b.line_order);
  let blocked: string | null = null;
  if (estimate.live_invoice) {
    blocked = estimateMessages.alreadyConverted(
      estimate.estimate_number,
      estimate.live_invoice.invoice_number,
    );
  } else if (estimate.declined_at) {
    blocked = estimateMessages.declinedCannotConvert(estimate.estimate_number);
  }
  return {
    estimateId: estimate.id,
    estimateNumber: estimate.estimate_number,
    values: {
      customer_id: estimate.customer_id,
      lines: ordered.map(estimateLineToFormLine),
    },
    blocked,
  };
}

/**
 * Where "Turn into an invoice" goes: the Invoices screen, which opens New
 * invoice filled in from this estimate.
 */
export function estimateConversionHref(estimateId: string): string {
  return `/invoices?new=1&estimate=${encodeURIComponent(estimateId)}`;
}

/** What the New invoice form opens with from an estimate, before its dates become pickers. */
export interface InvoiceFormFromEstimate {
  currency_code: string;
  customer_id: string;
  lines: FilledFormLine[];
  /** Days from the issue date to the due date: the customer's terms, else the company's. */
  dueInDays: number;
}

/**
 * The New invoice form's values when it opens from an estimate.
 *
 * Picking a customer by hand does two things to the form: it sets the due
 * date from the customer's terms, and it fills the tax rate of the customer's
 * state into every line that has none. Opening from an estimate does only the
 * first. The estimate's lines were priced and taxed when it was written, and
 * a line left untaxed on purpose (a service, an exempt sale) must not gain
 * tax on the way to the invoice: the customer accepted the estimate's total.
 * So each line keeps its own tax code exactly, including none.
 */
export function invoiceFormFromEstimate(
  prefill: EstimateInvoicePrefill,
  terms: {
    currencyCode: string;
    /** The customer's own terms in days; null or undefined when they have none. */
    customerTermsDays: number | null | undefined;
    /** The company's default payment terms. */
    defaultTermsDays: number;
  },
): InvoiceFormFromEstimate {
  return {
    currency_code: terms.currencyCode,
    customer_id: prefill.values.customer_id,
    lines: prefill.values.lines.map((line) => ({ ...line })),
    dueInDays: terms.customerTermsDays ?? terms.defaultTermsDays,
  };
}
```

- [ ] **Step 11: Create `ctyhp-accounting/lib/domain/estimate-document.ts`** with exactly this content:

```ts
/**
 * The printable form of an estimate: a quotation, on the invoice's layout.
 *
 * Pure, like the invoice's model (lib/domain/invoice-document), and built
 * from the same pieces: the seller block, the bill-to block, the line rows,
 * the balance check and the totals rows are that module's own helpers. It
 * adds one thing the invoice has not got: a closing line, always printed,
 * saying nothing is owed on it.
 */
import { USD_DECIMAL_PLACES } from "@/lib/domain/currency";
import {
  documentBillTo,
  documentLines,
  documentSeller,
  documentTotals,
  linesMatchingTotal,
  type DocumentCompany,
  type DocumentCustomer,
  type DocumentSourceLine,
  type PrintedDocument,
} from "@/lib/domain/invoice-document";
import { formatMoney } from "@/lib/format";

/** Printed at the foot of every estimate, after the note. */
export const ESTIMATE_CLOSING_LINE = "This is a quotation, not an invoice. Nothing is owed on it.";

export interface EstimateDocumentSource {
  estimate: {
    estimate_number: string;
    estimate_date: string;
    expiry_date: string;
    currency_code: string;
    subtotal_minor: number;
    tax_minor: number;
    total_minor: number;
    /** "Note printed at the foot". */
    memo: string | null;
  };
  lines: DocumentSourceLine[];
  customer: DocumentCustomer;
  company: DocumentCompany;
}

/**
 * The invoice's printed shape plus a closing line. Nothing is owed on an
 * estimate, so its totals stop at Total: no Paid to date, no Balance due.
 */
export interface EstimateDocument extends PrintedDocument {
  /** Always ESTIMATE_CLOSING_LINE, drawn after the note. */
  footer: string;
  /** `Estimate EST-000001 <customer>.pdf`. */
  fileName: string;
}

/** Characters no file system takes in a name, and control characters. */
const UNSAFE_IN_FILE_NAME = /[\u0000-\u001f\u007f<>:"/\\|?*]+/g;

/**
 * `Estimate EST-000001 <customer>.pdf`. Characters a file system refuses are
 * dropped from the customer's name, so "Rivera / Sons" saves as
 * "Estimate EST-000001 Rivera Sons.pdf".
 */
export function estimateDocumentFileName(estimateNumber: string, customerName: string): string {
  const customer = customerName.replace(UNSAFE_IN_FILE_NAME, " ").replace(/\s+/g, " ").trim();
  const stem = [`Estimate ${estimateNumber}`, customer].filter((part) => part.length > 0).join(" ");
  return `${stem}.pdf`;
}

export function buildEstimateDocument(source: EstimateDocumentSource): EstimateDocument {
  const { estimate, customer, company } = source;
  const money = (minor: number) => formatMoney(minor, estimate.currency_code, USD_DECIMAL_PLACES);

  const lines = linesMatchingTotal(source.lines, estimate.total_minor, "Estimate");

  return {
    title: `Estimate ${estimate.estimate_number}`,
    watermark: null,
    seller: documentSeller(company),
    billTo: documentBillTo(customer),
    meta: [
      { label: "Estimate date", value: estimate.estimate_date },
      { label: "Valid until", value: estimate.expiry_date },
    ],
    lines: documentLines(lines, money),
    totals: documentTotals(
      {
        subtotalMinor: estimate.subtotal_minor,
        taxMinor: estimate.tax_minor,
        totalMinor: estimate.total_minor,
      },
      money,
    ),
    memo: estimate.memo?.trim() || null,
    footer: ESTIMATE_CLOSING_LINE,
    fileName: estimateDocumentFileName(estimate.estimate_number, customer.name),
  };
}
```

- [ ] **Step 12: Create `ctyhp-accounting/lib/services/estimates.ts`** with exactly this content:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EstimateLineRow, EstimateRow, InvoiceStatus } from "@/lib/db/types";
import type { EstimateSaveInput, InvoiceCreateInput } from "@/lib/domain/schemas";
import {
  estimateToInvoicePrefill,
  type EstimateInvoicePrefill,
} from "@/lib/domain/estimates";
import type { EstimateDocumentSource } from "@/lib/domain/estimate-document";
import { getCurrentCompanySettings } from "@/lib/services/company";
import { readAllPages } from "@/lib/services/paging";

/**
 * Estimates: reads under the caller's RLS, and the four functions of
 * migration 0141 for every write. The tables are read-only to a signed-in
 * session, so nothing here writes them directly; every refusal is the
 * database's own words, passed through unchanged.
 */
export class EstimatesError extends Error {}

const ESTIMATE_COLS =
  "id,estimate_number,customer_id,estimate_date,expiry_date,currency_code,memo," +
  "subtotal_minor,tax_minor,total_minor,declined_at,status,created_by,created_at," +
  "updated_by,updated_at";

const LINE_COLS =
  "id,estimate_id,line_order,item_id,description,quantity,unit_price_minor," +
  "income_account_id,tax_code_id,line_subtotal_minor,line_tax_minor,line_total_minor";

/** The customer's name and every invoice made from the estimate, void ones included. */
const LINKED = "acc_customer(name),acc_invoice(id,invoice_number,status,issue_date,created_at)";

/** An invoice made from an estimate. */
export interface EstimateLinkedInvoice {
  id: string;
  /** Null while it is a draft. */
  invoice_number: string | null;
  status: InvoiceStatus;
  issue_date: string;
  created_at: string;
}

export interface EstimateListRow extends EstimateRow {
  customer_name: string;
  /**
   * The invoice made from it that is not void, if any: what makes it
   * Converted. The database allows at most one.
   */
  live_invoice: EstimateLinkedInvoice | null;
}

export interface EstimateDetail {
  estimate: EstimateListRow;
  lines: EstimateLineRow[];
  /** Every invoice made from it, void ones included, oldest first. */
  invoices: EstimateLinkedInvoice[];
}

export interface SavedEstimate {
  id: string;
  estimate_number: string;
  subtotal_minor: number;
  tax_minor: number;
  total_minor: number;
}

function fail(message: string): EstimatesError {
  return new EstimatesError(message);
}

function linkedInvoices(raw: unknown): EstimateLinkedInvoice[] {
  return ((raw ?? []) as EstimateLinkedInvoice[])
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

/** The one invoice that is not void, if any. A void one keeps its link but converts nothing. */
export function liveInvoiceOf(invoices: readonly EstimateLinkedInvoice[]): EstimateLinkedInvoice | null {
  return invoices.find((invoice) => invoice.status !== "void") ?? null;
}

function toListRow(raw: Record<string, unknown>): { row: EstimateListRow; invoices: EstimateLinkedInvoice[] } {
  const { acc_customer: customer, acc_invoice: invoiceRows, ...rest } = raw;
  const invoices = linkedInvoices(invoiceRows);
  const head = rest as unknown as EstimateRow;
  return {
    row: {
      ...head,
      subtotal_minor: Number(head.subtotal_minor),
      tax_minor: Number(head.tax_minor),
      total_minor: Number(head.total_minor),
      customer_name: (customer as { name?: string } | null)?.name ?? "—",
      live_invoice: liveInvoiceOf(invoices),
    },
    invoices,
  };
}

/** The lines of one estimate, in their order (unique per estimate), every page of them. */
function readLines(sb: SupabaseClient, estimateId: string): Promise<EstimateLineRow[]> {
  return readAllPages<EstimateLineRow>(
    (from, to) =>
      sb
        .from("acc_estimate_line")
        .select(LINE_COLS)
        .eq("estimate_id", estimateId)
        .order("line_order")
        .range(from, to),
    fail,
  );
}

// --- Reads ---

/**
 * Every estimate, newest first, with its customer's name, its totals and the
 * invoice made from it that is not void. The number is unique, so date then
 * number is a total order and no page can skip or repeat a row.
 */
export async function listEstimates(sb: SupabaseClient): Promise<EstimateListRow[]> {
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) =>
      sb
        .from("acc_estimate")
        .select(`${ESTIMATE_COLS},${LINKED}`)
        .order("estimate_date", { ascending: false })
        .order("estimate_number", { ascending: false })
        .range(from, to),
    fail,
  );
  return rows.map((raw) => toListRow(raw).row);
}

/** One estimate: its header, its lines and every invoice made from it. */
export async function getEstimateDetail(sb: SupabaseClient, id: string): Promise<EstimateDetail> {
  const [head, lines] = await Promise.all([
    sb.from("acc_estimate").select(`${ESTIMATE_COLS},${LINKED}`).eq("id", id).maybeSingle(),
    readLines(sb, id),
  ]);
  if (head.error) throw fail(head.error.message);
  if (!head.data) throw fail("Estimate not found");
  const { row, invoices } = toListRow(head.data as unknown as Record<string, unknown>);
  return { estimate: row, lines, invoices };
}

/**
 * What the New invoice form opens with when it is opened from this estimate,
 * or null when there is no such estimate (or the reader may not see it).
 */
export async function getEstimateInvoicePrefill(
  sb: SupabaseClient,
  id: string,
): Promise<EstimateInvoicePrefill | null> {
  const [head, lines] = await Promise.all([
    sb
      .from("acc_estimate")
      .select("id,estimate_number,customer_id,declined_at,acc_invoice(id,invoice_number,status,issue_date,created_at)")
      .eq("id", id)
      .maybeSingle(),
    readLines(sb, id),
  ]);
  if (head.error) throw fail(head.error.message);
  if (!head.data) return null;
  const row = head.data as unknown as {
    id: string;
    estimate_number: string;
    customer_id: string;
    declined_at: string | null;
    acc_invoice: unknown;
  };
  return estimateToInvoicePrefill(
    {
      id: row.id,
      estimate_number: row.estimate_number,
      customer_id: row.customer_id,
      declined_at: row.declined_at,
      live_invoice: liveInvoiceOf(linkedInvoices(row.acc_invoice)),
    },
    lines,
  );
}

/** Everything a printable estimate needs, read under the caller's RLS. */
export async function getEstimateDocumentSource(
  sb: SupabaseClient,
  id: string,
): Promise<EstimateDocumentSource> {
  const [head, lines, company] = await Promise.all([
    sb
      .from("acc_estimate")
      .select(
        "estimate_number,estimate_date,expiry_date,currency_code,subtotal_minor,tax_minor," +
          "total_minor,memo,acc_customer(name,email,contact_name,phone,address_line1," +
          "address_line2,city,region,postal_code,country)",
      )
      .eq("id", id)
      .maybeSingle(),
    readLines(sb, id),
    getCurrentCompanySettings(sb),
  ]);
  if (head.error) throw fail(head.error.message);
  if (!head.data) throw fail("Estimate not found");
  if (!company) {
    throw fail(
      "Company settings are required before an estimate can be printed. Set them in Settings → Company.",
    );
  }
  const { acc_customer: customer, ...estimate } = head.data as unknown as Record<string, unknown>;
  if (!customer) throw fail("The estimate's customer was not found");
  return {
    estimate: estimate as unknown as EstimateDocumentSource["estimate"],
    lines,
    customer: customer as unknown as EstimateDocumentSource["customer"],
    company: company as unknown as EstimateDocumentSource["company"],
  };
}

// --- Writes (each an atomic SECURITY DEFINER function of migration 0141) ---

/**
 * Create (`id` null) or edit an estimate with all its lines. The database
 * numbers a new one, works out every amount, and refuses a Converted one.
 */
export async function saveEstimate(
  sb: SupabaseClient,
  id: string | null,
  input: EstimateSaveInput,
): Promise<SavedEstimate> {
  const { data, error } = await sb.rpc("acc_save_estimate", {
    p_estimate_id: id,
    p_customer_id: input.customer_id,
    p_estimate_date: input.estimate_date,
    p_expiry_date: input.expiry_date || null,
    p_currency: input.currency_code,
    p_memo: input.memo || null,
    p_lines: input.lines.map((line) => ({
      description: line.description ?? "",
      quantity: line.quantity,
      unit_price_minor: line.unit_price_minor,
      income_account_id: line.income_account_id,
      tax_code_id: line.tax_code_id || null,
      item_id: line.item_id || null,
    })),
  });
  if (error) throw fail(error.message);
  const saved = data as Record<string, unknown>;
  return {
    id: String(saved.id),
    estimate_number: String(saved.estimate_number),
    subtotal_minor: Number(saved.subtotal_minor),
    tax_minor: Number(saved.tax_minor),
    total_minor: Number(saved.total_minor),
  };
}

/** Mark declined (`declined` true) or reopen (false). Refused once it is Converted. */
export async function setEstimateDeclined(
  sb: SupabaseClient,
  id: string,
  declined: boolean,
): Promise<{ id: string; estimate_number: string; declined_at: string | null }> {
  const { data, error } = await sb.rpc("acc_set_estimate_declined", {
    p_estimate_id: id,
    p_declined: declined,
  });
  if (error) throw fail(error.message);
  const result = data as Record<string, unknown>;
  return {
    id: String(result.id),
    estimate_number: String(result.estimate_number),
    declined_at: (result.declined_at as string | null) ?? null,
  };
}

/**
 * Delete an estimate and its lines. Refused when any invoice, void or not,
 * has been made from it; the refusal says to mark it declined instead.
 */
export async function deleteEstimate(
  sb: SupabaseClient,
  id: string,
): Promise<{ id: string; estimate_number: string }> {
  const { data, error } = await sb.rpc("acc_delete_estimate", { p_estimate_id: id });
  if (error) throw fail(error.message);
  const result = data as Record<string, unknown>;
  return { id: String(result.id), estimate_number: String(result.estimate_number) };
}

/**
 * The draft invoice made from an estimate, linked to it, in one transaction.
 * The fields and lines are the New invoice form's, passed exactly as
 * createDraftInvoice passes them; the database makes the draft through the
 * same function, and refuses a declined estimate, one already turned into an
 * invoice, or a different customer. Returns the new invoice's id.
 */
export async function createInvoiceFromEstimate(
  sb: SupabaseClient,
  estimateId: string,
  input: InvoiceCreateInput,
): Promise<string> {
  const { data, error } = await sb.rpc("acc_create_invoice_from_estimate", {
    p_estimate_id: estimateId,
    p_customer_id: input.customer_id,
    p_issue_date: input.issue_date || null,
    p_due_date: input.due_date || null,
    p_currency: input.currency_code,
    p_memo: input.memo || null,
    p_lines: input.lines,
  });
  if (error) throw fail(error.message);
  return String(data);
}
```

- [ ] **Step 13: Edit `ctyhp-accounting/lib/services/invoicing.ts`** — apply this 1 find/replace edit (its find string occurs exactly once):

Edit 1 of 1 — find:

```ts
  return invoice as unknown as InvoiceRow;
}
```

replace with:

```ts
  return invoice as unknown as InvoiceRow;
}

/** The estimate an invoice was made from (migration 0141). */
export interface InvoiceEstimateLink {
  id: string;
  estimate_number: string;
}

/**
 * The estimate this invoice was made from, or null when it was not made from
 * one, so the invoice's detail can say "From estimate EST-000001".
 */
export async function getInvoiceEstimate(
  sb: SupabaseClient,
  invoiceId: string,
): Promise<InvoiceEstimateLink | null> {
  const { data, error } = await sb
    .from("acc_invoice")
    .select("estimate_id,acc_estimate(id,estimate_number)")
    .eq("id", invoiceId)
    .maybeSingle();
  if (error) throw new InvoicingError(error.message);
  const estimate = (data as { acc_estimate?: InvoiceEstimateLink | null } | null)?.acc_estimate;
  return estimate ? { id: estimate.id, estimate_number: estimate.estimate_number } : null;
}
```

- [ ] **Step 14: Edit `ctyhp-accounting/lib/services/dashboard.ts`** — apply these 2 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 2 — find:

```ts
  acc_invoice: { entity: "Invoice", href: "/invoices", category: "sales" },
  acc_payment: { entity: "Customer payment", href: "/payments", category: "sales" },
```

replace with:

```ts
  acc_invoice: { entity: "Invoice", href: "/invoices", category: "sales" },
  acc_estimate: { entity: "Estimate", href: "/estimates", category: "sales" },
  acc_payment: { entity: "Customer payment", href: "/payments", category: "sales" },
```

Edit 2 of 2 — find:

```ts
  "receipt_number",
  "entry_number",
```

replace with:

```ts
  "receipt_number",
  "estimate_number",
  "entry_number",
```

- [ ] **Step 15: Create `ctyhp-accounting/app/(app)/estimates/actions.ts`** with exactly this content:

```ts
"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { estimateIdSchema, estimateSaveSchema } from "@/lib/domain/schemas";
import {
  estimateStateOf,
  type EstimateInvoicePrefill,
  type EstimateState,
} from "@/lib/domain/estimates";
import { buildEstimateDocument, type EstimateDocument } from "@/lib/domain/estimate-document";
import { companyClock } from "@/lib/services/report-context";
import {
  deleteEstimate,
  getEstimateDetail,
  getEstimateDocumentSource,
  getEstimateInvoicePrefill,
  listEstimates,
  saveEstimate,
  setEstimateDeclined,
  type EstimateDetail,
  type EstimateListRow,
  type SavedEstimate,
} from "@/lib/services/estimates";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

/** A list row with the state it is in on the company's today. */
export interface EstimateListEntry extends EstimateListRow {
  state: EstimateState;
}

export interface EstimateRegister {
  /** The company's today, in its own time zone: the day every state was worked out for. */
  today: string;
  estimates: EstimateListEntry[];
}

export interface EstimateDetailView extends EstimateDetail {
  state: EstimateState;
  today: string;
}

async function guard(): Promise<string | null> {
  const role = await getUserRole();
  return canWrite(role) ? null : "You do not have permission to perform this action";
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : "An unexpected error occurred";
}

function invalid(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? "Invalid data";
}

/** Every estimate write shows on the Estimates list and in the dashboard's recent activity. */
function revalidate(): void {
  revalidatePath("/estimates");
  revalidatePath("/dashboard");
}

// --- Reads: anyone who can see the books (RLS decides), writers or not ---

/** The Estimates list, each row with its state on the company's today. */
export async function listEstimatesAction(): Promise<ActionResult<EstimateRegister>> {
  try {
    const sb = await createSupabaseServerClient();
    const [rows, clock] = await Promise.all([listEstimates(sb), companyClock(sb)]);
    return {
      ok: true,
      data: {
        today: clock.today,
        estimates: rows.map((row) => ({ ...row, state: estimateStateOf(row, clock.today) })),
      },
    };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/** One estimate: header, lines, every invoice made from it, and its state today. */
export async function getEstimateDetailAction(id: string): Promise<ActionResult<EstimateDetailView>> {
  const parsedId = estimateIdSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: invalid(parsedId.error) };
  try {
    const sb = await createSupabaseServerClient();
    const [detail, clock] = await Promise.all([getEstimateDetail(sb, parsedId.data), companyClock(sb)]);
    return {
      ok: true,
      data: { ...detail, state: estimateStateOf(detail.estimate, clock.today), today: clock.today },
    };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/**
 * The printable form of one estimate. Built on the server so the balance
 * check in buildEstimateDocument fails as an ordinary action error, as the
 * invoice's does. Read-only roles download the PDF too.
 */
export async function getEstimateDocumentAction(id: string): Promise<ActionResult<EstimateDocument>> {
  const parsedId = estimateIdSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: invalid(parsedId.error) };
  try {
    const sb = await createSupabaseServerClient();
    const source = await getEstimateDocumentSource(sb, parsedId.data);
    return { ok: true, data: buildEstimateDocument(source) };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/**
 * What the New invoice form opens with when it is opened from this estimate.
 * Writers only: it exists to turn the estimate into an invoice. `blocked`
 * carries the words to show instead when that cannot happen now.
 */
export async function getEstimateInvoicePrefillAction(
  id: string,
): Promise<ActionResult<EstimateInvoicePrefill>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsedId = estimateIdSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: invalid(parsedId.error) };
  try {
    const sb = await createSupabaseServerClient();
    const prefill = await getEstimateInvoicePrefill(sb, parsedId.data);
    if (!prefill) return { ok: false, error: "Estimate not found" };
    return { ok: true, data: prefill };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

// --- Writes: canWrite here, acc_is_staff() in the database ---

/** Create (`id` null) or edit an estimate. The number is assigned on the first save. */
export async function saveEstimateAction(
  id: string | null,
  raw: unknown,
): Promise<ActionResult<SavedEstimate>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  if (id !== null) {
    const parsedId = estimateIdSchema.safeParse(id);
    if (!parsedId.success) return { ok: false, error: invalid(parsedId.error) };
  }
  const parsed = estimateSaveSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: invalid(parsed.error) };
  try {
    const sb = await createSupabaseServerClient();
    const saved = await saveEstimate(sb, id, parsed.data);
    revalidate();
    return { ok: true, data: saved };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

async function setDeclined(
  id: string,
  declined: boolean,
): Promise<ActionResult<{ id: string; estimate_number: string; declined_at: string | null }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsedId = estimateIdSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: invalid(parsedId.error) };
  try {
    const sb = await createSupabaseServerClient();
    const result = await setEstimateDeclined(sb, parsedId.data, declined);
    revalidate();
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/** Mark declined. No confirmation; the toast is estimateMessages.declined. */
export async function declineEstimateAction(
  id: string,
): Promise<ActionResult<{ id: string; estimate_number: string; declined_at: string | null }>> {
  return setDeclined(id, true);
}

/** Reopen a declined estimate. No confirmation; the toast is estimateMessages.reopened. */
export async function reopenEstimateAction(
  id: string,
): Promise<ActionResult<{ id: string; estimate_number: string; declined_at: string | null }>> {
  return setDeclined(id, false);
}

/**
 * Delete an estimate that never had an invoice made from it. The screen asks
 * first (estimateMessages.deleteConfirm); a refusal is the database's words.
 */
export async function deleteEstimateAction(
  id: string,
): Promise<ActionResult<{ id: string; estimate_number: string }>> {
  const denied = await guard();
  if (denied) return { ok: false, error: denied };
  const parsedId = estimateIdSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: invalid(parsedId.error) };
  try {
    const sb = await createSupabaseServerClient();
    const result = await deleteEstimate(sb, parsedId.data);
    revalidate();
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}
```

- [ ] **Step 16: Edit `ctyhp-accounting/app/(app)/invoices/actions.ts`** — apply these 14 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 14 — find:

```ts
  createCustomer,
  getInvoiceLines,
```

replace with:

```ts
  createCustomer,
  getInvoiceEstimate,
  getInvoiceLines,
```

Edit 2 of 14 — find:

```ts
  InvoicingError,
} from "@/lib/services/invoicing";
```

replace with:

```ts
  InvoicingError,
  type InvoiceEstimateLink,
} from "@/lib/services/invoicing";
```

Edit 3 of 14 — find:

```ts
} from "@/lib/services/invoicing";
import { searchAudit } from "@/lib/services/access";
```

replace with:

```ts
} from "@/lib/services/invoicing";
import { createInvoiceFromEstimate } from "@/lib/services/estimates";
import { searchAudit } from "@/lib/services/access";
```

Edit 4 of 14 — find:

```ts
import type { AuditEntryRow, InvoiceLineRow } from "@/lib/db/types";
import { invoiceCreateSchema, customerCreateSchema } from "@/lib/domain/schemas";
import {
```

replace with:

```ts
import type { AuditEntryRow, InvoiceLineRow } from "@/lib/db/types";
import { invoiceCreateWithEstimateSchema, customerCreateSchema } from "@/lib/domain/schemas";
import {
```

Edit 5 of 14 — find:

```ts

export async function createInvoiceAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
```

replace with:

```ts

/**
 * Create a draft invoice. When the New invoice form was opened from an
 * estimate, the input carries `estimateId`, and the draft is made and linked
 * to that estimate in one transaction (acc_create_invoice_from_estimate),
 * which makes the estimate Converted. The invoice fields are validated the
 * same way either way.
 */
export async function createInvoiceAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
```

Edit 6 of 14 — find:

```ts
  if (denied) return { ok: false, error: denied };
  const parsed = invoiceCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
```

replace with:

```ts
  if (denied) return { ok: false, error: denied };
  const parsed = invoiceCreateWithEstimateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
```

Edit 7 of 14 — find:

```ts
  const parsed = invoiceCreateWithEstimateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
```

replace with:

```ts
  const parsed = invoiceCreateWithEstimateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  const { estimateId, ...input } = parsed.data;
  try {
    const sb = await createSupabaseServerClient();
```

Edit 8 of 14 — find:

```ts
    const sb = await createSupabaseServerClient();
    const inv = await createDraftInvoice(sb, parsed.data);
    revalidatePath("/invoices");
```

replace with:

```ts
    const sb = await createSupabaseServerClient();
    if (estimateId) {
      const id = await createInvoiceFromEstimate(sb, estimateId, input);
      revalidatePath("/invoices");
      revalidatePath("/estimates");
      revalidatePath("/dashboard");
      return { ok: true, data: { id } };
    }
    const inv = await createDraftInvoice(sb, input);
    revalidatePath("/invoices");
```

Edit 9 of 14 — find:

```ts
  audit: ActionResult<AuditEntryRow[]> | null;
}
```

replace with:

```ts
  audit: ActionResult<AuditEntryRow[]> | null;
  /** The estimate it was made from ("From estimate EST-000001"); data null when none. */
  estimate: ActionResult<InvoiceEstimateLink | null>;
}
```

Edit 10 of 14 — find:

```ts
 * invoice was three trips in a row. Here the reads run side by side on one
 * client, each keeping its own error.
 *
```

replace with:

```ts
 * invoice was three trips in a row. Here the reads run side by side on one
 * client, each keeping its own error. The estimate the invoice was made from
 * is one more read alongside them.
 *
```

Edit 11 of 14 — find:

```ts
    const failed = { ok: false, error: msg(err) };
    return { lines: failed, settlements: failed, audit: withAudit ? failed : null };
  }
```

replace with:

```ts
    const failed = { ok: false, error: msg(err) };
    return { lines: failed, settlements: failed, audit: withAudit ? failed : null, estimate: failed };
  }
```

Edit 12 of 14 — find:

```ts
  }
  const [lines, settlements, audit] = await Promise.all([
    settled(() => getInvoiceLines(sb, id)),
```

replace with:

```ts
  }
  const [lines, settlements, audit, estimate] = await Promise.all([
    settled(() => getInvoiceLines(sb, id)),
```

Edit 13 of 14 — find:

```ts
      : Promise.resolve(null),
  ]);
```

replace with:

```ts
      : Promise.resolve(null),
    settled(() => getInvoiceEstimate(sb, id)),
  ]);
```

Edit 14 of 14 — find:

```ts
  ]);
  return { lines, settlements, audit };
}
```

replace with:

```ts
  ]);
  return { lines, settlements, audit, estimate };
}
```

- [ ] **Step 17: Run the gates**

Run from `ctyhp-accounting/` and read the pass/fail lines in full (never pipe through `tail`/`head`):

```bash
npx tsc --noEmit -p .
npx eslint "tests/unit/estimates.test.ts" "tests/unit/estimate-document.test.ts" "tests/unit/estimates-service.test.ts" "tests/unit/estimates-actions.test.ts" "tests/unit/detail-reads-one-request.test.ts" "lib/db/types.ts" "lib/domain/schemas.ts" "lib/domain/invoice-document.ts" "lib/domain/estimates.ts" "lib/domain/estimate-document.ts" "lib/services/estimates.ts" "lib/services/invoicing.ts" "lib/services/dashboard.ts" "app/(app)/estimates/actions.ts" "app/(app)/invoices/actions.ts"
npx vitest run tests/unit/estimates.test.ts tests/unit/estimate-document.test.ts tests/unit/estimates-service.test.ts tests/unit/estimates-actions.test.ts tests/unit/detail-reads-one-request.test.ts tests/unit/invoice-document.test.ts tests/unit/dashboard-analytics.test.ts
```

Expected: tsc exits 0 with no output; eslint reports 0 errors and 0 warnings for these files; estimates (36), estimate-document (15), estimates-service (24), estimates-actions (41) and detail-reads-one-request (10): 126 tests passing; invoice-document (22) and dashboard-analytics (5) pass.

- [ ] **Step 18: Commit**

```bash
git add "ctyhp-accounting/tests/unit/estimates.test.ts" "ctyhp-accounting/tests/unit/estimate-document.test.ts" "ctyhp-accounting/tests/unit/estimates-service.test.ts" "ctyhp-accounting/tests/unit/estimates-actions.test.ts" "ctyhp-accounting/tests/unit/detail-reads-one-request.test.ts" "ctyhp-accounting/lib/db/types.ts" "ctyhp-accounting/lib/domain/schemas.ts" "ctyhp-accounting/lib/domain/invoice-document.ts" "ctyhp-accounting/lib/domain/estimates.ts" "ctyhp-accounting/lib/domain/estimate-document.ts" "ctyhp-accounting/lib/services/estimates.ts" "ctyhp-accounting/lib/services/invoicing.ts" "ctyhp-accounting/lib/services/dashboard.ts" "ctyhp-accounting/app/(app)/estimates/actions.ts" "ctyhp-accounting/app/(app)/invoices/actions.ts"
git commit -m "feat(estimates): the estimate's states, printable model, services and actions, and the invoice made from one"
```

Stage by file name only (never `git add -A` / `git add .`). No Co-Authored-By trailer; no mention of Claude or AI in the message.

---

### Task 3: The Estimates screen and form, the invoice made from an estimate, the estimate PDF and navigation

**Files:**
- Test (create): `ctyhp-accounting/tests/unit/estimates-screen.test.ts`
- Test (modify): `ctyhp-accounting/tests/unit/invoice-pdf.test.ts`
- Test (modify): `ctyhp-accounting/tests/unit/navigation.test.ts`
- Create: `ctyhp-accounting/components/SalesLineItems.tsx`
- Create: `ctyhp-accounting/components/NewCustomerButton.tsx`
- Modify: `ctyhp-accounting/lib/client/invoice-pdf.ts`
- Modify: `ctyhp-accounting/lib/domain/navigation.ts`
- Create: `ctyhp-accounting/app/(app)/estimates/estimate-columns.ts`
- Create: `ctyhp-accounting/app/(app)/estimates/estimates.module.css`
- Create: `ctyhp-accounting/app/(app)/estimates/EstimateFormModal.tsx`
- Create: `ctyhp-accounting/app/(app)/estimates/EstimatesClient.tsx`
- Create: `ctyhp-accounting/app/(app)/estimates/page.tsx`
- Modify: `ctyhp-accounting/app/(app)/invoices/InvoicesClient.tsx`
- Modify: `ctyhp-accounting/app/(app)/invoices/page.tsx`

**Interfaces:**
- Consumes: everything Task 2 produces (names above); existing `DataTable`, `flexColumn`, `statusColumn`, `useInitiallyOpen`, `itemToInvoiceLineDefaults`, `createCustomerAction`, `matchesDocumentKeyword`, the company clock.
- Produces:
  - `/estimates`: state pills with counts, search, the list, the row menu per state, the confirmations and toasts, and the form modal (`?new=1` opens it).
  - `/invoices?new=1&estimate=<id>`: New invoice filled from the estimate (customer locked, the customer's default tax not reapplied, "From estimate EST-…"), or the blocked notice; the detail drawer's "From estimate EST-…".
  - `components/SalesLineItems.tsx` (the line editor shared by the invoice and estimate forms) and `components/NewCustomerButton.tsx`.
  - `renderInvoicePdf` takes a `PrintedDocument` plus an optional footer; invoices print as before.
  - Sales gains Estimates after Invoices; New transaction gains Estimate after Invoice.

- [ ] **Step 1: Create `ctyhp-accounting/tests/unit/estimates-screen.test.ts`** with exactly this content:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COLUMN, TABLE_BOX_AT_1280, fitsBox } from "@/lib/design/table-metrics";
import { TONES } from "@/lib/design/tone";
import {
  ESTIMATE_COLUMN_WIDTH,
  ESTIMATE_ELASTIC_FLOOR,
  ESTIMATE_STATE_TONES,
} from "@/app/(app)/estimates/estimate-columns";
import {
  ESTIMATE_STATES,
  ESTIMATE_STATE_LABELS,
  estimateConversionHref,
  estimateToInvoicePrefill,
  invoiceFormFromEstimate,
  type EstimateLineValues,
} from "@/lib/domain/estimates";
import { defaultTaxCodeForState } from "@/lib/domain/tax-jurisdiction";

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

const ROOT = process.cwd();
const ESTIMATES_DIR = join(ROOT, "app", "(app)", "estimates");
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), "utf8");

describe("the Estimates list fits the screen", () => {
  it("fits the 984px box of a 1280px window, with Customer at its floor", () => {
    expect(ESTIMATE_ELASTIC_FLOOR).toBe(COLUMN.TEXT_MIN);
    const measured = sum(Object.values(ESTIMATE_COLUMN_WIDTH));
    expect(fitsBox(measured, ESTIMATE_ELASTIC_FLOOR)).toBe(true);
    expect(measured + ESTIMATE_ELASTIC_FLOOR).toBeLessThanOrEqual(TABLE_BOX_AT_1280);
  });

  it("measures its columns from the shared tokens, giving every date at least the date token", () => {
    expect(ESTIMATE_COLUMN_WIDTH.number).toBe(COLUMN.CODE);
    expect(ESTIMATE_COLUMN_WIDTH.date).toBe(COLUMN.DATE);
    expect(ESTIMATE_COLUMN_WIDTH.validUntil).toBeGreaterThanOrEqual(COLUMN.DATE);
    expect(ESTIMATE_COLUMN_WIDTH.total).toBe(COLUMN.MONEY);
    expect(ESTIMATE_COLUMN_WIDTH.state).toBe(COLUMN.STATUS);
    expect(ESTIMATE_COLUMN_WIDTH.invoice).toBe(COLUMN.CODE);
    expect(ESTIMATE_COLUMN_WIDTH.actions).toBeGreaterThanOrEqual(COLUMN.ACTION);
  });

  it("draws every measured width it adds up, so the sum above is the table's", () => {
    const client = readFileSync(join(ESTIMATES_DIR, "EstimatesClient.tsx"), "utf8");
    for (const key of Object.keys(ESTIMATE_COLUMN_WIDTH)) {
      expect(client, key).toContain(`width: W.${key}`);
    }
    // Eight columns: seven measured and Customer, the elastic one.
    expect(client.match(/width: W\.\w+/g)).toHaveLength(Object.keys(ESTIMATE_COLUMN_WIDTH).length);
    expect(client).toContain("floor: ESTIMATE_ELASTIC_FLOOR");
  });

  it("reads every state in its own word, on the shared tones", () => {
    for (const state of ESTIMATE_STATES) {
      expect(ESTIMATE_STATE_TONES[state].label).toBe(ESTIMATE_STATE_LABELS[state]);
      expect(TONES).toContain(ESTIMATE_STATE_TONES[state].tone);
    }
    expect(ESTIMATE_STATE_TONES.converted.tone).toBe("positive");
    expect(ESTIMATE_STATE_TONES.expired.tone).toBe("warning");
  });
});

describe("the Estimates screen's sources", () => {
  const files = readdirSync(ESTIMATES_DIR).filter((file) => /\.(tsx?|css)$/.test(file));
  const sources = files.map((file) => ({ file, source: readFileSync(join(ESTIMATES_DIR, file), "utf8") }));

  it("finds the files it is guarding", () => {
    expect(files).toEqual(expect.arrayContaining(["page.tsx", "EstimatesClient.tsx", "EstimateFormModal.tsx"]));
  });

  it("draws the list through DataTable, never Ant Design's Table", () => {
    const client = readFileSync(join(ESTIMATES_DIR, "EstimatesClient.tsx"), "utf8");
    expect(client).toContain('import DataTable from "@/components/ui/DataTable"');
    expect(client).toMatch(/<DataTable<EstimateListEntry>/);
    for (const { file, source } of sources) {
      expect(source, file).not.toMatch(/<Table(?!\w)/);
      expect(source, file).not.toMatch(/import\s*\{[^}]*\bTable\b[^}]*\}\s*from\s*"antd"/);
    }
  });

  it("never asks for a horizontal scroll or pins a page size", () => {
    for (const { file, source } of sources) {
      expect(source, file).not.toMatch(/scroll=\{\{[^}]*\bx\s*:/);
      expect(source, file).not.toMatch(/pageSize\s*[:=]\s*\d/);
    }
  });

  it("opens the New estimate form from ?new=1 only after hydration", () => {
    expect(read("app", "(app)", "estimates", "page.tsx")).toContain('.new === "1"');
    const client = readFileSync(join(ESTIMATES_DIR, "EstimatesClient.tsx"), "utf8");
    expect(client).toContain('import { useInitiallyOpen } from "@/lib/client/use-initially-open"');
    expect(client).toContain("useInitiallyOpen(initialCreateOpen)");
  });

  it("never takes today from the browser's clock", () => {
    for (const { file, source } of sources) {
      expect(source, file).not.toContain("new Date().toISOString()");
      expect(source, file).not.toMatch(/\bdayjs\(\)/);
    }
    // The day every state is judged on is the company's, worked out on the server.
    const page = read("app", "(app)", "estimates", "page.tsx");
    expect(page).toContain("companyClock(sb)");
    expect(page).toContain("estimateStateOf(row, clock.today)");
    expect(page).toContain("today={clock.today}");
  });

  it("shows the spec's words: the title, the intro and the empty list", () => {
    const page = read("app", "(app)", "estimates", "page.tsx");
    expect(page).toContain('title="Estimates"');
    expect(page).toContain(
      "An estimate is a price promised to a customer. It is not in the books: nothing posts until the invoice made from it is issued.",
    );
    const client = readFileSync(join(ESTIMATES_DIR, "EstimatesClient.tsx"), "utf8");
    expect(client).toContain('"No estimates yet"');
    const form = readFileSync(join(ESTIMATES_DIR, "EstimateFormModal.tsx"), "utf8");
    expect(form).toContain('label="Note printed at the foot"');
  });

  it("asks before a delete and before turning an expired estimate into an invoice, in the shared words", () => {
    const client = readFileSync(join(ESTIMATES_DIR, "EstimatesClient.tsx"), "utf8");
    expect(client).toContain("estimateMessages.deleteConfirm(row.estimate_number)");
    expect(client).toContain("estimateMessages.expiredConfirm(target.estimate_number, target.expiry_date)");
    expect(client).toContain("estimateMessages.declined(n)");
    expect(client).toContain("estimateMessages.reopened(n)");
    expect(client).toContain("router.push(estimateConversionHref(target.id))");
  });
});

// --- Turning an estimate into an invoice ------------------------------------

const ESTIMATE_ID = "6f1c2a7e-0b5d-4c8e-9a31-2d4e5f6a7b8c";
const CUSTOMER_ID = "0c9d8e7f-6a5b-4c3d-8e1f-a2b3c4d5e6f7";
const ACCOUNT_ID = "1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d";
const MA_RATE_ID = "7e6d5c4b-3a2f-4e1d-9c0b-a1b2c3d4e5f6";

const lines: EstimateLineValues[] = [
  {
    line_order: 2,
    item_id: null,
    // Deliberately untaxed: a service the sample company does not tax.
    description: "Design consultation",
    quantity: 2,
    unit_price_minor: 7_500,
    income_account_id: ACCOUNT_ID,
    tax_code_id: null,
  },
  {
    line_order: 1,
    item_id: "9f8e7d6c-5b4a-4398-8776-655443322110",
    description: "Sample pendant",
    quantity: 1,
    unit_price_minor: 42_000,
    income_account_id: ACCOUNT_ID,
    tax_code_id: MA_RATE_ID,
  },
];

const prefill = estimateToInvoicePrefill(
  {
    id: ESTIMATE_ID,
    estimate_number: "EST-000007",
    customer_id: CUSTOMER_ID,
    declined_at: null,
    live_invoice: null,
  },
  lines,
);

describe("invoiceFormFromEstimate", () => {
  it("keeps each line's tax code exactly, so an untaxed line is not taxed on the way", () => {
    // Picking this customer by hand would fill the state's rate into every
    // line without one: the customer is in MA and the company has one MA rate.
    const maRate = {
      id: MA_RATE_ID,
      code: "MA-6.25",
      name: "Massachusetts sales tax",
      rate_percent: 6.25,
      direction: "sales" as const,
      tax_account_id: null,
      is_active: true,
      state_code: "MA",
    };
    expect(defaultTaxCodeForState("MA", [maRate])?.id).toBe(MA_RATE_ID);

    const values = invoiceFormFromEstimate(prefill, {
      currencyCode: "USD",
      customerTermsDays: 15,
      defaultTermsDays: 30,
    });
    expect(values.lines.map((line) => line.tax_code_id)).toEqual([MA_RATE_ID, null]);
  });

  it("carries the customer, the currency and every line in the estimate's order, losing nothing", () => {
    const values = invoiceFormFromEstimate(prefill, {
      currencyCode: "USD",
      customerTermsDays: null,
      defaultTermsDays: 30,
    });
    expect(values.customer_id).toBe(CUSTOMER_ID);
    expect(values.currency_code).toBe("USD");
    expect(values.lines).toEqual([
      {
        item_id: "9f8e7d6c-5b4a-4398-8776-655443322110",
        description: "Sample pendant",
        quantity: 1,
        unit_price: 420,
        income_account_id: ACCOUNT_ID,
        tax_code_id: MA_RATE_ID,
      },
      {
        item_id: null,
        description: "Design consultation",
        quantity: 2,
        unit_price: 75,
        income_account_id: ACCOUNT_ID,
        tax_code_id: null,
      },
    ]);
  });

  it("sets the due date from the customer's terms, as picking the customer would", () => {
    const terms = (customerTermsDays: number | null | undefined) =>
      invoiceFormFromEstimate(prefill, { currencyCode: "USD", customerTermsDays, defaultTermsDays: 30 }).dueInDays;
    expect(terms(15)).toBe(15);
    expect(terms(0)).toBe(0);
    expect(terms(null)).toBe(30);
    expect(terms(undefined)).toBe(30);
  });

  it("hands the form its own copies, so editing the form cannot change the prefill", () => {
    const values = invoiceFormFromEstimate(prefill, { currencyCode: "USD", customerTermsDays: null, defaultTermsDays: 30 });
    values.lines[0].quantity = 99;
    expect(prefill.values.lines[0].quantity).toBe(1);
  });
});

describe("estimateConversionHref", () => {
  it("opens New invoice on the Invoices screen, filled in from the estimate", () => {
    expect(estimateConversionHref(ESTIMATE_ID)).toBe(`/invoices?new=1&estimate=${ESTIMATE_ID}`);
  });
});

describe("the Invoices screen opened from an estimate", () => {
  const page = read("app", "(app)", "invoices", "page.tsx");
  const client = read("app", "(app)", "invoices", "InvoicesClient.tsx");

  it("reads the estimate on the server, for writers only, and never lets a failure take the list down", () => {
    expect(page).toContain("estimateLink(sb, params.estimate)");
    expect(page).toContain("if (!canWrite(await getUserRole())) return { prefill: null, notice: null };");
    expect(page).toContain("} catch (err) {");
    expect(page).toContain("return { prefill: null, notice: `The estimate could not be read${reason}` };");
    // A blocked estimate says so instead of opening a form.
    expect(page).toContain('const initialCreateOpen = params.new === "1" && fromEstimate.notice === null;');
  });

  it("fills the form through invoiceFormFromEstimate, not by picking the customer", () => {
    expect(client).toContain("invoiceFormFromEstimate(fromEstimate,");
    expect(client).toContain("initialValues={estimateFormValues ??");
    // applyCustomerDefaults runs only when somebody picks a customer.
    expect(client.match(/applyCustomerDefaults/g)).toHaveLength(2);
    expect(client).toContain("onChange={applyCustomerDefaults}");
  });

  it("sends the estimate with the draft, and says what happened in the spec's words", () => {
    expect(client).toContain("estimateId: fromEstimate.estimateId");
    expect(client).toContain("estimateMessages.invoiceCreated(fromEstimate.estimateNumber)");
    expect(client).toContain("estimateMessages.fromEstimate(fromEstimate.estimateNumber)");
    expect(client).toContain("setCreateError(res.error");
  });

  it("names the estimate in the invoice's detail, linking to Estimates", () => {
    expect(client).toContain('<Link href="/estimates">{estimateMessages.fromEstimate(viewEstimate.estimate_number)}</Link>');
  });
});
```

- [ ] **Step 2: Edit `ctyhp-accounting/tests/unit/invoice-pdf.test.ts`** — apply these 2 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 2 — find:

```ts
import { buildInvoiceDocument } from "@/lib/domain/invoice-document";
import { renderInvoicePdf } from "@/lib/client/invoice-pdf";
```

replace with:

```ts
import { buildInvoiceDocument } from "@/lib/domain/invoice-document";
import { buildEstimateDocument, ESTIMATE_CLOSING_LINE } from "@/lib/domain/estimate-document";
import { renderInvoicePdf } from "@/lib/client/invoice-pdf";
```

Edit 2 of 2 — find:

```ts

describe("the PDF library is only loaded when a PDF is asked for", () => {
```

replace with:

```ts

/** The page content as text: jsPDF writes its streams uncompressed unless asked otherwise. */
function pdfText(bytes: Uint8Array): string {
  return new TextDecoder("latin1").decode(bytes);
}

const estimateSource = {
  estimate: {
    estimate_number: "EST-000004",
    estimate_date: "2026-10-01",
    expiry_date: "2026-10-31",
    currency_code: "USD",
    subtotal_minor: 60_000,
    tax_minor: 3_750,
    total_minor: 63_750,
    memo: "Prices hold for thirty days.",
  },
  lines: [
    {
      line_order: 1,
      description: "Sample ring resizing",
      quantity: 2,
      unit_price_minor: 30_000,
      line_subtotal_minor: 60_000,
      line_tax_minor: 3_750,
      line_total_minor: 63_750,
    },
  ],
  customer: source.customer,
  company: source.company,
};

describe("renderInvoicePdf, drawing an estimate", () => {
  it("produces a real PDF file", async () => {
    const pdf = await renderInvoicePdf(buildEstimateDocument(estimateSource));
    const bytes = new Uint8Array(pdf.output("arraybuffer") as ArrayBuffer);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("draws the closing line after the note", async () => {
    const pdf = await renderInvoicePdf(buildEstimateDocument(estimateSource));
    const text = pdfText(new Uint8Array(pdf.output("arraybuffer") as ArrayBuffer));
    const note = text.indexOf("(Prices hold for thirty days.)");
    const closing = text.indexOf(`(${ESTIMATE_CLOSING_LINE})`);
    expect(note).toBeGreaterThan(-1);
    expect(closing).toBeGreaterThan(note);
  });

  it("draws the closing line when there is no note", async () => {
    const pdf = await renderInvoicePdf(
      buildEstimateDocument({ ...estimateSource, estimate: { ...estimateSource.estimate, memo: null } }),
    );
    expect(pdfText(new Uint8Array(pdf.output("arraybuffer") as ArrayBuffer))).toContain(`(${ESTIMATE_CLOSING_LINE})`);
  });

  it("emphasises Total, the estimate's last row, as it emphasises an invoice's Balance due", async () => {
    const pdf = await renderInvoicePdf(buildEstimateDocument(estimateSource));
    const text = pdfText(new Uint8Array(pdf.output("arraybuffer") as ArrayBuffer));
    // The emphasised row is set in 11pt; every other totals row in 9pt.
    const total = text.indexOf("(Total)");
    const subtotal = text.indexOf("(Subtotal)");
    expect(text.lastIndexOf(" 11 Tf", total)).toBeGreaterThan(text.lastIndexOf(" 9 Tf", total));
    expect(text.lastIndexOf(" 9 Tf", subtotal)).toBeGreaterThan(text.lastIndexOf(" 11 Tf", subtotal));
  });
});

describe("invoices print as before", () => {
  it("still emphasise Balance due, which the model always puts last", () => {
    // The renderer now emphasises the last totals row instead of the row
    // labelled Balance due. For an invoice they are the same row, paid or not.
    const unpaid = buildInvoiceDocument(source);
    const partlyPaid = buildInvoiceDocument({
      ...source,
      invoice: { ...source.invoice, status: "partial", balance_due_minor: 100_000 },
    });
    expect(unpaid.totals.at(-1)?.label).toBe("Balance due");
    expect(partlyPaid.totals.map((t) => t.label)).toEqual([
      "Subtotal",
      "Sales tax",
      "Total",
      "Paid to date",
      "Balance due",
    ]);
  });

  it("set Balance due in 11pt and draw no closing line", async () => {
    const text = pdfText(await pdfBytes());
    const balance = text.indexOf("(Balance due)");
    expect(text.lastIndexOf(" 11 Tf", balance)).toBeGreaterThan(text.lastIndexOf(" 9 Tf", balance));
    expect(text).not.toContain("quotation");
  });
});

describe("the PDF library is only loaded when a PDF is asked for", () => {
```

- [ ] **Step 3: Edit `ctyhp-accounting/tests/unit/navigation.test.ts`** — apply these 2 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 2 — find:

```ts
      "/invoices",
      "/payments",
```

replace with:

```ts
      "/invoices",
      "/estimates",
      "/payments",
```

Edit 2 of 2 — find:

```ts
      "invoice",
      "payment",
```

replace with:

```ts
      "invoice",
      "estimate",
      "payment",
```

- [ ] **Step 4: Run the tests to see them fail**

```bash
npx vitest run tests/unit/estimates-screen.test.ts tests/unit/invoice-pdf.test.ts tests/unit/navigation.test.ts
```

Expected: FAIL — `tests/unit/estimates-screen.test.ts` imports `app/(app)/estimates/estimate-columns`, which does not exist yet.

- [ ] **Step 5: Create `ctyhp-accounting/components/SalesLineItems.tsx`** with exactly this content:

```tsx
"use client";
import { Button, Form, Input, InputNumber, Select, Space, Typography } from "antd";
import type { SelectProps } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import IconActionButton from "@/components/ui/IconActionButton";
import EmptyCatalogHint from "@/components/EmptyCatalogHint";
import type { AccountRow, ItemRow } from "@/lib/db/types";
import { itemToInvoiceLineDefaults } from "@/lib/domain/items";

/**
 * The line items of a sales document: item, description, quantity, unit
 * price, income account and tax code, one row each.
 *
 * Written for the New invoice form and shared with the estimate form, because
 * an estimate is turned into an invoice and the promise is that nothing is
 * lost on the way. Two editors would drift: a picker that filled the price on
 * one and not the other would make the same customer two different totals.
 *
 * Renders inside the caller's `<Form>`, whose `lines` list it owns. Picking an
 * item fills that line's description, price, income account and tax code from
 * the catalog (`itemToInvoiceLineDefaults`); every field stays editable.
 */
export default function SalesLineItems({
  items,
  incomeAccounts,
  taxOptions,
  decimals,
  canManageItems,
  removeLabel,
}: {
  /** Sold, active catalog entries. */
  items: ItemRow[];
  incomeAccounts: AccountRow[];
  /** Sales tax codes, grouped by state. */
  taxOptions: SelectProps["options"];
  /** The document currency's decimal places, for the price an item fills in. */
  decimals: number;
  /** Holds `items.manage`, so the empty-catalog hint can link to the catalog. */
  canManageItems: boolean;
  /** Read out for the remove button on each line. */
  removeLabel: string;
}) {
  const form = Form.useFormInstance();
  return (
    <>
      <Typography.Text strong>Line items</Typography.Text>
      <Form.List name="lines">
        {(fields, { add, remove }) => (
          <div style={{ marginTop: 8 }}>
            {fields.map((field) => (
              <Space key={field.key} align="baseline" style={{ display: "flex", marginBottom: 8 }} wrap>
                <Form.Item name={[field.name, "item_id"]} style={{ marginBottom: 0, width: 190 }}>
                  <Select
                    allowClear
                    showSearch
                    placeholder="Item (optional)"
                    optionFilterProp="label"
                    notFoundContent={items.length === 0 ? "No products or services yet" : undefined}
                    options={items.map((i) => ({ value: i.id, label: i.name }))}
                    onChange={(itemId) => {
                      const it = items.find((i) => i.id === itemId);
                      if (!it) return;
                      const d = itemToInvoiceLineDefaults(it);
                      form.setFields([
                        { name: ["lines", field.name, "description"], value: d.description },
                        { name: ["lines", field.name, "unit_price"], value: d.unit_price_minor / 10 ** decimals },
                        { name: ["lines", field.name, "income_account_id"], value: d.income_account_id ?? undefined },
                        { name: ["lines", field.name, "tax_code_id"], value: d.tax_code_id ?? undefined },
                      ]);
                    }}
                  />
                </Form.Item>
                <Form.Item name={[field.name, "description"]} style={{ marginBottom: 0, width: 200 }}>
                  <Input placeholder="Description" />
                </Form.Item>
                <Form.Item name={[field.name, "quantity"]} style={{ marginBottom: 0 }} rules={[{ required: true, message: "Quantity" }]}>
                  <InputNumber placeholder="Quantity" min={0} style={{ width: 90 }} />
                </Form.Item>
                <Form.Item name={[field.name, "unit_price"]} style={{ marginBottom: 0 }} rules={[{ required: true, message: "Price" }]}>
                  <InputNumber placeholder="Unit price" min={0} step={0.01} style={{ width: 130 }} prefix="$" />
                </Form.Item>
                <Form.Item name={[field.name, "income_account_id"]} style={{ marginBottom: 0, width: 200 }} rules={[{ required: true, message: "Account" }]}>
                  <Select
                    placeholder="Income account"
                    options={incomeAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))}
                  />
                </Form.Item>
                <Form.Item name={[field.name, "tax_code_id"]} style={{ marginBottom: 0, width: 190 }}>
                  <Select
                    allowClear
                    showSearch
                    placeholder="Tax"
                    optionFilterProp="label"
                    options={taxOptions}
                  />
                </Form.Item>
                <IconActionButton
                  label={removeLabel}
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => remove(field.name)}
                />
              </Space>
            ))}
            <Button type="dashed" onClick={() => add({ quantity: 1 })} icon={<PlusOutlined />} block>
              Add line
            </Button>
          </div>
        )}
      </Form.List>

      {items.length === 0 ? (
        <div style={{ marginTop: 8 }}>
          <EmptyCatalogHint canManage={canManageItems}>
            No products or services yet, so every line must be typed in full. Save the price once in
          </EmptyCatalogHint>
        </div>
      ) : null}
    </>
  );
}
```

- [ ] **Step 6: Create `ctyhp-accounting/components/NewCustomerButton.tsx`** with exactly this content:

```tsx
"use client";
import { useState } from "react";
import { App, Button, Form, Input, Modal } from "antd";
import { createCustomerAction } from "@/app/(app)/invoices/actions";

/**
 * Create a customer without leaving the document being written.
 *
 * The same two fields as the New invoice form's "+ New customer": a name and
 * an email. Terms, address and credit limit are set on the Customers screen;
 * a document needs only someone to address. Calls the invoices' own action,
 * so a customer added here is the same record either way.
 */
export default function NewCustomerButton({
  onCreated,
  disabled,
}: {
  /** Called with the new customer so the caller can list and select it at once. */
  onCreated: (customer: { id: string; name: string }) => void;
  disabled?: boolean;
}) {
  const { message } = App.useApp();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<{ name: string; email?: string }>();

  async function submit() {
    const values = await form.validateFields();
    setSaving(true);
    const res = await createCustomerAction(values);
    setSaving(false);
    if (!res.ok || !res.data) {
      message.error(res.error ?? "Failed to add customer");
      return;
    }
    onCreated(res.data);
    message.success("Customer added");
    setOpen(false);
    form.resetFields();
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} disabled={disabled}>
        + New customer
      </Button>
      <Modal
        title="New customer"
        open={open}
        onOk={submit}
        onCancel={() => setOpen(false)}
        confirmLoading={saving}
        okText="Add"
        cancelText="Cancel"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item name="name" label="Name" rules={[{ required: true, message: "Enter a name" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="email" label="Email">
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
```

- [ ] **Step 7: Edit `ctyhp-accounting/lib/client/invoice-pdf.ts`** — apply these 9 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 9 — find:

```ts
import type { jsPDF } from "jspdf";
import type { InvoiceDocument } from "@/lib/domain/invoice-document";
import { invoiceDocumentFileName } from "@/lib/domain/invoice-document";
```

replace with:

```ts
import type { jsPDF } from "jspdf";
import type { InvoiceDocument, PrintedDocument } from "@/lib/domain/invoice-document";
import { invoiceDocumentFileName } from "@/lib/domain/invoice-document";
```

Edit 2 of 9 — find:

```ts
import { invoiceDocumentFileName } from "@/lib/domain/invoice-document";

```

replace with:

```ts
import { invoiceDocumentFileName } from "@/lib/domain/invoice-document";
import type { EstimateDocument } from "@/lib/domain/estimate-document";

/**
 * What this renderer draws: an invoice, or an estimate, which adds a closing
 * line under its note (lib/domain/estimate-document).
 */
export type RenderableDocument = PrintedDocument & { footer?: string | null };

```

Edit 3 of 9 — find:

```ts
/**
 * Draws the document model produced by lib/domain/invoice-document. Every
 * string here already came from that module — this file decides placement,
 * never content.
```

replace with:

```ts
/**
 * Draws the document model produced by lib/domain/invoice-document, or the
 * estimate's from lib/domain/estimate-document, which shares its layout. Every
 * string here already came from those modules — this file decides placement,
 * never content.
```

Edit 4 of 9 — find:

```ts
 */
export async function renderInvoicePdf(doc: InvoiceDocument): Promise<jsPDF> {
  const { jsPDF, autoTable } = await pdfLibrary();
```

replace with:

```ts
 */
export async function renderInvoicePdf(doc: RenderableDocument): Promise<jsPDF> {
  const { jsPDF, autoTable } = await pdfLibrary();
```

Edit 5 of 9 — find:

```ts
  let totalsY = (pdf.lastAutoTable?.finalY ?? billY) + 22;
  for (const total of doc.totals) {
    const emphasise = total.label === "Balance due";
    pdf.setFont("helvetica", emphasise ? "bold" : "normal");
```

replace with:

```ts
  let totalsY = (pdf.lastAutoTable?.finalY ?? billY) + 22;
  doc.totals.forEach((total, index) => {
    // The last row is the figure the reader acts on: Balance due on an
    // invoice, which the model always puts last, and Total on an estimate,
    // which owes nothing.
    const emphasise = index === doc.totals.length - 1;
    pdf.setFont("helvetica", emphasise ? "bold" : "normal");
```

Edit 6 of 9 — find:

```ts
    totalsY += emphasise ? 18 : 14;
  }

```

replace with:

```ts
    totalsY += emphasise ? 18 : 14;
  });

```

Edit 7 of 9 — find:

```ts

  if (doc.memo) {
```

replace with:

```ts

  let footY = totalsY + 10;
  if (doc.memo) {
```

Edit 8 of 9 — find:

```ts
    pdf.setTextColor(...MUTED);
    pdf.text(pdf.splitTextToSize(doc.memo, pageWidth - MARGIN * 2), MARGIN, totalsY + 10);
  }
```

replace with:

```ts
    pdf.setTextColor(...MUTED);
    const memoLines: string[] = pdf.splitTextToSize(doc.memo, pageWidth - MARGIN * 2);
    pdf.text(memoLines, MARGIN, footY);
    footY += memoLines.length * pdf.getLineHeight() + 8;
  }

  if (doc.footer) {
    // Starts a page of its own rather than running into the page number.
    if (footY > pdf.internal.pageSize.getHeight() - 48) {
      pdf.addPage();
      footY = 64;
    }
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(...INK);
    pdf.text(pdf.splitTextToSize(doc.footer, pageWidth - MARGIN * 2), MARGIN, footY);
  }
```

Edit 9 of 9 — find:

```ts

/** Opens the browser print dialog on the rendered document. */
```

replace with:

```ts

/** Saves an estimate under the name its model gives it: `Estimate EST-000001 <customer>.pdf`. */
export async function downloadEstimatePdf(doc: EstimateDocument): Promise<void> {
  const pdf = await renderInvoicePdf(doc);
  pdf.save(doc.fileName);
}

/** Opens the browser print dialog on the rendered document. */
```

- [ ] **Step 8: Edit `ctyhp-accounting/lib/domain/navigation.ts`** — apply these 2 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 2 — find:

```ts
      { key: "/invoices", label: "Invoices" },
      { key: "/payments", label: "Payments" },
```

replace with:

```ts
      { key: "/invoices", label: "Invoices" },
      { key: "/estimates", label: "Estimates" },
      { key: "/payments", label: "Payments" },
```

Edit 2 of 2 — find:

```ts
  { key: "invoice", label: "Invoice", href: "/invoices?new=1" },
  { key: "payment", label: "Payment received", href: "/payments?new=1" },
```

replace with:

```ts
  { key: "invoice", label: "Invoice", href: "/invoices?new=1" },
  { key: "estimate", label: "Estimate", href: "/estimates?new=1" },
  { key: "payment", label: "Payment received", href: "/payments?new=1" },
```

- [ ] **Step 9: Create `ctyhp-accounting/app/(app)/estimates/estimate-columns.ts`** with exactly this content:

```ts
import { COLUMN } from "@/lib/design/table-metrics";
import type { Tone } from "@/lib/design/tone";
import { ESTIMATE_STATE_LABELS, type EstimateState } from "@/lib/domain/estimates";

/**
 * How each state reads. Converted is the good outcome; Expired needs a look
 * before it is turned into an invoice; Declined is off the table, like a void
 * document; Open is work in progress.
 */
export const ESTIMATE_STATE_TONES: Record<EstimateState, { tone: Tone; label: string }> = {
  open: { tone: "neutral", label: ESTIMATE_STATE_LABELS.open },
  expired: { tone: "warning", label: ESTIMATE_STATE_LABELS.expired },
  declined: { tone: "muted", label: ESTIMATE_STATE_LABELS.declined },
  converted: { tone: "positive", label: ESTIMATE_STATE_LABELS.converted },
};

/**
 * The Estimates list's measured columns, in the order they are drawn, and the
 * floor of its one elastic column (Customer).
 *
 * Kept apart from the client component so tests/unit/estimates-screen.test.ts
 * can add them up against the 984px box of a 1280px window without rendering
 * the table.
 */
export const ESTIMATE_COLUMN_WIDTH = {
  number: COLUMN.CODE,
  date: COLUMN.DATE,
  /**
   * A date, but under a two-word heading: at COLUMN.DATE "Valid until" wraps
   * onto a second line and makes the whole heading row taller, which is what
   * the invoice list renamed "Issue date" to "Issued" to avoid.
   */
  validUntil: 104,
  total: COLUMN.MONEY,
  state: COLUMN.STATUS,
  /** The invoice made from it: a number such as INV-000123, or "Draft". */
  invoice: COLUMN.CODE,
  /** One "⋯" button. */
  actions: COLUMN.ACTION + 8,
} as const;

/** Customer takes what the measured columns leave, down to this. */
export const ESTIMATE_ELASTIC_FLOOR = COLUMN.TEXT_MIN;
```

- [ ] **Step 10: Create `ctyhp-accounting/app/(app)/estimates/estimates.module.css`** with exactly this content:

```css
/*
 * The Estimates list (EstimatesClient.tsx). The state pills are drawn the way
 * Chart of Accounts draws its type pills, so the two filters read as one
 * control. Every colour is a token, so the dark theme follows.
 */

/* ---------- state pills ---------- */

.pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0 0 14px;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 13px;
  border: 1px solid var(--ob-border-default);
  border-radius: 999px;
  background: var(--ob-surface-card);
  color: var(--ob-text-secondary);
  font: inherit;
  font-size: 12.5px;
  line-height: 1.4;
  cursor: pointer;
  transition:
    color 140ms ease,
    background-color 140ms ease,
    border-color 140ms ease;
}

.pill:hover {
  color: var(--ob-text-heading);
  border-color: var(--ob-border-muted);
}

.pill:focus-visible {
  outline: 2px solid var(--ob-intent-primary);
  outline-offset: 2px;
}

/* The pressed pill is filled with ink: dark on a light page, light on a dark one. */
.pill[aria-pressed="true"] {
  color: var(--ob-surface-card);
  background: var(--ob-text-heading);
  border-color: var(--ob-text-heading);
  font-weight: 600;
}

.pillCount {
  font-variant-numeric: tabular-nums;
}

/* ---------- the list ---------- */

/* The number opens the estimate; a link button without the button's padding. */
.number {
  padding: 0;
  height: auto;
  font-variant-numeric: tabular-nums;
}

.money {
  font-variant-numeric: tabular-nums;
}

/* ---------- the form ---------- */

.formTitle {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.formTitleState {
  font-size: 13px;
  font-weight: 400;
}

.notice {
  margin-bottom: 16px;
}

.totals {
  margin-top: 4px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.totals > div {
  line-height: 1.7;
}
```

- [ ] **Step 11: Create `ctyhp-accounting/app/(app)/estimates/EstimateFormModal.tsx`** with exactly this content:

```tsx
"use client";
import { useMemo, useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { Alert, App, Button, DatePicker, Form, Input, Modal, Select, Space } from "antd";
import SalesLineItems from "@/components/SalesLineItems";
import NewCustomerButton from "@/components/NewCustomerButton";
import { ToneBadge } from "@/lib/design/tone";
import type { AccountRow, CustomerRow, ItemRow, TaxCodeRow } from "@/lib/db/types";
import { USD_CURRENCY_CODE, USD_DECIMAL_PLACES } from "@/lib/domain/currency";
import {
  ESTIMATE_STATE_LABELS,
  defaultExpiryDate,
  estimateActions,
  estimateLineToFormLine,
  estimateMessages,
  estimateState,
  formLineToLineInput,
  formLinesTotals,
  type DocumentFormLine,
} from "@/lib/domain/estimates";
import {
  defaultTaxCodeForState,
  groupTaxCodesByState,
  taxCodeLabel,
} from "@/lib/domain/tax-jurisdiction";
import { formatMoney } from "@/lib/format";
import { saveEstimateAction, type EstimateDetailView } from "./actions";
import { ESTIMATE_STATE_TONES } from "./estimate-columns";
import styles from "./estimates.module.css";

/** What "Turn into an invoice" hands back to the list, which asks first when it has expired. */
export interface ConversionTarget {
  id: string;
  estimate_number: string;
  expiry_date: string;
  expired: boolean;
}

interface Props {
  open: boolean;
  /** The estimate being edited or viewed; null for a new one. */
  detail: EstimateDetailView | null;
  /** The company's today, from the server: the default estimate date and the day "expired" is judged on. */
  today: string;
  customers: CustomerRow[];
  incomeAccounts: AccountRow[];
  taxCodes: TaxCodeRow[];
  usStates: { code: string; name: string }[];
  items: ItemRow[];
  canWrite: boolean;
  canManageItems: boolean;
  onClose: () => void;
  onConvert: (target: ConversionTarget) => void;
}

interface FormValues {
  customer_id?: string;
  estimate_date?: Dayjs;
  expiry_date?: Dayjs | null;
  memo?: string;
  lines?: DocumentFormLine[];
}

const ISO = "YYYY-MM-DD";

/**
 * New estimate, Edit estimate, or a read-only view of one that can no longer
 * change (Converted) or of any estimate to someone who cannot write.
 *
 * The body mounts only while the dialog is open, so the form starts from the
 * estimate being edited without an effect, as the purchase order form does.
 */
export default function EstimateFormModal(props: Props) {
  if (!props.open) return null;
  return <EstimateFormBody {...props} />;
}

function EstimateFormBody({
  detail,
  today,
  customers,
  incomeAccounts,
  taxCodes,
  usStates,
  items,
  canWrite,
  canManageItems,
  onClose,
  onConvert,
}: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const estimate = detail?.estimate ?? null;
  const actions = detail ? estimateActions(detail.state, canWrite) : null;
  const readOnly = detail ? !actions!.edit : !canWrite;

  // A customer added from inside this dialog has to be pickable now; the
  // page's own list catches up when the estimate is saved.
  const [addedCustomers, setAddedCustomers] = useState<{ id: string; name: string }[]>([]);
  const customerOptions = useMemo(() => {
    const listed = customers
      // The database takes only an active customer, but an estimate already
      // written to one since made inactive must still show its name.
      .filter((c) => c.is_active || c.id === estimate?.customer_id)
      .map((c) => ({ value: c.id, label: c.name }));
    const added = addedCustomers
      .filter((c) => !listed.some((option) => option.value === c.id))
      .map((c) => ({ value: c.id, label: c.name }));
    return [...listed, ...added].sort((a, b) => a.label.localeCompare(b.label));
  }, [customers, addedCustomers, estimate?.customer_id]);

  const taxOptions = useMemo(
    () =>
      groupTaxCodesByState(taxCodes, usStates).map((group) => ({
        label: group.stateName,
        title: group.stateName,
        options: group.codes.map((code) => ({ value: code.id, label: taxCodeLabel(code) })),
      })),
    [taxCodes, usStates],
  );

  const initialValues = useMemo<FormValues>(() => {
    if (!detail) {
      return {
        estimate_date: dayjs(today),
        expiry_date: dayjs(defaultExpiryDate(today)),
        lines: [{ quantity: 1 }],
      };
    }
    return {
      customer_id: detail.estimate.customer_id,
      estimate_date: dayjs(detail.estimate.estimate_date),
      expiry_date: dayjs(detail.estimate.expiry_date),
      memo: detail.estimate.memo ?? undefined,
      lines: detail.lines.map(estimateLineToFormLine),
    };
    // Computed once at mount; the dialog remounts on each open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Valid until" follows the estimate date, 30 days on, until somebody sets
  // it by hand. An estimate saved with its own date keeps it.
  const [expiryFollowsDate, setExpiryFollowsDate] = useState(
    () => !detail || detail.estimate.expiry_date === defaultExpiryDate(detail.estimate.estimate_date),
  );

  const watchedLines: DocumentFormLine[] = Form.useWatch("lines", form) ?? [];
  const taxRateOf = (id: string | null | undefined) =>
    id ? Number(taxCodes.find((t) => t.id === id)?.rate_percent ?? 0) : 0;
  const totals = formLinesTotals(watchedLines, taxRateOf);
  const money = (minor: number) => formatMoney(minor, USD_CURRENCY_CODE, USD_DECIMAL_PLACES);

  function onEstimateDateChange(value: Dayjs | null) {
    if (!value || !expiryFollowsDate) return;
    form.setFieldValue("expiry_date", dayjs(defaultExpiryDate(value.format(ISO))));
  }

  /**
   * As on the New invoice form: the customer's state rate goes on every line
   * that has no rate yet, never over one somebody chose, and only where the
   * company has exactly one rate in that state.
   */
  function onCustomerChange(customerId: string) {
    const customer = customers.find((c) => c.id === customerId);
    const rate = defaultTaxCodeForState(customer?.region, taxCodes);
    if (!rate) return;
    const lines: DocumentFormLine[] = form.getFieldValue("lines") ?? [];
    let filled = 0;
    lines.forEach((line, index) => {
      if (line?.tax_code_id) return;
      form.setFields([{ name: ["lines", index, "tax_code_id"], value: rate.id }]);
      filled += 1;
    });
    if (filled > 0) message.info(`Applied ${taxCodeLabel(rate)} for ${customer?.region}`);
  }

  function addCustomer(customer: { id: string; name: string }) {
    setAddedCustomers((prev) => [...prev, customer]);
    form.setFieldValue("customer_id", customer.id);
  }

  /** Saves the form; the number is assigned on the first save. Null when it did not save. */
  async function save(): Promise<{ id: string; estimate_number: string; expiry_date: string } | null> {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return null;
    }
    const expiry = values.expiry_date ? values.expiry_date.format(ISO) : null;
    setSaving(true);
    setError(null);
    const res = await saveEstimateAction(estimate?.id ?? null, {
      customer_id: values.customer_id,
      currency_code: USD_CURRENCY_CODE,
      estimate_date: values.estimate_date?.format(ISO),
      expiry_date: expiry,
      memo: values.memo?.trim() || null,
      lines: (values.lines ?? []).map(formLineToLineInput),
    });
    setSaving(false);
    if (!res.ok || !res.data) {
      // The server's words, in the form, where the thing to fix is.
      setError(res.error ?? "Failed to save the estimate");
      return null;
    }
    const estimateDate = values.estimate_date?.format(ISO) ?? today;
    return {
      id: res.data.id,
      estimate_number: res.data.estimate_number,
      expiry_date: expiry ?? defaultExpiryDate(estimateDate),
    };
  }

  async function submit() {
    const saved = await save();
    if (!saved) return;
    message.success(`${saved.estimate_number} saved.`);
    onClose();
  }

  /**
   * Unsaved changes are saved first, so the invoice is made from what is on
   * the screen rather than from what was stored before.
   */
  async function turnIntoInvoice() {
    if (!estimate) return;
    let target = { id: estimate.id, estimate_number: estimate.estimate_number, expiry_date: estimate.expiry_date };
    if (form.isFieldsTouched()) {
      const saved = await save();
      if (!saved) return;
      message.success(`${saved.estimate_number} saved.`);
      target = saved;
    }
    const state = estimateState({ declinedAt: null, expiryDate: target.expiry_date, hasLiveInvoice: false }, today);
    onConvert({ ...target, expired: state === "expired" });
  }

  const title = estimate ? (
    <span className={styles.formTitle}>
      <span>{readOnly ? `Estimate ${estimate.estimate_number}` : `Edit estimate ${estimate.estimate_number}`}</span>
      <span className={styles.formTitleState}>
        <ToneBadge tone={ESTIMATE_STATE_TONES[detail!.state].tone}>{ESTIMATE_STATE_LABELS[detail!.state]}</ToneBadge>
      </span>
    </span>
  ) : (
    "New estimate"
  );

  const footer = [
    <Button key="close" onClick={onClose}>
      {readOnly ? "Close" : "Cancel"}
    </Button>,
  ];
  if (estimate && actions?.convert) {
    footer.push(
      <Button key="convert" onClick={turnIntoInvoice} disabled={saving}>
        Turn into an invoice
      </Button>,
    );
  }
  if (!readOnly) {
    footer.push(
      <Button key="save" type="primary" loading={saving} onClick={submit}>
        Save
      </Button>,
    );
  }

  return (
    <Modal title={title} open onCancel={onClose} footer={footer} width={860}>
      {estimate?.live_invoice ? (
        <Alert
          className={styles.notice}
          type="info"
          showIcon
          title={estimateMessages.alreadyConverted(estimate.estimate_number, estimate.live_invoice.invoice_number)}
        />
      ) : null}

      <Form<FormValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        disabled={readOnly}
        initialValues={initialValues}
      >
        {/* A block row, so "Line items" below starts on its own line. */}
        <Space align="end" wrap style={{ display: "flex" }}>
          <Form.Item
            name="customer_id"
            label="Customer"
            rules={[{ required: true, message: "Select a customer" }]}
            style={{ minWidth: 280 }}
          >
            <Select
              showSearch
              filterOption={(input, option) => String(option?.label ?? "").toLowerCase().includes(input.toLowerCase())}
              placeholder="Select a customer"
              options={customerOptions}
              onChange={onCustomerChange}
            />
          </Form.Item>
          <Form.Item label=" ">
            <NewCustomerButton onCreated={addCustomer} disabled={readOnly} />
          </Form.Item>
          <Form.Item
            name="estimate_date"
            label="Estimate date"
            rules={[{ required: true, message: "Choose the estimate date." }]}
          >
            <DatePicker allowClear={false} onChange={onEstimateDateChange} />
          </Form.Item>
          <Form.Item
            name="expiry_date"
            label="Valid until"
            dependencies={["estimate_date"]}
            rules={[
              ({ getFieldValue }) => ({
                validator(_, value: Dayjs | null | undefined) {
                  const date: Dayjs | undefined = getFieldValue("estimate_date");
                  if (!value || !date || !value.isBefore(date, "day")) return Promise.resolve();
                  return Promise.reject(new Error("Valid until cannot be before the estimate date."));
                },
              }),
            ]}
          >
            <DatePicker onChange={() => setExpiryFollowsDate(false)} />
          </Form.Item>
        </Space>

        <SalesLineItems
          items={items}
          incomeAccounts={incomeAccounts}
          taxOptions={taxOptions}
          decimals={USD_DECIMAL_PLACES}
          canManageItems={canManageItems}
          removeLabel="Remove estimate line"
        />

        <Form.Item name="memo" label="Note printed at the foot" style={{ marginTop: 12 }}>
          <Input.TextArea rows={2} maxLength={500} />
        </Form.Item>

        <div className={styles.totals} aria-live="polite">
          <div>Subtotal: {money(totals.subtotalMinor)}</div>
          <div>Sales tax: {money(totals.taxTotalMinor)}</div>
          <div>
            <strong>Total: {money(totals.totalMinor)}</strong>
          </div>
        </div>

        {error ? <Alert style={{ marginTop: 12 }} type="error" showIcon title={error} /> : null}
      </Form>
    </Modal>
  );
}
```

- [ ] **Step 12: Create `ctyhp-accounting/app/(app)/estimates/EstimatesClient.tsx`** with exactly this content:

```tsx
"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { App, Button, Dropdown, Input, type MenuProps, type TableColumnsType } from "antd";
import { MoreOutlined, PlusOutlined } from "@ant-design/icons";
import DataTable from "@/components/ui/DataTable";
import FilterBar from "@/components/ui/FilterBar";
import { dateColumn, flexColumn, statusColumn } from "@/components/ui/columns";
import { useInitiallyOpen } from "@/lib/client/use-initially-open";
import { downloadEstimatePdf } from "@/lib/client/invoice-pdf";
import type { AccountRow, CustomerRow, ItemRow, TaxCodeRow } from "@/lib/db/types";
import { USD_DECIMAL_PLACES } from "@/lib/domain/currency";
import { matchesDocumentKeyword } from "@/lib/domain/document-filter";
import {
  ESTIMATE_FILTERS,
  countEstimatesByFilter,
  estimateActions,
  estimateConversionHref,
  estimateInFilter,
  estimateMessages,
  type EstimateFilter,
} from "@/lib/domain/estimates";
import { formatMoney } from "@/lib/format";
import {
  declineEstimateAction,
  deleteEstimateAction,
  getEstimateDetailAction,
  getEstimateDocumentAction,
  reopenEstimateAction,
  type EstimateDetailView,
  type EstimateListEntry,
} from "./actions";
import EstimateFormModal, { type ConversionTarget } from "./EstimateFormModal";
import { ESTIMATE_COLUMN_WIDTH, ESTIMATE_ELASTIC_FLOOR, ESTIMATE_STATE_TONES } from "./estimate-columns";
import styles from "./estimates.module.css";

export default function EstimatesClient({
  initialCreateOpen,
  estimates,
  today,
  customers,
  incomeAccounts,
  taxCodes,
  usStates,
  items,
  canWrite,
  canManageItems,
}: {
  /** Seeded by the top-bar New menu via `?new=1`. */
  initialCreateOpen: boolean;
  /** Every estimate, each with its state on the company's today. */
  estimates: EstimateListEntry[];
  /** The company's today, in its own time zone: the day every state was worked out for. */
  today: string;
  customers: CustomerRow[];
  incomeAccounts: AccountRow[];
  taxCodes: TaxCodeRow[];
  usStates: { code: string; name: string }[];
  /** Sold, active catalog entries. */
  items: ItemRow[];
  canWrite: boolean;
  /** Holds `items.manage`, so the empty-catalog hint can link to the catalog. */
  canManageItems: boolean;
}) {
  const { message, modal } = App.useApp();
  const router = useRouter();
  const [createOpen, setCreateOpen] = useInitiallyOpen(initialCreateOpen);
  const [editing, setEditing] = useState<EstimateDetailView | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pdfId, setPdfId] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [filter, setFilter] = useState<EstimateFilter>("all");

  // The pills count what the search leaves, so a pill never promises rows the
  // list then hides.
  const searched = useMemo(
    () => estimates.filter((e) => matchesDocumentKeyword([e.estimate_number, e.customer_name], keyword)),
    [estimates, keyword],
  );
  const counts = useMemo(() => countEstimatesByFilter(searched.map((e) => e.state)), [searched]);
  const rows = useMemo(() => searched.filter((e) => estimateInFilter(e.state, filter)), [searched, filter]);
  const narrowed = keyword.trim() !== "" || filter !== "all";

  function openNew() {
    setEditing(null);
    setCreateOpen(true);
  }

  function closeForm() {
    setCreateOpen(false);
    setEditing(null);
  }

  /** Edit, or view one that can no longer change. Reads its lines first. */
  async function openEstimate(row: EstimateListEntry) {
    setBusyId(row.id);
    const res = await getEstimateDetailAction(row.id);
    setBusyId(null);
    if (!res.ok || !res.data) {
      message.error(res.error ?? "Failed to open the estimate");
      return;
    }
    setCreateOpen(false);
    setEditing(res.data);
  }

  /** To the Invoices screen, which opens New invoice filled in. An expired price is asked about first. */
  function turnIntoInvoice(target: ConversionTarget) {
    const go = () => {
      closeForm();
      router.push(estimateConversionHref(target.id));
    };
    if (!target.expired) {
      go();
      return;
    }
    modal.confirm({
      title: estimateMessages.expiredConfirm(target.estimate_number, target.expiry_date),
      okText: "Turn into an invoice",
      cancelText: "Cancel",
      onOk: go,
    });
  }

  /** No confirmation either way: both are undone by the other. */
  async function setDeclined(row: EstimateListEntry, declined: boolean) {
    setBusyId(row.id);
    const res = declined ? await declineEstimateAction(row.id) : await reopenEstimateAction(row.id);
    setBusyId(null);
    if (res.ok && res.data) {
      const n = res.data.estimate_number;
      message.success(declined ? estimateMessages.declined(n) : estimateMessages.reopened(n));
    } else {
      message.error(res.error ?? (declined ? "Failed to mark the estimate declined" : "Failed to reopen the estimate"));
    }
  }

  function confirmDelete(row: EstimateListEntry) {
    modal.confirm({
      title: estimateMessages.deleteConfirm(row.estimate_number),
      okText: "Delete",
      okButtonProps: { danger: true },
      cancelText: "Cancel",
      onOk: async () => {
        const res = await deleteEstimateAction(row.id);
        // A refusal is the database's own words: mark it declined instead.
        if (res.ok) message.success(`${row.estimate_number} deleted.`);
        else message.error(res.error ?? "Failed to delete the estimate");
      },
    });
  }

  async function downloadPdf(row: EstimateListEntry) {
    setPdfId(row.id);
    try {
      const res = await getEstimateDocumentAction(row.id);
      if (!res.ok || !res.data) {
        message.error(res.error ?? "Failed to build the estimate PDF");
        return;
      }
      await downloadEstimatePdf(res.data);
    } finally {
      setPdfId(null);
    }
  }

  const W = ESTIMATE_COLUMN_WIDTH;
  const columns: TableColumnsType<EstimateListEntry> = [
    {
      title: "Number",
      dataIndex: "estimate_number",
      width: W.number,
      render: (n: string, row) => (
        <Button type="link" size="small" className={styles.number} onClick={() => openEstimate(row)}>
          {n}
        </Button>
      ),
    },
    dateColumn<EstimateListEntry>({ title: "Date", dataIndex: "estimate_date", width: W.date }),
    flexColumn<EstimateListEntry>({ title: "Customer", dataIndex: "customer_name", floor: ESTIMATE_ELASTIC_FLOOR }),
    dateColumn<EstimateListEntry>({ title: "Valid until", dataIndex: "expiry_date", width: W.validUntil }),
    {
      title: "Total",
      dataIndex: "total_minor",
      width: W.total,
      align: "right",
      render: (minor: number, row) => (
        <span className={styles.money}>{formatMoney(minor, row.currency_code, USD_DECIMAL_PLACES)}</span>
      ),
    },
    statusColumn<EstimateListEntry>({ title: "State", dataIndex: "state", tones: ESTIMATE_STATE_TONES, width: W.state }),
    {
      // The invoice made from it that is not void: its number once issued.
      title: "Invoice",
      key: "invoice",
      width: W.invoice,
      render: (_: unknown, row) => (row.live_invoice ? (row.live_invoice.invoice_number ?? "Draft") : "—"),
    },
    {
      title: "",
      key: "actions",
      width: W.actions,
      align: "right",
      render: (_: unknown, row) => {
        const can = estimateActions(row.state, canWrite);
        const menu: MenuProps["items"] = [
          { key: "open", label: can.edit ? "Edit" : "View", onClick: () => void openEstimate(row) },
        ];
        if (can.convert) {
          menu.push({
            key: "convert",
            label: "Turn into an invoice",
            onClick: () =>
              turnIntoInvoice({
                id: row.id,
                estimate_number: row.estimate_number,
                expiry_date: row.expiry_date,
                expired: can.confirmConvert,
              }),
          });
        }
        if (can.decline) {
          menu.push({ key: "decline", label: "Mark declined", onClick: () => void setDeclined(row, true) });
        }
        if (can.reopen) {
          menu.push({ key: "reopen", label: "Reopen", onClick: () => void setDeclined(row, false) });
        }
        if (can.pdf) {
          menu.push({
            key: "pdf",
            label: pdfId === row.id ? "Preparing PDF…" : "Download PDF",
            disabled: pdfId === row.id,
            onClick: () => void downloadPdf(row),
          });
        }
        if (can.delete) {
          menu.push({ type: "divider", key: "before-delete" });
          menu.push({ key: "delete", label: "Delete", danger: true, onClick: () => confirmDelete(row) });
        }
        return (
          <Dropdown menu={{ items: menu, style: { minWidth: 176 } }} trigger={["click"]}>
            <Button
              size="small"
              icon={<MoreOutlined />}
              loading={busyId === row.id}
              aria-label={`Actions for ${row.estimate_number}`}
            />
          </Dropdown>
        );
      },
    },
  ];

  const newButton = canWrite ? (
    <Button type="primary" icon={<PlusOutlined />} onClick={openNew}>
      New estimate
    </Button>
  ) : null;

  return (
    <div>
      <div className={styles.pills} role="group" aria-label="Estimate state">
        {ESTIMATE_FILTERS.map((pill) => (
          <button
            key={pill.key}
            type="button"
            className={styles.pill}
            aria-pressed={filter === pill.key}
            onClick={() => setFilter(pill.key)}
          >
            {pill.label}{" "}
            <span className={styles.pillCount}>({counts[pill.key]})</span>
          </button>
        ))}
      </div>

      <FilterBar resultCount={rows.length} actions={newButton}>
        <Input.Search
          allowClear
          aria-label="Search estimates by number or customer"
          placeholder="Search number or customer"
          style={{ width: 260 }}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
      </FilterBar>

      <DataTable<EstimateListEntry>
        rowKey="id"
        columns={columns}
        dataSource={rows}
        sticky
        emptyTitle={narrowed ? "No estimates match these filters" : "No estimates yet"}
        emptyAction={narrowed ? undefined : (newButton ?? undefined)}
      />

      <EstimateFormModal
        key={editing?.estimate.id ?? "new"}
        open={createOpen || editing !== null}
        detail={editing}
        today={today}
        customers={customers}
        incomeAccounts={incomeAccounts}
        taxCodes={taxCodes}
        usStates={usStates}
        items={items}
        canWrite={canWrite}
        canManageItems={canManageItems}
        onClose={closeForm}
        onConvert={turnIntoInvoice}
      />
    </div>
  );
}
```

- [ ] **Step 13: Create `ctyhp-accounting/app/(app)/estimates/page.tsx`** with exactly this content:

```tsx
import { createSupabaseServerClient } from "@/lib/db/server";
import { listEstimates } from "@/lib/services/estimates";
import { listCustomers } from "@/lib/services/invoicing";
import { listAccounts } from "@/lib/services/accounts";
import { listTaxCodes, listUsStates } from "@/lib/services/reference";
import { listItems } from "@/lib/services/items";
import { companyClock } from "@/lib/services/report-context";
import { hasPermission } from "@/lib/services/access";
import { getUserRole, canWrite } from "@/lib/auth";
import { salesRevenueAccounts } from "@/lib/domain/accounts";
import { estimateStateOf } from "@/lib/domain/estimates";
import PageHeader from "@/components/PageHeader";
import EstimatesClient from "./EstimatesClient";
import type { EstimateListEntry } from "./actions";

export const dynamic = "force-dynamic";

export default async function EstimatesPage({
  searchParams,
}: {
  searchParams: Promise<{ new?: string }>;
}) {
  const initialCreateOpen = (await searchParams).new === "1";
  const sb = await createSupabaseServerClient();
  const [rows, clock, customers, accounts, taxCodes, usStates, items, role, canManageItems] =
    await Promise.all([
      listEstimates(sb),
      companyClock(sb),
      listCustomers(sb),
      listAccounts(sb),
      listTaxCodes(sb),
      listUsStates(sb),
      listItems(sb),
      getUserRole(),
      hasPermission(sb, "items.manage"),
    ]);

  // Every state is worked out for the company's today, in its own time zone,
  // once, here: the list, the pills and the form all read the same day.
  const estimates: EstimateListEntry[] = rows.map((row) => ({
    ...row,
    state: estimateStateOf(row, clock.today),
  }));

  return (
    <div>
      <PageHeader
        title="Estimates"
        description="An estimate is a price promised to a customer. It is not in the books: nothing posts until the invoice made from it is issued."
      />
      <EstimatesClient
        initialCreateOpen={initialCreateOpen}
        estimates={estimates}
        today={clock.today}
        customers={customers}
        incomeAccounts={salesRevenueAccounts(accounts)}
        taxCodes={taxCodes}
        usStates={usStates}
        items={items.filter((item) => item.is_sold && item.is_active)}
        canWrite={canWrite(role)}
        canManageItems={canManageItems}
      />
    </div>
  );
}
```

- [ ] **Step 14: Edit `ctyhp-accounting/app/(app)/invoices/InvoicesClient.tsx`** — apply these 24 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 24 — find:

```tsx
  Input,
  InputNumber,
  Dropdown,
```

replace with:

```tsx
  Input,
  Dropdown,
```

Edit 2 of 24 — find:

```tsx
import {
  DeleteOutlined,
  MoreOutlined,
```

replace with:

```tsx
import {
  MoreOutlined,
```

Edit 3 of 24 — find:

```tsx
} from "@/lib/db/types";
import type { InvoiceWithCustomer } from "@/lib/services/invoicing";
import type { CustomerCreditRow } from "@/lib/services/credit";
```

replace with:

```tsx
} from "@/lib/db/types";
import type { InvoiceEstimateLink, InvoiceWithCustomer } from "@/lib/services/invoicing";
import type { CustomerCreditRow } from "@/lib/services/credit";
```

Edit 4 of 24 — find:

```tsx
import { computeInvoiceLine, sumInvoiceTotals } from "@/lib/domain/money";
import { itemToInvoiceLineDefaults } from "@/lib/domain/items";
import EmptyCatalogHint from "@/components/EmptyCatalogHint";
import { documentAttribution } from "@/lib/domain/audit";
```

replace with:

```tsx
import { computeInvoiceLine, sumInvoiceTotals } from "@/lib/domain/money";
import SalesLineItems from "@/components/SalesLineItems";
import {
  estimateMessages,
  invoiceFormFromEstimate,
  type EstimateInvoicePrefill,
} from "@/lib/domain/estimates";
import { documentAttribution } from "@/lib/domain/audit";
```

Edit 5 of 24 — find:

```tsx
  initialCreateOpen,
  initialQueue,
```

replace with:

```tsx
  initialCreateOpen,
  estimatePrefill,
  estimateNotice,
  initialQueue,
```

Edit 6 of 24 — find:

```tsx
  initialCreateOpen: boolean;
  initialQueue: { asOf: string; focusId: string | null } | null;
```

replace with:

```tsx
  initialCreateOpen: boolean;
  /** From "Turn into an invoice" (`?estimate=`): the customer and lines the form opens with. */
  estimatePrefill: EstimateInvoicePrefill | null;
  /** Shown instead of opening the form when that estimate cannot be turned into an invoice now. */
  estimateNotice: string | null;
  initialQueue: { asOf: string; focusId: string | null } | null;
```

Edit 7 of 24 — find:

```tsx

  // Inline customer creation
```

replace with:

```tsx

  // Turning an estimate into an invoice. Both are read once: after the draft
  // is made, the refreshed page finds the estimate converted, which is not
  // news to the person who just converted it.
  const [fromEstimate, setFromEstimate] = useState(estimatePrefill);
  const [estimateNoticeShown, setEstimateNoticeShown] = useState(estimateNotice);
  const [createError, setCreateError] = useState<string | null>(null);

  // Inline customer creation
```

Edit 8 of 24 — find:

```tsx
  const [settlementsLoading, setSettlementsLoading] = useState(false);

```

replace with:

```tsx
  const [settlementsLoading, setSettlementsLoading] = useState(false);
  const [viewEstimate, setViewEstimate] = useState<InvoiceEstimateLink | null>(null);

```

Edit 9 of 24 — find:

```tsx
  function openCreate() {
    form.resetFields();
```

replace with:

```tsx
  function openCreate() {
    setFromEstimate(null);
    setCreateError(null);
    form.resetFields();
```

Edit 10 of 24 — find:

```tsx
    setOpen(true);
  }

  /**
```

replace with:

```tsx
    setOpen(true);
  }

  /**
   * Opened from an estimate: its customer and lines, and the due date set from
   * the customer's terms as picking the customer would set it. Not the rest of
   * what picking a customer does: the estimate's lines keep their own tax
   * codes, so an untaxed line is not taxed on the way (invoiceFormFromEstimate).
   */
  const estimateFormValues = useMemo(() => {
    if (!fromEstimate) return null;
    const customer = localCustomers.find((c) => c.id === fromEstimate.values.customer_id);
    const { dueInDays, ...values } = invoiceFormFromEstimate(fromEstimate, {
      currencyCode: baseCurrency,
      customerTermsDays: customer?.credit_terms_days,
      defaultTermsDays,
    });
    return { ...values, due_date: dayjs().add(dueInDays, "day") };
  }, [fromEstimate, localCustomers, baseCurrency, defaultTermsDays]);

  /**
```

Edit 11 of 24 — find:

```tsx
    setSaving(true);
    const res = await createInvoiceAction({
```

replace with:

```tsx
    setSaving(true);
    setCreateError(null);
    const res = await createInvoiceAction({
```

Edit 12 of 24 — find:

```tsx
      lines,
    });
```

replace with:

```tsx
      lines,
      // Makes the draft and links it to the estimate in one transaction.
      ...(fromEstimate ? { estimateId: fromEstimate.estimateId } : {}),
    });
```

Edit 13 of 24 — find:

```tsx
    setSaving(false);
    if (res.ok) {
```

replace with:

```tsx
    setSaving(false);
    if (fromEstimate) {
      if (!res.ok) {
        // The database's words, in the form: the estimate was converted or
        // declined meanwhile, or the customer no longer matches.
        setCreateError(res.error ?? "Failed to create invoice");
        return;
      }
      message.success(estimateMessages.invoiceCreated(fromEstimate.estimateNumber));
      setFromEstimate(null);
      setOpen(false);
      // Off the estimate's link, so a reload does not try to convert it again.
      router.replace("/invoices");
      return;
    }
    if (res.ok) {
```

Edit 14 of 24 — find:

```tsx
    setViewSettlements([]);
    setLinesOpen(true);
```

replace with:

```tsx
    setViewSettlements([]);
    setViewEstimate(null);
    setLinesOpen(true);
```

Edit 15 of 24 — find:

```tsx
    // reads sent as separate actions were three trips in a row.
    const { lines: res, settlements: settled, audit: trail } = await getInvoiceDetailAction(inv.id, canReadAudit);
    setSettlementsLoading(false);
```

replace with:

```tsx
    // reads sent as separate actions were three trips in a row.
    const { lines: res, settlements: settled, audit: trail, estimate: madeFrom } = await getInvoiceDetailAction(inv.id, canReadAudit);
    setSettlementsLoading(false);
```

Edit 16 of 24 — find:

```tsx
    else message.error(settled.error ?? "Failed to load the payment history");
    if (!trail) return;
```

replace with:

```tsx
    else message.error(settled.error ?? "Failed to load the payment history");
    if (madeFrom.ok) setViewEstimate(madeFrom.data ?? null);
    else message.error(madeFrom.error ?? "Failed to load the estimate it was made from");
    if (!trail) return;
```

Edit 17 of 24 — find:

```tsx
    <div>
      {sequenceWarning ? (
```

replace with:

```tsx
    <div>
      {estimateNoticeShown ? (
        <Alert
          type="warning"
          showIcon
          closable
          style={{ marginBottom: 16 }}
          title={estimateNoticeShown}
          onClose={() => setEstimateNoticeShown(null)}
          action={
            <Button size="small" onClick={() => router.push("/estimates")}>
              Open Estimates
            </Button>
          }
        />
      ) : null}

      {sequenceWarning ? (
```

Edit 18 of 24 — find:

```tsx
      >
        {/* Defaults live here too, so opening straight from the New menu matches
```

replace with:

```tsx
      >
        {fromEstimate ? (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            title={estimateMessages.fromEstimate(fromEstimate.estimateNumber)}
          />
        ) : null}
        {/* Defaults live here too, so opening straight from the New menu matches
```

Edit 19 of 24 — find:

```tsx
          requiredMark={false}
          initialValues={{ currency_code: baseCurrency, lines: [{ quantity: 1 }] }}
        >
```

replace with:

```tsx
          requiredMark={false}
          initialValues={estimateFormValues ?? { currency_code: baseCurrency, lines: [{ quantity: 1 }] }}
        >
```

Edit 20 of 24 — find:

```tsx
                onChange={applyCustomerDefaults}
              />
```

replace with:

```tsx
                onChange={applyCustomerDefaults}
                // The database takes only the estimate's own customer.
                disabled={Boolean(fromEstimate)}
              />
```

Edit 21 of 24 — find:

```tsx
            <Form.Item label=" ">
              <Button onClick={() => setCustOpen(true)}>+ New customer</Button>
            </Form.Item>
```

replace with:

```tsx
            <Form.Item label=" ">
              <Button onClick={() => setCustOpen(true)} disabled={Boolean(fromEstimate)}>
                + New customer
              </Button>
            </Form.Item>
```

Edit 22 of 24 — find:

```tsx

          <Typography.Text strong>Line items</Typography.Text>
          <Form.List name="lines">
            {(fields, { add, remove }) => (
              <div style={{ marginTop: 8 }}>
                {fields.map((field) => (
                  <Space key={field.key} align="baseline" style={{ display: "flex", marginBottom: 8 }} wrap>
                    <Form.Item name={[field.name, "item_id"]} style={{ marginBottom: 0, width: 190 }}>
                      <Select
                        allowClear
                        showSearch
                        placeholder="Item (optional)"
                        optionFilterProp="label"
                        notFoundContent={items.length === 0 ? "No products or services yet" : undefined}
                        options={items.map((i) => ({ value: i.id, label: i.name }))}
                        onChange={(itemId) => {
                          const it = items.find((i) => i.id === itemId);
                          if (!it) return;
                          const d = itemToInvoiceLineDefaults(it);
                          const dec = decimalsOf(form.getFieldValue("currency_code") ?? baseCurrency);
                          form.setFields([
                            { name: ["lines", field.name, "description"], value: d.description },
                            { name: ["lines", field.name, "unit_price"], value: d.unit_price_minor / 10 ** dec },
                            { name: ["lines", field.name, "income_account_id"], value: d.income_account_id ?? undefined },
                            { name: ["lines", field.name, "tax_code_id"], value: d.tax_code_id ?? undefined },
                          ]);
                        }}
                      />
                    </Form.Item>
                    <Form.Item name={[field.name, "description"]} style={{ marginBottom: 0, width: 200 }}>
                      <Input placeholder="Description" />
                    </Form.Item>
                    <Form.Item name={[field.name, "quantity"]} style={{ marginBottom: 0 }} rules={[{ required: true, message: "Quantity" }]}>
                      <InputNumber placeholder="Quantity" min={0} style={{ width: 90 }} />
                    </Form.Item>
                    <Form.Item name={[field.name, "unit_price"]} style={{ marginBottom: 0 }} rules={[{ required: true, message: "Price" }]}>
                      <InputNumber placeholder="Unit price" min={0} step={0.01} style={{ width: 130 }} prefix="$" />
                    </Form.Item>
                    <Form.Item name={[field.name, "income_account_id"]} style={{ marginBottom: 0, width: 200 }} rules={[{ required: true, message: "Account" }]}>
                      <Select
                        placeholder="Income account"
                        options={incomeAccounts.map((a) => ({ value: a.id, label: `${a.account_code} — ${a.name}` }))}
                      />
                    </Form.Item>
                    <Form.Item name={[field.name, "tax_code_id"]} style={{ marginBottom: 0, width: 190 }}>
                      <Select
                        allowClear
                        showSearch
                        placeholder="Tax"
                        optionFilterProp="label"
                        options={taxOptions}
                      />
                    </Form.Item>
                    <IconActionButton
                      label="Remove invoice line"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => remove(field.name)}
                    />
                  </Space>
                ))}
                <Button type="dashed" onClick={() => add({ quantity: 1 })} icon={<PlusOutlined />} block>
                  Add line
                </Button>
              </div>
            )}
          </Form.List>

          {items.length === 0 ? (
            <div style={{ marginTop: 8 }}>
              <EmptyCatalogHint canManage={canManageItems}>
                No products or services yet, so every line must be typed in full. Save the price once in
              </EmptyCatalogHint>
            </div>
          ) : null}

```

replace with:

```tsx

          {/* Shared with the estimate form, so an estimate's lines and an invoice's are the same editor. */}
          <SalesLineItems
            items={items}
            incomeAccounts={incomeAccounts}
            taxOptions={taxOptions}
            decimals={decimalsOf(currency)}
            canManageItems={canManageItems}
            removeLabel="Remove invoice line"
          />

```

Edit 23 of 24 — find:

```tsx
          </div>
        </Form>
```

replace with:

```tsx
          </div>

          {createError ? <Alert style={{ marginTop: 12 }} type="error" showIcon title={createError} /> : null}
        </Form>
```

Edit 24 of 24 — find:

```tsx
      >
        {viewInvoice ? (
```

replace with:

```tsx
      >
        {viewEstimate ? (
          <Typography.Paragraph>
            <Link href="/estimates">{estimateMessages.fromEstimate(viewEstimate.estimate_number)}</Link>
          </Typography.Paragraph>
        ) : null}

        {viewInvoice ? (
```

- [ ] **Step 15: Edit `ctyhp-accounting/app/(app)/invoices/page.tsx`** — apply these 9 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 9 — find:

```tsx
import { isDocumentScannerConfigured } from "@/lib/services/document-scanner";
import PageHeader from "@/components/PageHeader";
```

replace with:

```tsx
import { isDocumentScannerConfigured } from "@/lib/services/document-scanner";
import { getEstimateInvoicePrefill } from "@/lib/services/estimates";
import { estimateIdSchema } from "@/lib/domain/schemas";
import type { EstimateInvoicePrefill } from "@/lib/domain/estimates";
import PageHeader from "@/components/PageHeader";
```

Edit 2 of 9 — find:

```tsx
export const dynamic = "force-dynamic";

```

replace with:

```tsx
export const dynamic = "force-dynamic";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

/**
 * `?estimate=<id>`, from "Turn into an invoice": the New invoice form's
 * values, or the words to show instead of opening it (already turned into an
 * invoice, declined, not found). Writers only, since it exists to create an
 * invoice; anyone else gets the plain page. Never throws: a failed read must
 * not take the invoice list down with it.
 */
async function estimateLink(
  sb: SupabaseServerClient,
  raw: string | undefined,
): Promise<{ prefill: EstimateInvoicePrefill | null; notice: string | null }> {
  if (!raw) return { prefill: null, notice: null };
  if (!canWrite(await getUserRole())) return { prefill: null, notice: null };
  const id = estimateIdSchema.safeParse(raw);
  if (!id.success) return { prefill: null, notice: "Estimate not found" };
  try {
    const prefill = await getEstimateInvoicePrefill(sb, id.data);
    if (!prefill) return { prefill: null, notice: "Estimate not found" };
    if (prefill.blocked) return { prefill: null, notice: prefill.blocked };
    return { prefill, notice: null };
  } catch (err) {
    const reason = err instanceof Error && err.message ? `: ${err.message}` : ".";
    return { prefill: null, notice: `The estimate could not be read${reason}` };
  }
}

```

Edit 3 of 9 — find:

```tsx
    focus?: string;
  }>;
```

replace with:

```tsx
    focus?: string;
    estimate?: string;
  }>;
```

Edit 4 of 9 — find:

```tsx
  const params = await searchParams;
  const initialCreateOpen = params.new === "1";
  const initialQueue =
```

replace with:

```tsx
  const params = await searchParams;
  const initialQueue =
```

Edit 5 of 9 — find:

```tsx
    canManageItems,
  ] = await Promise.all([
```

replace with:

```tsx
    canManageItems,
    fromEstimate,
  ] = await Promise.all([
```

Edit 6 of 9 — find:

```tsx
    hasPermission(sb, "items.manage"),
  ]);
```

replace with:

```tsx
    hasPermission(sb, "items.manage"),
    estimateLink(sb, params.estimate),
  ]);
```

Edit 7 of 9 — find:

```tsx
  ]);

```

replace with:

```tsx
  ]);

  // An estimate that cannot be turned into an invoice now says so instead of
  // opening a form the database would refuse.
  const initialCreateOpen = params.new === "1" && fromEstimate.notice === null;

```

Edit 8 of 9 — find:

```tsx
      <InvoicesClient
        initialCreateOpen={initialCreateOpen}
```

replace with:

```tsx
      <InvoicesClient
        // A fresh screen per estimate link: the prefill and its notice are read
        // once, when the screen mounts. Keyed on the address rather than on the
        // answer, so the refresh after the draft is made (which now finds the
        // estimate converted) does not remount it to say so.
        key={params.estimate ?? "invoices"}
        initialCreateOpen={initialCreateOpen}
```

Edit 9 of 9 — find:

```tsx
        initialCreateOpen={initialCreateOpen}
        initialQueue={initialQueue}
```

replace with:

```tsx
        initialCreateOpen={initialCreateOpen}
        estimatePrefill={fromEstimate.prefill}
        estimateNotice={fromEstimate.notice}
        initialQueue={initialQueue}
```

- [ ] **Step 16: Run the gates**

Run from `ctyhp-accounting/` and read the pass/fail lines in full (never pipe through `tail`/`head`):

```bash
npx tsc --noEmit -p .
npx eslint "tests/unit/estimates-screen.test.ts" "tests/unit/invoice-pdf.test.ts" "tests/unit/navigation.test.ts" "components/SalesLineItems.tsx" "components/NewCustomerButton.tsx" "lib/client/invoice-pdf.ts" "lib/domain/navigation.ts" "app/(app)/estimates/estimate-columns.ts" "app/(app)/estimates/EstimateFormModal.tsx" "app/(app)/estimates/EstimatesClient.tsx" "app/(app)/estimates/page.tsx" "app/(app)/invoices/InvoicesClient.tsx" "app/(app)/invoices/page.tsx"
npx vitest run tests/unit/estimates-screen.test.ts tests/unit/invoice-pdf.test.ts tests/unit/navigation.test.ts tests/unit/rsc-antd.test.ts tests/unit/table-adoption.test.ts tests/unit/table-fit-contract.test.ts tests/unit/table-pagination-guard.test.ts tests/unit/no-hardcoded-color.test.ts tests/unit/design-tokens.test.ts tests/unit/open-after-hydration.test.ts tests/unit/detail-reads-one-request.test.ts tests/unit/data-table-contract.test.ts
```

Expected: tsc exits 0 with no output; eslint reports 0 errors and 0 warnings for these files; estimates-screen (20), invoice-pdf (11) and navigation (46): 77 tests passing; rsc-antd (2), table-adoption (6), table-fit-contract (3), table-pagination-guard (3), no-hardcoded-color (5), design-tokens (12), open-after-hydration (2), detail-reads-one-request (10) and data-table-contract (5) pass.

- [ ] **Step 17: Commit**

```bash
git add "ctyhp-accounting/tests/unit/estimates-screen.test.ts" "ctyhp-accounting/tests/unit/invoice-pdf.test.ts" "ctyhp-accounting/tests/unit/navigation.test.ts" "ctyhp-accounting/components/SalesLineItems.tsx" "ctyhp-accounting/components/NewCustomerButton.tsx" "ctyhp-accounting/lib/client/invoice-pdf.ts" "ctyhp-accounting/lib/domain/navigation.ts" "ctyhp-accounting/app/(app)/estimates/estimate-columns.ts" "ctyhp-accounting/app/(app)/estimates/estimates.module.css" "ctyhp-accounting/app/(app)/estimates/EstimateFormModal.tsx" "ctyhp-accounting/app/(app)/estimates/EstimatesClient.tsx" "ctyhp-accounting/app/(app)/estimates/page.tsx" "ctyhp-accounting/app/(app)/invoices/InvoicesClient.tsx" "ctyhp-accounting/app/(app)/invoices/page.tsx"
git commit -m "feat(estimates): the Estimates screen and form, the invoice made from an estimate, the estimate PDF and navigation"
```

Stage by file name only (never `git add -A` / `git add .`). No Co-Authored-By trailer; no mention of Claude or AI in the message.

---

### Task 4: Release 2.02 and the Guide

**Files:**
- Modify: `ctyhp-accounting/lib/domain/changelog.ts`
- Modify: `ctyhp-accounting/lib/domain/system-guide.ts`

**Interfaces:**
- Consumes: the screens from Task 3 (the notes describe them).
- Produces: release 2.02 above 2.01, dated 2026-10-13 (if main has moved past 2.01 by the time this merges, the controller renumbers it to the next free number); the Guide's estimates steps in the sales work.

- [ ] **Step 1: Edit `ctyhp-accounting/lib/domain/changelog.ts`** — apply this 1 find/replace edit (its find string occurs exactly once):

Edit 1 of 1 — find:

```ts
export const RELEASES: Release[] = [
  {
```

replace with:

```ts
export const RELEASES: Release[] = [
  {
    version: "2.02",
    date: "2026-10-13",
    headline:
      "Estimates: promise a customer a price, print it, and turn it into an invoice when they accept.",
    changes: [
      {
        kind: "added",
        title: "Estimates, under Sales",
        detail:
          "Sales › Estimates lists every estimate with its number, date, customer, Valid until, total, state, and the invoice made from it. The pills narrow the list to Open, Expired, Declined or Converted, each with its count, and the search finds a number or a customer. New estimate, here or under New › Estimate, opens the form: choose a customer or add one, then the estimate date and Valid until, which starts 30 days later. The lines work exactly as on an invoice — item, description, quantity, unit price, income account and tax code — and choosing an item fills in its price and tax. Subtotal, Sales tax and Total add up as you type, and Note printed at the foot is optional. Save gives a new estimate its number, from EST-000001. An estimate is not in the books: nothing posts for it.",
        route: "/estimates",
      },
      {
        kind: "added",
        title: "Open, Expired, Declined and Converted",
        detail:
          "An estimate starts Open, and reads Expired from the day after its Valid until date, in the company’s time zone. An expired estimate can still be edited, or turned into an invoice after a question. Mark declined when the customer says no, and Reopen if they change their mind. Once an invoice is made from it, it reads Converted and is locked: it can be viewed and printed, but not edited, declined or deleted. An estimate that has never had an invoice made from it can be deleted; one that has is marked declined instead.",
        route: "/estimates",
      },
      {
        kind: "added",
        title: "Turn an estimate into an invoice",
        detail:
          "Turn into an invoice, on the list or in the form, opens New invoice on the Invoices screen with the estimate’s customer and lines filled in, under From estimate EST-000001. The due date follows the customer’s terms as usual, and each line keeps the tax code the estimate gave it. Change anything you need, then Save draft: the draft is linked to the estimate, which becomes Converted. Check the draft over, then issue it as usual — only the invoice posts. Cancel changes nothing. If that invoice is voided later, the estimate reads Open again. An invoice made from an estimate says so in its detail, with a link to Estimates.",
        route: "/invoices",
      },
      {
        kind: "added",
        title: "Estimates print as PDF",
        detail:
          "Download PDF prints an estimate on the invoice’s layout: Estimate EST-000001 with its estimate date and Valid until, the lines, then Subtotal, Sales tax and Total. Nothing is owed on an estimate, so there is no Paid or Balance due. Your note follows, then always “This is a quotation, not an invoice. Nothing is owed on it.” The file is named Estimate, the number and the customer’s name.",
        route: "/estimates",
      },
    ],
  },
  {
```

- [ ] **Step 2: Edit `ctyhp-accounting/lib/domain/system-guide.ts`** — apply this 1 find/replace edit (its find string occurs exactly once):

Edit 1 of 1 — find:

```ts
          "documents; As they usually pay moves each one by how late that customer or supplier has paid before.",
      },
```

replace with:

```ts
          "documents; As they usually pay moves each one by how late that customer or supplier has paid before.",
      },
    ],
  },
  {
    id: "quote-a-price",
    title: "Give a customer an estimate and turn it into an invoice",
    purpose:
      "Promise a customer a price before the sale, then make the invoice from it when they accept. " +
      "Nothing reaches the books until that invoice is issued.",
    route: "/estimates",
    steps: [
      {
        action: "Write the estimate",
        control: "New estimate",
        route: "/estimates",
        note:
          "Choose the customer, the estimate date and Valid until, which starts 30 days later. The lines " +
          "work as on an invoice: an item fills in its price, income account and tax code. Save gives it " +
          "its number, EST-000001 onwards. It posts nothing.",
      },
      {
        action: "Give the customer a copy",
        control: "Download PDF",
        note:
          "Printed on the invoice's layout with Valid until in place of the due date, and Subtotal, Sales " +
          "tax and Total with no Balance due. It always ends: This is a quotation, not an invoice. Nothing " +
          "is owed on it.",
      },
      {
        action: "Record a no",
        control: "Mark declined",
        note:
          "Reopen brings it back if the customer changes their mind. An estimate past its Valid until date " +
          "reads Expired on its own; it can still be edited, or turned into an invoice after a question.",
      },
      {
        action: "Turn a yes into an invoice",
        control: "Turn into an invoice",
        note:
          "Opens New invoice on the Invoices screen with the customer and lines filled in, marked From " +
          "estimate. Change anything you need first; Cancel changes nothing.",
      },
      {
        action: "Create the draft",
        control: "Save draft",
        route: "/invoices",
        note:
          "The draft is linked to the estimate, which reads Converted and is locked from then on. The draft " +
          "itself affects nothing yet: check it over before issuing it.",
      },
      {
        action: "Issue the invoice",
        control: "Issue",
        route: "/invoices",
        note:
          "Posts it like any other invoice. The estimate never posts; only the invoice made from it does.",
      },
      {
        action: "If the sale falls through after all",
        control: "Void invoice",
        route: "/invoices",
        note:
          "Voiding the invoice made from an estimate opens the estimate again: it reads Open, so it can be " +
          "turned into a new invoice or marked declined. An estimate that has had an invoice made from it " +
          "cannot be deleted.",
      },
```

- [ ] **Step 3: Run the gates**

Run from `ctyhp-accounting/` and read the pass/fail lines in full (never pipe through `tail`/`head`):

```bash
npx tsc --noEmit -p .
npx eslint "lib/domain/changelog.ts" "lib/domain/system-guide.ts"
npx vitest run tests/unit/changelog.test.ts tests/unit/system-guide.test.ts
```

Expected: tsc exits 0 with no output; eslint reports 0 errors and 0 warnings for these files; changelog (15) and system-guide (23): 38 tests passing.

- [ ] **Step 4: Commit**

```bash
git add "ctyhp-accounting/lib/domain/changelog.ts" "ctyhp-accounting/lib/domain/system-guide.ts"
git commit -m "feat(estimates): release 2.02 notes and the Guide"
```

Stage by file name only (never `git add -A` / `git add .`). No Co-Authored-By trailer; no mention of Claude or AI in the message.

---

### Task 5: Controller — whole-branch gates, verification, smoke, approval

**Files:** none changed by this task (scratch scripts live outside the repo).

**Interfaces:**
- Consumes: the whole branch.

- [ ] **Step 1: The branch equals the pre-build.** `git diff prebuild/estimates HEAD -- ctyhp-accounting` is empty, unless a review fix was agreed. Every commit has no Co-Authored-By trailer and no mention of Claude or AI; typographic ’ and — are unchanged.
- [ ] **Step 2: Whole-suite gates.** `npm run typecheck`, `npm run lint`, `npx vitest run`, `npm run build`, `npm run quality:budget`. Expected: tsc 0; lint 0 errors; every test file passes (load-sensitive timeouts must pass when rerun alone); build compiles; 11/11 within budget.
- [ ] **Step 3: Verification, alone** (`npm run verify:estimates`): 224/224 — 99 on the sample company, 25 on each other company, all rolled back.
- [ ] **Step 4: Smoke and screenshots on PC-Test**, against `next start` on a free port: create an estimate, its PDF, decline and reopen, turn it into an invoice with a changed quantity, a second conversion refused, the invoice's "From estimate", void the draft and see the estimate Open, the delete rules, the expired confirmation; light, dark and phone; no console errors; staff emails blurred. Estimates created stay on PC-Test as sample data.
- [ ] **Step 5: Approval page** of the screenshots for the user. Nothing is pushed before the user approves.
- [ ] **Step 6: After approval** — scan the whole diff for real client data and secrets (separate command, read before pushing), check main has not moved (renumber the release up if it has), push the branch; the user opens the PR; then CI and a read-only production check.
