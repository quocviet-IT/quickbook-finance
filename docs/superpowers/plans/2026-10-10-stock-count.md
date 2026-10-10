# Stock Count Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the client mockup's periodic Stock Count as release 1.96. A count sheet holds lines entered or pasted in. It is compared with the inventory accounts' balance on a date, and one adjusting entry is posted for the difference. Posting follows the inventory-adjustment approval policy.

**Architecture:**
- **Database.** Two migrations: an enum value on its own (0138), then the tables and RPCs (0139). The RPCs create, save and post a count, mark it pending, and re-issue the approval dispatch. A trigger returns a count to draft when its approval request is rejected or cancelled.
- **App code.**
  - A pure domain module (`lib/domain/stock-count.ts`) and a service.
  - Server actions that post through `executeOrSubmitForApproval`.
  - A list page and a count page under `/inventory/stock-count`.
  - A sidebar leaf, a Report Center card, release notes and a Guide flow.

**Tech Stack:**
- Next.js 16 App Router, React 19, Ant Design 6, Zod 4
- Supabase/PostgREST, one schema per company
- Postgres functions (SECURITY DEFINER)
- vitest

**Source of truth:**
- **Spec:** `docs/superpowers/specs/2026-10-09-stock-count-design.md`, including its "Amendments from pre-building".
- **Code:** every file in this plan was first built and run on a local pre-build branch. There it passed:
  - typecheck, lint, unit tests (314 files), build and bundle budget;
  - the migration verification script, 168/168, inside rolled-back transactions on all six companies;
  - the read-only live test, 3/3 on all six;
  - a smoke on the sample company PC-Test, where one count was posted for real.
- **How the code is given here:**
  - New files are given whole.
  - Edits to existing files are find/replace pairs that reproduce the pre-build exactly when applied in order.
  - A file rewritten by more than half is given whole.

**Migrations 0138 and 0139 are ALREADY LIVE** on all six companies; the user approved them. Never run `scripts/migrate.mjs`, `verify:stock-count`, `provision-company` or any database script. The controller does that.

**Do not "improve" the given code while transcribing it.** It has been verified against the real database. If something looks wrong, stop and report it instead of changing it.

## Global Constraints

- **The database, 0138/0139.**
  - Both migrations are already live. Add the files exactly; never apply them.
  - The only writes are the stock-count RPCs. `authenticated` has SELECT only on `acc_stock_count` and `acc_stock_count_line`.
- **Copy and figures.**
  - UI copy is in US English, with names exactly as the spec gives them.
  - Money is in base-currency minor units. The book value is `amount_base_minor`, signed by side.
  - Dates are in the company's time zone. Never use `new Date().toISOString()` for "today".
- **Reads.** Every list read pages past PostgREST's silent 1,000-row cap, with a total order ending in a unique column.
- **Who can do what.**
  - Posting needs `inventory.adjust`.
  - Posting goes through the `inventory_adjustment` approval policy.
  - A company that tracks inventory items cannot post a count.
- **Tables.**
  - Every list that can grow goes through `DataTable` or `ReportTable`. Never import antd's `Table` in a screen.
  - Total rows use `ReportTable`'s `summary` with `SummaryRow` and `SummaryCell`.
  - Report tables pass `reportPagination(printing, …)`.
- **JSX.** Never put an HTML entity (`&apos;`, `&quot;`) right after an element. Keep typographic quotes and apostrophes (’ “ ”) exactly as given.
- **Server Components.** `page.tsx` never reads Ant Design sub-components.
- **Test data.** The repository is public, so tests use invented data only.
- **Commits.**
  - Stage files by name, never `git add -A` / `git add .`.
  - Never stage `.claude/settings.json`.
  - Use exactly `git commit -m "<message>"`, with NO Co-Authored-By trailer and no mention of Claude or AI.
- **Gates.**
  - Run them from `ctyhp-accounting/`.
  - If tsc complains about stale `.next/types`, delete `.next/types` and rerun.
  - Read the pass/fail lines in full; never pipe them through `tail` or `head`.

---

### Task 1: Migrations 0138 and 0139, their test and the verification script

**Files:**
- Test (create): `ctyhp-accounting/tests/unit/stock-count-migration.test.ts`
- Create: `ctyhp-accounting/supabase/migrations/0138_stock_count_source.sql`
- Create: `ctyhp-accounting/supabase/migrations/0139_stock_count.sql`
- Create: `ctyhp-accounting/scripts/verify-stock-count.mjs`
- Modify: `ctyhp-accounting/package.json`

**Interfaces:**
- Consumes (existing, in the database): `acc_post_entry` (0029), the guards of `acc_post_manual_journal` (0037), the difference body of `acc_post_afda_adjustment` (0093), `acc_adjusting_entry` (0124), `acc_approval_required(key, amount)`, `acc_approval_request`, `acc_active_inventory_writedown_account()`, `acc_next_sequence`, the stamp and audit triggers.
- Produces (already live): enum value `stock_count` on `acc_journal_source` (0138, alone, because a new enum value cannot be used in the transaction that adds it); tables `acc_stock_count` (header, `SC-000001`…) and `acc_stock_count_line`; RPCs `acc_inventory_account_ids()`, `acc_stock_count_default_accounts()`, `acc_create_stock_count(date)`, `acc_save_stock_count(uuid, date, text, jsonb)`, `acc_post_stock_count(uuid, uuid, uuid)` (returns the journal entry id), `acc_mark_stock_count_pending(uuid, uuid)`; trigger function `acc_stock_count_request_closed()`; the re-issued `acc_approve_request(uuid, text)` with a `stock_count_id` branch; npm script `verify:stock-count` (run by the controller only). Task 2's service calls these RPCs by these names.

- [ ] **Step 1: Create `ctyhp-accounting/tests/unit/stock-count-migration.test.ts`** with exactly this content:

```ts
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
```

- [ ] **Step 2: Run the tests to see them fail**

```bash
npx vitest run tests/unit/stock-count-migration.test.ts
```

Expected: FAIL — `supabase/migrations/0139_stock_count.sql` does not exist yet (the test cannot read it).

- [ ] **Step 3: Create `ctyhp-accounting/supabase/migrations/0138_stock_count_source.sql`** with exactly this content:

```sql
-- A journal source for the entry a stock count posts.
--
-- The value lands alone in this migration on purpose. Postgres refuses to use a
-- value added by ALTER TYPE ... ADD VALUE later in the same transaction, and
-- scripts/migrate.mjs wraps every migration in begin/commit. Everything that
-- posts with 'stock_count' waits for 0139.
--
-- Nothing else changes here.
alter type acc_journal_source add value if not exists 'stock_count';
```

- [ ] **Step 4: Create `ctyhp-accounting/supabase/migrations/0139_stock_count.sql`** with exactly this content:

```sql
-- ============================================================================
-- 0139 — Stock Count: a periodic count sheet that corrects the inventory
-- accounts to what was counted.
--
-- A count compares the counted value (quantity x cost, line by line) with the
-- ledger balance of the company's inventory accounts on a date, and posts ONE
-- adjusting entry for the difference. It does not move units: books kept this
-- way take purchases to cost of sales and let the count fix the balance sheet.
--
-- Needs 0138 (the 'stock_count' journal source). That value cannot be used in
-- the transaction that adds it, so it lives in its own migration; every
-- function below only names it inside a plpgsql body, which Postgres resolves
-- when the function runs.
--
-- Writes go only through the functions below: the tables have a read policy
-- and no write policy, as acc_adjusting_entry does (0124).
-- ============================================================================

set search_path = public;

-- ----------------------------------------------------------------------------
-- The two tables
-- ----------------------------------------------------------------------------
create table if not exists acc_stock_count (
  id                   uuid primary key default gen_random_uuid(),
  count_number         text not null unique,
  as_of                date not null,
  status               text not null default 'draft'
                         check (status in ('draft', 'pending_approval', 'posted')),
  memo                 text check (memo is null or length(memo) <= 500),
  -- frozen at posting
  counted_minor        bigint,
  book_minor           bigint,
  difference_minor     bigint,
  inventory_account_id uuid references acc_account (id),
  offset_account_id    uuid references acc_account (id),
  journal_entry_id     uuid references acc_journal_entry (id),
  approval_request_id  uuid references acc_approval_request (id),
  posted_by            uuid references auth.users (id),
  posted_at            timestamptz,
  created_by           uuid references auth.users (id),
  created_at           timestamptz not null default now(),
  updated_by           uuid references auth.users (id),
  updated_at           timestamptz not null default now(),
  constraint acc_stock_count_posted_ck
    check (status <> 'posted'
           or (journal_entry_id is not null and counted_minor is not null and book_minor is not null
               and difference_minor is not null and inventory_account_id is not null
               and offset_account_id is not null and posted_at is not null))
);

-- One count is open (draft or waiting for approval) at a time.
create unique index if not exists acc_stock_count_one_open_idx
  on acc_stock_count ((true)) where status in ('draft', 'pending_approval');
create index if not exists acc_stock_count_as_of_idx on acc_stock_count (as_of desc, count_number desc);

create table if not exists acc_stock_count_line (
  id              uuid primary key default gen_random_uuid(),
  stock_count_id  uuid not null references acc_stock_count (id) on delete cascade,
  line_order      integer not null,
  name            text not null check (length(btrim(name)) between 1 and 200),
  sku             text check (sku is null or length(sku) <= 100),
  quantity        numeric(20,4) not null default 0 check (quantity >= 0),
  unit_cost_minor bigint not null default 0 check (unit_cost_minor >= 0),
  sells_for_minor bigint check (sells_for_minor is null or sells_for_minor >= 0),
  constraint acc_stock_count_line_order_uq unique (stock_count_id, line_order)
);

-- The actor stamps and the audit trail sit on the header. The line rows are
-- replaced wholesale by every save (up to 2,000 at a time) and carry no actor
-- columns, so the header's audit row is the record of who changed the count.
drop trigger if exists acc_stock_count_actor_stamp on acc_stock_count;
create trigger acc_stock_count_actor_stamp
  before insert or update on acc_stock_count
  for each row execute function acc_stamp_actor();

drop trigger if exists acc_stock_count_atomic_audit on acc_stock_count;
create trigger acc_stock_count_atomic_audit
  after insert or update or delete on acc_stock_count
  for each row execute function acc_audit_row_change();

alter table acc_stock_count enable row level security;
alter table acc_stock_count_line enable row level security;

drop policy if exists acc_stock_count_read on acc_stock_count;
create policy acc_stock_count_read on acc_stock_count
  for select using (acc_current_role() is not null);
drop policy if exists acc_stock_count_line_read on acc_stock_count_line;
create policy acc_stock_count_line_read on acc_stock_count_line
  for select using (acc_current_role() is not null);

-- No insert, update or delete policy: an application session writes these
-- tables only through the functions below.
revoke all on acc_stock_count from public, anon;
revoke all on acc_stock_count_line from public, anon;
-- Schema public hands authenticated write rights on every new table through
-- Supabase's default privileges. These tables are written only by the
-- security definer functions below, so take those rights back.
revoke insert, update, delete, truncate on acc_stock_count from authenticated;
revoke insert, update, delete, truncate on acc_stock_count_line from authenticated;
grant select on acc_stock_count to authenticated;
grant select on acc_stock_count_line to authenticated;
grant all on acc_stock_count to service_role;
grant all on acc_stock_count_line to service_role;

insert into acc_sequence (key, prefix, next_value)
values ('stock_count', 'SC-', 1)
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- Which accounts hold the company's stock. The same rule as 1.95's
-- pickInventoryAccounts (lib/domain/inventory-accounts.ts):
--   1. accounts inventory items post to (acc_item.inventory_account_id on items
--      with is_inventory) plus accounts whose cash_flow_role is
--      'operating_inventory';
--   2. only when that finds nothing: current_asset accounts named like
--      inventory or stock.
-- ----------------------------------------------------------------------------
create or replace function acc_inventory_account_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  with by_item_or_role as (
    select i.inventory_account_id as id
      from acc_item i
     where i.is_inventory and i.inventory_account_id is not null
    union
    select a.id from acc_account a where a.cash_flow_role = 'operating_inventory'
  ),
  by_name as (
    select a.id from acc_account a
     where a.account_type = 'current_asset' and a.name ~* 'inventory|stock'
  )
  select id from by_item_or_role
  union
  select id from by_name where not exists (select 1 from by_item_or_role);
$$;

-- ----------------------------------------------------------------------------
-- The accounts a count posts to when the person has not chosen others.
--   inventory: the inventory account with the lowest code that can be posted to;
--   offset:    an active posting cost-of-sales account named like
--              "Inventory Adjustment", else the inventory write-down account,
--              else the lowest-coded active cost-of-sales account.
-- Either is null when the company has no such account.
-- ----------------------------------------------------------------------------
create or replace function acc_stock_count_default_accounts()
returns table (inventory_account_id uuid, offset_account_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare
  v_inventory uuid;
  v_offset    uuid;
begin
  select a.id into v_inventory
    from acc_account a
   where a.id in (select acc_inventory_account_ids())
     and a.is_posting_account and a.status = 'active'
   order by a.account_code, a.id
   limit 1;

  select a.id into v_offset
    from acc_account a
   where a.account_type = 'cost_of_goods_sold' and a.is_posting_account and a.status = 'active'
     and a.name ~* 'inventory\s*adjust'
   order by a.account_code, a.id
   limit 1;
  if v_offset is null then
    v_offset := acc_active_inventory_writedown_account();
  end if;
  if v_offset is null then
    select a.id into v_offset
      from acc_account a
     where a.account_type = 'cost_of_goods_sold' and a.is_posting_account and a.status = 'active'
     order by a.account_code, a.id
     limit 1;
  end if;

  return query select v_inventory, v_offset;
end;
$$;

-- ----------------------------------------------------------------------------
-- acc_create_stock_count — the open count if there is one, else a new draft
-- that starts as a copy of the previous count's lines.
-- ----------------------------------------------------------------------------
create or replace function acc_create_stock_count(p_as_of date) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid;
  v_prev uuid;
begin
  if not acc_is_staff() then raise exception 'Not authorized to create a stock count'; end if;
  if p_as_of is null then raise exception 'A stock count needs an as-of date'; end if;

  select id into v_id from acc_stock_count where status in ('draft', 'pending_approval') limit 1;
  if v_id is not null then return v_id; end if;

  -- The most recent posted count, or the most recent of any status when none is posted.
  select id into v_prev from acc_stock_count
   order by (status = 'posted') desc, posted_at desc nulls last, created_at desc, id desc
   limit 1;

  begin
    insert into acc_stock_count (count_number, as_of)
    values (acc_next_number('stock_count'), p_as_of)
    returning id into v_id;
  exception when unique_violation then
    -- Someone created the open count a moment ago; use theirs.
    select id into v_id from acc_stock_count where status in ('draft', 'pending_approval') limit 1;
    return v_id;
  end;

  if v_prev is not null then
    insert into acc_stock_count_line (stock_count_id, line_order, name, sku, quantity, unit_cost_minor, sells_for_minor)
    select v_id, l.line_order, l.name, l.sku, l.quantity, l.unit_cost_minor, l.sells_for_minor
      from acc_stock_count_line l
     where l.stock_count_id = v_prev
     order by l.line_order;
  end if;

  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- acc_save_stock_count — replace the whole set of lines of a draft in one
-- transaction. p_lines is a JSON array of
--   { name, sku, quantity, unit_cost_minor, sells_for_minor }.
-- Returns the number of lines saved.
-- ----------------------------------------------------------------------------
create or replace function acc_save_stock_count(
  p_id    uuid,
  p_as_of date,
  p_memo  text,
  p_lines jsonb
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count  acc_stock_count;
  v_el     jsonb;
  v_n      bigint;
  v_total  integer;
begin
  if not acc_is_staff() then raise exception 'Not authorized to save a stock count'; end if;
  if p_as_of is null then raise exception 'A stock count needs an as-of date'; end if;

  select * into v_count from acc_stock_count where id = p_id for update;
  if not found then raise exception 'Stock count not found'; end if;
  if v_count.status <> 'draft' then
    raise exception 'Only a draft count can be edited; % is %', v_count.count_number, v_count.status;
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'The count lines must be a list';
  end if;
  v_total := jsonb_array_length(p_lines);
  if v_total > 2000 then
    raise exception 'A count can hold at most 2,000 lines (this one has %)', v_total;
  end if;

  for v_el, v_n in select e.value, e.ordinality from jsonb_array_elements(p_lines) with ordinality as e loop
    if jsonb_typeof(v_el) <> 'object' then
      raise exception 'Line %: not a count line', v_n;
    end if;
    if btrim(coalesce(v_el ->> 'name', '')) = '' then
      raise exception 'Line %: a name is required', v_n;
    end if;
    if length(btrim(v_el ->> 'name')) > 200 then
      raise exception 'Line %: the name is too long (200 characters at most)', v_n;
    end if;
    if length(coalesce(v_el ->> 'sku', '')) > 100 then
      raise exception 'Line %: the SKU is too long (100 characters at most)', v_n;
    end if;
    if jsonb_typeof(v_el -> 'quantity') is distinct from 'number' then
      raise exception 'Line %: a quantity is required', v_n;
    end if;
    if (v_el ->> 'quantity')::numeric < 0 then
      raise exception 'Line %: the quantity cannot be negative', v_n;
    end if;
    if jsonb_typeof(v_el -> 'unit_cost_minor') is distinct from 'number'
       or (v_el ->> 'unit_cost_minor')::numeric <> trunc((v_el ->> 'unit_cost_minor')::numeric) then
      raise exception 'Line %: the cost each must be a whole number of minor units', v_n;
    end if;
    if (v_el ->> 'unit_cost_minor')::numeric < 0 then
      raise exception 'Line %: the cost each cannot be negative', v_n;
    end if;
    if jsonb_typeof(v_el -> 'sells_for_minor') = 'number' then
      if (v_el ->> 'sells_for_minor')::numeric <> trunc((v_el ->> 'sells_for_minor')::numeric) then
        raise exception 'Line %: sells for must be a whole number of minor units', v_n;
      end if;
      if (v_el ->> 'sells_for_minor')::numeric < 0 then
        raise exception 'Line %: sells for cannot be negative', v_n;
      end if;
    elsif jsonb_typeof(v_el -> 'sells_for_minor') is not null
          and jsonb_typeof(v_el -> 'sells_for_minor') <> 'null' then
      raise exception 'Line %: sells for must be a number or empty', v_n;
    end if;
  end loop;

  delete from acc_stock_count_line where stock_count_id = p_id;

  insert into acc_stock_count_line (stock_count_id, line_order, name, sku, quantity, unit_cost_minor, sells_for_minor)
  select p_id, e.ordinality::integer, btrim(e.value ->> 'name'),
         nullif(btrim(coalesce(e.value ->> 'sku', '')), ''),
         (e.value ->> 'quantity')::numeric,
         (e.value ->> 'unit_cost_minor')::bigint,
         case when jsonb_typeof(e.value -> 'sells_for_minor') = 'number'
              then (e.value ->> 'sells_for_minor')::bigint end
    from jsonb_array_elements(p_lines) with ordinality as e;

  update acc_stock_count
     set as_of = p_as_of, memo = nullif(btrim(coalesce(p_memo, '')), '')
   where id = p_id;

  return v_total;
end;
$$;

-- ----------------------------------------------------------------------------
-- acc_post_stock_count — post the difference between the counted value and the
-- books as one adjusting entry. Returns the journal entry id.
-- ----------------------------------------------------------------------------
create or replace function acc_post_stock_count(
  p_id                   uuid,
  p_inventory_account_id uuid,
  p_offset_account_id    uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_count   acc_stock_count;
  v_counted bigint;
  v_book    bigint;
  v_diff    bigint;
  v_amount  bigint;
  v_desc    text;
  v_currency text;
  v_lines   jsonb;
  v_entry   uuid;
begin
  if not acc_is_staff() then raise exception 'Not authorized to post a stock count'; end if;
  if not acc_has_permission('inventory.adjust') then
    raise exception 'You do not have permission to adjust inventory';
  end if;

  select * into v_count from acc_stock_count where id = p_id for update;
  if not found then raise exception 'Stock count not found'; end if;
  if v_count.status = 'pending_approval' and not acc_in_approval_dispatch() then
    raise exception 'Stock count % is waiting for approval', v_count.count_number;
  elsif v_count.status = 'posted' then
    raise exception 'Stock count % is already posted', v_count.count_number;
  end if;

  if exists (select 1 from acc_item where is_inventory and is_active) then
    raise exception 'This company tracks stock item by item; adjust items on the Products & Services page';
  end if;

  if p_inventory_account_id is null
     or p_inventory_account_id not in (select acc_inventory_account_ids()) then
    raise exception 'The inventory account is not one of this company''s inventory accounts';
  end if;
  if p_offset_account_id is null or not exists (
       select 1 from acc_account a
        where a.id = p_offset_account_id and a.account_type = 'cost_of_goods_sold'
          and a.is_posting_account and a.status = 'active') then
    raise exception 'The offset account must be an active cost of sales account';
  end if;
  if p_offset_account_id = p_inventory_account_id then
    raise exception 'The offset account must differ from the inventory account';
  end if;

  select coalesce(sum(round(l.quantity * l.unit_cost_minor)), 0)::bigint into v_counted
    from acc_stock_count_line l where l.stock_count_id = p_id;

  -- Base currency, signed by side, exactly as acc_ledger_balances (0009) reads a line.
  select coalesce(sum(case when jl.debit_minor > 0 then jl.amount_base_minor else 0 end), 0)::bigint
       - coalesce(sum(case when jl.credit_minor > 0 then jl.amount_base_minor else 0 end), 0)::bigint
    into v_book
    from acc_journal_line jl
    join acc_journal_entry e on e.id = jl.journal_entry_id
   where jl.account_id in (select acc_inventory_account_ids())
     and e.status = 'posted'
     and e.entry_date <= v_count.as_of;

  v_diff := v_counted - v_book;
  if v_diff = 0 then raise exception 'The count already agrees with the books.'; end if;
  v_amount := abs(v_diff);

  if acc_approval_required('inventory_adjustment', v_amount) and not acc_in_approval_dispatch() then
    raise exception 'A stock count of this size requires approval; submit it for approval instead';
  end if;

  select code into v_currency from acc_currency where is_base limit 1;
  v_desc := 'Stock count ' || v_count.count_number || ' as of ' || v_count.as_of;

  if v_diff > 0 then
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', p_inventory_account_id, 'debit_minor', v_amount, 'credit_minor', 0,
                         'amount_base_minor', v_amount, 'memo', 'Stock count'),
      jsonb_build_object('account_id', p_offset_account_id, 'debit_minor', 0, 'credit_minor', v_amount,
                         'amount_base_minor', v_amount, 'memo', 'Stock count'));
  else
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', p_offset_account_id, 'debit_minor', v_amount, 'credit_minor', 0,
                         'amount_base_minor', v_amount, 'memo', 'Stock count'),
      jsonb_build_object('account_id', p_inventory_account_id, 'debit_minor', 0, 'credit_minor', v_amount,
                         'amount_base_minor', v_amount, 'memo', 'Stock count'));
  end if;

  perform acc_assert_postable(v_lines);
  v_entry := acc_post_entry(v_count.as_of, v_desc, 'stock_count', p_id, v_currency, v_lines);

  -- Adjusting, as depreciation is (0124): it shows in the Working Trial Balance's adjustments column.
  insert into acc_adjusting_entry (journal_entry_id, note, marked_by)
  values (v_entry, left(v_desc, 500), auth.uid())
  on conflict (journal_entry_id) do nothing;

  update acc_stock_count
     set status = 'posted', counted_minor = v_counted, book_minor = v_book, difference_minor = v_diff,
         inventory_account_id = p_inventory_account_id, offset_account_id = p_offset_account_id,
         journal_entry_id = v_entry, posted_by = auth.uid(), posted_at = now()
   where id = p_id;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values ('acc_journal_entry', v_entry, 'post', auth.uid(),
          jsonb_build_object('stock_count_id', p_id, 'count_number', v_count.count_number,
                             'as_of', v_count.as_of, 'counted_minor', v_counted,
                             'book_minor', v_book, 'difference_minor', v_diff));

  return v_entry;
end;
$$;

-- ----------------------------------------------------------------------------
-- acc_mark_stock_count_pending — the app calls this once a count has been sent
-- for approval. It checks that the request really is this count's, then freezes
-- the count (a pending count cannot be edited) and links the request.
-- ----------------------------------------------------------------------------
create or replace function acc_mark_stock_count_pending(p_id uuid, p_request_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_count acc_stock_count;
  v_req   acc_approval_request;
begin
  if not acc_is_staff() then raise exception 'Not authorized to submit a stock count'; end if;

  select * into v_count from acc_stock_count where id = p_id for update;
  if not found then raise exception 'Stock count not found'; end if;
  if v_count.status <> 'draft' then
    raise exception 'Only a draft count can be sent for approval; % is %', v_count.count_number, v_count.status;
  end if;

  select * into v_req from acc_approval_request where id = p_request_id;
  if not found
     or v_req.action_key <> 'inventory_adjustment'
     or v_req.status <> 'pending'
     or v_req.payload ->> 'stock_count_id' is distinct from p_id::text then
    raise exception 'That approval request is not a pending request for this stock count';
  end if;

  update acc_stock_count
     set status = 'pending_approval', approval_request_id = p_request_id
   where id = p_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- A request that is rejected (or cancelled) returns its count to draft. An
-- AFTER UPDATE trigger on the request leaves acc_reject_request,
-- acc_cancel_request and every other approval function untouched.
-- ----------------------------------------------------------------------------
create or replace function acc_stock_count_request_closed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.action_key = 'inventory_adjustment'
     and old.status = 'pending'
     and new.status in ('rejected', 'cancelled')
     and new.payload ->> 'stock_count_id' is not null then
    update acc_stock_count
       set status = 'draft', approval_request_id = null
     where id = (new.payload ->> 'stock_count_id')::uuid
       and status = 'pending_approval'
       and approval_request_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists acc_approval_request_stock_count on acc_approval_request;
create trigger acc_approval_request_stock_count
  after update on acc_approval_request
  for each row execute function acc_stock_count_request_closed();

-- ----------------------------------------------------------------------------
-- acc_approve_request — body from 0039_vendor_tax_functions.sql with one extra
-- branch: an inventory_adjustment request whose payload carries stock_count_id
-- posts that count. It sits before the item branch, which is unchanged.
-- Copied mechanically so none of the existing dispatcher can be lost in a retype.
-- ----------------------------------------------------------------------------
create or replace function acc_approve_request(p_request_id uuid, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_req    acc_approval_request;
  v_policy acc_approval_policy;
  v_p      jsonb;
  v_result uuid;
begin
  if not acc_has_permission('approval.decide') then
    raise exception 'You do not have permission to decide approval requests';
  end if;

  select * into v_req from acc_approval_request where id = p_request_id for update;
  if not found then raise exception 'Approval request not found'; end if;
  if v_req.status <> 'pending' then raise exception 'Request is already %', v_req.status; end if;

  select * into v_policy from acc_approval_policy where action_key = v_req.action_key;
  if v_policy.require_segregation and v_req.requested_by = auth.uid() then
    raise exception 'You cannot approve your own request while segregation of duties is enabled';
  end if;

  v_p := v_req.payload;
  perform set_config('acc.approval_dispatch', 'on', true);

  if v_req.action_key = 'manual_journal' then
    v_result := acc_post_manual_journal(
      (v_p ->> 'entry_date')::date, v_p ->> 'description', v_p ->> 'source_ref',
      v_p ->> 'currency', v_p -> 'lines');
  elsif v_req.action_key = 'write_off' then
    v_result := acc_write_off(
      v_p ->> 'side', (v_p ->> 'target_id')::uuid, (v_p ->> 'offset_account_id')::uuid,
      (v_p ->> 'amount_minor')::bigint, (v_p ->> 'date')::date, v_req.reason);
  elsif v_req.action_key = 'inventory_adjustment' and v_p ->> 'stock_count_id' is not null then
    v_result := acc_post_stock_count(
      (v_p ->> 'stock_count_id')::uuid, (v_p ->> 'inventory_account_id')::uuid,
      (v_p ->> 'offset_account_id')::uuid);
  elsif v_req.action_key = 'inventory_adjustment' then
    v_result := acc_adjust_inventory(
      (v_p ->> 'item_id')::uuid, (v_p ->> 'date')::date, (v_p ->> 'qty_delta')::numeric,
      (v_p ->> 'unit_cost_minor')::bigint, (v_p ->> 'value_delta_minor')::bigint,
      (v_p ->> 'offset_account_id')::uuid, v_req.reason);
  elsif v_req.action_key = 'period_reopen' then
    perform acc_reopen_period((v_p ->> 'period_id')::uuid, v_req.reason);
    v_result := (v_p ->> 'period_id')::uuid;
  elsif v_req.action_key = 'reconciliation_reopen' then
    perform acc_reopen_reconciliation((v_p ->> 'reconciliation_id')::uuid, v_req.reason);
    v_result := (v_p ->> 'reconciliation_id')::uuid;
  elsif v_req.action_key = 'vendor_tax_profile' then
    v_result := acc_save_vendor_tax_profile(
      (v_p ->> 'vendor_id')::uuid,
      (v_p ->> 'w9_status')::acc_w9_status,
      nullif(v_p ->> 'w9_received_date', '')::date,
      nullif(v_p ->> 'w9_expires_date', '')::date,
      nullif(v_p ->> 'classification', '')::acc_tax_classification,
      v_p ->> 'reporting_name',
      v_p ->> 'tin_ref',
      nullif(v_p ->> 'tin_type', '')::acc_tin_type,
      v_p ->> 'address_line1', v_p ->> 'address_line2', v_p ->> 'city',
      v_p ->> 'region', v_p ->> 'postal_code', v_p ->> 'country',
      (v_p ->> 'is_1099_eligible')::boolean,
      v_p ->> 'box_code',
      (v_p ->> 'eligibility_override')::boolean,
      v_p ->> 'override_reason',
      v_req.reason);
  else
    raise exception 'No dispatch defined for %', v_req.action_key;
  end if;

  perform set_config('acc.approval_dispatch', 'off', true);

  update acc_approval_request
     set status = 'approved', decided_by = auth.uid(), decided_at = now(),
         decision_note = p_note, result_id = v_result
   where id = p_request_id;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
    values ('acc_approval_request', p_request_id, 'post', auth.uid(),
            jsonb_build_object('status', 'approved', 'result_id', v_result, 'note', p_note));
  return v_result;
end;
$$;

-- ----------------------------------------------------------------------------
-- Who may call what
-- ----------------------------------------------------------------------------
revoke all on function acc_inventory_account_ids() from public, anon;
revoke all on function acc_stock_count_default_accounts() from public, anon;
revoke all on function acc_create_stock_count(date) from public, anon;
revoke all on function acc_save_stock_count(uuid, date, text, jsonb) from public, anon;
revoke all on function acc_post_stock_count(uuid, uuid, uuid) from public, anon;
revoke all on function acc_mark_stock_count_pending(uuid, uuid) from public, anon;
revoke all on function acc_stock_count_request_closed() from public, anon, authenticated;
grant execute on function acc_inventory_account_ids() to authenticated, service_role;
grant execute on function acc_stock_count_default_accounts() to authenticated, service_role;
grant execute on function acc_create_stock_count(date) to authenticated, service_role;
grant execute on function acc_save_stock_count(uuid, date, text, jsonb) to authenticated, service_role;
grant execute on function acc_post_stock_count(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function acc_mark_stock_count_pending(uuid, uuid) to authenticated, service_role;
```

- [ ] **Step 5: Create `ctyhp-accounting/scripts/verify-stock-count.mjs`** with exactly this content:

```js
/**
 * Behavioural verification of migration 0139 (Stock Count) on every company.
 *
 * Every schema gets ONE short transaction that is ALWAYS rolled back, with
 * lock_timeout and statement_timeout set. 0139 is applied inside it (retargeted
 * to the schema, as scripts/migrate.mjs does), so nothing is left behind.
 *
 *  - In every schema: structure only. Tables, RLS, grants, the sequence and the
 *    functions exist; the inventory-account rule and the default accounts
 *    resolve to something.
 *  - In co_pc (the sample company) only: the behaviour. Counts are created,
 *    saved, posted, sent for approval, rejected and refused there, every one of
 *    them rolled back, on dates in 2099 so no real period or entry is touched.
 *
 * Posting needs the 'stock_count' value of acc_journal_source (0138). When it is
 * not yet a committed value in a schema, the posting checks are skipped with one
 * line instead of failing.
 *
 * Run alone, never beside another database script:
 *   node --env-file=.env.local scripts/verify-stock-count.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0139_stock_count.sql";
const MIGRATION = readFileSync(new URL(`../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const SAMPLE = "co_pc";
const OUTSIDER = "00000000-0000-0000-0000-000000000000";
const AS_OF = "2099-06-30";
const APPROVAL_GUARD = /requires approval;\s*submit it for approval instead/i;

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
/** Runs `sql`, expecting the database to refuse it with a message holding `expect`; the books stay as they were. */
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

// ---------------------------------------------------------------------------
// Structure, in every schema
// ---------------------------------------------------------------------------
async function structure(schema) {
  const tables = ["acc_stock_count", "acc_stock_count_line"];
  for (const table of tables) {
    const t = await one(
      `select c.relrowsecurity as rls,
              has_table_privilege('authenticated', c.oid, 'select') as sel,
              has_table_privilege('authenticated', c.oid, 'insert') as ins,
              has_table_privilege('authenticated', c.oid, 'update') as upd,
              has_table_privilege('authenticated', c.oid, 'delete') as del,
              has_table_privilege('authenticated', c.oid, 'truncate') as trunc,
              has_table_privilege('anon', c.oid, 'select') as anon_sel,
              has_table_privilege('service_role', c.oid, 'insert') as svc
         from pg_class c where c.oid = to_regclass($1)`,
      [table],
    );
    check(`${table} exists with RLS on`, Boolean(t) && t.rls === true);
    check(`${table} is SELECT-only for signed-in users, closed to anon, open to the service role`,
      Boolean(t) && t.sel && !t.ins && !t.upd && !t.del && !t.trunc && !t.anon_sel && t.svc, JSON.stringify(t));
  }
  const policies = await all(`select tablename, cmd from pg_policies where schemaname = $1 and tablename = any($2::text[])`, [schema, tables]);
  check("both tables have a read policy and no write policy",
    policies.length === 2 && policies.every((p) => p.cmd === "SELECT"), JSON.stringify(policies));
  const triggers = await all(
    `select tgname from pg_trigger where tgrelid = to_regclass('acc_stock_count') and not tgisinternal order by tgname`,
  );
  check("the header has its actor-stamp and audit triggers",
    triggers.map((r) => r.tgname).join(",") === "acc_stock_count_actor_stamp,acc_stock_count_atomic_audit", JSON.stringify(triggers));
  check("a rejected request returns its count: the trigger is on acc_approval_request",
    (await one(`select count(*)::int as n from pg_trigger where tgrelid = to_regclass('acc_approval_request') and tgname = 'acc_approval_request_stock_count'`)).n === 1);
  check("the SC- sequence row exists",
    (await one(`select count(*)::int as n from acc_sequence where key = 'stock_count' and prefix = 'SC-'`)).n === 1);

  const functions = [
    "acc_inventory_account_ids()",
    "acc_stock_count_default_accounts()",
    "acc_create_stock_count(date)",
    "acc_save_stock_count(uuid,date,text,jsonb)",
    "acc_post_stock_count(uuid,uuid,uuid)",
    "acc_mark_stock_count_pending(uuid,uuid)",
    "acc_approve_request(uuid,text)",
  ];
  for (const fn of functions) {
    const f = await one(
      `select p.prosecdef as definer, p.proconfig as config,
              has_function_privilege('anon', p.oid, 'execute') as anon_exec,
              has_function_privilege('authenticated', p.oid, 'execute') as auth_exec
         from pg_proc p where p.oid = to_regprocedure($1)`,
      [fn],
    );
    check(`${fn} exists, is security definer with search_path, closed to anon, open to signed-in users`,
      Boolean(f) && f.definer && (f.config ?? []).some((c) => c.startsWith("search_path=")) && !f.anon_exec && f.auth_exec,
      JSON.stringify(f));
  }

  const ids = await all(`select acc_inventory_account_ids() as id`);
  check("the inventory-account rule finds at least one account", ids.length > 0, `${ids.length}`);
  const defaults = await one(`select * from acc_stock_count_default_accounts()`);
  check("the default inventory and offset accounts resolve", Boolean(defaults?.inventory_account_id) && Boolean(defaults?.offset_account_id), JSON.stringify(defaults));
}

// ---------------------------------------------------------------------------
// Behaviour, in the sample company only
// ---------------------------------------------------------------------------
async function behaviour() {
  const admin = await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`);
  const viewer = await one(`select id from acc_app_user where role = 'viewer' and status = 'active' order by created_at limit 1`);
  const base = await one(`select code from acc_currency where is_base limit 1`);
  if (!admin || !base) {
    console.log("  (no active administrator or base currency; behaviour checks skipped)");
    return;
  }

  // Owner prep: a clean slate for the checks, rolled back with everything else.
  await client.query(`delete from acc_stock_count where status in ('draft', 'pending_approval')`);
  await client.query(`update acc_item set is_active = false where is_inventory`);
  await client.query(`update acc_approval_policy set enabled = false where action_key = 'inventory_adjustment'`);
  const { inventory_account_id: inv, offset_account_id: off } = await one(`select * from acc_stock_count_default_accounts()`);

  await client.query("set local role authenticated");
  await as(admin.id);

  const bookAt = async (date) =>
    Number((await one(
      `select (coalesce(sum(case when l.debit_minor > 0 then l.amount_base_minor else 0 end), 0)
             - coalesce(sum(case when l.credit_minor > 0 then l.amount_base_minor else 0 end), 0))::bigint as v
         from acc_journal_line l join acc_journal_entry e on e.id = l.journal_entry_id
        where l.account_id in (select acc_inventory_account_ids()) and e.status = 'posted' and e.entry_date <= $1`,
      [date],
    )).v);
  const shift = (date, minor) =>
    one(`select acc_post_entry($1, 'Verify stock count: book shift', 'manual', null, $2,
                               jsonb_build_array(
                                 jsonb_build_object('account_id', $3::uuid, 'debit_minor', $4::bigint, 'credit_minor', 0, 'amount_base_minor', $4::bigint),
                                 jsonb_build_object('account_id', $5::uuid, 'debit_minor', 0, 'credit_minor', $4::bigint, 'amount_base_minor', $4::bigint))) as id`,
      [date, base.code, inv, minor, off]);
  const line = (name, quantity, cost, extra = {}) => ({ name, sku: null, quantity, unit_cost_minor: cost, sells_for_minor: null, ...extra });
  const save = (id, asOf, lines, memo = null) =>
    one(`select acc_save_stock_count($1, $2, $3, $4::jsonb) as n`, [id, asOf, memo, JSON.stringify(lines)]);
  /** A count whose lines add up to `target`: three lines that exercise rounding, and one that tops it up. */
  const sheet = (target) => {
    const known = 12500 + 833 + 396; // 10 x 1250, round(2.5 x 333), 4 x 99
    return [
      line("Sample widget", 10, 1250, { sku: "W-1", sells_for_minor: 999999 }),
      line("Sample gadget, large", 2.5, 333),
      line("Sample box", 4, 99),
      line("Balancing stock", 1, target - known),
    ];
  };
  const post = (id) => one(`select acc_post_stock_count($1, $2, $3) as id`, [id, inv, off]);
  const POST = `select acc_post_stock_count($1, $2, $3)`;
  const countRow = (id) => one(`select *, as_of::text as as_of_text from acc_stock_count where id = $1`, [id]);

  // the books: 200,000 of stock on 1 June 2099, so both signs of difference are possible
  await shift("2099-06-01", 200000);
  const book0 = await bookAt(AS_OF);

  // ---- who may create
  if (viewer) {
    await as(viewer.id);
    await refused("a viewer cannot create a count", `select acc_create_stock_count($1)`, [AS_OF], "Not authorized");
  }
  await as(OUTSIDER);
  await refused("someone outside the company cannot create a count", `select acc_create_stock_count($1)`, [AS_OF], "Not authorized");
  await as(admin.id);

  // ---- create, save, read back
  const a = (await one(`select acc_create_stock_count($1) as id`, [AS_OF])).id;
  const aRow = await countRow(a);
  check("a new count is a draft numbered SC-", aRow.status === "draft" && /^SC-\d{6}$/.test(aRow.count_number) && aRow.as_of_text === AS_OF);
  check("asking again returns the open count, not a second one",
    (await one(`select acc_create_stock_count('2099-07-31') as id`)).id === a &&
      (await one(`select count(*)::int as n from acc_stock_count where status in ('draft', 'pending_approval')`)).n === 1);
  check("a first count starts with no lines", (await one(`select count(*)::int as n from acc_stock_count_line where stock_count_id = $1`, [a])).n === 0);

  const target = book0 + 5000;
  check("saving returns the number of lines", (await save(a, AS_OF, sheet(target), "Verify memo")).n === 4);
  const saved = await all(`select * from acc_stock_count_line where stock_count_id = $1 order by line_order`, [a]);
  check("the lines read back in order, with the SKU, fractional quantity and sells-for kept",
    saved.length === 4 && saved.map((l) => l.line_order).join() === "1,2,3,4" &&
      saved[0].sku === "W-1" && Number(saved[0].sells_for_minor) === 999999 &&
      saved[1].name === "Sample gadget, large" && Number(saved[1].quantity) === 2.5 && saved[1].sells_for_minor === null,
    JSON.stringify(saved));
  check("the header keeps the memo", (await countRow(a)).memo === "Verify memo");
  check("saving again replaces the lines rather than adding to them",
    (await save(a, AS_OF, sheet(target), "Verify memo")).n === 4 &&
      (await one(`select count(*)::int as n from acc_stock_count_line where stock_count_id = $1`, [a])).n === 4);

  // ---- what saving refuses
  const SAVE = `select acc_save_stock_count($1, $2, null, $3::jsonb)`;
  const bad = (lines) => [a, AS_OF, JSON.stringify(lines)];
  await refused("a line without a name is refused", SAVE, bad([line("  ", 1, 1)]), "Line 1: a name is required");
  await refused("a negative quantity is refused", SAVE, bad([line("X", -1, 1)]), "Line 1: the quantity cannot be negative");
  await refused("a negative cost is refused", SAVE, bad([line("X", 1, 5), line("Y", 1, -1)]), "Line 2: the cost each cannot be negative");
  await refused("a negative sells-for is refused", SAVE, bad([line("X", 1, 1, { sells_for_minor: -5 })]), "sells for cannot be negative");
  await refused("a missing quantity is refused", SAVE, bad([{ name: "X", unit_cost_minor: 1 }]), "a quantity is required");
  await refused("more than 2,000 lines are refused", SAVE, bad(Array.from({ length: 2001 }, (_, i) => line(`L${i}`, 1, 1))), "at most 2,000 lines");
  await refused("a list that is not a list is refused", SAVE, [a, AS_OF, "{}"], "must be a list");
  await refused("an unknown count is refused", SAVE, [OUTSIDER, AS_OF, "[]"], "Stock count not found");
  check("a refused save leaves the lines as they were",
    (await one(`select count(*)::int as n from acc_stock_count_line where stock_count_id = $1`, [a])).n === 4);

  // ---- what posting refuses
  await asOwner(admin.id, () => client.query(`update acc_role_permission set allowed = false where role = 'admin' and permission_key = 'inventory.adjust'`));
  await refused("posting without the inventory.adjust permission is refused", POST, [a, inv, off], "do not have permission to adjust inventory");
  await asOwner(admin.id, () => client.query(`update acc_role_permission set allowed = true where role = 'admin' and permission_key = 'inventory.adjust'`));
  if (viewer) {
    await as(viewer.id);
    await refused("a viewer cannot post", POST, [a, inv, off], "Not authorized");
    await as(admin.id);
  }
  await refused("posting an unknown count is refused", POST, [OUTSIDER, inv, off], "Stock count not found");
  await refused("an account that is not an inventory account is refused", POST, [a, off, off], "not one of this company's inventory accounts");
  await refused("an offset that is not cost of sales is refused", POST, [a, inv, inv], "must be an active cost of sales account");

  await asOwner(admin.id, async () => {
    await client.query(
      `insert into acc_item (name, is_inventory, inventory_account_id, is_active) values ('Verify tracked item', true, $1, true)`,
      [inv],
    );
  }).catch((e) => check("a tracked item can be added for the check", false, e.message));
  await refused("a company that tracks items is refused", POST, [a, inv, off], "tracks stock item by item; adjust items on the Products & Services page");
  await asOwner(admin.id, () => client.query(`update acc_item set is_active = false where name = 'Verify tracked item'`));

  await save(a, AS_OF, sheet(book0));
  await refused("a zero difference is refused", POST, [a, inv, off], "The count already agrees with the books.");

  // a closed period: the check runs inside a savepoint, so the count keeps its date
  await client.query("savepoint closed");
  try {
    await asOwner(admin.id, () =>
      client.query(
        `insert into acc_accounting_period (fiscal_year, period_month, period_start, period_end, label, status)
         values (2099, 5, '2099-05-01', '2099-05-31', 'May 2099', 'closed')`,
      ),
    );
    await save(a, "2099-05-15", [line("Closed-period stock", 1, 1000)]);
    await client.query("savepoint closed_post");
    try {
      await client.query(POST, [a, inv, off]);
      check("a closed period is refused", false, "it was accepted");
    } catch (error) {
      check("a closed period is refused", error.message.includes("Accounting period for 2099-05-15 is closed"), error.message);
    }
    await client.query("rollback to savepoint closed_post");
  } finally {
    await client.query("rollback to savepoint closed");
  }
  check("…and the refusal left the count dated as before", (await countRow(a)).as_of_text === AS_OF);

  // ---- the book value is the base-currency ledger balance
  const ledgerBase = async (date) =>
    Number((await one(
      `select coalesce(sum(b.debit_base - b.credit_base), 0)::bigint as v
         from acc_ledger_balances(null, $1) b where b.account_id in (select acc_inventory_account_ids())`,
      [date],
    )).v);
  check("the book value agrees with acc_ledger_balances over the inventory accounts", (await ledgerBase(AS_OF)) === book0, `${book0} vs ${await ledgerBase(AS_OF)}`);
  // A line whose base amount differs from its own debit/credit, as a foreign-currency line does:
  // acc_post_entry balances debit against credit and takes amount_base_minor as given.
  await client.query("savepoint fx_line");
  try {
    await one(`select acc_post_entry('2099-06-02', 'Verify stock count: foreign-style line', 'manual', null, $1,
                 jsonb_build_array(
                   jsonb_build_object('account_id', $2::uuid, 'debit_minor', 1000, 'credit_minor', 0, 'amount_base_minor', 1700),
                   jsonb_build_object('account_id', $3::uuid, 'debit_minor', 0, 'credit_minor', 1000, 'amount_base_minor', 1700))) as id`,
      [base.code, inv, off]);
    const bookFx = await bookAt(AS_OF);
    check("a line with a different base amount moves the book value by its base amount", bookFx === book0 + 1700, `${bookFx} vs ${book0 + 1700}`);
    check("…and the ledger report agrees", (await ledgerBase(AS_OF)) === bookFx);
    await save(a, AS_OF, sheet(bookFx + 2500));
    await post(a);
    const fx = await countRow(a);
    check("posting uses the base amount: book value and difference are in base currency",
      Number(fx.book_minor) === book0 + 1700 && Number(fx.difference_minor) === 2500, JSON.stringify(fx));
  } finally {
    await client.query("rollback to savepoint fx_line");
  }
  check("…and the rolled-back post left the count a draft", (await countRow(a)).status === "draft");

  // ---- posting a surplus
  await save(a, AS_OF, sheet(target));
  const entryA = (await post(a)).id;
  const posted = await countRow(a);
  check("the count is posted, with its figures frozen",
    posted.status === "posted" && Number(posted.counted_minor) === target && Number(posted.book_minor) === book0 &&
      Number(posted.difference_minor) === 5000 && posted.inventory_account_id === inv && posted.offset_account_id === off &&
      posted.journal_entry_id === entryA && posted.posted_by === admin.id && posted.posted_at !== null,
    JSON.stringify(posted));
  const entry = await one(`select source_type::text as source, source_id, status::text as status, description from acc_journal_entry where id = $1`, [entryA]);
  check("the entry has source stock_count, points at the count and is posted",
    entry.source === "stock_count" && entry.source_id === a && entry.status === "posted" && entry.description.startsWith(`Stock count ${posted.count_number} as of 2099-06-30`),
    JSON.stringify(entry));
  const lines = await all(`select account_id, debit_minor::bigint as d, credit_minor::bigint as c from acc_journal_line where journal_entry_id = $1 order by line_order`, [entryA]);
  check("a surplus debits inventory and credits the offset by the difference",
    lines.length === 2 && lines[0].account_id === inv && Number(lines[0].d) === 5000 && lines[1].account_id === off && Number(lines[1].c) === 5000,
    JSON.stringify(lines));
  check("the entry is marked adjusting",
    (await one(`select count(*)::int as n from acc_adjusting_entry where journal_entry_id = $1`, [entryA])).n === 1);
  check("an audit row with action post is written",
    (await one(`select count(*)::int as n from acc_audit_log where table_name = 'acc_journal_entry' and record_id = $1 and action = 'post' and actor_id = $2`, [entryA, admin.id])).n === 1);
  check("the book value is now the counted value", (await bookAt(AS_OF)) === target);
  await refused("a posted count cannot be posted again", POST, [a, inv, off], "already posted");
  await refused("a posted count cannot be edited", SAVE, [a, AS_OF, "[]"], "Only a draft count can be edited");

  // ---- the next count starts from the last one, and posts a shortfall
  const b = (await one(`select acc_create_stock_count($1) as id`, [AS_OF])).id;
  const copied = await all(`select name, sku, quantity::float as q, unit_cost_minor::bigint as cost, sells_for_minor::bigint as sells from acc_stock_count_line where stock_count_id = $1 order by line_order`, [b]);
  check("a new count starts as a copy of the previous count's lines",
    copied.length === 4 && copied[0].name === "Sample widget" && copied[0].sku === "W-1" && Number(copied[0].sells) === 999999 && copied[1].q === 2.5,
    JSON.stringify(copied));
  await refused("an unchanged copy agrees with the books", POST, [b, inv, off], "The count already agrees with the books.");
  await save(b, AS_OF, sheet(target - 7000));
  const entryB = (await post(b)).id;
  const postedB = await countRow(b);
  check("a shortfall is posted with a negative difference and the book value it found",
    Number(postedB.difference_minor) === -7000 && Number(postedB.book_minor) === target && Number(postedB.counted_minor) === target - 7000);
  const linesB = await all(`select account_id, debit_minor::bigint as d, credit_minor::bigint as c from acc_journal_line where journal_entry_id = $1 order by line_order`, [entryB]);
  check("a shortfall debits the offset and credits inventory",
    linesB.length === 2 && linesB[0].account_id === off && Number(linesB[0].d) === 7000 && linesB[1].account_id === inv && Number(linesB[1].c) === 7000,
    JSON.stringify(linesB));
  check("the earlier count's figures did not move", Number((await countRow(a)).book_minor) === book0 && Number((await countRow(a)).difference_minor) === 5000);

  // ---- the approval policy
  await asOwner(admin.id, () =>
    client.query(`update acc_approval_policy set enabled = true, threshold_minor = 1000, require_segregation = false where action_key = 'inventory_adjustment'`),
  );
  const c = (await one(`select acc_create_stock_count($1) as id`, [AS_OF])).id;
  const bookC = await bookAt(AS_OF);
  await save(c, AS_OF, sheet(bookC + 3000));
  let guard = "";
  await client.query("savepoint guard");
  try {
    await client.query(POST, [c, inv, off]);
  } catch (error) {
    guard = error.message;
  }
  await client.query("rollback to savepoint guard");
  check("above the threshold, posting raises the approval guard", APPROVAL_GUARD.test(guard), guard);
  check("…and posts nothing", (await countRow(c)).status === "draft");

  const payload = { stock_count_id: c, inventory_account_id: inv, offset_account_id: off };
  const submit = async (id) =>
    (await one(`select acc_submit_for_approval('inventory_adjustment', 'Stock count', 3000, $1::jsonb, 'Verify') as id`, [JSON.stringify({ ...payload, stock_count_id: id })])).id;
  const reqC = await submit(c);
  const MARK = `select acc_mark_stock_count_pending($1, $2)`;
  const NOT_THIS = "not a pending request for this stock count";
  await refused("a request id that does not exist cannot be linked", MARK, [c, OUTSIDER], NOT_THIS);
  const reqOther = await submit(OUTSIDER);
  await refused("a request whose payload names another count cannot be linked", MARK, [c, reqOther], NOT_THIS);
  check("…and the count was not changed by the refusals", (await countRow(c)).status === "draft" && (await countRow(c)).approval_request_id === null);
  await refused("an unknown count cannot be marked pending", MARK, [OUTSIDER, reqC], "Stock count not found");
  if (viewer) {
    await as(viewer.id);
    await refused("a viewer cannot mark a count pending", MARK, [c, reqC], "Not authorized");
    await as(admin.id);
  }
  await refused("a posted count cannot be marked pending", MARK, [a, reqC], "Only a draft count can be sent for approval");
  await one(`select acc_mark_stock_count_pending($1, $2)`, [c, reqC]);
  const pending = await countRow(c);
  check("a submitted count waits for approval, linked to its request", pending.status === "pending_approval" && pending.approval_request_id === reqC);
  await refused("a count waiting for approval cannot be edited", SAVE, [c, AS_OF, "[]"], "Only a draft count can be edited");
  await refused("a count waiting for approval cannot be posted directly", POST, [c, inv, off], "waiting for approval");
  check("a count waiting for approval is still the open count",
    (await one(`select acc_create_stock_count('2099-08-31') as id`)).id === c);

  // the books move before the approval: the difference is worked out again at approval
  await shift("2099-06-15", 500);
  const approved = (await one(`select acc_approve_request($1, 'Verify') as id`, [reqC])).id;
  const postedC = await countRow(c);
  check("approving posts the count and returns its entry",
    postedC.status === "posted" && postedC.journal_entry_id === approved, JSON.stringify(postedC));
  check("the difference is recomputed at approval, against the books as they stand",
    Number(postedC.difference_minor) === 2500 && Number(postedC.book_minor) === bookC + 500,
    `${postedC.difference_minor} / ${postedC.book_minor}`);
  const reqRow = await one(`select status::text as status, result_id from acc_approval_request where id = $1`, [reqC]);
  check("the request is approved with the entry as its result", reqRow.status === "approved" && reqRow.result_id === approved);

  // rejected, and cancelled: the count goes back to draft and can be edited again
  const d = (await one(`select acc_create_stock_count($1) as id`, [AS_OF])).id;
  await save(d, AS_OF, sheet((await bookAt(AS_OF)) + 4000));
  const reqD = await submit(d);
  await one(`select acc_mark_stock_count_pending($1, $2)`, [d, reqD]);
  await one(`select acc_reject_request($1, 'Not now')`, [reqD]);
  const rejected = await countRow(d);
  check("a rejected request returns the count to draft, unlinked", rejected.status === "draft" && rejected.approval_request_id === null, JSON.stringify(rejected));
  check("…and the draft can be edited again", (await save(d, AS_OF, sheet(1000000))).n === 4);
  const reqD2 = await submit(d);
  await one(`select acc_mark_stock_count_pending($1, $2)`, [d, reqD2]);
  await one(`select acc_cancel_request($1)`, [reqD2]);
  check("a cancelled request returns the count to draft too", (await countRow(d)).status === "draft");
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
      const statements = schema === "public" ? [MIGRATION] : planCompanySchema([{ file: FILE, sql: MIGRATION }], schema).statements;
      const applied = (await client.query(`select 1 from acc_schema_migrations where filename = $1`, [FILE])).rowCount > 0;
      if (!applied) {
        for (const statement of statements) await client.query(statement);
        console.log("  (0139 applied inside the transaction, never committed)");
      }
      for (const statement of statements) await client.query(statement);
      check("applying 0139 a second time is harmless", true);

      await structure(schema);

      if (schema === SAMPLE) {
        const hasValue = (await client.query(
          `select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid join pg_namespace n on n.oid = t.typnamespace
            where n.nspname = $1 and t.typname = 'acc_journal_source' and e.enumlabel = 'stock_count'`,
          [schema],
        )).rowCount > 0;
        if (hasValue) await behaviour();
        else console.log(`  0138 not applied in ${schema}: posting checks skipped`);
      }
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

- [ ] **Step 6: Edit `ctyhp-accounting/package.json`** — apply this 1 find/replace edit (its find string occurs exactly once):

Edit 1 of 1 — find:

```json
    "test:scanner-gateway": "node ../services/document-scanner/test/contract.test.mjs",
    "verify:entitlement": "node --env-file=.env.local scripts/verify-entitlement.mjs"
  },
```

replace with:

```json
    "test:scanner-gateway": "node ../services/document-scanner/test/contract.test.mjs",
    "verify:entitlement": "node --env-file=.env.local scripts/verify-entitlement.mjs",
    "verify:stock-count": "node --env-file=.env.local scripts/verify-stock-count.mjs"
  },
```

- [ ] **Step 7: Do not touch the database**

0138 and 0139 are already live on all six companies. Do NOT run `scripts/migrate.mjs`, `npm run verify:stock-count`, `provision-company` or any other script that connects to the database — the controller runs the verification. The unit test above reads the migration files as text and needs no database.

- [ ] **Step 8: Run the gates**

Run from `ctyhp-accounting/` and read the pass/fail lines in full (never pipe through `tail`/`head`):

```bash
npx tsc --noEmit -p .
npx eslint "tests/unit/stock-count-migration.test.ts"
npx vitest run tests/unit/stock-count-migration.test.ts tests/unit/migration-grants.test.ts
```

Expected: tsc exits 0 with no output; eslint reports 0 errors and 0 warnings for these files; stock-count-migration + migration-grants: 64 tests passing.

- [ ] **Step 9: Commit**

```bash
git add "ctyhp-accounting/tests/unit/stock-count-migration.test.ts" "ctyhp-accounting/supabase/migrations/0138_stock_count_source.sql" "ctyhp-accounting/supabase/migrations/0139_stock_count.sql" "ctyhp-accounting/scripts/verify-stock-count.mjs" "ctyhp-accounting/package.json"
git commit -m "feat(inventory): Stock Count tables and RPCs (migrations 0138, 0139)"
```

Stage by file name only (never `git add -A` / `git add .`). No Co-Authored-By trailer; no mention of Claude or AI in the message.

---

### Task 2: The count model, service and actions, and where counts show up elsewhere

**Files:**
- Test (create): `ctyhp-accounting/tests/unit/stock-count.test.ts`
- Test (create): `ctyhp-accounting/tests/unit/stock-count-service.test.ts`
- Test (create): `ctyhp-accounting/tests/unit/stock-count-actions.test.ts`
- Test (modify): `ctyhp-accounting/tests/unit/purchases-inventory.test.ts`
- Test (modify): `ctyhp-accounting/tests/unit/entry-detail.test.ts`
- Test (modify): `ctyhp-accounting/tests/unit/company-export-order.test.ts`
- Modify: `ctyhp-accounting/lib/db/types.ts`
- Create: `ctyhp-accounting/lib/domain/stock-count.ts`
- Create: `ctyhp-accounting/lib/services/stock-count.ts`
- Create: `ctyhp-accounting/app/(app)/inventory/stock-count/actions.ts`
- Modify: `ctyhp-accounting/lib/domain/purchases-inventory.ts`
- Modify: `ctyhp-accounting/lib/domain/entry-detail.ts`
- Modify: `ctyhp-accounting/app/(app)/reports/general-ledger/GeneralLedgerClient.tsx`
- Modify: `ctyhp-accounting/app/(app)/reports/journal/JournalReportClient.tsx`
- Modify: `ctyhp-accounting/lib/domain/company-export.ts`
- Modify: `ctyhp-accounting/app/(app)/settings/audit/page.tsx`
- Modify: `ctyhp-accounting/lib/services/dashboard.ts`

**Interfaces:**
- Consumes: Task 1's RPCs by name; existing `readAllPages` (`lib/services/paging.ts`), `getLedgerBalances` (`lib/services/reports.ts`), `executeOrSubmitForApproval` (`lib/services/approval-flow.ts`), `hasPermission` (`lib/services/access`), `lib/domain/money`, `lib/domain/report-export`.
- Produces:
  - `JournalSource` gains `"stock_count"`; `StockCountStatusValue`, `StockCountRow`, `StockCountLineRow` (`lib/db/types.ts`).
  - `lib/domain/stock-count.ts`: `MAX_COUNT_LINES`, `parseCountSheet`, `validateStockCount`, `isDirty`, `lineValueMinor`, `countedTotalMinor`, `countDifferenceMinor`, `stockCountSheet`, `stockCountErrorMessage`, `pasteProblemText`, `pasteSummary`, `appendCountLines`, `adjustButtonState`, `adjustButtonLabel`, `signedAmountText`, `entryPreview`, `differenceTone`, `isLocked`, `stockCountStatusLabel`, and the copy constants `PASTE_HINT`, `FOOTNOTE`, `AGREES_MESSAGE`, `SAVE_FIRST_MESSAGE`, `CLOSED_PERIOD_MESSAGE`, `TRACKS_ITEMS_MESSAGE` — Task 3's screens use them.
  - `lib/services/stock-count.ts`: `listStockCounts`, `listStockCountSummaries` → `StockCountSummary[]`, `getStockCount(sb, id)` → `StockCountWithLines | null`, `getBookValue(sb, asOf)` → minor units, `getPostingContext(sb)` → `PostingContext`, `createStockCount`, `saveStockCount`, `postStockCount`, `markStockCountPending`, `getEntryNumber`.
  - `app/(app)/inventory/stock-count/actions.ts`: `createStockCountAction(asOf)`, `saveStockCountAction(raw)`, `bookValueAction(asOf)`, `postStockCountAction(raw)` → `ActionResult<PostStockCountOutcome>` where the outcome is `{ kind: "posted"; entryId; entryNumber }` or `{ kind: "submitted"; requestId }`.
  - Counts read as count adjustments in Purchases and Inventory, show as "Stock count" in entry detail, the General Ledger and the Journal, are exported in the right order, and appear in the audit log filter and the dashboard's recent activity.

- [ ] **Step 1: Create `ctyhp-accounting/tests/unit/stock-count.test.ts`** with exactly this content:

```ts
import { describe, expect, it } from "vitest";
import {
  countDifferenceMinor,
  countedTotalMinor,
  isDirty,
  lineValueMinor,
  parseCountSheet,
  stockCountErrorMessage,
  stockCountSheet,
  stockCountStatusLabel,
  validateStockCount,
  type StockCountDraft,
  type StockCountLineInput,
} from "@/lib/domain/stock-count";

const line = (over: Partial<StockCountLineInput> = {}): StockCountLineInput => ({
  name: "Brass bolt",
  sku: null,
  quantity: 10,
  unitCostMinor: 250,
  sellsForMinor: null,
  ...over,
});

describe("parseCountSheet", () => {
  it("reads name, quantity and cost", () => {
    const r = parseCountSheet("Brass bolt, 10, 2.50");
    expect(r.problems).toEqual([]);
    expect(r.lines).toEqual([{ name: "Brass bolt", sku: null, quantity: 10, unitCostMinor: 250, sellsForMinor: null }]);
  });

  it("reads the optional fourth column as sells for", () => {
    const r = parseCountSheet("Brass bolt, 10, 2.50, 4");
    expect(r.lines[0]).toMatchObject({ name: "Brass bolt", quantity: 10, unitCostMinor: 250, sellsForMinor: 400 });
  });

  it("lets a name contain commas, reading from the right", () => {
    const r = parseCountSheet("Bolt, brass, M8, 120, 0.35\nScrew, steel, 4 inch, 3, 1.10, 2");
    expect(r.problems).toEqual([]);
    expect(r.lines.map((l) => [l.name, l.quantity, l.unitCostMinor, l.sellsForMinor])).toEqual([
      ["Bolt, brass, M8", 120, 35, null],
      ["Screw, steel, 4 inch", 3, 110, 200],
    ]);
  });

  it("trims the fields and takes decimal quantities", () => {
    const r = parseCountSheet("   Copper wire  ,  12.5 ,  3  ");
    expect(r.lines[0]).toMatchObject({ name: "Copper wire", quantity: 12.5, unitCostMinor: 300 });
  });

  it("skips blank lines silently but counts them in the line numbers", () => {
    const r = parseCountSheet("Washer, 5, 1\n\n   \nNut, abc, 1\nBolt, 2, 1");
    expect(r.lines.map((l) => l.name)).toEqual(["Washer", "Bolt"]);
    expect(r.problems).toHaveLength(1);
    expect(r.problems[0].lineNumber).toBe(4);
    expect(r.problems[0].text).toBe("Nut, abc, 1");
  });

  it("refuses a line with no cost, and says so", () => {
    const r = parseCountSheet("Washer, 5");
    expect(r.lines).toEqual([]);
    expect(r.problems).toEqual([{ lineNumber: 1, text: "Washer, 5", reason: expect.stringContaining("cost") }]);
  });

  it("refuses a line with only a name", () => {
    expect(parseCountSheet("Washer").problems[0].reason).toMatch(/name, a quantity and a cost/);
  });

  it("refuses a missing name", () => {
    const r = parseCountSheet(", 5, 2");
    expect(r.problems[0]).toMatchObject({ lineNumber: 1, reason: "A name is required" });
    expect(parseCountSheet(" ,5,2").problems[0].reason).toBe("A name is required");
  });

  it("treats a fourth numeric field as sells for and a fifth as part of the name", () => {
    const four = parseCountSheet("Bolt, 5, 2, 3");
    expect(four.lines[0].sellsForMinor).toBe(300);
    const five = parseCountSheet("Bolt, 5, 2, 3, 4");
    expect(five.lines[0]).toMatchObject({ name: "Bolt, 5", quantity: 2, unitCostMinor: 300, sellsForMinor: 400 });
  });

  it("refuses negative numbers", () => {
    expect(parseCountSheet("Bolt, -5, 2").problems[0].reason).toBe("Quantity cannot be negative");
    expect(parseCountSheet("Bolt, 5, -2").problems[0].reason).toBe("Cost each cannot be negative");
    expect(parseCountSheet("Bolt, 5, 2, -1").problems[0].reason).toBe("Sells for cannot be negative");
  });

  it("refuses junk instead of guessing", () => {
    expect(parseCountSheet("Bolt, five, 2").problems[0].reason).toBe("Quantity “five” is not a number");
    expect(parseCountSheet("Bolt, 5, $2").problems[0].reason).toBe("Cost each “$2” is not a number");
    expect(parseCountSheet("Bolt, 5, 1e3").problems[0].reason).toContain("not a number");
    expect(parseCountSheet("Bolt, 5, ").problems[0].reason).toContain("is missing");
  });

  it("refuses more decimals than the currency or the quantity column holds", () => {
    expect(parseCountSheet("Bolt, 5, 2.505").problems[0].reason).toBe("Cost each can have at most 2 decimal places");
    expect(parseCountSheet("Bolt, 5, 2.5", 0).problems[0].reason).toBe("Cost each must be a whole number");
    expect(parseCountSheet("Bolt, 1.23456, 2").problems[0].reason).toBe("Quantity can have at most 4 decimal places");
    // trailing zeros are not extra decimals
    expect(parseCountSheet("Bolt, 5, 2.500").lines[0].unitCostMinor).toBe(250);
  });

  it("accepts thousands separators only where they cannot be a column break", () => {
    const tabs = parseCountSheet("Gasket, large\t1,200\t1,250.50");
    expect(tabs.problems).toEqual([]);
    expect(tabs.lines[0]).toMatchObject({ name: "Gasket, large", quantity: 1200, unitCostMinor: 125050 });

    const quoted = parseCountSheet('Gasket, "1,200", "1,250.50"');
    expect(quoted.problems).toEqual([]);
    expect(quoted.lines[0]).toMatchObject({ name: "Gasket", quantity: 1200, unitCostMinor: 125050 });
  });

  it("refuses a bare thousands comma instead of reading it as two columns", () => {
    const r = parseCountSheet("Gasket, 1,000, 2.50");
    expect(r.lines).toEqual([]);
    expect(r.problems[0].reason).toMatch(/thousands comma/);
    // a malformed group in a quoted or tabbed field is refused as well
    expect(parseCountSheet('Gasket, "1,20", 2').problems[0].reason).toMatch(/comma/);
  });

  it("reports good lines and bad lines together, by line number", () => {
    const r = parseCountSheet("A, 1, 1\nB, x, 1\nC, 3, 3\nD, 4\nE, 5, 5");
    expect(r.lines.map((l) => l.name)).toEqual(["A", "C", "E"]);
    expect(r.problems.map((p) => p.lineNumber)).toEqual([2, 4]);
  });

  it("reads Windows line endings", () => {
    expect(parseCountSheet("A, 1, 1\r\nB, 2, 2\r\n").lines).toHaveLength(2);
  });

  it("returns nothing for an empty paste", () => {
    expect(parseCountSheet("")).toEqual({ lines: [], problems: [] });
    expect(parseCountSheet("\n  \n")).toEqual({ lines: [], problems: [] });
  });
});

describe("line value and totals", () => {
  it("is quantity x cost, rounded to a whole minor unit", () => {
    expect(lineValueMinor(10, 250)).toBe(2500);
    expect(lineValueMinor(0, 250)).toBe(0);
    expect(lineValueMinor(12.5, 301)).toBe(3763); // 3762.5 rounds up
    expect(lineValueMinor(0.5, 1)).toBe(1);
    expect(lineValueMinor(0.4999, 1)).toBe(0);
    expect(lineValueMinor(1.0005, 100)).toBe(100); // 100.05
    expect(lineValueMinor(2.675, 100)).toBe(268); // 267.5, not lost to binary floating point
  });

  it("stays exact with large amounts", () => {
    expect(lineValueMinor(1_000_000, 99_999_999)).toBe(99_999_999_000_000);
  });

  it("sums the rounded line values, not the rounded sum", () => {
    const lines = [line({ quantity: 0.5, unitCostMinor: 1 }), line({ quantity: 0.5, unitCostMinor: 1 })];
    expect(countedTotalMinor(lines)).toBe(2);
    expect(countedTotalMinor([])).toBe(0);
  });

  it("takes the books from the count for the difference", () => {
    expect(countDifferenceMinor(120_000, 100_000)).toBe(20_000);
    expect(countDifferenceMinor(80_000, 100_000)).toBe(-20_000);
    expect(countDifferenceMinor(5, 5)).toBe(0);
  });
});

describe("stockCountStatusLabel", () => {
  it("names the three states as the screen does", () => {
    expect(stockCountStatusLabel("draft")).toBe("Draft");
    expect(stockCountStatusLabel("pending_approval")).toBe("Waiting for approval");
    expect(stockCountStatusLabel("posted")).toBe("Posted");
  });
});

describe("isDirty", () => {
  const saved: StockCountDraft = { asOf: "2026-06-30", memo: "June", lines: [line(), line({ name: "Nut", sku: "N-1" })] };
  const copy = (): StockCountDraft => ({ ...saved, lines: saved.lines.map((l) => ({ ...l })) });

  it("is clean when nothing changed", () => {
    expect(isDirty(saved, copy())).toBe(false);
  });

  it("sees a changed date, memo or line field", () => {
    expect(isDirty(saved, { ...copy(), asOf: "2026-07-01" })).toBe(true);
    expect(isDirty(saved, { ...copy(), memo: "July" })).toBe(true);
    for (const patch of [
      { name: "Bolt" },
      { sku: "B-9" },
      { quantity: 11 },
      { unitCostMinor: 251 },
      { sellsForMinor: 500 },
    ]) {
      const c = copy();
      expect(isDirty(saved, { ...c, lines: [{ ...c.lines[0], ...patch }, c.lines[1]] }), JSON.stringify(patch)).toBe(true);
    }
  });

  it("sees a line added, removed or reordered", () => {
    expect(isDirty(saved, { ...copy(), lines: [...saved.lines, line()] })).toBe(true);
    expect(isDirty(saved, { ...copy(), lines: saved.lines.slice(1) })).toBe(true);
    expect(isDirty(saved, { ...copy(), lines: [saved.lines[1], saved.lines[0]] })).toBe(true);
  });

  it("treats an empty memo or SKU and an absent one as the same, and ignores stray spaces", () => {
    const a: StockCountDraft = { asOf: "2026-06-30", memo: null, lines: [line({ sku: null })] };
    const b: StockCountDraft = { asOf: "2026-06-30", memo: "  ", lines: [line({ sku: "", name: " Brass bolt " })] };
    expect(isDirty(a, b)).toBe(false);
  });
});

describe("validateStockCount", () => {
  const ok = (over: Partial<StockCountDraft> = {}): StockCountDraft => ({
    asOf: "2026-06-30",
    memo: null,
    lines: [line()],
    ...over,
  });

  it("passes a good sheet, and an empty one", () => {
    expect(validateStockCount(ok())).toEqual([]);
    expect(validateStockCount(ok({ lines: [] }))).toEqual([]);
  });

  it("names the line each problem is on", () => {
    const problems = validateStockCount(
      ok({
        lines: [
          line(),
          line({ name: "  " }),
          line({ quantity: -1 }),
          line({ unitCostMinor: -5 }),
          line({ sellsForMinor: -1 }),
          line({ unitCostMinor: 2.5 }),
          line({ quantity: Number.NaN }),
        ],
      }),
    );
    expect(problems).toEqual([
      { lineNumber: 2, reason: "A name is required" },
      { lineNumber: 3, reason: "The quantity cannot be negative" },
      { lineNumber: 4, reason: "The cost each cannot be negative" },
      { lineNumber: 5, reason: "Sells for cannot be negative" },
      { lineNumber: 6, reason: "Enter the cost each" },
      { lineNumber: 7, reason: "Enter a quantity" },
    ]);
  });

  it("allows 2,000 lines and refuses 2,001", () => {
    expect(validateStockCount(ok({ lines: Array.from({ length: 2000 }, () => line()) }))).toEqual([]);
    const p = validateStockCount(ok({ lines: Array.from({ length: 2001 }, () => line()) }));
    expect(p).toEqual([{ lineNumber: null, reason: expect.stringContaining("at most 2,000 lines") }]);
  });

  it("needs a date and a memo that fits", () => {
    expect(validateStockCount(ok({ asOf: "" }))[0].reason).toBe("Choose the as-of date");
    expect(validateStockCount(ok({ memo: "x".repeat(501) }))[0].reason).toContain("memo is too long");
  });

  it("refuses names and SKUs longer than the database holds", () => {
    expect(validateStockCount(ok({ lines: [line({ name: "n".repeat(201) })] }))[0].reason).toContain("name is too long");
    expect(validateStockCount(ok({ lines: [line({ sku: "s".repeat(101) })] }))[0].reason).toContain("SKU is too long");
  });
});

describe("stockCountSheet", () => {
  const base = {
    companyName: "Example Co",
    currencyCode: "USD",
    decimals: 2,
    countNumber: "SC-000007",
    asOf: "2026-06-30",
    status: "draft",
    memo: "Year end",
    lines: [line({ sku: "B-1", sellsForMinor: 400 }), line({ name: "Nut", quantity: 3, unitCostMinor: 99 })],
    bookMinor: 2000,
  };

  it("prints every line, then the counted total, the books and the difference", () => {
    const sheet = stockCountSheet(base);
    expect(sheet.title).toBe("Stock Count");
    expect(sheet.subtitle).toBe("SC-000007 · As of 2026-06-30 · Draft · Year end");
    expect(sheet.fileName).toBe("stock-count-SC-000007");
    expect(sheet.rows).toHaveLength(5);
    expect(sheet.rows[0]).toEqual({ name: "Brass bolt", sku: "B-1", quantity: 10, cost: 2.5, value: 25, sellsFor: 4 });
    expect(sheet.rows[1]).toMatchObject({ name: "Nut", value: 2.97, sellsFor: null });
    expect(sheet.rows[2]).toMatchObject({ name: "Counted at cost", value: 27.97 });
    expect(sheet.rows[3]).toMatchObject({ name: "On the books", value: 20 });
    expect(sheet.rows[4]).toMatchObject({ name: "Difference", value: 7.97 });
    expect(sheet.columns.map((c) => c.key)).toEqual(["name", "sku", "quantity", "cost", "value", "sellsFor"]);
  });

  it("leaves out the books and difference when they are not known, and the memo when empty", () => {
    const sheet = stockCountSheet({ ...base, bookMinor: null, memo: null, status: "posted" });
    expect(sheet.rows.map((r) => r.name)).toEqual(["Brass bolt", "Nut", "Counted at cost"]);
    expect(sheet.subtitle).toBe("SC-000007 · As of 2026-06-30 · Posted");
  });

  it("writes whole-unit currencies without decimals", () => {
    const sheet = stockCountSheet({ ...base, decimals: 0, currencyCode: "VND", bookMinor: null });
    expect(sheet.rows[0]).toMatchObject({ cost: 250, value: 2500 });
  });
});

describe("stockCountErrorMessage", () => {
  it("says a closed period in plain words", () => {
    expect(stockCountErrorMessage("Accounting period for 2026-03-31 is closed")).toBe(
      "That date falls in a closed accounting period. Choose a later date, or reopen the period.",
    );
  });

  it("rewrites the item-tracking and agreement refusals, and passes the rest through", () => {
    expect(
      stockCountErrorMessage("This company tracks stock item by item; adjust items on the Products & Services page"),
    ).toContain("Products & Services");
    expect(stockCountErrorMessage("The count already agrees with the books.")).toBe("The count agrees with the books.");
    expect(stockCountErrorMessage("Not authorized to post a stock count")).toBe(
      "You do not have permission to change stock counts",
    );
    expect(stockCountErrorMessage("Line 3: a name is required")).toBe("Line 3: a name is required");
  });
});
```

- [ ] **Step 2: Create `ctyhp-accounting/tests/unit/stock-count-service.test.ts`** with exactly this content:

```ts
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createStockCount,
  getBookValue,
  getPostingContext,
  getStockCount,
  listStockCounts,
  listStockCountSummaries,
  markStockCountPending,
  postStockCount,
  saveStockCount,
  StockCountError,
} from "@/lib/services/stock-count";

type Row = Record<string, unknown>;
type Reply = { data: unknown; error: { message: string } | null; count?: number | null };

interface Call {
  table?: string;
  rpc?: string;
  args?: unknown;
  orders: { column: string; ascending: boolean }[];
  filters: [string, unknown][];
  range?: [number, number];
}

/**
 * A stub client. `tables` and `rpcs` give each answer; a function answer is
 * handed the call, so a test can serve pages by range.
 */
function stub(config: {
  tables?: Record<string, Reply | ((c: Call) => Reply)>;
  rpcs?: Record<string, Reply | ((c: Call) => Reply)>;
}): { sb: SupabaseClient; calls: Call[] } {
  const calls: Call[] = [];
  const answer = (source: Reply | ((c: Call) => Reply) | undefined, call: Call): Reply =>
    source === undefined ? { data: [], error: null } : typeof source === "function" ? source(call) : source;

  const source = (call: Call) => (call.rpc ? config.rpcs?.[call.rpc] : config.tables?.[call.table ?? ""]);

  const builder = (call: Call) => {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (c: string, v: unknown) => (call.filters.push([c, v]), chain),
      order: (column: string, opts?: { ascending?: boolean }) => (
        call.orders.push({ column, ascending: opts?.ascending ?? true }), chain
      ),
      range: (a: number, b: number) => ((call.range = [a, b]), chain),
      maybeSingle: () => Promise.resolve(answer(source(call), call)),
      then: (resolve: (r: Reply) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(answer(source(call), call)).then(resolve, reject),
    };
    return chain;
  };

  const sb = {
    from: (table: string) => {
      const call: Call = { table, orders: [], filters: [] };
      calls.push(call);
      return builder(call);
    },
    rpc: (fn: string, args?: unknown) => {
      const call: Call = { rpc: fn, args, orders: [], filters: [] };
      calls.push(call);
      return builder(call);
    },
  } as unknown as SupabaseClient;
  return { sb, calls };
}

const headerRow = (over: Row = {}): Row => ({
  id: "c1",
  count_number: "SC-000001",
  as_of: "2026-06-30",
  status: "draft",
  memo: null,
  counted_minor: null,
  book_minor: null,
  difference_minor: null,
  ...over,
});

describe("listStockCounts", () => {
  it("pages past 1,000 rows, newest first, with the unique id last in the order", async () => {
    const all = Array.from({ length: 1200 }, (_, i) => headerRow({ id: `c${i}`, count_number: `SC-${i}` }));
    const { sb, calls } = stub({
      tables: {
        acc_stock_count: (c) => ({ data: all.slice(c.range![0], c.range![1] + 1), error: null }),
      },
    });
    const rows = await listStockCounts(sb);
    expect(rows).toHaveLength(1200);
    expect(calls).toHaveLength(2);
    expect(calls[0].orders).toEqual([
      { column: "as_of", ascending: false },
      { column: "count_number", ascending: false },
      { column: "id", ascending: false },
    ]);
  });

  it("turns bigint columns that arrive as strings into numbers", async () => {
    const { sb } = stub({
      tables: {
        acc_stock_count: {
          data: [headerRow({ status: "posted", counted_minor: "120000", book_minor: "100000", difference_minor: "20000" })],
          error: null,
        },
      },
    });
    const [row] = await listStockCounts(sb);
    expect([row.counted_minor, row.book_minor, row.difference_minor]).toEqual([120000, 100000, 20000]);
  });

  it("throws a StockCountError with the database's message", async () => {
    const { sb } = stub({ tables: { acc_stock_count: { data: null, error: { message: "boom" } } } });
    await expect(listStockCounts(sb)).rejects.toThrow(new StockCountError("boom"));
  });
});

describe("getStockCount", () => {
  it("returns the header with its lines ordered by line_order, then id", async () => {
    const { sb, calls } = stub({
      tables: {
        acc_stock_count: { data: headerRow(), error: null },
        acc_stock_count_line: {
          data: [
            { id: "l1", stock_count_id: "c1", line_order: 1, name: "Bolt", sku: null, quantity: "10.5", unit_cost_minor: "250", sells_for_minor: null },
          ],
          error: null,
        },
      },
    });
    const found = await getStockCount(sb, "c1");
    expect(found?.count.count_number).toBe("SC-000001");
    expect(found?.lines[0]).toMatchObject({ quantity: 10.5, unit_cost_minor: 250, sells_for_minor: null });
    const lineCall = calls.find((c) => c.table === "acc_stock_count_line")!;
    expect(lineCall.filters).toEqual([["stock_count_id", "c1"]]);
    expect(lineCall.orders.map((o) => o.column)).toEqual(["line_order", "id"]);
  });

  it("pages the lines of a long sheet", async () => {
    const lines = Array.from({ length: 1500 }, (_, i) => ({
      id: `l${i}`, stock_count_id: "c1", line_order: i + 1, name: "n", sku: null, quantity: 1, unit_cost_minor: 1, sells_for_minor: null,
    }));
    const { sb } = stub({
      tables: {
        acc_stock_count: { data: headerRow(), error: null },
        acc_stock_count_line: (c) => ({ data: lines.slice(c.range![0], c.range![1] + 1), error: null }),
      },
    });
    expect((await getStockCount(sb, "c1"))?.lines).toHaveLength(1500);
  });

  it("returns null for a count that does not exist", async () => {
    const { sb } = stub({ tables: { acc_stock_count: { data: null, error: null } } });
    expect(await getStockCount(sb, "nope")).toBeNull();
  });
});

describe("getBookValue", () => {
  const balance = (account_id: string, debit_base: number, credit_base: number) => ({
    account_id, account_code: account_id, name: account_id, account_type: "current_asset", debit_base, credit_base,
  });

  it("sums debit less credit over the accounts the database calls inventory, up to the date", async () => {
    const { sb, calls } = stub({
      rpcs: {
        acc_inventory_account_ids: { data: ["inv1", "inv2"], error: null },
        acc_ledger_balances: { data: [balance("inv1", 500_000, 120_000), balance("inv2", 10_000, 0), balance("cash", 9_000_000, 0)], error: null },
      },
    });
    expect(await getBookValue(sb, "2026-06-30")).toBe(390_000);
    const ledger = calls.find((c) => c.rpc === "acc_ledger_balances")!;
    expect(ledger.args).toEqual({ p_from: null, p_to: "2026-06-30" });
  });

  it("is zero when the company has no inventory accounts", async () => {
    const { sb } = stub({
      rpcs: { acc_inventory_account_ids: { data: [], error: null }, acc_ledger_balances: { data: [balance("cash", 5, 0)], error: null } },
    });
    expect(await getBookValue(sb, "2026-06-30")).toBe(0);
  });

  it("reads ids wrapped as objects as well as bare", async () => {
    const { sb } = stub({
      rpcs: {
        acc_inventory_account_ids: { data: [{ acc_inventory_account_ids: "inv1" }], error: null },
        acc_ledger_balances: { data: [balance("inv1", 100, 40)], error: null },
      },
    });
    expect(await getBookValue(sb, "2026-06-30")).toBe(60);
  });

  it("reports a failed id read", async () => {
    const { sb } = stub({ rpcs: { acc_inventory_account_ids: { data: null, error: { message: "denied" } } } });
    await expect(getBookValue(sb, "2026-06-30")).rejects.toThrow("denied");
  });
});

describe("getPostingContext", () => {
  const accounts = [
    { id: "inv", account_code: "1200", name: "Inventory", account_type: "current_asset" },
    { id: "cash", account_code: "1000", name: "Cash", account_type: "current_asset" },
    { id: "cogs", account_code: "5000", name: "Cost of Goods Sold", account_type: "cost_of_goods_sold" },
    { id: "adj", account_code: "5010", name: "Inventory Adjustment", account_type: "cost_of_goods_sold" },
  ];
  const base = (over: { items?: number; allowed?: boolean } = {}) =>
    stub({
      tables: {
        acc_account: { data: accounts, error: null },
        acc_item: { data: null, error: null, count: over.items ?? 0 },
      },
      rpcs: {
        acc_inventory_account_ids: { data: ["inv"], error: null },
        acc_stock_count_default_accounts: { data: [{ inventory_account_id: "inv", offset_account_id: "adj" }], error: null },
        acc_has_permission: { data: over.allowed ?? true, error: null },
      },
    });

  it("lists the inventory and cost-of-sales accounts, the defaults, and the person's right", async () => {
    const { sb, calls } = base();
    const ctx = await getPostingContext(sb);
    expect(ctx.inventoryAccounts).toEqual([{ id: "inv", code: "1200", name: "Inventory" }]);
    expect(ctx.offsetAccounts.map((a) => a.id)).toEqual(["cogs", "adj"]);
    expect(ctx.defaultInventoryAccountId).toBe("inv");
    expect(ctx.defaultOffsetAccountId).toBe("adj");
    expect(ctx.tracksItems).toBe(false);
    expect(ctx.canAdjust).toBe(true);
    expect(calls.find((c) => c.rpc === "acc_has_permission")!.args).toEqual({ p_key: "inventory.adjust" });
    const chart = calls.find((c) => c.table === "acc_account")!;
    expect(chart.orders.map((o) => o.column)).toEqual(["account_code", "id"]);
  });

  it("says when the company tracks items, and when the person may not adjust", async () => {
    const ctx = await getPostingContext(base({ items: 3, allowed: false }).sb);
    expect(ctx.tracksItems).toBe(true);
    expect(ctx.canAdjust).toBe(false);
  });

  it("has no defaults when the database finds none", async () => {
    const { sb } = stub({
      tables: { acc_account: { data: [], error: null }, acc_item: { data: null, error: null, count: 0 } },
      rpcs: {
        acc_inventory_account_ids: { data: [], error: null },
        acc_stock_count_default_accounts: { data: [{ inventory_account_id: null, offset_account_id: null }], error: null },
        acc_has_permission: { data: false, error: null },
      },
    });
    const ctx = await getPostingContext(sb);
    expect([ctx.defaultInventoryAccountId, ctx.defaultOffsetAccountId]).toEqual([null, null]);
  });
});

describe("create, save, post and mark pending", () => {
  it("creates a count by calling acc_create_stock_count with the date", async () => {
    const { sb, calls } = stub({ rpcs: { acc_create_stock_count: { data: "c9", error: null } } });
    expect(await createStockCount(sb, "2026-06-30")).toBe("c9");
    expect(calls[0]).toMatchObject({ rpc: "acc_create_stock_count", args: { p_as_of: "2026-06-30" } });
  });

  it("saves the whole sheet with the column names the database reads", async () => {
    const { sb, calls } = stub({ rpcs: { acc_save_stock_count: { data: 2, error: null } } });
    const saved = await saveStockCount(sb, {
      id: "c1",
      asOf: "2026-06-30",
      memo: null,
      lines: [
        { name: "Bolt", sku: "B-1", quantity: 10.5, unitCostMinor: 250, sellsForMinor: 400 },
        { name: "Nut", sku: null, quantity: 3, unitCostMinor: 99, sellsForMinor: null },
      ],
    });
    expect(saved).toBe(2);
    expect(calls[0].args).toEqual({
      p_id: "c1",
      p_as_of: "2026-06-30",
      p_memo: null,
      p_lines: [
        { name: "Bolt", sku: "B-1", quantity: 10.5, unit_cost_minor: 250, sells_for_minor: 400 },
        { name: "Nut", sku: null, quantity: 3, unit_cost_minor: 99, sells_for_minor: null },
      ],
    });
  });

  it("posts with both accounts and returns the entry id", async () => {
    const { sb, calls } = stub({ rpcs: { acc_post_stock_count: { data: "je1", error: null } } });
    expect(await postStockCount(sb, { id: "c1", inventoryAccountId: "inv", offsetAccountId: "adj" })).toBe("je1");
    expect(calls[0].args).toEqual({ p_id: "c1", p_inventory_account_id: "inv", p_offset_account_id: "adj" });
  });

  it("marks a count pending with its request", async () => {
    const { sb, calls } = stub({ rpcs: { acc_mark_stock_count_pending: { data: null, error: null } } });
    await markStockCountPending(sb, "c1", "r1");
    expect(calls[0].args).toEqual({ p_id: "c1", p_request_id: "r1" });
  });

  it("raises the database's message for each call", async () => {
    const err = { data: null, error: { message: "Accounting period for 2026-06-30 is closed" } };
    const { sb } = stub({
      rpcs: { acc_create_stock_count: err, acc_save_stock_count: err, acc_post_stock_count: err, acc_mark_stock_count_pending: err },
    });
    await expect(createStockCount(sb, "2026-06-30")).rejects.toThrow("is closed");
    await expect(saveStockCount(sb, { id: "c", asOf: "2026-06-30", memo: null, lines: [] })).rejects.toThrow("is closed");
    await expect(postStockCount(sb, { id: "c", inventoryAccountId: "a", offsetAccountId: "b" })).rejects.toThrow("is closed");
    await expect(markStockCountPending(sb, "c", "r")).rejects.toThrow("is closed");
  });
});

describe("listStockCountSummaries", () => {
  it("reads each count with the number of lines it holds", async () => {
    const { sb, calls } = stub({
      tables: {
        acc_stock_count: {
          data: [
            { id: "a", count_number: "SC-000002", as_of: "2026-06-30", status: "draft", counted_minor: null, lines: [{ count: 3 }] },
            { id: "b", count_number: "SC-000001", as_of: "2026-03-31", status: "posted", counted_minor: "500", lines: [] },
          ],
          error: null,
        },
      },
    });
    const rows = await listStockCountSummaries(sb);
    expect(rows.map((r) => r.lineCount)).toEqual([3, 0]);
    expect(rows[1].counted_minor).toBe(500);
    expect(calls[0].orders.map((o) => o.column)).toEqual(["as_of", "count_number", "id"]);
  });
});
```

- [ ] **Step 3: Create `ctyhp-accounting/tests/unit/stock-count-actions.test.ts`** with exactly this content:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUserRole: vi.fn(),
  executeOrSubmit: vi.fn(),
  createStockCount: vi.fn(),
  getBookValue: vi.fn(),
  getEntryNumber: vi.fn(),
  getStockCount: vi.fn(),
  markPending: vi.fn(),
  postStockCount: vi.fn(),
  saveStockCount: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/db/server", () => ({ createSupabaseServerClient: mocks.createClient }));
vi.mock("@/lib/auth", () => ({
  getUserRole: mocks.getUserRole,
  canWrite: (role: string | null) => role === "admin" || role === "accountant",
}));
vi.mock("@/lib/services/approval-flow", () => ({ executeOrSubmitForApproval: mocks.executeOrSubmit }));
vi.mock("@/lib/services/stock-count", () => ({
  createStockCount: mocks.createStockCount,
  getBookValue: mocks.getBookValue,
  getEntryNumber: mocks.getEntryNumber,
  getStockCount: mocks.getStockCount,
  markStockCountPending: mocks.markPending,
  postStockCount: mocks.postStockCount,
  saveStockCount: mocks.saveStockCount,
}));

import { bookValueAction, createStockCountAction, postStockCountAction, saveStockCountAction } from "@/app/(app)/inventory/stock-count/actions";

const sb = { name: "company client" };
const ID = "6f1f5f6a-0000-4000-8000-000000000001";
const INV = "6f1f5f6a-0000-4000-8000-000000000002";
const ADJ = "6f1f5f6a-0000-4000-8000-000000000003";
const post = { id: ID, inventoryAccountId: INV, offsetAccountId: ADJ };

function draftCount(lines = [{ quantity: 10, unit_cost_minor: 250 }]) {
  return {
    count: { id: ID, count_number: "SC-000001", as_of: "2026-06-30", status: "draft" },
    lines,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createClient.mockResolvedValue(sb);
  mocks.getUserRole.mockResolvedValue("accountant");
  mocks.getStockCount.mockResolvedValue(draftCount());
  mocks.getBookValue.mockResolvedValue(1_000);
});

describe("postStockCountAction", () => {
  it("asks the approval flow about the size of the difference, with the count in the payload", async () => {
    mocks.executeOrSubmit.mockImplementation(async (o) => ({ status: "executed", result: await o.execute() }));
    mocks.postStockCount.mockResolvedValue("je1");
    mocks.getEntryNumber.mockResolvedValue("JE-000042");
    const r = await postStockCountAction(post);
    expect(r).toEqual({ ok: true, data: { kind: "posted", entryId: "je1", entryNumber: "JE-000042" } });
    const options = mocks.executeOrSubmit.mock.calls[0][0];
    expect(options).toMatchObject({
      sb,
      actionKey: "inventory_adjustment",
      amountMinor: 1_500, // counted 2,500 less the books 1,000
      payload: { stock_count_id: ID, inventory_account_id: INV, offset_account_id: ADJ },
    });
    expect(mocks.postStockCount).toHaveBeenCalledWith(sb, post);
    expect(mocks.markPending).not.toHaveBeenCalled();
  });

  it("uses the size of a shortfall, not its sign", async () => {
    mocks.getBookValue.mockResolvedValue(10_000);
    mocks.executeOrSubmit.mockResolvedValue({ status: "executed", result: "je1" });
    await postStockCountAction(post);
    expect(mocks.executeOrSubmit.mock.calls[0][0].amountMinor).toBe(7_500);
  });

  it("marks the count pending when the policy sends it for approval", async () => {
    mocks.executeOrSubmit.mockResolvedValue({ status: "submitted", requestId: "r1" });
    const r = await postStockCountAction(post);
    expect(r).toEqual({ ok: true, data: { kind: "submitted", requestId: "r1" } });
    expect(mocks.markPending).toHaveBeenCalledWith(sb, ID, "r1");
    expect(mocks.postStockCount).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/approvals");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/inventory/stock-count/${ID}`);
  });

  it("says so when the request went through but could not be linked to the count", async () => {
    mocks.executeOrSubmit.mockResolvedValue({ status: "submitted", requestId: "r1" });
    mocks.markPending.mockRejectedValue(new Error("That approval request is not a pending request for this stock count"));
    const r = await postStockCountAction(post);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("sent for approval, but the count could not be linked");
  });

  it("refuses a count that already agrees with the books, before asking for approval", async () => {
    mocks.getBookValue.mockResolvedValue(2_500);
    const r = await postStockCountAction(post);
    expect(r).toEqual({ ok: false, error: "The count agrees with the books." });
    expect(mocks.executeOrSubmit).not.toHaveBeenCalled();
  });

  it("refuses a count that is not a draft, or does not exist", async () => {
    mocks.getStockCount.mockResolvedValue({ ...draftCount(), count: { ...draftCount().count, status: "posted" } });
    expect((await postStockCountAction(post)).error).toContain("is not a draft");
    mocks.getStockCount.mockResolvedValue(null);
    expect((await postStockCountAction(post)).error).toBe("Stock count not found");
    expect(mocks.executeOrSubmit).not.toHaveBeenCalled();
  });

  it("puts a closed period in plain words", async () => {
    mocks.executeOrSubmit.mockRejectedValue(new Error("Accounting period for 2026-06-30 is closed"));
    const r = await postStockCountAction(post);
    expect(r).toEqual({
      ok: false,
      error: "That date falls in a closed accounting period. Choose a later date, or reopen the period.",
    });
  });

  it("refuses a viewer, and bad ids, without touching the database", async () => {
    mocks.getUserRole.mockResolvedValue("viewer");
    expect((await postStockCountAction(post)).ok).toBe(false);
    mocks.getUserRole.mockResolvedValue("admin");
    expect((await postStockCountAction({ ...post, offsetAccountId: "x" })).error).toBe("Choose the offset account");
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});

describe("saveStockCountAction", () => {
  const sheet = {
    id: ID,
    asOf: "2026-06-30",
    memo: null,
    lines: [{ name: "Bolt", sku: null, quantity: 3, unitCostMinor: 99, sellsForMinor: null }],
  };

  it("saves a valid sheet", async () => {
    mocks.saveStockCount.mockResolvedValue(1);
    expect(await saveStockCountAction(sheet)).toEqual({ ok: true, data: { saved: 1 } });
    expect(mocks.saveStockCount).toHaveBeenCalledWith(sb, sheet);
  });

  it("names the line a bad value is on, before any call", async () => {
    const r = await saveStockCountAction({ ...sheet, lines: [sheet.lines[0], { ...sheet.lines[0], name: " " }] });
    expect(r).toEqual({ ok: false, error: "Line 2: A name is required" });
    expect(mocks.saveStockCount).not.toHaveBeenCalled();
  });

  it("refuses a viewer", async () => {
    mocks.getUserRole.mockResolvedValue("viewer");
    expect((await saveStockCountAction(sheet)).ok).toBe(false);
  });
});

describe("createStockCountAction", () => {
  it("opens or starts a count for the date", async () => {
    mocks.createStockCount.mockResolvedValue(ID);
    expect(await createStockCountAction("2026-06-30")).toEqual({ ok: true, data: { id: ID } });
    expect(mocks.createStockCount).toHaveBeenCalledWith(sb, "2026-06-30");
  });

  it("refuses a missing date", async () => {
    expect((await createStockCountAction("")).ok).toBe(false);
    expect(mocks.createStockCount).not.toHaveBeenCalled();
  });
});

describe("bookValueAction", () => {
  it("reads the books on the date", async () => {
    mocks.getBookValue.mockResolvedValue(4_200);
    expect(await bookValueAction("2026-06-30")).toEqual({ ok: true, data: { bookMinor: 4_200 } });
    expect(mocks.getBookValue).toHaveBeenCalledWith(sb, "2026-06-30");
  });
  it("refuses a date that is not a date", async () => {
    const r = await bookValueAction("soon");
    expect(r.ok).toBe(false);
    expect(mocks.getBookValue).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Edit `ctyhp-accounting/tests/unit/purchases-inventory.test.ts`** — apply this 1 find/replace edit (its find string occurs exactly once):

Edit 1 of 1 — find:

```ts
      "Month by month|Feb 2026",
    ]);
  });
});
```

replace with:

```ts
      "Month by month|Feb 2026",
    ]);
  });
});

describe("a stock count entry", () => {
  // The count posts against a plain cost of sales account, whose name does not read as an
  // adjustment. Only its source says it is a count.
  const lines = [
    line("o", "2026-01-01", "inv", 100_000, { sourceType: "opening_balance" }),
    line("b", "2026-02-10", "cogs", 50_000, { sourceId: "bill1" }),
    line("b", "2026-02-10", "ap", -50_000, { sourceId: "bill1" }),
    line("c", "2026-12-31", "inv", 20_000, { sourceType: "stock_count", sourceId: "sc1" }),
    line("c", "2026-12-31", "cogs", -20_000, { sourceType: "stock_count", sourceId: "sc1" }),
  ];
  const report = run(lines, { vendorOfSource: new Map([["bill1", { id: "v1", name: "Example Supply" }]]) });

  it("is a count adjustment, not a negative purchase", () => {
    expect(report.years[0]).toMatchObject({
      openingMinor: 100_000,
      boughtMinor: 50_000,
      countAdjustmentMinor: 20_000,
      closingMinor: 120_000,
    });
    expect(report.purchases).toBe(1);
    expect(report.boughtMinor).toBe(50_000);
  });
});
```

- [ ] **Step 5: Edit `ctyhp-accounting/tests/unit/entry-detail.test.ts`** — apply these 2 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 2 — find:

```ts
  entryTotals,
  sourceLabel,
```

replace with:

```ts
  entryTotals,
  sourceHref,
  sourceLabel,
```

Edit 2 of 2 — find:

```ts
    expect(service).not.toMatch(/\.rpc\(/);
  });
});
```

replace with:

```ts
    expect(service).not.toMatch(/\.rpc\(/);
  });
});

describe("stock count entries", () => {
  it("reads as a stock count and opens the count's own page", () => {
    expect(sourceLabel("stock_count")).toBe("Stock count");
    expect(sourceTone("stock_count")).toBe("ledger");
    expect(sourceHref("stock_count", "c0ffee00-0000-4000-8000-000000000001")).toBe(
      "/inventory/stock-count/c0ffee00-0000-4000-8000-000000000001",
    );
  });

  it("has no link without a source id, and no link for kinds routed elsewhere", () => {
    expect(sourceHref("stock_count", null)).toBeNull();
    expect(sourceHref("invoice", "abc")).toBeNull();
  });
});
```

- [ ] **Step 6: Edit `ctyhp-accounting/tests/unit/company-export-order.test.ts`** — apply this 1 find/replace edit (its find string occurs exactly once):

Edit 1 of 1 — find:

```ts
  });
});
```

replace with:

```ts
  });
});

describe("the Stock Count tables in the export list", () => {
  it("come after everything they reference, header before lines", () => {
    const at = (t: string) => EXPORT_TABLES.indexOf(t);
    expect(at("acc_stock_count")).toBeGreaterThan(-1);
    expect(at("acc_stock_count")).toBeGreaterThan(at("acc_account"));
    expect(at("acc_stock_count")).toBeGreaterThan(at("acc_journal_entry"));
    expect(at("acc_stock_count")).toBeGreaterThan(at("acc_approval_request"));
    expect(at("acc_stock_count_line")).toBeGreaterThan(at("acc_stock_count"));
  });
});
```

- [ ] **Step 7: Run the tests to see them fail**

```bash
npx vitest run tests/unit/stock-count.test.ts tests/unit/stock-count-service.test.ts tests/unit/stock-count-actions.test.ts tests/unit/purchases-inventory.test.ts tests/unit/entry-detail.test.ts tests/unit/company-export-order.test.ts
```

Expected: FAIL — `lib/domain/stock-count.ts`, `lib/services/stock-count.ts` and the actions do not exist yet, and the purchases, entry-detail and export expectations for `stock_count` fail against the old code.

- [ ] **Step 8: Edit `ctyhp-accounting/lib/db/types.ts`** — apply these 2 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 2 — find:

```ts
  | "depreciation"
  | "asset_disposal";
export type JournalStatus = "posted" | "void";
```

replace with:

```ts
  | "depreciation"
  | "asset_disposal"
  | "stock_count";
export type JournalStatus = "posted" | "void";
```

Edit 2 of 2 — find:

```ts

export interface InventoryValuationRow {
```

replace with:

```ts

export type StockCountStatusValue = "draft" | "pending_approval" | "posted";

/** acc_stock_count: one periodic count sheet (migration 0139). */
export interface StockCountRow {
  id: string;
  count_number: string;
  as_of: string;
  status: StockCountStatusValue;
  memo: string | null;
  counted_minor: number | null;
  book_minor: number | null;
  difference_minor: number | null;
  inventory_account_id: string | null;
  offset_account_id: string | null;
  journal_entry_id: string | null;
  approval_request_id: string | null;
  posted_by: string | null;
  posted_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
}

/** acc_stock_count_line: one line of a count sheet. */
export interface StockCountLineRow {
  id: string;
  stock_count_id: string;
  line_order: number;
  name: string;
  sku: string | null;
  quantity: number;
  unit_cost_minor: number;
  sells_for_minor: number | null;
}

export interface InventoryValuationRow {
```

- [ ] **Step 9: Create `ctyhp-accounting/lib/domain/stock-count.ts`** with exactly this content:

```ts
import { fromMinor } from "./money";
import { sanitizeExportFileName, type ReportExportSheet } from "./report-export";

/**
 * Stock Count: a periodic count sheet. You type or paste the stock on hand, line
 * by line; OneBook compares the counted value (quantity x cost) with the
 * inventory accounts' balance on a date and posts one adjusting entry.
 *
 * Pure. Money is integer minor units in the base currency. The rules here mirror
 * the database functions in migration 0139 (acc_save_stock_count and
 * acc_post_stock_count), so the screen refuses what the database would refuse
 * before a request is sent.
 */

export const MAX_COUNT_LINES = 2000;
export const MAX_NAME_LENGTH = 200;
export const MAX_SKU_LENGTH = 100;
export const MAX_MEMO_LENGTH = 500;
/** The quantity column is numeric(20,4). */
export const QUANTITY_DECIMALS = 4;

export type StockCountStatus = "draft" | "pending_approval" | "posted";

const STATUS_LABEL: Record<StockCountStatus, string> = {
  draft: "Draft",
  pending_approval: "Waiting for approval",
  posted: "Posted",
};

export function stockCountStatusLabel(status: string): string {
  return STATUS_LABEL[status as StockCountStatus] ?? status;
}

/** One line of a count sheet, as the screen edits it and the save call sends it. */
export interface StockCountLineInput {
  name: string;
  sku: string | null;
  quantity: number;
  unitCostMinor: number;
  /** For convenience only; it never reaches the accounts. */
  sellsForMinor: number | null;
}

// ---------------------------------------------------------------------------
// Values and totals
// ---------------------------------------------------------------------------

/**
 * The value of one line: round(quantity x unit cost), halves rounded up, which
 * is what `round(l.quantity * l.unit_cost_minor)` does in the database for the
 * non-negative numbers a count holds. Worked in integers (the quantity scaled to
 * its four decimals) so that binary floating point cannot move a half.
 */
export function lineValueMinor(quantity: number, unitCostMinor: number): number {
  const scale = 10 ** QUANTITY_DECIMALS;
  const scaledQuantity = BigInt(Math.round(quantity * scale));
  const numerator = scaledQuantity * BigInt(unitCostMinor);
  const denominator = BigInt(scale);
  const two = BigInt(2);
  return Number((numerator * two + denominator) / (denominator * two));
}

/** The counted total at cost: the sum of the line values. */
export function countedTotalMinor(lines: readonly Pick<StockCountLineInput, "quantity" | "unitCostMinor">[]): number {
  let total = 0;
  for (const l of lines) total += lineValueMinor(l.quantity, l.unitCostMinor);
  return total;
}

/** What posting would move the inventory accounts by: counted minus the books. */
export function countDifferenceMinor(countedMinor: number, bookMinor: number): number {
  return countedMinor - bookMinor;
}

// ---------------------------------------------------------------------------
// The paste reader
// ---------------------------------------------------------------------------

export interface PasteProblem {
  /** 1-based, counting blank lines, so it matches the line in the text box. */
  lineNumber: number;
  text: string;
  reason: string;
}

export interface PasteResult {
  lines: StockCountLineInput[];
  problems: PasteProblem[];
}

/** A plain amount, or one with unambiguous thousands groups (1,234,567.89). */
const PLAIN_NUMBER = /^\d+(\.\d+)?$/;
const GROUPED_NUMBER = /^\d{1,3}(,\d{3})+(\.\d+)?$/;
/** Used only to decide where the name ends; it is deliberately loose. */
const NUMBER_SHAPED = /^[-+]?(\d[\d.,]*|\.\d+)$/;

/**
 * Split one line into fields. A tab-separated line (a paste from a spreadsheet)
 * splits on tabs only, so a comma can sit inside a name or a thousands group. A
 * comma-separated line splits on commas outside double quotes.
 */
function splitFields(line: string): string[] {
  if (line.includes("\t")) return line.split("\t").map((f) => unquote(f.trim()));
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === "," && !quoted) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function unquote(field: string): string {
  return field.length >= 2 && field.startsWith('"') && field.endsWith('"')
    ? field.slice(1, -1).replaceAll('""', '"')
    : field;
}

type Parsed = { ok: true; whole: string; fraction: string } | { ok: false; reason: string };

/**
 * One amount as digits. Thousands commas are accepted only in the exact grouped
 * form (1,234 or 12,345.50). A bare comma-separated paste cannot carry them, as
 * the comma is the column break, so they arrive via quotes or a spreadsheet's
 * tabs.
 */
function parseAmount(raw: string, label: string): Parsed {
  const text = raw.trim();
  if (text === "") return { ok: false, reason: `${label} is missing` };
  if (/^-/.test(text)) return { ok: false, reason: `${label} cannot be negative` };
  let digits = text;
  if (GROUPED_NUMBER.test(text)) digits = text.replaceAll(",", "");
  else if (!PLAIN_NUMBER.test(text)) {
    return {
      ok: false,
      reason: text.includes(",")
        ? `${label} “${text}” has a comma that could be a thousands separator or a column break; write it without commas`
        : `${label} “${text}” is not a number`,
    };
  }
  // 000, 050: the tail of a thousands group that the comma split off.
  if (/^0\d/.test(digits)) {
    return {
      ok: false,
      reason: `${label} “${text}” looks like part of a number split at a thousands comma; write it without commas`,
    };
  }
  const [whole, fraction = ""] = digits.split(".");
  return { ok: true, whole, fraction };
}

function toQuantity(raw: string, label: string): { value: number } | { reason: string } {
  const p = parseAmount(raw, label);
  if (!p.ok) return { reason: p.reason };
  const fraction = p.fraction.replace(/0+$/, "");
  if (fraction.length > QUANTITY_DECIMALS) {
    return { reason: `${label} can have at most ${QUANTITY_DECIMALS} decimal places` };
  }
  const value = Number(fraction ? `${p.whole}.${fraction}` : p.whole);
  if (!Number.isFinite(value) || value > 1e15) return { reason: `${label} is too large` };
  return { value };
}

function toMinorAmount(raw: string, label: string, decimals: number): { value: number } | { reason: string } {
  const p = parseAmount(raw, label);
  if (!p.ok) return { reason: p.reason };
  const fraction = p.fraction.replace(/0+$/, "");
  if (fraction.length > decimals) {
    return {
      reason: decimals === 0
        ? `${label} must be a whole number`
        : `${label} can have at most ${decimals} decimal place${decimals === 1 ? "" : "s"}`,
    };
  }
  const value = Number(p.whole + fraction.padEnd(decimals, "0"));
  if (!Number.isSafeInteger(value)) return { reason: `${label} is too large` };
  return { value };
}

/**
 * Read a pasted count sheet: "name, quantity, cost" and, if you like, "sells
 * for". Each line is read from the right. The last two or three fields are the
 * numbers and everything before them is the name, so a name may contain commas.
 * A line is read as three numbers when the field in front of the last two is
 * itself shaped like a number and a name is left; otherwise as two.
 *
 * Blank lines are skipped without comment. A line that cannot be read is
 * reported by its number and the reason, and the lines that can be read are
 * still returned.
 */
export function parseCountSheet(text: string, decimals = 2): PasteResult {
  const lines: StockCountLineInput[] = [];
  const problems: PasteProblem[] = [];
  const rows = text.split(/\r\n|\r|\n/);

  rows.forEach((row, index) => {
    if (row.trim() === "") return;
    const lineNumber = index + 1;
    const refuse = (reason: string) => problems.push({ lineNumber, text: row.trim(), reason });

    const fields = splitFields(row.trim());
    if (fields.length < 3) {
      refuse(
        fields.length === 2
          ? "Needs a cost: write the name, the quantity and the cost each"
          : "Needs a name, a quantity and a cost each",
      );
      return;
    }

    const threeNumbers = fields.length >= 4 && NUMBER_SHAPED.test(fields[fields.length - 3]);
    const count = threeNumbers ? 3 : 2;
    const name = fields.slice(0, fields.length - count).join(", ").trim();
    const [qtyText, costText, sellsText] = fields.slice(fields.length - count);

    if (name === "") {
      refuse("A name is required");
      return;
    }
    if (name.length > MAX_NAME_LENGTH) {
      refuse(`The name is too long (${MAX_NAME_LENGTH} characters at most)`);
      return;
    }

    const qty = toQuantity(qtyText, "Quantity");
    if ("reason" in qty) return refuse(qty.reason);
    const cost = toMinorAmount(costText, "Cost each", decimals);
    if ("reason" in cost) return refuse(cost.reason);
    let sellsForMinor: number | null = null;
    if (sellsText !== undefined) {
      const sells = toMinorAmount(sellsText, "Sells for", decimals);
      if ("reason" in sells) return refuse(sells.reason);
      sellsForMinor = sells.value;
    }

    lines.push({ name, sku: null, quantity: qty.value, unitCostMinor: cost.value, sellsForMinor });
  });

  return { lines, problems };
}

// ---------------------------------------------------------------------------
// The unsaved-changes guard
// ---------------------------------------------------------------------------

/** What the draft screen edits and saves. */
export interface StockCountDraft {
  asOf: string;
  memo: string | null;
  lines: readonly StockCountLineInput[];
}

function normalisedText(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/**
 * True when the screen's current content differs from what was last saved, so
 * leaving would lose work. A memo or SKU that is empty and one that is absent
 * are the same; a client-only row key is ignored.
 */
export function isDirty(saved: StockCountDraft, current: StockCountDraft): boolean {
  if (saved.asOf !== current.asOf) return true;
  if (normalisedText(saved.memo) !== normalisedText(current.memo)) return true;
  if (saved.lines.length !== current.lines.length) return true;
  return saved.lines.some((a, i) => {
    const b = current.lines[i];
    return (
      a.name.trim() !== b.name.trim() ||
      normalisedText(a.sku) !== normalisedText(b.sku) ||
      a.quantity !== b.quantity ||
      a.unitCostMinor !== b.unitCostMinor ||
      (a.sellsForMinor ?? null) !== (b.sellsForMinor ?? null)
    );
  });
}

// ---------------------------------------------------------------------------
// Validation before a save
// ---------------------------------------------------------------------------

export interface CountProblem {
  /** 1-based line the problem is on; null for a problem with the sheet as a whole. */
  lineNumber: number | null;
  reason: string;
}

/**
 * The rules acc_save_stock_count enforces, checked on the screen first: a name
 * on every line; quantity, cost and sells for not negative; whole minor units;
 * at most 2,000 lines.
 */
export function validateStockCount(draft: StockCountDraft): CountProblem[] {
  const problems: CountProblem[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.asOf)) problems.push({ lineNumber: null, reason: "Choose the as-of date" });
  if (normalisedText(draft.memo).length > MAX_MEMO_LENGTH) {
    problems.push({ lineNumber: null, reason: `The memo is too long (${MAX_MEMO_LENGTH} characters at most)` });
  }
  if (draft.lines.length > MAX_COUNT_LINES) {
    problems.push({
      lineNumber: null,
      reason: `A count can hold at most ${MAX_COUNT_LINES.toLocaleString("en-US")} lines (this one has ${draft.lines.length.toLocaleString("en-US")})`,
    });
  }
  draft.lines.forEach((l, index) => {
    const lineNumber = index + 1;
    const add = (reason: string) => problems.push({ lineNumber, reason });
    const name = l.name.trim();
    if (name === "") add("A name is required");
    else if (name.length > MAX_NAME_LENGTH) add(`The name is too long (${MAX_NAME_LENGTH} characters at most)`);
    if (normalisedText(l.sku).length > MAX_SKU_LENGTH) add(`The SKU is too long (${MAX_SKU_LENGTH} characters at most)`);
    if (!Number.isFinite(l.quantity)) add("Enter a quantity");
    else if (l.quantity < 0) add("The quantity cannot be negative");
    if (!Number.isInteger(l.unitCostMinor)) add("Enter the cost each");
    else if (l.unitCostMinor < 0) add("The cost each cannot be negative");
    if (l.sellsForMinor !== null && l.sellsForMinor !== undefined) {
      if (!Number.isInteger(l.sellsForMinor)) add("Sells for must be an amount or empty");
      else if (l.sellsForMinor < 0) add("Sells for cannot be negative");
    }
  });
  return problems;
}

// ---------------------------------------------------------------------------
// Print, CSV and Excel
// ---------------------------------------------------------------------------

export interface StockCountSheetInput {
  companyName: string;
  currencyCode: string;
  /** Decimal places of the base currency. */
  decimals: number;
  countNumber: string;
  asOf: string;
  status: string;
  memo: string | null;
  lines: readonly StockCountLineInput[];
  /** The figures frozen at posting, or the live ones for a draft; null when not known. */
  bookMinor: number | null;
}

/** One count as a report sheet: every line, then the counted total and, when known, the books and the difference. */
export function stockCountSheet(input: StockCountSheetInput): ReportExportSheet {
  const money = (minor: number) => fromMinor(minor, input.decimals);
  const rows: ReportExportSheet["rows"] = input.lines.map((l) => ({
    name: l.name,
    sku: l.sku ?? "",
    quantity: l.quantity,
    cost: money(l.unitCostMinor),
    value: money(lineValueMinor(l.quantity, l.unitCostMinor)),
    sellsFor: l.sellsForMinor === null ? null : money(l.sellsForMinor),
  }));
  const counted = countedTotalMinor(input.lines);
  const total = (label: string, minor: number) => ({
    name: label,
    sku: "",
    quantity: null,
    cost: null,
    value: money(minor),
    sellsFor: null,
  });
  rows.push(total("Counted at cost", counted));
  if (input.bookMinor !== null) {
    rows.push(total("On the books", input.bookMinor));
    rows.push(total("Difference", countDifferenceMinor(counted, input.bookMinor)));
  }

  const subtitle = [
    `${input.countNumber}`,
    `As of ${input.asOf}`,
    stockCountStatusLabel(input.status),
    normalisedText(input.memo),
  ]
    .filter((part) => part !== "")
    .join(" · ");

  return {
    fileName: sanitizeExportFileName(`stock-count-${input.countNumber}`),
    companyName: input.companyName,
    title: "Stock Count",
    subtitle,
    currencyCode: input.currencyCode,
    columns: [
      { key: "name", header: "Name", kind: "text", width: 40 },
      { key: "sku", header: "SKU", kind: "text", width: 16 },
      { key: "quantity", header: "Counted", kind: "number", width: 12 },
      { key: "cost", header: "Cost each", kind: "money", width: 14 },
      { key: "value", header: "Value", kind: "money", width: 16 },
      { key: "sellsFor", header: "Sells for", kind: "money", width: 14 },
    ],
    rows,
  };
}

// ---------------------------------------------------------------------------
// The database's messages, in plain words
// ---------------------------------------------------------------------------

export const CLOSED_PERIOD_MESSAGE =
  "That date falls in a closed accounting period. Choose a later date, or reopen the period.";
export const TRACKS_ITEMS_MESSAGE =
  "This company keeps stock item by item. Adjust items on the Products & Services page instead.";
export const AGREES_MESSAGE = "The count agrees with the books.";

/**
 * Turn what the database raised into a sentence for the screen. Messages that
 * already read as plain sentences pass through unchanged.
 */
export function stockCountErrorMessage(raw: string): string {
  if (/accounting period for .* is closed/i.test(raw)) return CLOSED_PERIOD_MESSAGE;
  if (/tracks stock item by item/i.test(raw)) return TRACKS_ITEMS_MESSAGE;
  if (/already agrees with the books/i.test(raw)) return AGREES_MESSAGE;
  if (/not authorized to/i.test(raw)) return "You do not have permission to change stock counts";
  if (/do not have permission to adjust inventory/i.test(raw)) return "You do not have permission to adjust inventory";
  return raw;
}

// ---------------------------------------------------------------------------
// The screens: pasting, the Adjust button and the entry it will post
// ---------------------------------------------------------------------------

export const PASTE_HINT =
  "One line each: name, quantity, cost — and sells for, if you like. Pasting from a spreadsheet keeps the columns apart; in typed text leave out thousands separators.";

export const FOOTNOTE =
  "Periodic, on purpose: purchases go to cost of sales as they are made and the count corrects the balance sheet. This is a count sheet, not perpetual stock, so it does not track units in and out.";

export const SAVE_FIRST_MESSAGE = "Save the count first";

/** One problem found while reading a pasted sheet, as the screen lists it. */
export function pasteProblemText(problem: PasteProblem): string {
  return `Line ${problem.lineNumber}: ${problem.reason}`;
}

/** What "Read it" tells the reader: how many lines went in and how many did not. */
export function pasteSummary(result: PasteResult): string {
  const added = result.lines.length;
  const skipped = result.problems.length;
  const lines = (n: number) => `${n.toLocaleString("en-US")} ${n === 1 ? "line" : "lines"}`;
  if (added === 0 && skipped === 0) return "Nothing to read. Paste one line for each item.";
  if (skipped === 0) return `Added ${lines(added)}.`;
  return `Added ${lines(added)}. ${lines(skipped)} could not be read and ${skipped === 1 ? "was" : "were"} left out.`;
}

/** The good lines of a paste go on the end of the sheet; nothing already there moves. */
export function appendCountLines<T extends StockCountLineInput>(current: readonly T[], added: readonly T[]): T[] {
  return [...current, ...added];
}

export interface AdjustButtonInput {
  /** Holds inventory.adjust in this company. */
  canAdjust: boolean;
  /** The company keeps stock item by item. */
  tracksItems: boolean;
  /** The screen holds changes that are not saved. */
  dirty: boolean;
  /** Counted at cost less the books, with the lines as they are saved. */
  differenceMinor: number;
}

export interface AdjustButtonState {
  /** False for a person without inventory.adjust: the button is not drawn at all. */
  visible: boolean;
  disabled: boolean;
  /** Why it is disabled, in plain words; null when it can be pressed. */
  reason: string | null;
}

/**
 * Whether the "Adjust inventory by ..." button can be pressed. The checks run
 * in the order the database raises them: item tracking first (a company that
 * keeps stock by item cannot post a count at all), then unsaved changes (the
 * database posts the saved lines, not the screen's), then a zero difference.
 */
export function adjustButtonState(input: AdjustButtonInput): AdjustButtonState {
  if (!input.canAdjust) return { visible: false, disabled: true, reason: null };
  if (input.tracksItems) return { visible: true, disabled: true, reason: TRACKS_ITEMS_MESSAGE };
  if (input.dirty) return { visible: true, disabled: true, reason: SAVE_FIRST_MESSAGE };
  if (input.differenceMinor === 0) return { visible: true, disabled: true, reason: AGREES_MESSAGE };
  return { visible: true, disabled: false, reason: null };
}

/** "+$12.00" or "-$12.00"; a zero has no sign. `format` renders an absolute amount. */
export function signedAmountText(minor: number, format: (absoluteMinor: number) => string): string {
  if (minor === 0) return format(0);
  return `${minor > 0 ? "+" : "-"}${format(Math.abs(minor))}`;
}

/** The button's words: "Adjust inventory by +$12.00 at 2026-06-30". */
export function adjustButtonLabel(differenceMinor: number, asOf: string, format: (absoluteMinor: number) => string): string {
  return `Adjust inventory by ${signedAmountText(differenceMinor, format)} at ${asOf}`;
}

export interface PreviewAccount {
  code: string;
  name: string;
}

export interface EntryPreviewLine {
  side: "Dr" | "Cr";
  accountLabel: string;
  amountMinor: number;
}

/**
 * The entry a post would write, as acc_post_stock_count builds it: a positive
 * difference debits inventory and credits the offset account; a negative one
 * does the reverse. Null when there is nothing to post or an account is not chosen.
 */
export function entryPreview(
  differenceMinor: number,
  inventory: PreviewAccount | null,
  offset: PreviewAccount | null,
): EntryPreviewLine[] | null {
  if (differenceMinor === 0 || !inventory || !offset) return null;
  const amountMinor = Math.abs(differenceMinor);
  const up = differenceMinor > 0;
  const label = (a: PreviewAccount) => `${a.code} ${a.name}`;
  return [
    { side: up ? "Dr" : "Cr", accountLabel: label(inventory), amountMinor },
    { side: up ? "Cr" : "Dr", accountLabel: label(offset), amountMinor },
  ];
}

/**
 * How a difference (or an adjustment) is coloured, one rule for every screen:
 * a shortage is "shortage" (red), a surplus and zero are "neutral" (the normal
 * text colour). A surplus is good news for the books and is never red.
 */
export function differenceTone(minor: number): "shortage" | "neutral" {
  return minor < 0 ? "shortage" : "neutral";
}

/** Statuses whose lines can no longer be edited. */
export function isLocked(status: string): boolean {
  return status !== "draft";
}
```

- [ ] **Step 10: Create `ctyhp-accounting/lib/services/stock-count.ts`** with exactly this content:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StockCountLineRow, StockCountRow } from "@/lib/db/types";
import type { StockCountLineInput } from "@/lib/domain/stock-count";
import { hasPermission } from "@/lib/services/access";
import { readAllPages } from "@/lib/services/paging";
import { getLedgerBalances } from "@/lib/services/reports";

export class StockCountError extends Error {}

const fail = (message: string) => new StockCountError(message);

const HEADER_COLUMNS =
  "id,count_number,as_of,status,memo,counted_minor,book_minor,difference_minor," +
  "inventory_account_id,offset_account_id,journal_entry_id,approval_request_id," +
  "posted_by,posted_at,created_by,created_at,updated_by,updated_at";

const LINE_COLUMNS = "id,stock_count_id,line_order,name,sku,quantity,unit_cost_minor,sells_for_minor";

function numberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/** bigint and numeric columns can arrive as strings; the screen works in numbers. */
function headerFromRow(r: Record<string, unknown>): StockCountRow {
  return {
    ...(r as unknown as StockCountRow),
    counted_minor: numberOrNull(r.counted_minor),
    book_minor: numberOrNull(r.book_minor),
    difference_minor: numberOrNull(r.difference_minor),
  };
}

function lineFromRow(r: Record<string, unknown>): StockCountLineRow {
  return {
    ...(r as unknown as StockCountLineRow),
    line_order: Number(r.line_order),
    quantity: Number(r.quantity),
    unit_cost_minor: Number(r.unit_cost_minor),
    sells_for_minor: numberOrNull(r.sells_for_minor),
  };
}

/**
 * Every count, newest first. Ordered by as-of date, then count number (unique),
 * then id, so a row cannot straddle a page.
 */
export async function listStockCounts(sb: SupabaseClient): Promise<StockCountRow[]> {
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) =>
      sb
        .from("acc_stock_count")
        .select(HEADER_COLUMNS)
        .order("as_of", { ascending: false })
        .order("count_number", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
    fail,
  );
  return rows.map(headerFromRow);
}

export interface StockCountSummary extends StockCountRow {
  lineCount: number;
}

/**
 * The list screen's rows: every count, newest first, each with how many lines
 * it holds. The line count comes from an embedded count, so no line is read.
 */
export async function listStockCountSummaries(sb: SupabaseClient): Promise<StockCountSummary[]> {
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) =>
      sb
        .from("acc_stock_count")
        .select(`${HEADER_COLUMNS},lines:acc_stock_count_line(count)`)
        .order("as_of", { ascending: false })
        .order("count_number", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
    fail,
  );
  return rows.map((r) => {
    const embedded = r.lines as { count?: number | string }[] | null | undefined;
    return { ...headerFromRow(r), lineCount: Number(embedded?.[0]?.count ?? 0) };
  });
}

export interface StockCountWithLines {
  count: StockCountRow;
  lines: StockCountLineRow[];
}

/** One count with its lines in sheet order (line_order, then id), or null when there is none. */
export async function getStockCount(sb: SupabaseClient, id: string): Promise<StockCountWithLines | null> {
  const { data, error } = await sb.from("acc_stock_count").select(HEADER_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw fail(error.message);
  if (!data) return null;
  const lines = await readAllPages<Record<string, unknown>>(
    (from, to) =>
      sb
        .from("acc_stock_count_line")
        .select(LINE_COLUMNS)
        .eq("stock_count_id", id)
        .order("line_order")
        .order("id")
        .range(from, to),
    fail,
  );
  return { count: headerFromRow(data as unknown as Record<string, unknown>), lines: lines.map(lineFromRow) };
}

/** The ids acc_inventory_account_ids() returns, whether PostgREST wraps each scalar or not. */
async function inventoryAccountIds(sb: SupabaseClient): Promise<string[]> {
  const { data, error } = await sb.rpc("acc_inventory_account_ids");
  if (error) throw fail(error.message);
  return ((data ?? []) as unknown[]).map((row) =>
    typeof row === "string" ? row : String(Object.values(row as Record<string, unknown>)[0]),
  );
}

/**
 * What the books say the stock is worth on a date: the net debit balance, up to
 * and including that date, of the accounts acc_inventory_account_ids() names.
 * That function is the very one acc_post_stock_count sums over, so the figure on
 * the screen and the figure the post freezes pick the same accounts.
 *
 * It sums `getLedgerBalances(null, asOf)` for those accounts. The database
 * adds debit_minor less credit_minor over the same posted entries; the two agree
 * for any base-currency line. They part only for a foreign-currency line on an
 * inventory account, where this uses the base amount (amount_base_minor) and the
 * post function the document-currency amount.
 */
export async function getBookValue(sb: SupabaseClient, asOf: string): Promise<number> {
  const [ids, balances] = await Promise.all([inventoryAccountIds(sb), getLedgerBalances(sb, null, asOf)]);
  const inventory = new Set(ids);
  let total = 0;
  for (const b of balances) if (inventory.has(b.accountId)) total += b.debitBase - b.creditBase;
  return total;
}

export interface PostingAccountOption {
  id: string;
  code: string;
  name: string;
}

export interface PostingContext {
  inventoryAccounts: PostingAccountOption[];
  /** Active posting cost-of-sales accounts, for the offset select. */
  offsetAccounts: PostingAccountOption[];
  defaultInventoryAccountId: string | null;
  defaultOffsetAccountId: string | null;
  /** True when the company keeps stock item by item; a count then cannot be posted. */
  tracksItems: boolean;
  canAdjust: boolean;
}

/** What the confirm dialog needs: the two selects, their defaults, and whether posting is open to this person here. */
export async function getPostingContext(sb: SupabaseClient): Promise<PostingContext> {
  const [ids, accounts, defaults, tracked, canAdjust] = await Promise.all([
    inventoryAccountIds(sb),
    readAllPages<{ id: string; account_code: string; name: string; account_type: string }>(
      (from, to) =>
        sb
          .from("acc_account")
          .select("id,account_code,name,account_type")
          .eq("is_posting_account", true)
          .eq("status", "active")
          .order("account_code")
          .order("id")
          .range(from, to),
      fail,
    ),
    sb.rpc("acc_stock_count_default_accounts"),
    sb.from("acc_item").select("id", { count: "exact", head: true }).eq("is_inventory", true).eq("is_active", true),
    hasPermission(sb, "inventory.adjust"),
  ]);
  if (defaults.error) throw fail(defaults.error.message);
  if (tracked.error) throw fail(tracked.error.message);

  const inventory = new Set(ids);
  const option = (a: { id: string; account_code: string; name: string }): PostingAccountOption => ({
    id: a.id,
    code: a.account_code,
    name: a.name,
  });
  const row = (Array.isArray(defaults.data) ? defaults.data[0] : defaults.data) as
    | { inventory_account_id?: string | null; offset_account_id?: string | null }
    | null
    | undefined;

  return {
    inventoryAccounts: accounts.filter((a) => inventory.has(a.id)).map(option),
    offsetAccounts: accounts.filter((a) => a.account_type === "cost_of_goods_sold").map(option),
    defaultInventoryAccountId: row?.inventory_account_id ?? null,
    defaultOffsetAccountId: row?.offset_account_id ?? null,
    tracksItems: (tracked.count ?? 0) > 0,
    canAdjust,
  };
}

/** The open count, or a new draft dated asOf that starts as a copy of the previous count's lines. */
export async function createStockCount(sb: SupabaseClient, asOf: string): Promise<string> {
  const { data, error } = await sb.rpc("acc_create_stock_count", { p_as_of: asOf });
  if (error) throw fail(error.message);
  return String(data);
}

export interface SaveStockCountInput {
  id: string;
  asOf: string;
  memo: string | null;
  lines: readonly StockCountLineInput[];
}

/** Replace a draft's lines in one transaction. Returns how many lines were saved. */
export async function saveStockCount(sb: SupabaseClient, input: SaveStockCountInput): Promise<number> {
  const { data, error } = await sb.rpc("acc_save_stock_count", {
    p_id: input.id,
    p_as_of: input.asOf,
    p_memo: input.memo,
    p_lines: input.lines.map((l) => ({
      name: l.name,
      sku: l.sku,
      quantity: l.quantity,
      unit_cost_minor: l.unitCostMinor,
      sells_for_minor: l.sellsForMinor,
    })),
  });
  if (error) throw fail(error.message);
  return Number(data ?? 0);
}

/** Post the count. Returns the journal entry id. */
export async function postStockCount(
  sb: SupabaseClient,
  input: { id: string; inventoryAccountId: string; offsetAccountId: string },
): Promise<string> {
  const { data, error } = await sb.rpc("acc_post_stock_count", {
    p_id: input.id,
    p_inventory_account_id: input.inventoryAccountId,
    p_offset_account_id: input.offsetAccountId,
  });
  if (error) throw fail(error.message);
  return String(data);
}

/** After a count has been sent for approval: link the request and freeze the count. */
export async function markStockCountPending(sb: SupabaseClient, id: string, requestId: string): Promise<void> {
  const { error } = await sb.rpc("acc_mark_stock_count_pending", { p_id: id, p_request_id: requestId });
  if (error) throw fail(error.message);
}

/** The number of a journal entry (JE-...), or null when it cannot be read. */
export async function getEntryNumber(sb: SupabaseClient, entryId: string): Promise<string | null> {
  const { data, error } = await sb.from("acc_journal_entry").select("entry_number").eq("id", entryId).maybeSingle();
  if (error || !data) return null;
  return String((data as { entry_number: string }).entry_number);
}
```

- [ ] **Step 11: Create `ctyhp-accounting/app/(app)/inventory/stock-count/actions.ts`** with exactly this content:

```ts
"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/db/server";
import { canWrite, getUserRole } from "@/lib/auth";
import {
  AGREES_MESSAGE,
  countDifferenceMinor,
  countedTotalMinor,
  stockCountErrorMessage,
  validateStockCount,
} from "@/lib/domain/stock-count";
import { executeOrSubmitForApproval } from "@/lib/services/approval-flow";
import {
  createStockCount,
  getBookValue,
  getEntryNumber,
  getStockCount,
  markStockCountPending,
  postStockCount,
  saveStockCount,
} from "@/lib/services/stock-count";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

/** How a post ended: the entry it wrote, or the approval request it was sent as. */
export type PostStockCountOutcome =
  | { kind: "posted"; entryId: string; entryNumber: string | null }
  | { kind: "submitted"; requestId: string };

const NO_PERMISSION = "You do not have permission to change stock counts";

function msg(e: unknown): string {
  return e instanceof Error ? stockCountErrorMessage(e.message) : "An unexpected error occurred";
}

function revalidateCounts(id?: string) {
  revalidatePath("/inventory/stock-count");
  if (id) revalidatePath(`/inventory/stock-count/${id}`);
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose the as-of date");

/** Open the current draft, or start one dated `asOf` (the company's today) from the previous count. */
export async function createStockCountAction(asOf: string): Promise<ActionResult<{ id: string }>> {
  if (!canWrite(await getUserRole())) return { ok: false, error: NO_PERMISSION };
  const date = isoDate.safeParse(asOf);
  if (!date.success) return { ok: false, error: date.error.issues[0]?.message ?? "Choose the as-of date" };
  try {
    const sb = await createSupabaseServerClient();
    const id = await createStockCount(sb, date.data);
    revalidateCounts(id);
    return { ok: true, data: { id } };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

const lineSchema = z.object({
  name: z.string(),
  sku: z.string().nullable(),
  quantity: z.number(),
  unitCostMinor: z.number(),
  sellsForMinor: z.number().nullable(),
});

const saveSchema = z.object({
  id: z.uuid(),
  asOf: z.string(),
  memo: z.string().nullable(),
  lines: z.array(lineSchema),
});

/** Save the draft: its date, memo and the whole set of lines, in one step. */
export async function saveStockCountAction(raw: unknown): Promise<ActionResult<{ saved: number }>> {
  if (!canWrite(await getUserRole())) return { ok: false, error: NO_PERMISSION };
  const parsed = saveSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "The count could not be read; reload the page and try again" };
  const input = parsed.data;
  const problems = validateStockCount(input);
  if (problems.length > 0) {
    const first = problems[0];
    return { ok: false, error: first.lineNumber === null ? first.reason : `Line ${first.lineNumber}: ${first.reason}` };
  }
  try {
    const sb = await createSupabaseServerClient();
    const saved = await saveStockCount(sb, input);
    revalidateCounts(input.id);
    return { ok: true, data: { saved } };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

/** What the books say the stock is worth on a date, for the draft screen when the as-of date changes. */
export async function bookValueAction(asOf: string): Promise<ActionResult<{ bookMinor: number }>> {
  const date = isoDate.safeParse(asOf);
  if (!date.success) return { ok: false, error: date.error.issues[0]?.message ?? "Choose the as-of date" };
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: { bookMinor: await getBookValue(sb, date.data) } };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}

const postSchema = z.object({
  id: z.uuid(),
  inventoryAccountId: z.uuid("Choose the inventory account"),
  offsetAccountId: z.uuid("Choose the offset account"),
});

/**
 * Post the count as one adjusting entry, or send it for a second person's
 * approval when the inventory-adjustment policy asks for that at this size.
 *
 * The approval amount is the size of the difference, worked out here from the
 * saved lines and the books on the as-of date. The database recomputes the
 * difference when it posts, and again when the request is approved.
 */
export async function postStockCountAction(raw: unknown): Promise<ActionResult<PostStockCountOutcome>> {
  if (!canWrite(await getUserRole())) return { ok: false, error: NO_PERMISSION };
  const parsed = postSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  const { id, inventoryAccountId, offsetAccountId } = parsed.data;
  try {
    const sb = await createSupabaseServerClient();
    const found = await getStockCount(sb, id);
    if (!found) return { ok: false, error: "Stock count not found" };
    if (found.count.status !== "draft") {
      return { ok: false, error: `Stock count ${found.count.count_number} is not a draft, so it cannot be posted` };
    }

    const counted = countedTotalMinor(
      found.lines.map((l) => ({ quantity: l.quantity, unitCostMinor: l.unit_cost_minor })),
    );
    const difference = countDifferenceMinor(counted, await getBookValue(sb, found.count.as_of));
    if (difference === 0) return { ok: false, error: AGREES_MESSAGE };

    const outcome = await executeOrSubmitForApproval({
      sb,
      actionKey: "inventory_adjustment",
      title: `Stock count ${found.count.count_number}`,
      amountMinor: Math.abs(difference),
      reason: `Stock count ${found.count.count_number} as of ${found.count.as_of}`,
      payload: {
        stock_count_id: id,
        inventory_account_id: inventoryAccountId,
        offset_account_id: offsetAccountId,
      },
      execute: () => postStockCount(sb, { id, inventoryAccountId, offsetAccountId }),
    });

    let result: PostStockCountOutcome;
    if (outcome.status === "submitted") {
      try {
        await markStockCountPending(sb, id, outcome.requestId);
      } catch (e) {
        revalidatePath("/approvals");
        revalidateCounts(id);
        return { ok: false, error: `The request was sent for approval, but the count could not be linked to it: ${msg(e)}` };
      }
      result = { kind: "submitted", requestId: outcome.requestId };
    } else {
      result = { kind: "posted", entryId: outcome.result, entryNumber: await getEntryNumber(sb, outcome.result) };
    }

    revalidateCounts(id);
    revalidatePath("/approvals");
    revalidatePath("/journal");
    revalidatePath("/dashboard");
    revalidatePath("/reports/inventory-valuation");
    revalidatePath("/reports/purchases-inventory");
    return { ok: true, data: result };
  } catch (e) {
    return { ok: false, error: msg(e) };
  }
}
```

- [ ] **Step 12: Edit `ctyhp-accounting/lib/domain/purchases-inventory.ts`** — apply this 1 find/replace edit (its find string occurs exactly once):

Edit 1 of 1 — find:

```ts
      opening: isOpeningEntry({ id: l.entryId, sourceType: l.sourceType, description: l.description }, input.equityEntryIds),
      count: l.sourceType === "inventory_adjustment" || adjustmentEntries.has(l.entryId),
    };
```

replace with:

```ts
      opening: isOpeningEntry({ id: l.entryId, sourceType: l.sourceType, description: l.description }, input.equityEntryIds),
      count: l.sourceType === "inventory_adjustment" || l.sourceType === "stock_count" || adjustmentEntries.has(l.entryId),
    };
```

- [ ] **Step 13: Edit `ctyhp-accounting/lib/domain/entry-detail.ts`** — apply these 2 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 2 — find:

```ts
  inventory_adjustment: "Stock adjustment",
  depreciation: "Depreciation",
```

replace with:

```ts
  inventory_adjustment: "Stock adjustment",
  stock_count: "Stock count",
  depreciation: "Depreciation",
```

Edit 2 of 2 — find:

```ts
  return SOURCE_LABEL[sourceType] ?? sourceType.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
}
```

replace with:

```ts
  return SOURCE_LABEL[sourceType] ?? sourceType.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
}

/**
 * Where the document behind an entry opens, for the kinds whose document has a
 * page of its own by id. Other kinds are routed by their list page.
 */
export function sourceHref(sourceType: string, sourceId: string | null): string | null {
  if (!sourceId) return null;
  if (sourceType === "stock_count") return `/inventory/stock-count/${sourceId}`;
  return null;
}
```

- [ ] **Step 14: Edit `ctyhp-accounting/app/(app)/reports/general-ledger/GeneralLedgerClient.tsx`** — apply these 2 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 2 — find:

```tsx
import { fromMinor } from "@/lib/domain/money";
import {
```

replace with:

```tsx
import { fromMinor } from "@/lib/domain/money";
import { sourceHref as documentHref } from "@/lib/domain/entry-detail";
import {
```

Edit 2 of 2 — find:

```tsx
  if (!sourceId) return null;
  const map: Record<string, string> = {
```

replace with:

```tsx
  if (!sourceId) return null;
  // A stock count has a page of its own, opened by id rather than filtered by ?source=.
  const own = documentHref(sourceType, sourceId);
  if (own) return own;
  const map: Record<string, string> = {
```

- [ ] **Step 15: Edit `ctyhp-accounting/app/(app)/reports/journal/JournalReportClient.tsx`** — apply this 1 find/replace edit (its find string occurs exactly once):

Edit 1 of 1 — find:

```tsx
  "tax_payment",
];
```

replace with:

```tsx
  "tax_payment",
  "stock_count",
];
```

- [ ] **Step 16: Edit `ctyhp-accounting/lib/domain/company-export.ts`** — apply this 1 find/replace edit (its find string occurs exactly once):

Edit 1 of 1 — find:

```ts
  "acc_inventory_txn",
  "acc_fixed_asset",
```

replace with:

```ts
  "acc_inventory_txn",
  // Stock Count (0139): a count references accounts, a journal entry and an approval request.
  "acc_stock_count",
  "acc_stock_count_line",
  "acc_fixed_asset",
```

- [ ] **Step 17: Edit `ctyhp-accounting/app/(app)/settings/audit/page.tsx`** — apply this 1 find/replace edit (its find string occurs exactly once):

Edit 1 of 1 — find:

```tsx
  "acc_statement_reconciliation",
  "acc_tax_code",
```

replace with:

```tsx
  "acc_statement_reconciliation",
  "acc_stock_count",
  "acc_tax_code",
```

- [ ] **Step 18: Edit `ctyhp-accounting/lib/services/dashboard.ts`** — apply this 1 find/replace edit (its find string occurs exactly once):

Edit 1 of 1 — find:

```ts
  acc_inventory_txn: { entity: "Inventory movement", href: "/items", category: "inventory" },
  acc_journal_entry: { entity: "Journal entry", href: "/journal", category: "close" },
```

replace with:

```ts
  acc_inventory_txn: { entity: "Inventory movement", href: "/items", category: "inventory" },
  acc_stock_count: { entity: "Stock count", href: "/inventory/stock-count", category: "inventory" },
  acc_journal_entry: { entity: "Journal entry", href: "/journal", category: "close" },
```

- [ ] **Step 19: Run the gates**

Run from `ctyhp-accounting/` and read the pass/fail lines in full (never pipe through `tail`/`head`):

```bash
npx tsc --noEmit -p .
npx eslint "tests/unit/stock-count.test.ts" "tests/unit/stock-count-service.test.ts" "tests/unit/stock-count-actions.test.ts" "tests/unit/purchases-inventory.test.ts" "tests/unit/entry-detail.test.ts" "tests/unit/company-export-order.test.ts" "lib/db/types.ts" "lib/domain/stock-count.ts" "lib/services/stock-count.ts" "app/(app)/inventory/stock-count/actions.ts" "lib/domain/purchases-inventory.ts" "lib/domain/entry-detail.ts" "app/(app)/reports/general-ledger/GeneralLedgerClient.tsx" "app/(app)/reports/journal/JournalReportClient.tsx" "lib/domain/company-export.ts" "app/(app)/settings/audit/page.tsx" "lib/services/dashboard.ts"
npx vitest run tests/unit/stock-count.test.ts tests/unit/stock-count-service.test.ts tests/unit/stock-count-actions.test.ts tests/unit/purchases-inventory.test.ts tests/unit/entry-detail.test.ts tests/unit/company-export-order.test.ts tests/unit/audit.test.ts
```

Expected: tsc exits 0 with no output; eslint reports 0 errors and 0 warnings for these files; the six stock-count, purchases-inventory, entry-detail and company-export-order files: 108 tests passing; audit passes.

- [ ] **Step 20: Commit**

```bash
git add "ctyhp-accounting/tests/unit/stock-count.test.ts" "ctyhp-accounting/tests/unit/stock-count-service.test.ts" "ctyhp-accounting/tests/unit/stock-count-actions.test.ts" "ctyhp-accounting/tests/unit/purchases-inventory.test.ts" "ctyhp-accounting/tests/unit/entry-detail.test.ts" "ctyhp-accounting/tests/unit/company-export-order.test.ts" "ctyhp-accounting/lib/db/types.ts" "ctyhp-accounting/lib/domain/stock-count.ts" "ctyhp-accounting/lib/services/stock-count.ts" "ctyhp-accounting/app/(app)/inventory/stock-count/actions.ts" "ctyhp-accounting/lib/domain/purchases-inventory.ts" "ctyhp-accounting/lib/domain/entry-detail.ts" "ctyhp-accounting/app/(app)/reports/general-ledger/GeneralLedgerClient.tsx" "ctyhp-accounting/app/(app)/reports/journal/JournalReportClient.tsx" "ctyhp-accounting/lib/domain/company-export.ts" "ctyhp-accounting/app/(app)/settings/audit/page.tsx" "ctyhp-accounting/lib/services/dashboard.ts"
git commit -m "feat(inventory): the stock count model, service and actions"
```

Stage by file name only (never `git add -A` / `git add .`). No Co-Authored-By trailer; no mention of Claude or AI in the message.

---

### Task 3: The Stock Count screens, the sidebar leaf and the Report Center card

**Files:**
- Test (create): `ctyhp-accounting/tests/unit/stock-count-screens.test.ts`
- Test (modify): `ctyhp-accounting/tests/unit/navigation.test.ts`
- Test (modify): `ctyhp-accounting/tests/unit/reports-wave1-catalog.test.ts`
- Create: `ctyhp-accounting/lib/client/use-unsaved-guard.ts`
- Create: `ctyhp-accounting/app/(app)/inventory/stock-count/stock-count.module.css`
- Create: `ctyhp-accounting/app/(app)/inventory/stock-count/NewCountButton.tsx`
- Create: `ctyhp-accounting/app/(app)/inventory/stock-count/PostCountDialog.tsx`
- Create: `ctyhp-accounting/app/(app)/inventory/stock-count/StockCountListClient.tsx`
- Create: `ctyhp-accounting/app/(app)/inventory/stock-count/StockCountDetailClient.tsx`
- Create: `ctyhp-accounting/app/(app)/inventory/stock-count/page.tsx`
- Create: `ctyhp-accounting/app/(app)/inventory/stock-count/[id]/page.tsx`
- Modify: `ctyhp-accounting/lib/domain/navigation.ts`
- Modify: `ctyhp-accounting/lib/domain/report-catalog.ts`
- Modify: `ctyhp-accounting/components/reports/ReportsHub.tsx`

**Interfaces:**
- Consumes: Task 2's domain helpers, service reads and the four actions (names above); existing `DataTable`, `ReportTable` with `SummaryRow`/`SummaryCell`, `reportPagination`, `FilterBar`, `ReportExportButtons`, `PageHeader`, `ReportEntityBadge`, `lib/design/table-metrics`.
- Produces: `useUnsavedGuard(dirty, modal, what = "this count")` (`lib/client/use-unsaved-guard.ts`); the list page `/inventory/stock-count` and the count page `/inventory/stock-count/[id]`; `EDITOR_FIXED_WIDTHS`, `READONLY_FIXED_WIDTHS`, `NAME_FLOOR`, `LIST_FIXED_WIDTHS`, `LIST_ELASTIC_FLOOR` (checked by the screens test); the sidebar leaf "Stock Count" between Overview and Fixed Assets; the Report Center card "Stock Count" — "What stock is on hand and what it is carried at." (40 reports for an administrator).

- [ ] **Step 1: Create `ctyhp-accounting/tests/unit/stock-count-screens.test.ts`** with exactly this content:

```ts
import { describe, expect, it } from "vitest";
import { fitsBox } from "@/lib/design/table-metrics";
import { EDITOR_FIXED_WIDTHS, NAME_FLOOR, READONLY_FIXED_WIDTHS } from "@/app/(app)/inventory/stock-count/StockCountDetailClient";
import { LIST_ELASTIC_FLOOR, LIST_FIXED_WIDTHS } from "@/app/(app)/inventory/stock-count/StockCountListClient";
import {
  AGREES_MESSAGE,
  FOOTNOTE,
  PASTE_HINT,
  SAVE_FIRST_MESSAGE,
  TRACKS_ITEMS_MESSAGE,
  adjustButtonLabel,
  adjustButtonState,
  appendCountLines,
  differenceTone,
  entryPreview,
  isLocked,
  parseCountSheet,
  pasteProblemText,
  pasteSummary,
  signedAmountText,
} from "@/lib/domain/stock-count";

const fmt = (m: number) => `$${(m / 100).toFixed(2)}`;
const base = { canAdjust: true, tracksItems: false, dirty: false, differenceMinor: 1200 };

describe("adjustButtonState", () => {
  it("is open when the difference is not zero and nothing is unsaved", () => {
    expect(adjustButtonState(base)).toEqual({ visible: true, disabled: false, reason: null });
  });
  it("is not drawn without inventory.adjust", () => {
    expect(adjustButtonState({ ...base, canAdjust: false }).visible).toBe(false);
  });
  it("explains a zero difference", () => {
    expect(adjustButtonState({ ...base, differenceMinor: 0 })).toEqual({
      visible: true,
      disabled: true,
      reason: AGREES_MESSAGE,
    });
  });
  it("explains item tracking before anything else", () => {
    const s = adjustButtonState({ ...base, tracksItems: true, dirty: true, differenceMinor: 0 });
    expect(s.reason).toBe(TRACKS_ITEMS_MESSAGE);
  });
  it("asks to save first, ahead of a zero difference", () => {
    expect(adjustButtonState({ ...base, dirty: true, differenceMinor: 0 }).reason).toBe(SAVE_FIRST_MESSAGE);
  });
});

describe("labels", () => {
  it("signs the amount", () => {
    expect(signedAmountText(1200, fmt)).toBe("+$12.00");
    expect(signedAmountText(-1200, fmt)).toBe("-$12.00");
    expect(signedAmountText(0, fmt)).toBe("$0.00");
  });
  it("words the button as the spec does", () => {
    expect(adjustButtonLabel(-505, "2026-06-30", fmt)).toBe("Adjust inventory by -$5.05 at 2026-06-30");
  });
  it("carries the hint and footnote verbatim", () => {
    expect(PASTE_HINT).toBe(
      "One line each: name, quantity, cost — and sells for, if you like. Pasting from a spreadsheet keeps the columns apart; in typed text leave out thousands separators.",
    );
    expect(FOOTNOTE).toBe(
      "Periodic, on purpose: purchases go to cost of sales as they are made and the count corrects the balance sheet. This is a count sheet, not perpetual stock, so it does not track units in and out.",
    );
  });
});

describe("entryPreview", () => {
  const inv = { code: "1200", name: "Inventory" };
  const off = { code: "5010", name: "Inventory Adjustment" };
  it("debits inventory for a positive difference", () => {
    expect(entryPreview(500, inv, off)).toEqual([
      { side: "Dr", accountLabel: "1200 Inventory", amountMinor: 500 },
      { side: "Cr", accountLabel: "5010 Inventory Adjustment", amountMinor: 500 },
    ]);
  });
  it("reverses for a negative difference", () => {
    const lines = entryPreview(-500, inv, off)!;
    expect(lines.map((l) => l.side)).toEqual(["Cr", "Dr"]);
    expect(lines.every((l) => l.amountMinor === 500)).toBe(true);
  });
  it("is null for a zero difference or a missing account", () => {
    expect(entryPreview(0, inv, off)).toBeNull();
    expect(entryPreview(5, null, off)).toBeNull();
    expect(entryPreview(5, inv, null)).toBeNull();
  });
});

describe("pasting", () => {
  it("appends the good lines and reports the bad ones by number", () => {
    const result = parseCountSheet("Bolt, 5, 2.00\nbroken\n\nNut, 3, 0.50");
    expect(result.lines).toHaveLength(2);
    expect(result.problems.map(pasteProblemText)).toEqual(["Line 2: Needs a name, a quantity and a cost each"]);
    expect(pasteSummary(result)).toBe("Added 2 lines. 1 line could not be read and was left out.");
    const existing = [{ name: "Old", sku: null, quantity: 1, unitCostMinor: 100, sellsForMinor: null }];
    expect(appendCountLines(existing, result.lines).map((l) => l.name)).toEqual(["Old", "Bolt", "Nut"]);
  });
  it("says when there was nothing to read", () => {
    expect(pasteSummary(parseCountSheet("  \n"))).toBe("Nothing to read. Paste one line for each item.");
  });
  it("uses the singular", () => {
    expect(pasteSummary(parseCountSheet("Bolt, 1, 1"))).toBe("Added 1 line.");
  });
});

describe("isLocked", () => {
  it("locks everything but a draft", () => {
    expect(isLocked("draft")).toBe(false);
    expect(isLocked("pending_approval")).toBe(true);
    expect(isLocked("posted")).toBe(true);
  });
});

describe("table fit", () => {
  const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
  it("fits the list at a 1280px window", () => {
    expect(fitsBox(sum(LIST_FIXED_WIDTHS), LIST_ELASTIC_FLOOR)).toBe(true);
  });
  it("fits the editable and the read-only lines tables at a 1280px window", () => {
    expect(fitsBox(sum(EDITOR_FIXED_WIDTHS), NAME_FLOOR)).toBe(true);
    expect(fitsBox(sum(READONLY_FIXED_WIDTHS), NAME_FLOOR)).toBe(true);
  });
});

describe("differenceTone", () => {
  it("is red only for a shortage", () => {
    expect(differenceTone(-1)).toBe("shortage");
    expect(differenceTone(177500)).toBe("neutral");
    expect(differenceTone(0)).toBe("neutral");
  });
});
```

- [ ] **Step 2: Edit `ctyhp-accounting/tests/unit/navigation.test.ts`** — apply these 2 find/replace edits in order (each find string occurs exactly once at the moment it is applied):

Edit 1 of 2 — find:

```ts
      "/inventory",
      "/fixed-assets",
```

replace with:

```ts
      "/inventory",
      "/inventory/stock-count",
      "/fixed-assets",
```

Edit 2 of 2 — find:

```ts
    expect(findActivePage("/banking/reconcile/abc")?.key).toBe("/banking/reconcile");
  });
```

replace with:

```ts
    expect(findActivePage("/banking/reconcile/abc")?.key).toBe("/banking/reconcile");
  });

  it("opens Stock Count under Inventory & Assets, not under the Inventory overview", () => {
    expect(findActivePage("/inventory/stock-count")?.key).toBe("/inventory/stock-count");
    expect(findActivePage("/inventory/stock-count/abc")?.key).toBe("/inventory/stock-count");
    expect(findActivePage("/inventory")?.key).toBe("/inventory");
  });
```

- [ ] **Step 3: Edit `ctyhp-accounting/tests/unit/reports-wave1-catalog.test.ts`** — apply this 1 find/replace edit (its find string occurs exactly once):

Edit 1 of 1 — find:

```ts
    expect(REPORT_CATALOG.some((r) => r.href.includes("beancount"))).toBe(false);
    expect(REPORT_CATALOG).toHaveLength(39);
  });
```

replace with:

```ts
    expect(REPORT_CATALOG.some((r) => r.href.includes("beancount"))).toBe(false);
    expect(REPORT_CATALOG).toHaveLength(40);
  });
```

- [ ] **Step 4: Run the tests to see them fail**

```bash
npx vitest run tests/unit/stock-count-screens.test.ts tests/unit/navigation.test.ts tests/unit/reports-wave1-catalog.test.ts
```

Expected: FAIL — the screens do not exist yet, the sidebar has no Stock Count leaf and the catalog still has 39 reports.

- [ ] **Step 5: Create `ctyhp-accounting/lib/client/use-unsaved-guard.ts`** with exactly this content:

```ts
"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import type { HookAPI } from "antd/es/modal/useModal";

/**
 * Do not lose typing by leaving the page.
 *
 * While `dirty` is true:
 * - closing the tab, reloading, or typing another address asks the browser's own
 *   question (`beforeunload`);
 * - clicking one of the app's own links (the sidebar, a breadcrumb, any anchor
 *   that stays on this site) is held back and put to the reader in a dialog
 *   first, because the browser asks nothing when the app navigates client-side.
 *
 * The browser's Back button is left alone: it cannot be held back without
 * rewriting history, and the draft is one Save away from safe.
 */
export function useUnsavedGuard(dirty: boolean, modal: HookAPI, what = "this count") {
  const router = useRouter();
  const dirtyRef = useRef(dirty);
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Chrome still wants a returnValue to show its dialog.
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!dirtyRef.current) return;
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || (anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      // The same page (a hash, or the same path and query) is not leaving it.
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      event.preventDefault();
      event.stopPropagation();
      const destination = `${url.pathname}${url.search}${url.hash}`;
      modal.confirm({
        title: "Leave without saving?",
        content: `You have changes to ${what} that are not saved. Leaving now throws them away.`,
        okText: "Leave",
        okButtonProps: { danger: true },
        cancelText: "Stay and keep editing",
        onOk: () => {
          dirtyRef.current = false;
          router.push(destination);
        },
      });
    };
    // Capture phase: this runs before the link's own handler starts the navigation.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [modal, router, what]);
}
```

- [ ] **Step 6: Create `ctyhp-accounting/app/(app)/inventory/stock-count/stock-count.module.css`** with exactly this content:

```css
.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
  margin-bottom: 16px;
}

.field {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--ob-text-secondary);
  font-size: 13px;
}

.memo {
  flex: 1 1 280px;
  min-width: 200px;
}

.adjust {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  margin: 16px 0;
}

.reason {
  color: var(--ob-text-secondary);
  font-size: 13px;
}

.notice {
  margin-bottom: 12px;
}

.problems {
  margin: 4px 0 0;
  padding-left: 18px;
}

/* One row of the editable table: the name and SKU share a cell. */
.nameCell {
  display: flex;
  gap: 4px;
  min-width: 0;
}

.nameCell > :first-child {
  flex: 1 1 auto;
  min-width: 0;
}

.sku {
  flex: 0 0 96px;
  width: 96px;
}

.sku,
.nameCell input {
  font-size: 12px;
}

/* A compact amount: right-aligned, no spinner, the cell's whole width. */
.amount {
  width: 100%;
}

.amount :global(.ant-input-number-input) {
  text-align: right;
  padding-inline: 6px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.value {
  display: block;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.paste {
  margin-top: 20px;
  padding: 14px 16px;
  background: var(--ob-surface-subtle);
  border: 1px solid var(--ob-border-default);
  border-radius: 8px;
}

.pasteTitle {
  margin: 0 0 4px;
  font-weight: 600;
  color: var(--ob-text-heading);
}

.hint {
  margin: 0 0 8px;
  font-size: 12.5px;
  color: var(--ob-text-secondary);
  line-height: 1.55;
}

.pasteActions {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
}

.figures {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  padding: 12px 14px;
  margin-bottom: 16px;
  background: var(--ob-surface-subtle);
  border: 1px solid var(--ob-border-default);
  border-radius: 8px;
}

.figure {
  display: grid;
  gap: 2px;
}

.figureLabel {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--ob-text-secondary);
}

.figureValue {
  font-size: 15px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--ob-text-heading);
}

.shortage {
  color: var(--ob-money-negative);
}

.selects {
  display: grid;
  gap: 12px;
  margin-bottom: 16px;
}

.selectLabel {
  display: grid;
  gap: 4px;
  font-size: 13px;
  color: var(--ob-text-secondary);
}

.preview {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.preview th {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ob-text-secondary);
  text-align: left;
  padding: 0 8px 6px 0;
  border-bottom: 1px solid var(--ob-border-muted);
}

.preview td {
  padding: 6px 8px 6px 0;
  border-bottom: 1px solid var(--ob-border-muted);
  color: var(--ob-text-body);
}

.preview .num {
  text-align: right;
  padding-right: 0;
}

.outcome {
  display: grid;
  gap: 8px;
}

.lockedBar {
  margin-bottom: 16px;
}
```

- [ ] **Step 7: Create `ctyhp-accounting/app/(app)/inventory/stock-count/NewCountButton.tsx`** with exactly this content:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlusOutlined } from "@ant-design/icons";
import { App, Button } from "antd";
import { createStockCountAction } from "./actions";

/**
 * Opens the count that is still open, or starts a new one dated the company's
 * today with the previous count's lines copied in. The database decides which;
 * this only asks.
 */
export default function NewCountButton({ today, type = "primary" }: { today: string; type?: "primary" | "default" }) {
  const router = useRouter();
  const { message } = App.useApp();
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    try {
      const res = await createStockCountAction(today);
      if (res.ok && res.data) router.push(`/inventory/stock-count/${res.data.id}`);
      else message.error(res.error ?? "The count could not be started");
    } catch {
      message.error("The count could not be started. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button type={type} icon={<PlusOutlined />} loading={busy} onClick={() => void start()}>
      New count
    </Button>
  );
}
```

- [ ] **Step 8: Create `ctyhp-accounting/app/(app)/inventory/stock-count/PostCountDialog.tsx`** with exactly this content:

```tsx
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Button, Modal, Select } from "antd";
import { differenceTone, entryPreview, signedAmountText } from "@/lib/domain/stock-count";
import type { PostingContext } from "@/lib/services/stock-count";
import { postStockCountAction, type PostStockCountOutcome } from "./actions";
import styles from "./stock-count.module.css";

/**
 * The last step: the figures, the two accounts, and the entry that will be
 * written. It ends in "Posted as JE-..." or "Sent for approval", each with a
 * link; a refusal from the database is shown here in plain words and the
 * dialog stays open so the accounts can be changed.
 */
export default function PostCountDialog({
  open,
  onClose,
  countId,
  asOf,
  countedMinor,
  bookMinor,
  differenceMinor,
  posting,
  money,
}: {
  open: boolean;
  onClose: () => void;
  countId: string;
  asOf: string;
  countedMinor: number;
  bookMinor: number;
  differenceMinor: number;
  posting: PostingContext;
  money: (minor: number) => string;
}) {
  const router = useRouter();
  const [inventoryId, setInventoryId] = useState<string | null>(
    posting.defaultInventoryAccountId ?? posting.inventoryAccounts[0]?.id ?? null,
  );
  const [offsetId, setOffsetId] = useState<string | null>(
    posting.defaultOffsetAccountId ?? posting.offsetAccounts[0]?.id ?? null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<PostStockCountOutcome | null>(null);

  const inventory = posting.inventoryAccounts.find((a) => a.id === inventoryId) ?? null;
  const offset = posting.offsetAccounts.find((a) => a.id === offsetId) ?? null;
  const preview = useMemo(() => entryPreview(differenceMinor, inventory, offset), [differenceMinor, inventory, offset]);

  async function post() {
    if (!inventoryId || !offsetId) {
      setError("Choose both accounts first");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await postStockCountAction({ id: countId, inventoryAccountId: inventoryId, offsetAccountId: offsetId });
      if (res.ok && res.data) {
        setOutcome(res.data);
        // The page behind reads the count again and turns read-only.
        router.refresh();
      } else {
        setError(res.error ?? "The count could not be posted");
      }
    } catch {
      setError("The count could not be posted. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const accountOptions = (list: { id: string; code: string; name: string }[]) =>
    list.map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }));

  if (outcome) {
    return (
      <Modal title="Stock count" open={open} onCancel={onClose} footer={<Button type="primary" onClick={onClose}>Close</Button>}>
        <div className={styles.outcome}>
          {outcome.kind === "posted" ? (
            <Alert
              type="success"
              showIcon
              title={`Posted as ${outcome.entryNumber ?? "a journal entry"}`}
              description={
                <Link href={`/journal?entry=${outcome.entryId}`}>
                  {outcome.entryNumber ? `Open ${outcome.entryNumber}` : "Open the entry"}
                </Link>
              }
            />
          ) : (
            <Alert
              type="info"
              showIcon
              title="Sent for approval"
              description={
                <>
                  The difference is above the approval limit, so a second person has to approve it. It posts when they
                  do, against the books as they stand then. <Link href={`/approvals?focus=${outcome.requestId}`}>Open Approvals</Link>
                </>
              }
            />
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={`Adjust inventory at ${asOf}`}
      open={open}
      onCancel={busy ? undefined : onClose}
      closable={!busy}
      maskClosable={!busy}
      keyboard={!busy}
      okText="Post the adjustment"
      cancelText="Cancel"
      confirmLoading={busy}
      okButtonProps={{ disabled: !preview }}
      onOk={() => void post()}
      destroyOnHidden
    >
      <div className={styles.figures}>
        <div className={styles.figure}>
          <span className={styles.figureLabel}>Counted at cost</span>
          <span className={styles.figureValue}>{money(countedMinor)}</span>
        </div>
        <div className={styles.figure}>
          <span className={styles.figureLabel}>On the books</span>
          <span className={styles.figureValue}>{money(bookMinor)}</span>
        </div>
        <div className={styles.figure}>
          <span className={styles.figureLabel}>Difference</span>
          <span className={`${styles.figureValue}${differenceTone(differenceMinor) === "shortage" ? ` ${styles.shortage}` : ""}`}>
            {signedAmountText(differenceMinor, money)}
          </span>
        </div>
      </div>

      <div className={styles.selects}>
        <label className={styles.selectLabel}>
          Inventory account
          <Select
            showSearch
            optionFilterProp="label"
            value={inventoryId}
            onChange={setInventoryId}
            options={accountOptions(posting.inventoryAccounts)}
            placeholder="Choose the inventory account"
            disabled={busy}
          />
        </label>
        <label className={styles.selectLabel}>
          Offset account
          <Select
            showSearch
            optionFilterProp="label"
            value={offsetId}
            onChange={setOffsetId}
            options={accountOptions(posting.offsetAccounts)}
            placeholder="Choose the offset account"
            disabled={busy}
          />
        </label>
      </div>

      <table className={styles.preview} aria-label="The entry this will post">
        <thead>
          <tr>
            <th>Dr / Cr</th>
            <th>Account</th>
            <th className={styles.num}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {preview ? (
            preview.map((line) => (
              <tr key={line.side}>
                <td>{line.side}</td>
                <td>{line.accountLabel}</td>
                <td className={styles.num}>{money(line.amountMinor)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={3}>Choose both accounts to see the entry.</td>
            </tr>
          )}
        </tbody>
      </table>

      {error ? <Alert className={styles.notice} style={{ marginTop: 16 }} type="error" showIcon title={error} /> : null}
    </Modal>
  );
}
```

- [ ] **Step 9: Create `ctyhp-accounting/app/(app)/inventory/stock-count/StockCountListClient.tsx`** with exactly this content:

```tsx
"use client";

import Link from "next/link";
import DataTable from "@/components/ui/DataTable";
import type { ColumnType } from "antd/es/table";
import { dateColumn, flexColumn, statusColumn } from "@/components/ui/columns";
import { COLUMN } from "@/lib/design/table-metrics";
import { formatMoney } from "@/lib/format";
import { differenceTone, stockCountStatusLabel } from "@/lib/domain/stock-count";
import type { StockCountSummary } from "@/lib/services/stock-count";
import NewCountButton from "./NewCountButton";

export interface CountListRow extends StockCountSummary {
  /** Name of whoever posted it, or null. */
  postedByName: string | null;
}

/**
 * The fixed widths of the list, in column order, and the floor of its one
 * elastic column (Posted by). tests/unit/stock-count-screens.test.ts adds them
 * up against the 984px box at a 1280px window.
 */
export const LIST_FIXED_WIDTHS = [100, 96, 168, 116, 116, 116, 72] as const;
export const LIST_ELASTIC_FLOOR = COLUMN.TEXT_MIN;

const TONES = {
  draft: { tone: "neutral", label: stockCountStatusLabel("draft") },
  pending_approval: { tone: "warning", label: stockCountStatusLabel("pending_approval") },
  posted: { tone: "positive", label: stockCountStatusLabel("posted") },
} as const;

export default function StockCountListClient({
  rows,
  currencyCode,
  decimals,
  today,
  canWrite,
}: {
  rows: CountListRow[];
  currencyCode: string;
  decimals: number;
  today: string;
  canWrite: boolean;
}) {
  // Plain text colour for every figure; only a shortage in Adjusted by is red.
  const money = (title: string, dataIndex: "counted_minor" | "book_minor" | "difference_minor", width: number): ColumnType<CountListRow> => ({
    title,
    dataIndex,
    width,
    align: "right",
    render: (minor: number | null) =>
      minor === null ? (
        "—"
      ) : (
        <span
          style={{
            fontVariantNumeric: "tabular-nums",
            color: dataIndex === "difference_minor" && differenceTone(minor) === "shortage" ? "var(--ob-money-negative)" : undefined,
          }}
        >
          {formatMoney(minor, currencyCode, decimals)}
        </span>
      ),
  });

  return (
    <DataTable<CountListRow>
      rowKey="id"
      dataSource={rows}
      emptyTitle="No stock counts yet"
      emptyDescription="A count compares the stock you have counted, at cost, with what the inventory accounts say, and posts the difference as one entry."
      emptyAction={canWrite ? <NewCountButton today={today} /> : undefined}
      columns={[
        {
          title: "Count #",
          dataIndex: "count_number",
          width: LIST_FIXED_WIDTHS[0],
          render: (n: string, row) => <Link href={`/inventory/stock-count/${row.id}`}>{n}</Link>,
        },
        dateColumn<CountListRow>({ title: "As of", dataIndex: "as_of", width: LIST_FIXED_WIDTHS[1] }),
        statusColumn<CountListRow>({ title: "Status", dataIndex: "status", tones: TONES, width: LIST_FIXED_WIDTHS[2] }),
        money("Counted", "counted_minor", LIST_FIXED_WIDTHS[3]),
        money("Was on the books", "book_minor", LIST_FIXED_WIDTHS[4]),
        money("Adjusted by", "difference_minor", LIST_FIXED_WIDTHS[5]),
        {
          title: "Lines",
          dataIndex: "lineCount",
          width: LIST_FIXED_WIDTHS[6],
          align: "right",
          render: (n: number) => n.toLocaleString("en-US"),
        },
        flexColumn<CountListRow>({
          title: "Posted by",
          dataIndex: "postedByName",
          floor: LIST_ELASTIC_FLOOR,
        }),
      ]}
    />
  );
}
```

- [ ] **Step 10: Create `ctyhp-accounting/app/(app)/inventory/stock-count/StockCountDetailClient.tsx`** with exactly this content:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { DeleteOutlined, PlusOutlined, PrinterOutlined } from "@ant-design/icons";
import { Alert, App, Button, DatePicker, Input, InputNumber, Space } from "antd";
import dayjs from "dayjs";
import FilterBar from "@/components/ui/FilterBar";
import ReportTable, { SummaryCell, SummaryRow } from "@/components/ui/ReportTable";
import { flexColumn, secondaryLine } from "@/components/ui/columns";
import ReportExportButtons from "@/components/reports/ReportExportButtons";
import { ReportFoot, ReportPaper, StatRow } from "@/components/reports/ReportPaper";
import { reportPagination } from "@/components/reports/SimpleReport";
import { downloadTextFile } from "@/lib/client/download";
import { printReport, watchReportPrinting } from "@/lib/client/print-report";
import { useUnsavedGuard } from "@/lib/client/use-unsaved-guard";
import { COLUMN } from "@/lib/design/table-metrics";
import { fromMinor, toMinor } from "@/lib/domain/money";
import { csvFromExportSheet } from "@/lib/domain/report-export";
import {
  FOOTNOTE,
  PASTE_HINT,
  QUANTITY_DECIMALS,
  adjustButtonLabel,
  adjustButtonState,
  appendCountLines,
  countDifferenceMinor,
  countedTotalMinor,
  differenceTone,
  isDirty,
  lineValueMinor,
  parseCountSheet,
  pasteProblemText,
  pasteSummary,
  signedAmountText,
  stockCountSheet,
  stockCountStatusLabel,
  validateStockCount,
  type CountProblem,
  type PasteProblem,
  type StockCountLineInput,
} from "@/lib/domain/stock-count";
import { dateInTimeZone } from "@/lib/domain/stamp";
import { formatMoney } from "@/lib/format";
import type { PostingContext } from "@/lib/services/stock-count";
import { bookValueAction, saveStockCountAction } from "./actions";
import PostCountDialog from "./PostCountDialog";
import styles from "./stock-count.module.css";

/**
 * Fixed widths of the lines table, in column order after the elastic Name
 * column: Counted, Cost each, Value, Sells for, delete. The Name column takes
 * what is left and never less than its floor; tests/unit/stock-count-screens
 * adds them up against the 984px box at a 1280px window.
 */
export const EDITOR_FIXED_WIDTHS = [104, 116, 116, 116, COLUMN.ACTION] as const;
export const READONLY_FIXED_WIDTHS = [104, 116, 116, 116] as const;
export const NAME_FLOOR = COLUMN.TEXT_MIN;

const PAGE_SIZE = 50;
const MAX_LISTED_PROBLEMS = 20;

type EditorLine = StockCountLineInput & { key: string };

export interface CountDetail {
  id: string;
  countNumber: string;
  asOf: string;
  status: string;
  memo: string | null;
  journalEntryId: string | null;
  journalEntryNumber: string | null;
  approvalRequestId: string | null;
  postedByName: string | null;
  postedAt: string | null;
  /** Figures frozen at posting (or at the request); null while a draft. */
  countedMinor: number | null;
  bookMinor: number | null;
}

export interface DetailProps {
  count: CountDetail;
  lines: StockCountLineInput[];
  /** The books on the count's as-of date, read when the page was drawn. */
  liveBookMinor: number;
  posting: PostingContext;
  companyName: string;
  currencyCode: string;
  decimals: number;
  canWrite: boolean;
  /** The company time zone, in which stamps are shown. */
  timeZone: string;
}

let keySeed = 0;
/** A row key that no other row, on this page or after a delete, ever shares. */
const withKey = (l: StockCountLineInput): EditorLine => ({ ...l, key: `l${keySeed++}` });

const blankLine = (): StockCountLineInput => ({ name: "", sku: null, quantity: 0, unitCostMinor: 0, sellsForMinor: null });

export default function StockCountDetailClient(props: DetailProps) {
  const locked = props.count.status !== "draft";
  return locked ? <LockedCount {...props} /> : <DraftCount {...props} />;
}

// ---------------------------------------------------------------------------
// A draft: edit, paste, save, adjust
// ---------------------------------------------------------------------------

function DraftCount({ count, lines, liveBookMinor, posting, currencyCode, decimals, canWrite }: DetailProps) {
  const { message, modal } = App.useApp();
  const [asOf, setAsOf] = useState(count.asOf);
  const [memo, setMemo] = useState(count.memo ?? "");
  const [rows, setRows] = useState<EditorLine[]>(() => lines.map(withKey));
  const [saved, setSaved] = useState(() => ({ asOf: count.asOf, memo: count.memo, lines }));
  const [book, setBook] = useState(liveBookMinor);
  const [bookBusy, setBookBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState<CountProblem[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [page, setPage] = useState(1);
  const [pasteText, setPasteText] = useState("");
  const [pasteNote, setPasteNote] = useState<{ summary: string; problems: PasteProblem[] } | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const latestBook = useRef(0);

  const money = useCallback((minor: number) => formatMoney(minor, currencyCode, decimals), [currencyCode, decimals]);
  const current = useMemo(() => ({ asOf, memo: memo.trim() === "" ? null : memo, lines: rows }), [asOf, memo, rows]);
  const dirty = isDirty(saved, current);
  useUnsavedGuard(dirty, modal);

  const counted = countedTotalMinor(rows);
  const difference = countDifferenceMinor(counted, book);
  const button = adjustButtonState({
    canAdjust: posting.canAdjust && canWrite,
    tracksItems: posting.tracksItems,
    dirty,
    differenceMinor: difference,
  });

  const patch = (key: string, change: Partial<StockCountLineInput>) =>
    setRows((all) => all.map((r) => (r.key === key ? { ...r, ...change } : r)));
  const remove = (key: string) => setRows((all) => all.filter((r) => r.key !== key));

  function addLine() {
    setRows((all) => [...all, withKey(blankLine())]);
    // The new line is on the last page.
    setPage(Math.ceil((rows.length + 1) / pageSize));
  }

  async function changeDate(date: dayjs.Dayjs | null) {
    if (!date) return;
    const next = date.format("YYYY-MM-DD");
    setAsOf(next);
    const run = ++latestBook.current;
    setBookBusy(true);
    try {
      const res = await bookValueAction(next);
      if (run !== latestBook.current) return;
      if (res.ok && res.data) setBook(res.data.bookMinor);
      else message.error(res.error ?? "The books could not be read for that date");
    } catch {
      if (run === latestBook.current) message.error("The books could not be read for that date");
    } finally {
      if (run === latestBook.current) setBookBusy(false);
    }
  }

  function readPaste() {
    const result = parseCountSheet(pasteText, decimals);
    const added = result.lines.map(withKey);
    if (added.length > 0) {
      setRows((all) => appendCountLines(all, added));
      setPage(Math.ceil((rows.length + added.length) / pageSize));
    }
    setPasteNote({ summary: pasteSummary(result), problems: result.problems });
    // What could not be read stays in the box, to be corrected and read again.
    setPasteText(result.problems.map((p) => p.text).join("\n"));
  }

  async function save() {
    const draft = {
      asOf,
      memo: memo.trim() === "" ? null : memo.trim(),
      lines: rows.map((l) => ({
        name: l.name.trim(),
        sku: l.sku?.trim() ? l.sku.trim() : null,
        quantity: l.quantity,
        unitCostMinor: l.unitCostMinor,
        sellsForMinor: l.sellsForMinor,
      })),
    };
    const found = validateStockCount(draft);
    setProblems(found);
    setSaveError(null);
    if (found.length > 0) return;
    setSaving(true);
    try {
      const res = await saveStockCountAction({ id: count.id, ...draft });
      if (res.ok) {
        setSaved({ asOf: draft.asOf, memo: draft.memo, lines: draft.lines });
        setRows((all) => all.map((r, i) => ({ ...r, name: draft.lines[i].name, sku: draft.lines[i].sku })));
        message.success("Draft saved");
      } else {
        setSaveError(res.error ?? "The draft could not be saved");
      }
    } catch {
      setSaveError("The draft could not be saved. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const amountProps = { controls: false, min: 0, className: styles.amount } as const;
  const base = (i: number) => (page - 1) * pageSize + i + 1;
  const pager = reportPagination(false, pageSize, setPageSize, PAGE_SIZE);

  return (
    <div>
      <div className={styles.controls}>
        <label className={styles.field}>
          As of
          <DatePicker
            aria-label="As of"
            value={dayjs(asOf)}
            allowClear={false}
            onChange={(d) => void changeDate(d)}
            disabled={saving}
          />
        </label>
        <label className={`${styles.field} ${styles.memo}`}>
          Memo
          <Input
            aria-label="Memo"
            value={memo}
            maxLength={500}
            placeholder="What this count covers"
            onChange={(e) => setMemo(e.target.value)}
          />
        </label>
        <Button type="primary" loading={saving} disabled={!dirty} onClick={() => void save()}>
          Save draft
        </Button>
      </div>

      {saveError ? <Alert className={styles.notice} type="error" showIcon title={saveError} /> : null}
      {problems.length > 0 ? (
        <Alert
          className={styles.notice}
          type="error"
          showIcon
          title="The count cannot be saved yet"
          description={
            <ul className={styles.problems}>
              {problems.slice(0, MAX_LISTED_PROBLEMS).map((p) => (
                <li key={`${p.lineNumber ?? "sheet"}-${p.reason}`}>
                  {p.lineNumber === null ? p.reason : `Line ${p.lineNumber}: ${p.reason}`}
                </li>
              ))}
              {problems.length > MAX_LISTED_PROBLEMS ? <li>and {problems.length - MAX_LISTED_PROBLEMS} more</li> : null}
            </ul>
          }
        />
      ) : null}

      <StatRow
        items={[
          { label: "Lines", value: rows.length.toLocaleString("en-US") },
          { label: "Counted at cost", value: money(counted) },
          { label: "On the books", value: bookBusy ? "Reading…" : money(book) },
          { label: "Difference", value: signedAmountText(difference, money), danger: differenceTone(difference) === "shortage" },
        ]}
      />

      <ReportTable<EditorLine>
        rowKey="key"
        dataSource={rows}
        pagination={pager && { ...pager, current: page, onChange: (p, s) => { setPage(p); setPageSize(s); } }}
        emptyTitle="No lines yet"
        emptyDescription="Add a line, or paste a count sheet below."
        columns={[
          flexColumn<EditorLine>({
            title: "Name",
            key: "name",
            floor: NAME_FLOOR,
            render: (_: unknown, row, index) => (
              <div className={styles.nameCell}>
                <Input
                  size="small"
                  aria-label={`Name, line ${base(index)}`}
                  value={row.name}
                  maxLength={200}
                  placeholder="Name"
                  onChange={(e) => patch(row.key, { name: e.target.value })}
                />
                <Input
                  size="small"
                  className={styles.sku}
                  aria-label={`SKU, line ${base(index)}`}
                  value={row.sku ?? ""}
                  maxLength={100}
                  placeholder="SKU"
                  onChange={(e) => patch(row.key, { sku: e.target.value })}
                />
              </div>
            ),
          }),
          {
            title: "Counted",
            key: "quantity",
            width: EDITOR_FIXED_WIDTHS[0],
            align: "right",
            render: (_: unknown, row, index) => (
              <InputNumber
                {...amountProps}
                size="small"
                aria-label={`Counted, line ${base(index)}`}
                value={row.quantity}
                onChange={(v) => patch(row.key, { quantity: roundQuantity(v) })}
              />
            ),
          },
          {
            title: "Cost each",
            key: "cost",
            width: EDITOR_FIXED_WIDTHS[1],
            align: "right",
            render: (_: unknown, row, index) => (
              <InputNumber
                {...amountProps}
                size="small"
                precision={decimals}
                aria-label={`Cost each, line ${base(index)}`}
                value={fromMinor(row.unitCostMinor, decimals)}
                onChange={(v) => patch(row.key, { unitCostMinor: toMinor(Number(v ?? 0), decimals) })}
              />
            ),
          },
          {
            title: "Value",
            key: "value",
            width: EDITOR_FIXED_WIDTHS[2],
            align: "right",
            render: (_: unknown, row) => (
              <span className={styles.value}>{money(lineValueMinor(row.quantity, row.unitCostMinor))}</span>
            ),
          },
          {
            title: "Sells for",
            key: "sells",
            width: EDITOR_FIXED_WIDTHS[3],
            align: "right",
            render: (_: unknown, row, index) => (
              <InputNumber
                {...amountProps}
                size="small"
                precision={decimals}
                aria-label={`Sells for, line ${base(index)}`}
                value={row.sellsForMinor === null ? null : fromMinor(row.sellsForMinor, decimals)}
                onChange={(v) => patch(row.key, { sellsForMinor: v === null ? null : toMinor(Number(v), decimals) })}
              />
            ),
          },
          {
            title: "",
            key: "delete",
            width: EDITOR_FIXED_WIDTHS[4],
            align: "center",
            render: (_: unknown, row, index) => (
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
                aria-label={`Delete line ${base(index)}`}
                onClick={() => remove(row.key)}
              />
            ),
          },
        ]}
        summary={() => (
          <SummaryRow>
            <SummaryCell index={0} colSpan={3} align="right">
              <strong>Counted at cost</strong>
            </SummaryCell>
            <SummaryCell index={1} align="right">
              <strong className={styles.value}>{money(counted)}</strong>
            </SummaryCell>
            <SummaryCell index={2} colSpan={2} />
          </SummaryRow>
        )}
      />

      <div style={{ marginTop: 12 }}>
        <Button icon={<PlusOutlined />} onClick={addLine}>
          Add a line
        </Button>
      </div>

      <section className={styles.paste} aria-label="Paste a count sheet">
        <h3 className={styles.pasteTitle}>Paste a count sheet</h3>
        <p className={styles.hint}>{PASTE_HINT}</p>
        <Input.TextArea
          aria-label="Count sheet"
          rows={5}
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder={"Gold chain 18in, 4, 120.00, 240.00\nSilver ring, 12, 18.50"}
        />
        <div className={styles.pasteActions}>
          <Button onClick={readPaste} disabled={pasteText.trim() === ""}>
            Read it
          </Button>
          {pasteNote && pasteNote.problems.length === 0 ? (
            <span className={styles.reason} role="status">
              {pasteNote.summary}
            </span>
          ) : null}
        </div>
        {pasteNote && pasteNote.problems.length > 0 ? (
          <Alert
            style={{ marginTop: 8 }}
            type="warning"
            showIcon
            title={pasteNote.summary}
            description={
              <>
                <ul className={styles.problems}>
                  {pasteNote.problems.slice(0, MAX_LISTED_PROBLEMS).map((p) => (
                    <li key={p.lineNumber}>{pasteProblemText(p)}</li>
                  ))}
                  {pasteNote.problems.length > MAX_LISTED_PROBLEMS ? (
                    <li>and {pasteNote.problems.length - MAX_LISTED_PROBLEMS} more</li>
                  ) : null}
                </ul>
                The box now holds only the lines that could not be read; correct them and read again.
              </>
            }
          />
        ) : null}
      </section>

      {button.visible ? (
        <div className={styles.adjust}>
          <Button type="primary" disabled={button.disabled} onClick={() => setDialogOpen(true)}>
            {adjustButtonLabel(difference, asOf, money)}
          </Button>
          {button.reason ? <span className={styles.reason}>{button.reason}</span> : null}
          {posting.tracksItems ? <Link href="/items">{"Products & Services"}</Link> : null}
        </div>
      ) : null}

      <ReportFoot>{FOOTNOTE}</ReportFoot>

      {dialogOpen ? (
        <PostCountDialog
          open
          onClose={() => setDialogOpen(false)}
          countId={count.id}
          asOf={asOf}
          countedMinor={counted}
          bookMinor={book}
          differenceMinor={difference}
          posting={posting}
          money={money}
        />
      ) : null}
    </div>
  );
}

function roundQuantity(value: number | string | null): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  const scale = 10 ** QUANTITY_DECIMALS;
  return Math.round(n * scale) / scale;
}

// ---------------------------------------------------------------------------
// A posted count, or one waiting for approval: read-only, printable
// ---------------------------------------------------------------------------

function LockedCount({ count, lines, liveBookMinor, companyName, currencyCode, decimals, timeZone }: DetailProps) {
  const [printing, setPrinting] = useState(false);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const money = useCallback((minor: number) => formatMoney(minor, currencyCode, decimals), [currencyCode, decimals]);

  useEffect(() => {
    const stop = watchReportPrinting();
    // Synchronous on purpose: the browser takes its print snapshot right after
    // beforeprint, so every line must be on the page by the time it returns.
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
      stop();
    };
  }, []);

  const posted = count.status === "posted";
  const counted = count.countedMinor ?? countedTotalMinor(lines);
  const book = count.bookMinor ?? liveBookMinor;
  const difference = countDifferenceMinor(counted, book);

  const sheet = useMemo(
    () =>
      stockCountSheet({
        companyName,
        currencyCode,
        decimals,
        countNumber: count.countNumber,
        asOf: count.asOf,
        status: count.status,
        memo: count.memo,
        lines,
        bookMinor: book,
      }),
    [companyName, currencyCode, decimals, count, lines, book],
  );

  const rows = useMemo(() => lines.map((l, i) => ({ ...l, key: String(i) })), [lines]);

  return (
    <div>
      {posted ? (
        <Alert
          className={styles.lockedBar}
          type="success"
          showIcon
          title={
            <>
              Posted{count.postedByName ? ` by ${count.postedByName}` : ""}
              {count.postedAt ? ` on ${dateInTimeZone(count.postedAt, timeZone)}` : ""}.{" "}
              {count.journalEntryId ? (
                <Link href={`/journal?entry=${count.journalEntryId}`}>
                  {count.journalEntryNumber ? `Open ${count.journalEntryNumber}` : "Open the entry"}
                </Link>
              ) : null}
            </>
          }
        />
      ) : (
        <Alert
          className={styles.lockedBar}
          type="info"
          showIcon
          title={
            <>
              Waiting for approval. It posts when a second person approves it, against the books as they stand then.{" "}
              {count.approvalRequestId ? (
                <Link href={`/approvals?focus=${count.approvalRequestId}`}>Open Approvals</Link>
              ) : (
                <Link href="/approvals">Open Approvals</Link>
              )}
            </>
          }
        />
      )}

      <FilterBar
        ariaLabel="Stock count exports"
        actions={
          <Space wrap>
            <Button onClick={() => downloadTextFile(`${sheet.fileName}.csv`, csvFromExportSheet(sheet))}>CSV</Button>
            <ReportExportButtons sheet={sheet} />
            <Button icon={<PrinterOutlined />} onClick={printReport}>
              Print
            </Button>
          </Space>
        }
      />

      <div className="report-print-area">
        <ReportPaper
          companyName={companyName}
          title="Stock Count"
          range={`${count.countNumber} · As of ${count.asOf} · ${stockCountStatusLabel(count.status)}`}
          basis={count.memo?.trim() ? count.memo.trim() : "Periodic count"}
          currencyCode={currencyCode}
        >
          <StatRow
            items={[
              { label: "Lines", value: lines.length.toLocaleString("en-US") },
              { label: "Counted at cost", value: money(counted) },
              { label: "On the books", value: money(book) },
              { label: posted ? "Adjusted by" : "Difference", value: signedAmountText(difference, money), danger: differenceTone(difference) === "shortage" },
            ]}
          />
          <ReportTable<(typeof rows)[number]>
            rowKey="key"
            dataSource={rows}
            pagination={reportPagination(printing, pageSize, setPageSize, PAGE_SIZE)}
            emptyTitle="No lines"
            columns={[
              flexColumn<(typeof rows)[number]>({
                title: "Name",
                key: "name",
                floor: NAME_FLOOR,
                render: (_: unknown, row) => (
                  <>
                    <span title={row.name}>{row.name}</span>
                    {row.sku ? secondaryLine(row.sku) : null}
                  </>
                ),
              }),
              {
                title: "Counted",
                dataIndex: "quantity",
                width: READONLY_FIXED_WIDTHS[0],
                align: "right",
                render: (q: number) => q.toLocaleString("en-US", { maximumFractionDigits: QUANTITY_DECIMALS }),
              },
              {
                title: "Cost each",
                dataIndex: "unitCostMinor",
                width: READONLY_FIXED_WIDTHS[1],
                align: "right",
                render: (m: number) => money(m),
              },
              {
                title: "Value",
                key: "value",
                width: READONLY_FIXED_WIDTHS[2],
                align: "right",
                render: (_: unknown, row) => money(lineValueMinor(row.quantity, row.unitCostMinor)),
              },
              {
                title: "Sells for",
                dataIndex: "sellsForMinor",
                width: READONLY_FIXED_WIDTHS[3],
                align: "right",
                render: (m: number | null) => (m === null ? "—" : money(m)),
              },
            ]}
            summary={() => (
              <SummaryRow>
                <SummaryCell index={0} colSpan={3} align="right">
                  <strong>Counted at cost</strong>
                </SummaryCell>
                <SummaryCell index={1} align="right">
                  <strong>{money(counted)}</strong>
                </SummaryCell>
                <SummaryCell index={2} />
              </SummaryRow>
            )}
          />
          <ReportFoot>{FOOTNOTE}</ReportFoot>
        </ReportPaper>
      </div>
    </div>
  );
}
```

- [ ] **Step 11: Create `ctyhp-accounting/app/(app)/inventory/stock-count/page.tsx`** with exactly this content:

```tsx
import PageHeader from "@/components/PageHeader";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import { canWrite, getUserRole } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/db/server";
import { listActors } from "@/lib/services/access";
import { reportPageContext } from "@/lib/services/report-context";
import { listStockCountSummaries } from "@/lib/services/stock-count";
import NewCountButton from "./NewCountButton";
import StockCountListClient, { type CountListRow } from "./StockCountListClient";

export const dynamic = "force-dynamic";

export default async function StockCountPage() {
  const sb = await createSupabaseServerClient();
  const [ctx, role, counts, actors] = await Promise.all([
    reportPageContext(sb),
    getUserRole(),
    listStockCountSummaries(sb),
    listActors(sb).catch(() => []),
  ]);
  const names = new Map(actors.map((a) => [a.id, a.full_name?.trim() || a.email]));
  const rows: CountListRow[] = counts.map((c) => ({
    ...c,
    postedByName: c.posted_by ? (names.get(c.posted_by) ?? null) : null,
  }));
  const writer = canWrite(role);
  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={ctx.companyName} isSample={ctx.isSample} />}
        title="Stock Count"
        description="What stock is on hand and what it is carried at."
        actions={writer ? <NewCountButton today={ctx.today} /> : undefined}
      />
      <StockCountListClient
        rows={rows}
        currencyCode={ctx.currencyCode}
        decimals={ctx.decimals}
        today={ctx.today}
        canWrite={writer}
      />
    </div>
  );
}
```

- [ ] **Step 12: Create `ctyhp-accounting/app/(app)/inventory/stock-count/[id]/page.tsx`** with exactly this content:

```tsx
import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import ReportEntityBadge from "@/components/reports/ReportEntityBadge";
import { canWrite, getUserRole } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/db/server";
import { listActors } from "@/lib/services/access";
import { reportPageContext } from "@/lib/services/report-context";
import { getBookValue, getEntryNumber, getPostingContext, getStockCount } from "@/lib/services/stock-count";
import StockCountDetailClient from "../StockCountDetailClient";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function StockCountDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const sb = await createSupabaseServerClient();
  const found = await getStockCount(sb, id);
  if (!found) notFound();
  const { count, lines } = found;
  const [ctx, role, posting, liveBookMinor, actors, entryNumber] = await Promise.all([
    reportPageContext(sb),
    getUserRole(),
    getPostingContext(sb),
    getBookValue(sb, count.as_of),
    listActors(sb).catch(() => []),
    count.journal_entry_id ? getEntryNumber(sb, count.journal_entry_id) : Promise.resolve(null),
  ]);
  const postedBy = count.posted_by ? actors.find((a) => a.id === count.posted_by) : undefined;

  return (
    <div>
      <PageHeader
        meta={<ReportEntityBadge companyName={ctx.companyName} isSample={ctx.isSample} />}
        title={`Stock Count ${count.count_number}`}
        description="What stock is on hand and what it is carried at."
        breadcrumbItems={[{ title: "Stock Count", href: "/inventory/stock-count" }, { title: count.count_number }]}
      />
      <StockCountDetailClient
        count={{
          id: count.id,
          countNumber: count.count_number,
          asOf: count.as_of,
          status: count.status,
          memo: count.memo,
          journalEntryId: count.journal_entry_id,
          journalEntryNumber: entryNumber,
          approvalRequestId: count.approval_request_id,
          postedByName: postedBy ? postedBy.full_name?.trim() || postedBy.email : null,
          postedAt: count.posted_at,
          countedMinor: count.counted_minor,
          bookMinor: count.book_minor,
        }}
        lines={lines.map((l) => ({
          name: l.name,
          sku: l.sku,
          quantity: l.quantity,
          unitCostMinor: l.unit_cost_minor,
          sellsForMinor: l.sells_for_minor,
        }))}
        liveBookMinor={liveBookMinor}
        posting={posting}
        companyName={ctx.companyName}
        currencyCode={ctx.currencyCode}
        decimals={ctx.decimals}
        canWrite={canWrite(role)}
        timeZone={ctx.timeZone}
      />
    </div>
  );
}
```

- [ ] **Step 13: Edit `ctyhp-accounting/lib/domain/navigation.ts`** — apply this 1 find/replace edit (its find string occurs exactly once):

Edit 1 of 1 — find:

```ts
      { key: "/inventory", label: "Overview" },
      { key: "/fixed-assets", label: "Fixed Assets" },
```

replace with:

```ts
      { key: "/inventory", label: "Overview" },
      { key: "/inventory/stock-count", label: "Stock Count" },
      { key: "/fixed-assets", label: "Fixed Assets" },
```

- [ ] **Step 14: Edit `ctyhp-accounting/lib/domain/report-catalog.ts`** — apply this 1 find/replace edit (its find string occurs exactly once):

Edit 1 of 1 — find:

```ts
  {
    id: "sales-tax-liability",
```

replace with:

```ts
  {
    id: "stock-count",
    title: "Stock Count",
    description: "What stock is on hand and what it is carried at.",
    href: "/inventory/stock-count",
    group: "inventory-tax",
  },
  {
    id: "sales-tax-liability",
```

- [ ] **Step 15: Edit `ctyhp-accounting/components/reports/ReportsHub.tsx`** — apply this 1 find/replace edit (its find string occurs exactly once):

Edit 1 of 1 — find:

```tsx
  "inventory-valuation": <ShopOutlined />,
  "sales-tax": <PercentageOutlined />,
```

replace with:

```tsx
  "inventory-valuation": <ShopOutlined />,
  "stock-count": <InboxOutlined />,
  "sales-tax": <PercentageOutlined />,
```

- [ ] **Step 16: Run the gates**

Run from `ctyhp-accounting/` and read the pass/fail lines in full (never pipe through `tail`/`head`):

```bash
npx tsc --noEmit -p .
npx eslint "tests/unit/stock-count-screens.test.ts" "tests/unit/navigation.test.ts" "tests/unit/reports-wave1-catalog.test.ts" "lib/client/use-unsaved-guard.ts" "app/(app)/inventory/stock-count/NewCountButton.tsx" "app/(app)/inventory/stock-count/PostCountDialog.tsx" "app/(app)/inventory/stock-count/StockCountListClient.tsx" "app/(app)/inventory/stock-count/StockCountDetailClient.tsx" "app/(app)/inventory/stock-count/page.tsx" "app/(app)/inventory/stock-count/[id]/page.tsx" "lib/domain/navigation.ts" "lib/domain/report-catalog.ts" "components/reports/ReportsHub.tsx"
npx vitest run tests/unit/stock-count-screens.test.ts tests/unit/navigation.test.ts tests/unit/reports-wave1-catalog.test.ts tests/unit/report-catalog.test.ts tests/unit/table-adoption.test.ts tests/unit/table-fit-contract.test.ts tests/unit/rsc-antd.test.ts tests/unit/report-frame-contract.test.ts
```

Expected: tsc exits 0 with no output; eslint reports 0 errors and 0 warnings for these files; stock-count-screens + navigation + reports-wave1-catalog: 71 tests passing; report-catalog, table-adoption, table-fit-contract, rsc-antd and report-frame-contract pass.

- [ ] **Step 17: Commit**

```bash
git add "ctyhp-accounting/tests/unit/stock-count-screens.test.ts" "ctyhp-accounting/tests/unit/navigation.test.ts" "ctyhp-accounting/tests/unit/reports-wave1-catalog.test.ts" "ctyhp-accounting/lib/client/use-unsaved-guard.ts" "ctyhp-accounting/app/(app)/inventory/stock-count/stock-count.module.css" "ctyhp-accounting/app/(app)/inventory/stock-count/NewCountButton.tsx" "ctyhp-accounting/app/(app)/inventory/stock-count/PostCountDialog.tsx" "ctyhp-accounting/app/(app)/inventory/stock-count/StockCountListClient.tsx" "ctyhp-accounting/app/(app)/inventory/stock-count/StockCountDetailClient.tsx" "ctyhp-accounting/app/(app)/inventory/stock-count/page.tsx" "ctyhp-accounting/app/(app)/inventory/stock-count/[id]/page.tsx" "ctyhp-accounting/lib/domain/navigation.ts" "ctyhp-accounting/lib/domain/report-catalog.ts" "ctyhp-accounting/components/reports/ReportsHub.tsx"
git commit -m "feat(inventory): Stock Count screens, sidebar and Report Center"
```

Stage by file name only (never `git add -A` / `git add .`). No Co-Authored-By trailer; no mention of Claude or AI in the message.

---

### Task 4: Release 1.96, the Guide flow and the live check

**Files:**
- Modify: `ctyhp-accounting/lib/domain/changelog.ts`
- Modify: `ctyhp-accounting/lib/domain/system-guide.ts`
- Test (create): `ctyhp-accounting/tests/live/stock-count.live.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–3; `getBookValue`, `getPostingContext`, `listStockCounts` for the live check.
- Produces: release 1.96 above 1.95 (date 2026-10-10 — if main has moved past 1.95 by the time this merges, the controller renumbers it to the next free number); the Guide flow `count-stock`; `tests/live/stock-count.live.ts` (3 read-only checks looping every company: book value equals the inventory accounts' ledger, the default accounts resolve, the counts list reads). The controller runs the live check in Task 5 — do not run it here.

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
    version: "1.96",
    date: "2026-10-10",
    headline: "Stock Count: count what is on the shelves and correct the books to it in one entry.",
    changes: [
      {
        kind: "added",
        title: "Stock Count",
        detail:
          "In the sidebar under Inventory & Assets, and as a card in the Report Center. New count starts a count dated today and copies the previous count’s lines, so a recount begins from the last sheet. Type the lines in, or use Paste a count sheet: one line each, name, quantity and cost, and Sells for if you like. A line that cannot be read stays in the box with its line number so you can correct it and read it again. Save draft keeps the count without touching the books.",
        route: "/inventory/stock-count",
      },
      {
        kind: "added",
        title: "Counted at cost, On the books and Difference",
        detail:
          "Each count shows three figures: Counted at cost, what the sheet comes to; On the books, what the inventory accounts hold on the count date; and the Difference between them. Change the As of date and On the books is read again for that day.",
        route: "/inventory/stock-count",
      },
      {
        kind: "added",
        title: "Adjust inventory by …",
        detail:
          "When there is a difference, Adjust inventory by … opens a dialog with the three figures, the Inventory account and the Offset account, and the entry it will post. It writes one adjusting entry against an Inventory Adjustment or write-down cost-of-sales account, and the figures are frozen on the count; a posted count is read-only and links to its entry. Posting follows the inventory-adjustment approval policy: above the limit the count is Sent for approval and posts when a second person approves it, against the books as they stand then. Companies that track items adjust item by item instead, on Products & Services. A count that agrees with the books cannot be posted.",
        route: "/approvals",
      },
      {
        kind: "changed",
        title: "Purchases and Inventory counts these entries as count adjustments",
        detail:
          "An entry posted from a Stock Count appears in the Count adjustment column of the report, not under Bought net of returns.",
        route: "/reports/purchases-inventory",
      },
    ],
  },
  {
```

- [ ] **Step 2: Edit `ctyhp-accounting/lib/domain/system-guide.ts`** — apply this 1 find/replace edit (its find string occurs exactly once):

Edit 1 of 1 — find:

```ts
          "month fails, the others are kept and the notice names the month and the reason; Save tries the rest.",
      },
```

replace with:

```ts
          "month fails, the others are kept and the notice names the month and the reason; Save tries the rest.",
      },
    ],
  },
  {
    id: "count-stock",
    title: "Count stock",
    purpose: "Count what is on the shelves and correct the inventory on the books to it.",
    route: "/inventory/stock-count",
    steps: [
      {
        action: "Start a count",
        control: "New count",
        route: "/inventory/stock-count",
        note:
          "Dated today, with the previous count’s lines copied in. If a count is still open, it opens that one instead.",
      },
      {
        action: "Put the counted lines in",
        control: "Paste a count sheet",
        note:
          "One line each: name, quantity, cost, and Sells for if you like. Press Read it to add them; a line that cannot " +
          "be read stays in the box with its line number. Add a line types one in by hand.",
      },
      {
        action: "Keep the count",
        control: "Save draft",
        note:
          "Nothing reaches the books. Counted at cost, On the books and Difference show the result; change the As of " +
          "date and On the books is read again for it.",
      },
      {
        action: "Correct the books to the count",
        control: "Adjust inventory by …",
        note:
          "Needs permission to adjust inventory, and a saved count with a difference. Choose the Inventory account and " +
          "the Offset account (a cost-of-sales account), check the entry shown, then press Post the adjustment. Above the " +
          "inventory-adjustment approval limit it is Sent for approval and posts when a second person approves it on " +
          "Approvals. Companies that track items adjust item by item instead.",
      },
```

- [ ] **Step 3: Create `ctyhp-accounting/tests/live/stock-count.live.ts`** with exactly this content:

```ts
/**
 * Stock Count, checked against every company's books — read-only.
 *
 * For every company the smoke user belongs to: the book value the screen shows
 * equals the inventory accounts' ledger balance; the default accounts resolve
 * to a cost-of-sales offset and one of the inventory accounts; the counts list
 * reads. Counts and agree/disagree are logged; names and amounts never are.
 * Nothing is written: every call is a select or a read-only RPC.
 *
 * Needs migration 0139 live (acc_stock_count_default_accounts).
 *
 * Run (never part of npm test):
 *   node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts tests/live/stock-count.live.ts --silent=false --reporter=verbose
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { smokeSession } from "../../scripts/smoke-environment.mjs";
import { getCurrentCompanySettings } from "@/lib/services/company";
import { todayInTimeZone } from "@/lib/services/dashboard";
import { getLedgerBalances } from "@/lib/services/reports";
import { getBookValue, listStockCounts } from "@/lib/services/stock-count";

interface Company {
  name: string;
  sb: SupabaseClient;
  today: string;
}

const companies: Company[] = [];

beforeAll(async () => {
  const s = await smokeSession();
  if (!s.session) throw new Error("The smoke sign-in returned no session.");
  const auth = { persistSession: false };
  const headers = { Authorization: `Bearer ${s.session.access_token}` };
  const control = createClient(s.supabaseUrl, s.anonKey, { db: { schema: "onebook" }, auth, global: { headers } });
  const { data, error } = await control.rpc("my_companies");
  if (error) throw new Error(`my_companies: ${error.message}`);
  for (const row of (data ?? []) as { legal_name: string; schema_name: string }[]) {
    const sb = createClient(s.supabaseUrl, s.anonKey, {
      db: { schema: row.schema_name },
      auth,
      global: { headers },
    }) as unknown as SupabaseClient;
    const settings = await getCurrentCompanySettings(sb);
    companies.push({ name: row.schema_name, sb, today: todayInTimeZone(settings?.time_zone ?? "UTC") });
  }
  if (companies.length === 0) throw new Error("The smoke user belongs to no company.");
});

/** The ids acc_inventory_account_ids() returns, whether PostgREST wraps each scalar or not. */
async function inventoryIds(sb: SupabaseClient): Promise<string[]> {
  const { data, error } = await sb.rpc("acc_inventory_account_ids");
  if (error) throw new Error(`acc_inventory_account_ids: ${error.message}`);
  return ((data ?? []) as unknown[]).map((row) =>
    typeof row === "string" ? row : String(Object.values(row as Record<string, unknown>)[0]),
  );
}

describe("Stock Count on every company's books", () => {
  it("the book value equals the inventory accounts' ledger balance", async () => {
    for (const c of companies) {
      const [ids, balances, book] = await Promise.all([
        inventoryIds(c.sb),
        getLedgerBalances(c.sb, null, c.today),
        getBookValue(c.sb, c.today),
      ]);
      const inventory = new Set(ids);
      let ledger = 0;
      for (const b of balances) if (inventory.has(b.accountId)) ledger += b.debitBase - b.creditBase;
      console.log(`${c.name}: ${ids.length} inventory accounts, book value ${book === ledger ? "agrees" : "DISAGREES"}`);
      expect(book, c.name).toBe(ledger);
    }
  });

  it("the default inventory and offset accounts resolve", async () => {
    for (const c of companies) {
      const [ids, defaults, accounts] = await Promise.all([
        inventoryIds(c.sb),
        c.sb.rpc("acc_stock_count_default_accounts"),
        c.sb.from("acc_account").select("id,account_type").limit(5000),
      ]);
      expect(defaults.error, c.name).toBeNull();
      expect(accounts.error, c.name).toBeNull();
      const row = (Array.isArray(defaults.data) ? defaults.data[0] : defaults.data) as
        | { inventory_account_id?: string | null; offset_account_id?: string | null }
        | null
        | undefined;
      const inventoryId = row?.inventory_account_id ?? null;
      const offsetId = row?.offset_account_id ?? null;
      const type = new Map(((accounts.data ?? []) as { id: string; account_type: string }[]).map((a) => [a.id, a.account_type]));
      const inventoryOk = inventoryId !== null && ids.includes(inventoryId);
      const offsetOk = offsetId !== null && type.get(offsetId) === "cost_of_goods_sold";
      console.log(`${c.name}: default inventory ${inventoryOk ? "resolves" : "DOES NOT resolve"}, offset ${offsetOk ? "resolves" : "DOES NOT resolve"}`);
      expect(inventoryOk, `${c.name} inventory account`).toBe(true);
      expect(offsetOk, `${c.name} offset account`).toBe(true);
    }
  });

  it("the counts list reads", async () => {
    for (const c of companies) {
      const counts = await listStockCounts(c.sb);
      console.log(`${c.name}: ${counts.length} counts`);
      expect(Array.isArray(counts), c.name).toBe(true);
    }
  });
});
```

- [ ] **Step 4: Run the gates**

Run from `ctyhp-accounting/` and read the pass/fail lines in full (never pipe through `tail`/`head`):

```bash
npx tsc --noEmit -p .
npx eslint "lib/domain/changelog.ts" "lib/domain/system-guide.ts" "tests/live/stock-count.live.ts"
npx vitest run tests/unit/changelog.test.ts tests/unit/system-guide.test.ts
```

Expected: tsc exits 0 with no output; eslint reports 0 errors and 0 warnings for these files; changelog + system-guide: 38 tests passing.

- [ ] **Step 5: Commit**

```bash
git add "ctyhp-accounting/lib/domain/changelog.ts" "ctyhp-accounting/lib/domain/system-guide.ts" "ctyhp-accounting/tests/live/stock-count.live.ts"
git commit -m "feat(inventory): release 1.96 and the Guide's stock count flow"
```

Stage by file name only (never `git add -A` / `git add .`). No Co-Authored-By trailer; no mention of Claude or AI in the message.

---

### Task 5: Controller — whole-branch gates, verification, live check, smoke on the sample company, approval

**Files:** none changed by this task (scratch scripts live outside the repo).

**Interfaces:**
- Consumes: the whole branch.

- [ ] **Step 1: The branch equals the pre-build.** `git diff prebuild/stock-count HEAD -- ctyhp-accounting` is empty (the plan reproduces the verified code byte for byte). Every commit has no Co-Authored-By trailer and no mention of Claude or AI.
- [ ] **Step 2: Whole-suite gates.** `npm run typecheck`, `npm run lint`, `npx vitest run`, `npm run build`, `npm run quality:budget`. Expected: tsc 0; lint 0 errors; every test file passes (two known load-sensitive timeouts — `chart-templates` and `quality-query-timing` — must pass when rerun alone); build compiles; 11/11 within budget.
- [ ] **Step 3: Verification against the live database, alone.** `npm run verify:stock-count`: 168/168, everything inside rolled-back transactions. Then `npm run verify:company-provisioning`: 17/17. Nothing else runs against the database meanwhile, and both keep their transactions short.
- [ ] **Step 4: Live check** (`tests/live/stock-count.live.ts`, alone, read-only): 3/3 on six companies.
- [ ] **Step 5: Smoke and screenshots on PC-Test** with the pre-build smoke script against `next start` on a free port: the list and count pages open with no console error; pasting reads good lines and reports a bad one by number; Save draft; the Adjust button names the difference and the date; the dialog shows the entry; posting reports the entry number (writes on PC-Test only); the posted count is read-only and prints every line; a new count copies the previous lines and agrees with the books; Purchases and Inventory shows the count adjustment; the sidebar leaf and the Report Center card (40). PC-Test already holds SC-000001 (posted as JE-000100) and SC-000002 (an open draft) from the pre-build smoke, so New count opens SC-000002 rather than starting a new one; adapt the script to continue from that draft. Staff emails blurred in every screenshot (screen and print).
- [ ] **Step 6: Approval page** of the screenshots (light and dark) for the user. Nothing is pushed before the user approves.
- [ ] **Step 7: After approval** — scan the whole diff for real client data and secrets (separate command, read before pushing), check main has not moved (renumber the release up if it has), push the branch; the user opens the PR; then CI and a read-only production check.
