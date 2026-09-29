# Chart of Accounts: Retail & Jewelry Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New companies can start from a Retail & Jewelry chart of accounts; every company's Chart of Accounts screen reads by section as a parent/sub-account tree; OneBook gains a non-current liability type, an explicit contra flag, and a rule that a sub-account has its parent's type — without changing any existing account or figure.

**Architecture:** Migration 0125 adds the enum value, the `is_contra` column (backfilled for the two system contra accounts), the Undeposited Funds detail type, a parent-type trigger, and the template choice on company requests. Pure modules hold the template (`lib/domain/chart-templates.ts`) and the section rules (`lib/domain/account-sections.ts`); provisioning applies the template inside its own transaction (Postgres 17.6 allows a new enum value there because the type is created in the same transaction — verified 2026-09-29).

**Tech Stack:** Next.js 16, React 19, TypeScript, Ant Design 6, Supabase Postgres 17.6, Vitest, `pg` for verify scripts.

**Spec:** `docs/superpowers/specs/2026-09-29-coa-retail-jewelry-template-design.md`.

## Global Constraints

- Existing companies' accounts are not changed: no amount, code, name, parent or type of an existing account changes. The migration only adds metadata (a new type, `is_contra` backfilled for 1590 and 1190, detail type `undeposited_funds` on 1210).
- System account codes keep their numbers: 1000, 1010, 1100, 1190, 1200, 1210, 1500, 1590, 2000, 2100, 2110, 2150, 3000, 3900, 4000, 4100, 5000, 5090, 6000, 6800, 6900, 7000, 7010, 7500, 7990, 8990. The template may rename them, set parent / contra / detail / cash-flow role, never their type.
- Nothing is written to live data without the user's approval; the migration apply (Task 9) is the one live write and is asked for before it runs. Verify scripts run in transactions that are always rolled back.
- Migration 0125 must be applied to every company before this branch is merged (the Chart of Accounts reads `is_contra`).
- US English UI. No hex colour in any source file, comments included (`tests/unit/no-hardcoded-color.test.ts`). No Ant Design `<Table` in new files (`tests/unit/table-adoption.test.ts`). A `page.tsx` never reads an Ant Design sub-component.
- Modules imported by `scripts/*.mjs` through `lib/services/company-provisioning.ts` use relative imports with the `.ts` extension, and `import type` for anything used only as a type (Node strips types; `@/` aliases do not resolve there).
- Write any file containing a backslash (SQL regexes) with the Write/Edit tool, never a shell heredoc.
- Commits: stage files by name, one-line subject, **no Co-Authored-By trailer**, message written with Bash `printf '%s\n' "<subject>" > "$SCRATCH/msg.txt"` and `git commit -F "$SCRATCH/msg.txt"` (`$SCRATCH` = the scratchpad directory named in your dispatch; PowerShell writes a BOM — never use it for messages).
- Run commands from `ctyhp-accounting/`. Focused tests: `npx vitest run tests/unit/<file>.test.ts`.

---

### Task 1: Migration 0125, its static test, and a rolled-back live check

**Files:**
- Create: `ctyhp-accounting/supabase/migrations/0125_chart_of_accounts_structure.sql`
- Create: `ctyhp-accounting/tests/unit/coa-structure-migration.test.ts`
- Create: `ctyhp-accounting/scripts/verify-coa-structure.mjs`

**Interfaces:**
- Produces (database): enum value `long_term_liability` on `acc_account_type` (after `current_liability`); column `acc_account.is_contra boolean not null default false`; trigger `acc_account_parent_type_trg` raising `A sub-account must have the same type as its parent`; column `onebook.company_request.chart_template` (`'standard' | 'retail_jewelry'`, default `'standard'`); function `onebook.request_company(p_slug text, p_legal_name text, p_is_sample boolean default false, p_display_order int default 100, p_chart_template text default 'standard') returns uuid`.

- [ ] **Step 1: Write the static test**

`ctyhp-accounting/tests/unit/coa-structure-migration.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run tests/unit/coa-structure-migration.test.ts`
Expected: FAIL — `ENOENT … 0125_chart_of_accounts_structure.sql`.

- [ ] **Step 3: Write the migration**

`ctyhp-accounting/supabase/migrations/0125_chart_of_accounts_structure.sql` (write it with the Write tool — it contains backslashes):

```sql
-- ============================================================================
-- 0125 — The chart of accounts: non-current liabilities, contra accounts,
-- sub-accounts that share their parent's type, and the chart a new company
-- starts from.
--
-- Metadata only. No amount, code, name, parent or type of an existing account
-- changes: the type added is new, the contra flag and the Undeposited Funds
-- detail type are filled in for system accounts only, and the parent-type rule
-- is checked only when a parent or a type is written.
-- ============================================================================

-- 1. Non-current liabilities. Nothing in this file uses the new value: a value
--    added to an existing enum cannot be used until its transaction commits.
--    (A company being provisioned creates the type in the same transaction,
--    and there Postgres allows it — verified on 17.6.)
alter type acc_account_type add value if not exists 'long_term_liability' after 'current_liability';

-- 2. Contra accounts, said rather than guessed from a detail type's wording.
alter table acc_account add column if not exists is_contra boolean not null default false;

update acc_account
   set is_contra = true
 where is_contra = false
   and (
     detail_type ~* '^\s*contra\M'
     or (account_code = '1190' and name ilike 'allowance%')
   );

-- 3. The system Undeposited Funds account, so the chart can show it with the
--    bank accounts. Its type stays current_asset.
update acc_account
   set detail_type = 'undeposited_funds'
 where account_code = '1210'
   and name ilike '%undeposited%'
   and detail_type is null;

-- 4. A sub-account has its parent's type. Checked when a parent or a type is
--    written, so rows written before this migration are not re-judged.
create or replace function acc_account_parent_type() returns trigger
language plpgsql as $$
begin
  if new.parent_account_id is not null and exists (
    select 1 from acc_account p
     where p.id = new.parent_account_id and p.account_type <> new.account_type
  ) then
    raise exception 'A sub-account must have the same type as its parent';
  end if;
  if tg_op = 'UPDATE' and new.account_type is distinct from old.account_type and exists (
    select 1 from acc_account c
     where c.parent_account_id = new.id and c.account_type <> new.account_type
  ) then
    raise exception 'A sub-account must have the same type as its parent';
  end if;
  return new;
end;
$$;

drop trigger if exists acc_account_parent_type_trg on acc_account;
create trigger acc_account_parent_type_trg
  before insert or update of parent_account_id, account_type on acc_account
  for each row execute function acc_account_parent_type();

-- 5. The chart a new company starts from.
alter table onebook.company_request
  add column if not exists chart_template text not null default 'standard';
alter table onebook.company_request
  drop constraint if exists company_request_chart_template_ck;
alter table onebook.company_request
  add constraint company_request_chart_template_ck
  check (chart_template in ('standard', 'retail_jewelry'));

-- A four-argument call must not be ambiguous between two signatures.
drop function if exists onebook.request_company(text, text, boolean, int);

create or replace function onebook.request_company(
  p_slug text,
  p_legal_name text,
  p_is_sample boolean default false,
  p_display_order int default 100,
  p_chart_template text default 'standard'
) returns uuid
language plpgsql security definer set search_path = onebook, public as $$
declare
  v_slug     text := lower(btrim(coalesce(p_slug, '')));
  v_name     text := btrim(coalesce(p_legal_name, ''));
  v_template text := coalesce(nullif(btrim(p_chart_template), ''), 'standard');
  v_id       uuid;
begin
  if not onebook.is_platform_admin() then
    raise exception 'Not authorized to create a company';
  end if;
  if v_slug !~ '^[a-z][a-z0-9_]{1,40}$' then
    raise exception 'A company key is lower case letters, digits and underscores';
  end if;
  if length(v_name) = 0 then raise exception 'A legal name is required'; end if;
  if v_template not in ('standard', 'retail_jewelry') then
    raise exception 'Unknown chart of accounts template %', v_template;
  end if;
  if exists (select 1 from onebook.company where slug = v_slug) then
    raise exception 'A company already uses the key %', v_slug;
  end if;
  -- A second click while the first is still building must not queue a twin.
  if exists (
    select 1 from onebook.company_request
     where slug = v_slug and status in ('pending', 'running')
  ) then
    raise exception 'A company with the key % is already being created', v_slug;
  end if;

  insert into onebook.company_request (slug, legal_name, is_sample, display_order, requested_by, chart_template)
  values (v_slug, v_name, coalesce(p_is_sample, false), coalesce(p_display_order, 100), auth.uid(), v_template)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function onebook.request_company(text, text, boolean, int, text) from public, anon;
grant execute on function onebook.request_company(text, text, boolean, int, text)
  to authenticated, service_role;
```

- [ ] **Step 4: Run the static test and the migration gates**

Run: `npx vitest run tests/unit/coa-structure-migration.test.ts tests/unit/migration-grants.test.ts tests/unit/schema-template.test.ts tests/unit/company-provisioning-migration.test.ts`
Expected: PASS. (`schema-template` must still classify the `onebook.` statements as global so provisioning skips them.)

- [ ] **Step 5: The rolled-back live check**

`ctyhp-accounting/scripts/verify-coa-structure.mjs`:

```js
/**
 * Behavioural verification of migration 0125 on every company's books.
 *
 * Each company runs inside its own transaction that is ALWAYS rolled back.
 * When 0125 has not been applied yet it is applied first, inside that same
 * transaction — so this proves the migration against the real books before it
 * is applied for real, and leaves nothing behind either way.
 *
 * Run: node --env-file=.env.local scripts/verify-coa-structure.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0125_chart_of_accounts_structure.sql";
const MIGRATION = readFileSync(new URL(`../supabase/migrations/${FILE}`, import.meta.url), "utf8");

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const killer = setTimeout(() => {
  console.error("HARD TIMEOUT");
  process.exit(2);
}, 5 * 60 * 1000);
await client.connect();

let passed = 0;
let failed = 0;
function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const FINGERPRINT = `
  select md5(coalesce(string_agg(
    account_code || '|' || name || '|' || account_type::text || '|' || coalesce(parent_account_id::text, ''),
    E'\\n' order by account_code), '')) as f
    from acc_account`;

async function refused(sql, params) {
  await client.query("savepoint probe");
  try {
    await client.query(sql, params);
    await client.query("release savepoint probe");
    return null;
  } catch (error) {
    await client.query("rollback to savepoint probe");
    return error.message;
  }
}

const { rows: companies } = await client.query(
  `select schema_name from onebook.company where status = 'active' order by display_order, schema_name`,
);

try {
  for (const { schema_name: schema } of companies) {
    console.log(`\n${schema}`);
    await client.query("begin");
    try {
      // Applying 0125 here takes a lock on the live acc_account: give up fast
      // rather than queue the app's reads behind a lock we are waiting for.
      await client.query("set local lock_timeout = '5s'");
      await client.query(`set local search_path = ${schema}, extensions`);
      const applied =
        (await client.query(`select 1 from acc_schema_migrations where filename = $1`, [FILE])).rowCount > 0;
      const before = (await client.query(FINGERPRINT)).rows[0].f;
      if (!applied) {
        const statements = schema === "public" ? [MIGRATION] : planCompanySchema([{ file: FILE, sql: MIGRATION }], schema).statements;
        for (const statement of statements) await client.query(statement);
        console.log("  (0125 applied inside the transaction, never committed)");
      }
      check("no account's code, name, type or parent changed", (await client.query(FINGERPRINT)).rows[0].f === before);

      const expectedContra = (
        await client.query(
          `select account_code from acc_account
            where detail_type ~* '^\\s*contra\\M' or (account_code = '1190' and name ilike 'allowance%')
            order by account_code`,
        )
      ).rows.map((r) => r.account_code);
      const flagged = (await client.query(`select account_code from acc_account where is_contra order by account_code`)).rows.map(
        (r) => r.account_code,
      );
      check(
        "the system contra accounts are flagged",
        expectedContra.every((c) => flagged.includes(c)),
        `expected ${expectedContra.join(",")} flagged ${flagged.join(",")}`,
      );
      if (!applied) {
        check("nothing else is flagged contra", flagged.length === expectedContra.length, flagged.join(","));
      }

      const undeposited = (
        await client.query(`select detail_type from acc_account where account_code = '1210' and name ilike '%undeposited%'`)
      ).rows[0];
      if (undeposited) check("Undeposited Funds carries its detail type", undeposited.detail_type === "undeposited_funds");

      const enumHas = (
        await client.query(
          `select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
            where t.typname = 'acc_account_type' and t.typnamespace = $1::regnamespace and e.enumlabel = 'long_term_liability'`,
          [schema],
        )
      ).rowCount > 0;
      check("the account type long_term_liability exists", enumHas);

      const income = (await client.query(`select id from acc_account where account_type = 'income' order by account_code limit 1`)).rows[0];
      const expense = (await client.query(`select id from acc_account where account_type = 'expense' order by account_code limit 1`)).rows[0];
      if (income && expense) {
        const message = await refused(`update acc_account set parent_account_id = $1 where id = $2`, [income.id, expense.id]);
        check("a parent of another type is refused", /same type as its parent/.test(message ?? ""), message ?? "accepted");
      }

      await client.query(
        `insert into acc_account (account_code, name, account_type, currency_code, is_posting_account)
         values ('ZZ-VERIFY-P', 'Verify parent', 'expense', 'USD', true),
                ('ZZ-VERIFY-C', 'Verify child', 'expense', 'USD', true)`,
      );
      const sameType = await refused(
        `update acc_account set parent_account_id = (select id from acc_account where account_code = 'ZZ-VERIFY-P')
          where account_code = 'ZZ-VERIFY-C'`,
      );
      check("a parent of the same type is accepted", sameType === null, sameType ?? "");
      const retype = await refused(`update acc_account set account_type = 'income' where account_code = 'ZZ-VERIFY-P'`);
      check("a parent cannot change type under a child of the old type", /same type as its parent/.test(retype ?? ""), retype ?? "accepted");

      if (applied) {
        const longTerm = await refused(
          `insert into acc_account (account_code, name, account_type, currency_code, is_posting_account)
           values ('ZZ-VERIFY-LT', 'Verify long-term loan', 'long_term_liability', 'USD', true)`,
        );
        check("a long-term liability account can be created", longTerm === null, longTerm ?? "");
      } else {
        console.log("  (creating a long_term_liability account waits until 0125 is committed)");
      }
    } finally {
      await client.query("rollback");
    }
  }
} finally {
  await client.end();
  clearTimeout(killer);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
```

- [ ] **Step 6: Run it against the live books (rolled back)**

Run: `timeout 400 node --env-file=.env.local scripts/verify-coa-structure.mjs`
Expected: every check `ok` for every company, ending `N passed, 0 failed`, and the line "(0125 applied inside the transaction, never committed)" per company. If a check fails, stop and report the output — do not edit the check to pass.

- [ ] **Step 7: Commit**

```bash
git add -- supabase/migrations/0125_chart_of_accounts_structure.sql tests/unit/coa-structure-migration.test.ts scripts/verify-coa-structure.mjs
printf '%s\n' "feat(accounts): migration 0125 — non-current liabilities, contra flag, parent-type rule, chart template on requests" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

---

### Task 2: The non-current liability type through the domain

**Files:**
- Modify: `ctyhp-accounting/lib/domain/accounts.ts` (ACCOUNT_TYPES, ACCOUNT_TYPE_LABEL)
- Modify: `ctyhp-accounting/lib/domain/reports.ts` (`buildBalanceSheet` liabilities)
- Modify: `ctyhp-accounting/lib/domain/statement.ts` (liabilities block)
- Modify: `ctyhp-accounting/lib/domain/cashflow.ts` (`defaultCashFlowRole`)
- Modify: `ctyhp-accounting/lib/domain/beancount.ts` (`ACCOUNT_PREFIX`)
- Modify: `ctyhp-accounting/lib/domain/import-mapping.ts` (rule at the "long ?term liabilit" pattern; the "thirteen" comments)
- Modify: `ctyhp-accounting/tests/live/statement-parity.live.ts` (liability groups add up)
- Test: `ctyhp-accounting/tests/unit/long-term-liability.test.ts` (create)

**Interfaces:**
- Produces: `AccountType` includes `"long_term_liability"` (label "Long-term Liability", credit-normal, balance sheet, default cash-flow role `financing`, Beancount root `Liabilities:LongTerm`). Balance Sheet statement row keys `liabilities:long` (classhead) and `liabilities:long:total` (subtotal), present only when the sheet has a long-term liability line.

- [ ] **Step 1: Write the failing tests**

`ctyhp-accounting/tests/unit/long-term-liability.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABEL, normalBalanceOf, statementSectionOf, type AccountType } from "@/lib/domain/accounts";
import { accountNames } from "@/lib/domain/beancount";
import { cashFlowCategoryOf, defaultCashFlowRole } from "@/lib/domain/cashflow";
import { translateAccountType } from "@/lib/domain/import-mapping";
import { buildBalanceSheet, type LedgerBalance } from "@/lib/domain/reports";
import { balanceSheetStatement, indexAccounts, type StatementColumn } from "@/lib/domain/statement";

const ACCOUNTS = indexAccounts([
  { id: "cash", code: "1000", name: "Cash", type: "bank", parentId: null },
  { id: "ap", code: "2000", name: "Accounts Payable", type: "accounts_payable", parentId: null },
  { id: "loan", code: "2500", name: "Long-Term Loans Payable", type: "long_term_liability", parentId: null },
  { id: "owner", code: "3000", name: "Owner's Capital", type: "equity", parentId: null },
]);
const bal = (id: string, debitBase: number, creditBase: number): LedgerBalance => {
  const a = ACCOUNTS.get(id)!;
  return { accountId: a.id, accountCode: a.code, name: a.name, accountType: a.type, debitBase, creditBase };
};
const COLUMN: StatementColumn = { key: "current", label: "Jun 30, 2026", sub: "", from: null, to: "2026-06-30", isTotal: false };
const sheet = (rows: LedgerBalance[]) =>
  balanceSheetStatement({
    columns: [COLUMN],
    sheets: [buildBalanceSheet(rows)],
    priorEarnings: [0],
    fiscalYearStarts: ["2026-01-01"],
    accounts: ACCOUNTS,
    change: false,
  });
const amount = (s: ReturnType<typeof sheet>, key: string) => s.rows.find((r) => r.key === key)?.cells[0].amount;

describe("the non-current liability type", () => {
  it("sits after current liabilities, is credit-normal and on the balance sheet", () => {
    expect(ACCOUNT_TYPES.indexOf("long_term_liability")).toBe(ACCOUNT_TYPES.indexOf("current_liability") + 1);
    expect(ACCOUNT_TYPE_LABEL.long_term_liability).toBe("Long-term Liability");
    expect(normalBalanceOf("long_term_liability")).toBe("credit");
    expect(statementSectionOf("long_term_liability")).toBe("balance_sheet");
  });

  it("is financing on the cash flow statement and Liabilities:LongTerm in Beancount", () => {
    expect(defaultCashFlowRole("long_term_liability")).toBe("financing");
    expect(cashFlowCategoryOf("long_term_liability")).toBe("financing");
    const names = accountNames([{ id: "loan", code: "2500", name: "Long-Term Loans Payable", type: "long_term_liability" as AccountType }]);
    expect(names.get("loan")).toMatch(/^Liabilities:LongTerm:/);
  });

  it("is what an import's long-term liabilities become", () => {
    expect(translateAccountType("Long Term Liabilities")).toBe("long_term_liability");
    expect(translateAccountType("Notes Payable")).toBe("long_term_liability");
    expect(translateAccountType("Other Current Liabilities")).toBe("current_liability");
  });

  it("counts in total liabilities and gets its own group on the balance sheet", () => {
    const rows = [bal("cash", 1_500_000, 0), bal("ap", 0, 200_000), bal("loan", 0, 1_000_000), bal("owner", 0, 300_000)];
    const built = buildBalanceSheet(rows);
    expect(built.totalLiabilities).toBe(1_200_000);
    expect(built.balanced).toBe(true);
    const s = sheet(rows);
    expect(amount(s, "liabilities:current:total")).toBe(200_000);
    expect(s.rows.find((r) => r.key === "liabilities:long")?.kind).toBe("classhead");
    expect(amount(s, "liabilities:long:total")).toBe(1_000_000);
    expect(amount(s, "liabilities:total")).toBe(1_200_000);
  });

  it("shows no long-term group when there is nothing long-term", () => {
    const s = sheet([bal("cash", 200_000, 0), bal("ap", 0, 200_000)]);
    expect(s.rows.some((r) => r.key === "liabilities:long")).toBe(false);
    expect(amount(s, "liabilities:current:total")).toBe(200_000);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/unit/long-term-liability.test.ts`
Expected: FAIL (type errors / assertions on `long_term_liability`).

- [ ] **Step 3: Add the type**

In `lib/domain/accounts.ts`, in `ACCOUNT_TYPES`, insert `"long_term_liability",` on the line after `"current_liability",`; in `ACCOUNT_TYPE_LABEL`, insert `long_term_liability: "Long-term Liability",` after `current_liability: "Current Liability",`. (`DEBIT_NORMAL` and `PROFIT_AND_LOSS` do not change: the type is credit-normal and on the balance sheet.)

In `lib/domain/reports.ts`, in `buildBalanceSheet`, the liabilities `section(...)` type list becomes:

```ts
  const liabilities = section("liabilities", "Liabilities", rows, [
    "accounts_payable",
    "credit_card",
    "current_liability",
    "long_term_liability",
  ]);
```

In `lib/domain/cashflow.ts`, in `defaultCashFlowRole`, add the case beside equity and credit card:

```ts
    case "equity":
    case "credit_card":
    case "long_term_liability":
      return "financing";
```

and in `cashFlowCategoryOf`:

```ts
  if (t === "equity" || t === "credit_card" || t === "long_term_liability") return "financing";
```

In `lib/domain/beancount.ts`, in `ACCOUNT_PREFIX`, after `current_liability: "Liabilities:Current",` add `long_term_liability: "Liabilities:LongTerm",`.

In `lib/domain/import-mapping.ts`, change the rule

```ts
  { pattern: /long ?term liabilit|non-?current liabilit|loan payable|notes payable/i, type: "current_liability" },
```

to

```ts
  { pattern: /long ?term liabilit|non-?current liabilit|loan payable|notes payable/i, type: "long_term_liability" },
```

and in the two doc comments that say One Book has "thirteen account types" / "One Book's thirteen account types" write "fourteen". (The "thirteen decisions" in `account-type-readings.ts` and `AccountTypeReview.tsx` is about something else — leave it.)

`tests/unit/import-mapping.test.ts` pins the old reading; change

```ts
    expect(translateAccountType("Long Term Liabilities")).toBe("current_liability");
```

to

```ts
    expect(translateAccountType("Long Term Liabilities")).toBe("long_term_liability");
```

- [ ] **Step 4: Split the Balance Sheet's liabilities**

In `lib/domain/statement.ts` replace

```ts
const LIABILITY_TYPES: AccountType[] = ["accounts_payable", "credit_card", "current_liability"];
```

with

```ts
const CURRENT_LIABILITY_TYPES: AccountType[] = ["accounts_payable", "credit_card", "current_liability"];
const LONG_TERM_LIABILITY_TYPES: AccountType[] = ["long_term_liability"];
```

and replace the whole liabilities block of `balanceSheetStatement` — from the comment `// Liabilities. OneBook has no long-term liability type, so there is one group.` through the `rows.push(` of the `liabilities:total` row — with:

```ts
  // Liabilities: current, then long-term when the chart has any.
  const liabilities = leavesOf(sheets.map((s) => s.liabilities));
  const longTerm = (leaf: Leaf) => typeOf(leaf) === "long_term_liability";
  const currentLiabilities = liabilities.filter((leaf) => !longTerm(leaf));
  const longTermLiabilities = liabilities.filter(longTerm);
  rows.push(spacerRow(ctx, "s-liabilities"));
  rows.push(sectionRow(ctx, "liabilities", "Liabilities"));
  rows.push(classheadRow(ctx, "liabilities:current", "Current Liabilities"));
  renderTree(forest(currentLiabilities, ctx, ofTypes(...CURRENT_LIABILITY_TYPES)), 1, ctx, rows, "liabilities");
  rows.push(
    makeRow(ctx, {
      key: "liabilities:current:total",
      kind: "subtotal",
      label: "Total Current Liabilities",
      amounts: sumLeaves(currentLiabilities, width),
      zoomIds: idsOf(currentLiabilities),
    }),
  );
  if (longTermLiabilities.length > 0) {
    rows.push(classheadRow(ctx, "liabilities:long", "Long-term Liabilities"));
    renderTree(forest(longTermLiabilities, ctx, ofTypes(...LONG_TERM_LIABILITY_TYPES)), 1, ctx, rows, "liabilities:long");
    rows.push(
      makeRow(ctx, {
        key: "liabilities:long:total",
        kind: "subtotal",
        label: "Total Long-term Liabilities",
        amounts: sumLeaves(longTermLiabilities, width),
        zoomIds: idsOf(longTermLiabilities),
      }),
    );
  }
  rows.push(
    makeRow(ctx, { key: "liabilities:total", kind: "total", label: "Total Liabilities", amounts: sheets.map((s) => s.totalLiabilities), zoomIds: idsOf(liabilities) }),
  );
```

(`typeOf`, `Leaf`, `width`, `leavesOf`, `forest`, `renderTree`, `sumLeaves`, `idsOf`, `classheadRow`, `sectionRow`, `spacerRow`, `ofTypes` already exist in this function / file.)

- [ ] **Step 5: The live parity test also adds up the liability groups**

In `tests/live/statement-parity.live.ts`, right after the asset-groups `expect(...)` (the line ending `` `${label} asset groups`).toBe(sh.totalAssets); ``), add:

```ts
            const liabilityGroups = bs.rows.filter(
              (r) => r.key === "liabilities:current:total" || r.key === "liabilities:long:total",
            );
            expect(
              liabilityGroups.reduce((sum, r) => sum + (r.cells[i].amount ?? 0), 0),
              `${label} liability groups`,
            ).toBe(sh.totalLiabilities);
```

(Do not run the live test here; the controller runs it after the migration is applied.)

- [ ] **Step 6: Run the tests, typecheck and the report/statement suites**

Run: `npx vitest run tests/unit/long-term-liability.test.ts tests/unit/statement.test.ts tests/unit/reports.test.ts tests/unit/beancount.test.ts tests/unit/import-mapping.test.ts tests/unit/cashflow.test.ts tests/unit/account-type-readings.test.ts` then `npm run typecheck`
Expected: PASS; typecheck exits 0. If an existing test enumerates every account type with an expected table, add the `long_term_liability` entry it needs (credit-normal, balance sheet, financing) — do not weaken the test.

- [ ] **Step 7: Commit**

```bash
git add -- lib/domain/accounts.ts lib/domain/reports.ts lib/domain/statement.ts lib/domain/cashflow.ts lib/domain/beancount.ts lib/domain/import-mapping.ts tests/live/statement-parity.live.ts tests/unit/long-term-liability.test.ts tests/unit/import-mapping.test.ts
printf '%s\n' "feat(accounts): non-current liabilities, with their own group on the Balance Sheet" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

(Add any existing test file you had to extend in Step 6 to the `git add` line.)

---

### Task 3: Contra flag, current-asset detail types, and the parent-type message

**Files:**
- Create: `ctyhp-accounting/lib/domain/account-detail.ts`
- Modify: `ctyhp-accounting/lib/db/types.ts` (`AccountRow.is_contra`)
- Modify: `ctyhp-accounting/lib/domain/schemas.ts` (account schemas)
- Modify: `ctyhp-accounting/lib/services/accounts.ts` (COLUMNS, `mapWriteError`)
- Modify: `ctyhp-accounting/lib/domain/exceptions.ts` (`ExceptionAccount.isContra` replaces `detailType`; `wrongWayBalances`)
- Modify: `ctyhp-accounting/lib/services/exceptions.ts` (maps `is_contra`)
- Test: `ctyhp-accounting/tests/unit/account-detail.test.ts` (create); update `tests/unit/exceptions.test.ts`, `tests/unit/account-schema.test.ts`

**Interfaces:**
- Produces: `CURRENT_ASSET_DETAIL_TYPES = ["undeposited_funds", "transfer_clearing"] as const`; `isBankSectionDetail(detail: string | null | undefined): boolean`; `detailTypeOptions(type: AccountType): { value: string; label: string }[]`; `detailLabel(type: AccountType, detail: string | null): string | null`; `AccountRow.is_contra: boolean`; `ExceptionAccount.isContra: boolean` (its `detailType` field is removed — it existed only to guess contra); account create accepts `is_contra?: boolean` defaulting to false; an update changes only the fields it is given; a trigger refusal surfaces as `AccountServiceError("A sub-account must have the same type as its parent")`.

**A bug this task also fixes.** The project runs Zod 4, where `.partial()` still applies a field's `.default()`. `accountUpdateSchema = accountInputSchema.partial()…` therefore fills in `status: "active"` and `currency_code: "USD"` on every update that does not send them — so editing an **inactive** account's name through the Chart of Accounts form (which never sends `status`) silently reactivates it, and so does any other partial update. Verified: `z.object({ st: z.enum(["active","inactive"]).default("active") }).partial().parse({})` returns `{ st: "active" }`. The update schema is built below from fields that carry no defaults.

- [ ] **Step 1: Write the failing tests**

`ctyhp-accounting/tests/unit/account-detail.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  CURRENT_ASSET_DETAIL_TYPES,
  detailLabel,
  detailTypeOptions,
  isBankSectionDetail,
} from "@/lib/domain/account-detail";
import { accountCreateSchema, accountUpdateSchema } from "@/lib/domain/schemas";

describe("detail types", () => {
  it("offers bank kinds for a bank, the two money-in-transit kinds for a current asset, and nothing else", () => {
    expect(detailTypeOptions("bank").map((o) => o.value)).toEqual(["checking", "savings", "money_market", "cash_on_hand", "other_bank"]);
    expect(detailTypeOptions("current_asset").map((o) => o.value)).toEqual([...CURRENT_ASSET_DETAIL_TYPES]);
    expect(detailTypeOptions("expense")).toEqual([]);
  });

  it("puts undeposited funds and transfer clearing with the bank accounts", () => {
    expect(isBankSectionDetail("undeposited_funds")).toBe(true);
    expect(isBankSectionDetail("transfer_clearing")).toBe(true);
    expect(isBankSectionDetail("checking")).toBe(false);
    expect(isBankSectionDetail(null)).toBe(false);
  });

  it("reads a detail type under an account's name", () => {
    expect(detailLabel("bank", "savings")).toBe("Savings account");
    expect(detailLabel("current_asset", "undeposited_funds")).toBe("Undeposited funds");
    expect(detailLabel("fixed_asset", "Contra fixed asset")).toBe("Contra fixed asset");
    expect(detailLabel("expense", null)).toBeNull();
  });
});

describe("the contra flag on an account", () => {
  const base = { account_code: "3300", name: "Owner's Draw", account_type: "equity" as const };

  it("defaults to false when an account is created", () => {
    expect(accountCreateSchema.parse(base).is_contra).toBe(false);
    expect(accountCreateSchema.parse({ ...base, is_contra: true }).is_contra).toBe(true);
  });

  it("is left alone by an update that does not mention it", () => {
    expect("is_contra" in accountUpdateSchema.parse({ name: "Owner's Draw" })).toBe(false);
    expect(accountUpdateSchema.parse({ is_contra: true }).is_contra).toBe(true);
  });
});
```

In `tests/unit/account-schema.test.ts` (it already imports `accountUpdateSchema`), add a new block at the end of the file:

```ts
describe("accountUpdateSchema", () => {
  it("changes only what it is given — renaming an inactive account must not reactivate it", () => {
    expect(accountUpdateSchema.parse({ name: "Rent" })).toEqual({ name: "Rent" });
    expect(accountUpdateSchema.parse({ cash_flow_role: "operating" })).toEqual({ cash_flow_role: "operating" });
  });
});
```

In `tests/unit/exceptions.test.ts`:
- the `account(...)` fixture helper's `detailType: null,` becomes `isContra: false,`;
- in "does not flag a contra account, which is meant to point the other way", `detailType: "Contra fixed asset",` becomes `isContra: true,`;
- the test "still flags a detail_type like 'Contractor Fees' …" is replaced by:

```ts
  it("goes by the contra flag, not by what an account is called", () => {
    const rows = wrongWayBalances([
      account({
        accountCode: "6300",
        name: "Contra Costa Office Rent",
        accountType: "expense",
        creditBase: 1_000_00,
      }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].accountCode).toBe("6300");
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/unit/account-detail.test.ts tests/unit/exceptions.test.ts`
Expected: FAIL (`@/lib/domain/account-detail` missing; `is_contra`/`isContra` unknown).

- [ ] **Step 3: `lib/domain/account-detail.ts`**

```ts
/**
 * What an account's detail type says, for the types that have a closed list.
 *
 * A bank account says what kind of bank account it is (migration 0072). A
 * current asset may say it is money on its way to a bank — Undeposited Funds,
 * Transfer Clearing — which is why the chart shows it with the bank accounts
 * while its type stays current_asset, so Banking and reconciliation never
 * treat it as a bank. Any other type's detail type stays free text.
 */
import type { AccountType } from "./accounts";
import { BANK_DETAIL_TYPES, bankDetailLabel } from "./bank-account-detail";

export const CURRENT_ASSET_DETAIL_TYPES = ["undeposited_funds", "transfer_clearing"] as const;
export type CurrentAssetDetailType = (typeof CURRENT_ASSET_DETAIL_TYPES)[number];

const CURRENT_ASSET_LABELS: Record<CurrentAssetDetailType, string> = {
  undeposited_funds: "Undeposited funds",
  transfer_clearing: "Transfer clearing",
};

const isCurrentAssetDetail = (detail: string | null | undefined): detail is CurrentAssetDetailType =>
  (CURRENT_ASSET_DETAIL_TYPES as readonly string[]).includes(detail ?? "");

/** A current asset that belongs with the bank accounts in the chart. */
export function isBankSectionDetail(detail: string | null | undefined): boolean {
  return isCurrentAssetDetail(detail);
}

/** The choices the account form offers for a type; empty when the type has no closed list. */
export function detailTypeOptions(type: AccountType): { value: string; label: string }[] {
  if (type === "bank") return BANK_DETAIL_TYPES.map((d) => ({ value: d, label: bankDetailLabel(d) }));
  if (type === "current_asset") return CURRENT_ASSET_DETAIL_TYPES.map((d) => ({ value: d, label: CURRENT_ASSET_LABELS[d] }));
  return [];
}

/** How an account's detail type reads under its name. */
export function detailLabel(type: AccountType, detail: string | null): string | null {
  if (type === "bank") return bankDetailLabel(detail);
  if (isCurrentAssetDetail(detail)) return CURRENT_ASSET_LABELS[detail];
  return detail;
}
```

- [ ] **Step 4: The row, the schemas and the service**

In `lib/db/types.ts`, in `AccountRow`, add after `detail_type: string | null;`:

```ts
  /** Reduces another account in its section (Accumulated Depreciation, Sales Returns, Owner's Draw). */
  is_contra: boolean;
```

In `lib/domain/schemas.ts`, replace the block from `const accountInputSchema = z.object({` through the `export const accountUpdateSchema = …` line with:

```ts
/**
 * An account's fields, with no defaults. Zod 4 applies a `.default()` even
 * inside `.partial()`, so an update schema built from defaulted fields writes
 * `status: "active"` into every edit that does not mention status — renaming
 * an inactive account used to reactivate it.
 */
const accountFieldsSchema = z.object({
  account_code: z
    .string()
    .trim()
    .min(1, "Account code is required")
    .max(20, "Account code is too long")
    .regex(/^[A-Za-z0-9.\-]+$/, "Account code may only contain letters, digits, '.' and '-'"),
  name: z.string().trim().min(1, "Account name is required").max(120),
  account_type: z.enum(ACCOUNT_TYPES),
  cash_flow_role: z.enum(CASH_FLOW_ROLES).optional(),
  detail_type: z.string().trim().max(80).optional().nullable(),
  is_contra: z.boolean(),
  parent_account_id: z.uuid().optional().nullable(),
  description: z.string().trim().max(500).optional().nullable(),
  default_tax_code_id: z.uuid().optional().nullable(),
  currency_code: usdCurrencySchema,
  is_posting_account: z.boolean(),
  status: z.enum(ACCOUNT_STATUSES),
});

const accountInputSchema = accountFieldsSchema.extend({
  is_contra: z.boolean().default(false),
  currency_code: usdCurrencySchema.default(USD_CURRENCY_CODE),
  is_posting_account: z.boolean().default(true),
  status: z.enum(ACCOUNT_STATUSES).default("active"),
});

export const accountCreateSchema = accountInputSchema.transform((value) => ({
  ...value,
  cash_flow_role: value.cash_flow_role ?? defaultCashFlowRole(value.account_type),
}));

export type AccountCreateInput = z.infer<typeof accountCreateSchema>;

/** Update allows partial fields, changes only those given, and never changes the code via this path. */
export const accountUpdateSchema = accountFieldsSchema.partial().omit({ account_code: true });
```

(Keep the `export type AccountUpdateInput = z.infer<typeof accountUpdateSchema>;` line that follows. The `.regex` is the file's existing one — copy it from the file, do not retype it: it contains a backslash.)

In `lib/services/accounts.ts`, add `is_contra` to `COLUMNS` after `detail_type`:

```ts
const COLUMNS =
  "id,account_code,name,account_type,cash_flow_role,detail_type,is_contra,parent_account_id,description," +
  "default_tax_code_id,currency_code,is_posting_account,status,effective_from," +
  "effective_to,created_by,approved_by,created_at,updated_at";
```

and in `mapWriteError`, before the final `throw`, add:

```ts
  if (message.includes("same type as its parent")) {
    throw new AccountServiceError("A sub-account must have the same type as its parent");
  }
```

- [ ] **Step 5: The Exception Report reads the flag**

In `lib/domain/exceptions.ts`, `ExceptionAccount`'s `detailType` existed only so the report could guess which accounts are contra. Replace the field and its doc comment:

```ts
export interface ExceptionAccount extends LedgerBalance {
  /**
   * Said on the account (migration 0125) rather than guessed from its detail
   * type's wording: Accumulated Depreciation, Allowance for Doubtful Accounts,
   * Sales Returns, Owner's Draw.
   */
  isContra: boolean;
}
```

then delete `const CONTRA = /^\s*contra\b/i;` and in `wrongWayBalances` replace `if (CONTRA.test(a.detailType ?? "")) continue;` with `if (a.isContra) continue;`.

In `lib/services/exceptions.ts`, rename `detailByAccountId` to `accountById` (it now carries the whole row's use, not a detail type) and in the `accounts` mapping replace the `detailType: …` line with:

```ts
    isContra: accountById.get(b.accountId)?.is_contra ?? false,
```

- [ ] **Step 6: Run the tests and typecheck**

Run: `npx vitest run tests/unit/account-detail.test.ts tests/unit/exceptions.test.ts tests/unit/exceptions-service.test.ts tests/unit/account-schema.test.ts tests/unit/bank-account-detail.test.ts` then `npm run typecheck`
Expected: PASS; exit 0. (Fix any other fixture typecheck names — an `AccountRow` literal now needs `is_contra` — by adding `is_contra: false`. If an existing test asserted that an update fills in `status: "active"`, that assertion pinned the bug: change it and say so in your report.)

- [ ] **Step 7: Commit**

```bash
git add -- lib/domain/account-detail.ts lib/db/types.ts lib/domain/schemas.ts lib/services/accounts.ts lib/domain/exceptions.ts lib/services/exceptions.ts tests/unit/account-detail.test.ts tests/unit/exceptions.test.ts tests/unit/account-schema.test.ts
printf '%s\n' "feat(accounts): an account says it is contra, and a current asset can say it is money in transit" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

(Add every other test file you touched for fixtures to the `git add` line.)

---

### Task 4: Sections of the chart

**Files:**
- Create: `ctyhp-accounting/lib/domain/account-sections.ts`
- Test: `ctyhp-accounting/tests/unit/account-sections.test.ts`

**Interfaces:**
- Consumes: `isBankSectionDetail` (Task 3), `AccountType` (incl. `long_term_liability`, Task 2).
- Produces: `type AccountSectionKey = "bank" | "receivables_inventory" | "non_current_assets" | "current_liabilities" | "non_current_liabilities" | "equity" | "income" | "cogs" | "operating_expenses" | "other_expenses"`; `ACCOUNT_SECTIONS: readonly { key: AccountSectionKey; title: string }[]`; `sectionOf(account: { account_type: AccountType; detail_type: string | null }): AccountSectionKey`; `compareCodes(a: string, b: string): number`; `interface SectionAccount { id: string; account_code: string; account_type: AccountType; detail_type: string | null; parent_account_id: string | null }`; `interface AccountTreeRow<T> { account: T; depth: number }`; `interface AccountSection<T> { key: AccountSectionKey; title: string; rows: AccountTreeRow<T>[] }`; `accountSections<T extends SectionAccount>(accounts: readonly T[]): AccountSection<T>[]`; `withAncestors<T extends SectionAccount>(all: readonly T[], matches: readonly T[]): T[]`; `parentChoices<T extends SectionAccount>(accounts: readonly T[], type: AccountType | undefined, selfId: string | null): T[]`.

- [ ] **Step 1: Write the failing tests**

`ctyhp-accounting/tests/unit/account-sections.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AccountType } from "@/lib/domain/accounts";
import {
  ACCOUNT_SECTIONS,
  accountSections,
  compareCodes,
  parentChoices,
  sectionOf,
  withAncestors,
  type SectionAccount,
} from "@/lib/domain/account-sections";

const acc = (id: string, code: string, type: AccountType, parent: string | null = null, detail: string | null = null): SectionAccount => ({
  id,
  account_code: code,
  account_type: type,
  detail_type: detail,
  parent_account_id: parent,
});

describe("the sections of a chart", () => {
  it("are the client's, in order, with other expenses last", () => {
    expect(ACCOUNT_SECTIONS.map((s) => s.title)).toEqual([
      "Current Assets – Bank Accounts",
      "Current Assets – Receivables & Inventory",
      "Non-current Assets",
      "Current Liabilities",
      "Non-current Liabilities",
      "Equity",
      "Income",
      "Cost of Goods Sold",
      "Operating Expenses",
      "Other Expenses",
    ]);
  });

  it("place every type, and money in transit with the banks", () => {
    expect(sectionOf({ account_type: "bank", detail_type: null })).toBe("bank");
    expect(sectionOf({ account_type: "current_asset", detail_type: "undeposited_funds" })).toBe("bank");
    expect(sectionOf({ account_type: "current_asset", detail_type: "transfer_clearing" })).toBe("bank");
    expect(sectionOf({ account_type: "current_asset", detail_type: null })).toBe("receivables_inventory");
    expect(sectionOf({ account_type: "accounts_receivable", detail_type: null })).toBe("receivables_inventory");
    expect(sectionOf({ account_type: "fixed_asset", detail_type: null })).toBe("non_current_assets");
    expect(sectionOf({ account_type: "credit_card", detail_type: null })).toBe("current_liabilities");
    expect(sectionOf({ account_type: "long_term_liability", detail_type: null })).toBe("non_current_liabilities");
    expect(sectionOf({ account_type: "other_income", detail_type: null })).toBe("income");
    expect(sectionOf({ account_type: "other_expense", detail_type: null })).toBe("other_expenses");
  });

  it("orders codes as numbers", () => {
    expect(["1000", "400", "90", "4010"].sort(compareCodes)).toEqual(["90", "400", "1000", "4010"]);
  });

  it("nests sub-accounts under their parent, in code order, and leaves empty sections out", () => {
    const sections = accountSections([
      acc("inv", "1200", "current_asset"),
      acc("jewel", "1230", "current_asset", "inv"),
      acc("und", "1210", "current_asset", null, "undeposited_funds"),
      acc("raw", "1250", "current_asset", "inv"),
      acc("cash", "1000", "bank"),
      acc("ar", "1100", "accounts_receivable"),
    ]);
    expect(sections.map((s) => s.key)).toEqual(["bank", "receivables_inventory"]);
    expect(sections[0].rows.map((r) => [r.account.account_code, r.depth])).toEqual([
      ["1000", 0],
      ["1210", 0],
    ]);
    expect(sections[1].rows.map((r) => [r.account.account_code, r.depth])).toEqual([
      ["1100", 0],
      ["1200", 0],
      ["1230", 1],
      ["1250", 1],
    ]);
  });

  it("puts a sub-account at the top of its own section when its parent is elsewhere or missing", () => {
    const sections = accountSections([
      acc("sales", "4000", "income"),
      acc("odd", "6010", "expense", "sales"),
      acc("orphan", "6020", "expense", "gone"),
    ]);
    const opex = sections.find((s) => s.key === "operating_expenses")!;
    expect(opex.rows.map((r) => [r.account.account_code, r.depth])).toEqual([
      ["6010", 0],
      ["6020", 0],
    ]);
  });

  it("survives a loop in the chart", () => {
    const sections = accountSections([acc("a", "6100", "expense", "b"), acc("b", "6200", "expense", "a")]);
    expect(sections[0].rows.map((r) => r.account.account_code).sort()).toEqual(["6100", "6200"]);
  });
});

describe("a search result in its place", () => {
  const chart = [
    acc("opex", "6000", "expense"),
    acc("rent", "6030", "expense", "opex"),
    acc("store", "6031", "expense", "rent"),
    acc("bank", "6080", "expense", "opex"),
  ];

  it("keeps each match under its parent and grandparent, and nothing else", () => {
    const store = chart.find((a) => a.id === "store")!;
    expect(withAncestors(chart, [store]).map((a) => a.id)).toEqual(["opex", "rent", "store"]);
    const rows = accountSections(withAncestors(chart, [store]))[0].rows;
    expect(rows.map((r) => [r.account.account_code, r.depth])).toEqual([
      ["6000", 0],
      ["6030", 1],
      ["6031", 2],
    ]);
  });

  it("survives a loop and a missing parent", () => {
    const loop = [acc("a", "6100", "expense", "b"), acc("b", "6200", "expense", "a"), acc("c", "6300", "expense", "gone")];
    expect(withAncestors(loop, [loop[0]]).map((a) => a.id)).toEqual(["a", "b"]);
    expect(withAncestors(loop, [loop[2]]).map((a) => a.id)).toEqual(["c"]);
  });
});

describe("the parents an account may have", () => {
  const chart = [
    acc("inv", "1200", "current_asset"),
    acc("jewel", "1230", "current_asset", "inv"),
    acc("ap", "2000", "accounts_payable"),
  ];

  it("are accounts of its own type, never itself", () => {
    expect(parentChoices(chart, "current_asset", "jewel").map((a) => a.id)).toEqual(["inv"]);
    expect(parentChoices(chart, "current_asset", null).map((a) => a.id)).toEqual(["inv", "jewel"]);
    expect(parentChoices(chart, "accounts_payable", null).map((a) => a.id)).toEqual(["ap"]);
  });

  it("are every other account until a type is chosen", () => {
    expect(parentChoices(chart, undefined, "ap").map((a) => a.id)).toEqual(["inv", "jewel"]);
  });
});

describe("account-sections module", () => {
  it("imports nothing that could write to the books", () => {
    expect(readFileSync("lib/domain/account-sections.ts", "utf8")).not.toMatch(/@\/lib\/(db|services)\//);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/unit/account-sections.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

`ctyhp-accounting/lib/domain/account-sections.ts`:

```ts
/**
 * The chart of accounts read by section: the headings the client's retail and
 * jewelry chart is organised under, for every company, derived from each
 * account's type (and, for money in transit, its detail type) — so a chart
 * numbered any way still reads in the same order.
 *
 * Pure: accounts in, sections of nested rows out.
 */
import type { AccountType } from "./accounts";
import { isBankSectionDetail } from "./account-detail";

export type AccountSectionKey =
  | "bank"
  | "receivables_inventory"
  | "non_current_assets"
  | "current_liabilities"
  | "non_current_liabilities"
  | "equity"
  | "income"
  | "cogs"
  | "operating_expenses"
  | "other_expenses";

export const ACCOUNT_SECTIONS: readonly { key: AccountSectionKey; title: string }[] = [
  { key: "bank", title: "Current Assets – Bank Accounts" },
  { key: "receivables_inventory", title: "Current Assets – Receivables & Inventory" },
  { key: "non_current_assets", title: "Non-current Assets" },
  { key: "current_liabilities", title: "Current Liabilities" },
  { key: "non_current_liabilities", title: "Non-current Liabilities" },
  { key: "equity", title: "Equity" },
  { key: "income", title: "Income" },
  { key: "cogs", title: "Cost of Goods Sold" },
  { key: "operating_expenses", title: "Operating Expenses" },
  { key: "other_expenses", title: "Other Expenses" },
];

export function sectionOf(account: { account_type: AccountType; detail_type: string | null }): AccountSectionKey {
  switch (account.account_type) {
    case "bank":
      return "bank";
    case "current_asset":
      return isBankSectionDetail(account.detail_type) ? "bank" : "receivables_inventory";
    case "accounts_receivable":
      return "receivables_inventory";
    case "fixed_asset":
      return "non_current_assets";
    case "accounts_payable":
    case "credit_card":
    case "current_liability":
      return "current_liabilities";
    case "long_term_liability":
      return "non_current_liabilities";
    case "equity":
      return "equity";
    case "income":
    case "other_income":
      return "income";
    case "cost_of_goods_sold":
      return "cogs";
    case "expense":
      return "operating_expenses";
    case "other_expense":
      return "other_expenses";
  }
}

/** Account codes in number order: 90, 400, 1000 — not 1000, 400, 90. */
export function compareCodes(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true });
}

export interface SectionAccount {
  id: string;
  account_code: string;
  account_type: AccountType;
  detail_type: string | null;
  parent_account_id: string | null;
}

export interface AccountTreeRow<T> {
  account: T;
  /** 0 for a top-level account; each sub-account level adds one. */
  depth: number;
}

export interface AccountSection<T> {
  key: AccountSectionKey;
  title: string;
  rows: AccountTreeRow<T>[];
}

function treeRows<T extends SectionAccount>(members: readonly T[]): AccountTreeRow<T>[] {
  const ids = new Set(members.map((m) => m.id));
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const m of members) {
    const parent = m.parent_account_id;
    if (parent && parent !== m.id && ids.has(parent)) {
      const list = children.get(parent) ?? [];
      list.push(m);
      children.set(parent, list);
    } else {
      roots.push(m);
    }
  }
  const out: AccountTreeRow<T>[] = [];
  const seen = new Set<string>();
  const walk = (list: readonly T[], depth: number) => {
    for (const a of [...list].sort((x, y) => compareCodes(x.account_code, y.account_code))) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      out.push({ account: a, depth });
      walk(children.get(a.id) ?? [], depth + 1);
    }
  };
  walk(roots, 0);
  // Accounts caught in a loop are reached from no root: list them at the top.
  walk(members.filter((m) => !seen.has(m.id)), 0);
  return out;
}

/** The sections that have accounts, in order, each as a tree in code order. */
export function accountSections<T extends SectionAccount>(accounts: readonly T[]): AccountSection<T>[] {
  const bySection = new Map<AccountSectionKey, T[]>();
  for (const a of accounts) {
    const key = sectionOf(a);
    const list = bySection.get(key) ?? [];
    list.push(a);
    bySection.set(key, list);
  }
  return ACCOUNT_SECTIONS.flatMap(({ key, title }) => {
    const members = bySection.get(key);
    return members && members.length > 0 ? [{ key, title, rows: treeRows(members) }] : [];
  });
}

/**
 * The accounts a search found, with the parents above them, so each match
 * reads in its place in the tree rather than stranded at the top of its section.
 */
export function withAncestors<T extends SectionAccount>(all: readonly T[], matches: readonly T[]): T[] {
  const byId = new Map(all.map((a) => [a.id, a]));
  const keep = new Set(matches.map((m) => m.id));
  for (const m of matches) {
    let parentId = m.parent_account_id;
    // Stops at a parent already kept, which is also what ends a loop.
    while (parentId && !keep.has(parentId)) {
      const parent = byId.get(parentId);
      if (!parent) break;
      keep.add(parent.id);
      parentId = parent.parent_account_id;
    }
  }
  return all.filter((a) => keep.has(a.id));
}

/**
 * The accounts that may be the parent of an account of `type`: a sub-account
 * has its parent's type (migration 0125 refuses anything else), and an account
 * is never its own parent.
 */
export function parentChoices<T extends SectionAccount>(
  accounts: readonly T[],
  type: AccountType | undefined,
  selfId: string | null,
): T[] {
  return accounts.filter((a) => a.id !== selfId && (type === undefined || a.account_type === type));
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/unit/account-sections.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add -- lib/domain/account-sections.ts tests/unit/account-sections.test.ts
printf '%s\n' "feat(accounts): the chart read by section, sub-accounts under their parent in number order" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

---

### Task 5: The Retail & Jewelry template

**Files:**
- Create: `ctyhp-accounting/lib/domain/chart-templates.ts`
- Test: `ctyhp-accounting/tests/unit/chart-templates.test.ts`

**Interfaces:**
- Consumes (types only): `AccountType`, `CashFlowRole`, `AccountSectionKey`.
- Produces: `CHART_TEMPLATE_KEYS = ["standard", "retail_jewelry"] as const`; `type ChartTemplateKey`; `interface TemplateAccount { code: string; name: string; type: AccountType; section: AccountSectionKey; parent?: string; detailType?: string; contra?: boolean; cashFlowRole?: CashFlowRole; system?: boolean }`; `interface ChartTemplate { key: ChartTemplateKey; label: string; description: string; accounts: readonly TemplateAccount[] }`; `CHART_TEMPLATES: Record<ChartTemplateKey, ChartTemplate>`; `interface TemplateStatement { sql: string; params: unknown[] }`; `chartTemplateStatements(key: ChartTemplateKey): TemplateStatement[]`.

- [ ] **Step 1: Write the failing tests**

`ctyhp-accounting/tests/unit/chart-templates.test.ts`:

```ts
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sectionOf } from "@/lib/domain/account-sections";
import { BANK_DETAIL_TYPES } from "@/lib/domain/bank-account-detail";
import { CHART_TEMPLATES, chartTemplateStatements } from "@/lib/domain/chart-templates";

const retail = CHART_TEMPLATES.retail_jewelry.accounts;
const byCode = new Map(retail.map((a) => [a.code, a]));

/**
 * Every account a migration seeds, with its type: `('1210', 'Undeposited Funds', 'current_asset'`.
 * A name may carry a doubled quote (`'Owner''s Equity'`). On 2026-09-29 this finds exactly the
 * 26 system codes the template marks `system: true`.
 */
function seeded(): Map<string, string> {
  const dir = join(process.cwd(), "supabase/migrations");
  const out = new Map<string, string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
    for (const m of readFileSync(join(dir, file), "utf8").matchAll(/'(\d{4})',\s*'(?:[^']|'')+',\s*'([a-z_]+)'/g)) {
      out.set(m[1], m[2]);
    }
  }
  return out;
}

describe("the Retail & Jewelry template", () => {
  it("has the 84 accounts of the approved table, each code once", () => {
    expect(retail.length).toBe(84);
    expect(byCode.size).toBe(84);
  });

  it("keeps every system account at its seeded code and type, and puts nothing else on a seeded code", () => {
    const seeds = seeded();
    expect(retail.filter((a) => a.system).length).toBe(26);
    for (const a of retail) {
      if (a.system) expect(seeds.get(a.code), a.code).toBe(a.type);
      else expect(seeds.has(a.code), a.code).toBe(false);
    }
  });

  it("gives every sub-account a parent in the template of the same type", () => {
    for (const a of retail.filter((r) => r.parent)) {
      expect(byCode.get(a.parent!)?.type, a.code).toBe(a.type);
    }
  });

  it("files each account in the section the client asked for", () => {
    for (const a of retail) {
      expect(sectionOf({ account_type: a.type, detail_type: a.detailType ?? null }), a.code).toBe(a.section);
    }
  });

  it("marks exactly the contra accounts", () => {
    expect(retail.filter((a) => a.contra).map((a) => a.code)).toEqual(["1190", "1590", "3300", "4900", "4910"]);
  });

  it("gives bank accounts a bank detail type", () => {
    for (const a of retail.filter((r) => r.type === "bank")) {
      expect((BANK_DETAIL_TYPES as readonly string[]).includes(a.detailType ?? ""), a.code).toBe(true);
    }
  });

  it("files the non-current liabilities as long-term", () => {
    expect(["2500", "2600", "2700", "2990"].map((c) => byCode.get(c)?.type)).toEqual(Array(4).fill("long_term_liability"));
  });
});

describe("chartTemplateStatements", () => {
  it("does nothing for the standard chart", () => {
    expect(chartTemplateStatements("standard")).toEqual([]);
  });

  it("upserts every account by code, then sets every parent by code", () => {
    const statements = chartTemplateStatements("retail_jewelry");
    const upserts = statements.filter((s) => /insert into acc_account/i.test(s.sql));
    const parents = statements.filter((s) => /set parent_account_id/i.test(s.sql));
    expect(upserts.length).toBe(84);
    expect(parents.length).toBe(retail.filter((a) => a.parent).length);
    expect(upserts[0].sql).toMatch(/on conflict \(account_code\) do update/i);
    expect(statements.indexOf(parents[0])).toBeGreaterThan(statements.indexOf(upserts[upserts.length - 1]));
  });

  it("never changes an existing account's type", () => {
    const upsert = chartTemplateStatements("retail_jewelry")[0].sql;
    const update = upsert.slice(upsert.search(/do update/i));
    expect(update).not.toMatch(/account_type\s*=/i);
  });

  it("imports nothing that could write to the books, and only types from other modules", () => {
    const src = readFileSync("lib/domain/chart-templates.ts", "utf8");
    expect(src).not.toMatch(/@\/lib\/(db|services)\//);
    expect(src).not.toMatch(/^import (?!type )/m);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/unit/chart-templates.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

`ctyhp-accounting/lib/domain/chart-templates.ts`:

```ts
/**
 * The charts a new company can start from.
 *
 * Standard is the chart the migrations seed — every company has always had
 * it. Retail & Jewelry is the client's chart for retail and jewelry businesses
 * (spec 2026-09-29): every bank account in one section, inventory by kind,
 * sub-accounts under their parent, and every system account kept at the code
 * the software looks it up by. Applied inside the provisioning transaction, to
 * a company that has no postings yet.
 *
 * Pure data and SQL text. Imported by scripts/*.mjs through
 * lib/services/company-provisioning.ts, so it imports only types.
 */
import type { AccountType } from "./accounts.ts";
import type { AccountSectionKey } from "./account-sections.ts";
import type { CashFlowRole } from "./cashflow.ts";

export const CHART_TEMPLATE_KEYS = ["standard", "retail_jewelry"] as const;
export type ChartTemplateKey = (typeof CHART_TEMPLATE_KEYS)[number];

export interface TemplateAccount {
  code: string;
  name: string;
  type: AccountType;
  section: AccountSectionKey;
  /** The parent's code, when this is a sub-account. */
  parent?: string;
  detailType?: string;
  contra?: boolean;
  /** Left as the migration set it when absent. */
  cashFlowRole?: CashFlowRole;
  /** Seeded by the migrations and looked up by its code: renamed at most, never retyped. */
  system?: boolean;
}

export interface ChartTemplate {
  key: ChartTemplateKey;
  label: string;
  description: string;
  accounts: readonly TemplateAccount[];
}

type Extra = Omit<TemplateAccount, "code" | "name" | "type" | "section">;
const at =
  (section: AccountSectionKey) =>
  (code: string, name: string, type: AccountType, extra: Extra = {}): TemplateAccount => ({ code, name, type, section, ...extra });

const bank = at("bank");
const recv = at("receivables_inventory");
const nca = at("non_current_assets");
const cl = at("current_liabilities");
const ncl = at("non_current_liabilities");
const eq = at("equity");
const inc = at("income");
const cogs = at("cogs");
const opex = at("operating_expenses");
const oexp = at("other_expenses");

const RETAIL_JEWELRY: readonly TemplateAccount[] = [
  // Current Assets – Bank Accounts
  bank("1000", "Cash on Hand", "bank", { system: true, detailType: "cash_on_hand", cashFlowRole: "cash" }),
  bank("1010", "Bank – Operating Account", "bank", { system: true, detailType: "checking", cashFlowRole: "cash" }),
  bank("1020", "Bank – Checking", "bank", { detailType: "checking", cashFlowRole: "cash" }),
  bank("1030", "Bank – Savings", "bank", { detailType: "savings", cashFlowRole: "cash" }),
  bank("1040", "Bank – Money Market", "bank", { detailType: "money_market", cashFlowRole: "cash" }),
  bank("1050", "Bank – Credit Union", "bank", { detailType: "other_bank", cashFlowRole: "cash" }),
  bank("1090", "Transfer Clearing", "current_asset", { detailType: "transfer_clearing", cashFlowRole: "cash_equivalent" }),
  bank("1210", "Undeposited Funds", "current_asset", { system: true, detailType: "undeposited_funds", cashFlowRole: "operating_asset" }),
  // Current Assets – Receivables & Inventory
  recv("1100", "Accounts Receivable", "accounts_receivable", { system: true, cashFlowRole: "operating_receivable" }),
  recv("1190", "Allowance for Doubtful Accounts", "current_asset", { system: true, contra: true }),
  recv("1200", "Inventory", "current_asset", { system: true, cashFlowRole: "operating_inventory" }),
  recv("1230", "Inventory – Jewelry", "current_asset", { parent: "1200", cashFlowRole: "operating_inventory" }),
  recv("1240", "Inventory – Finished Jewelry", "current_asset", { parent: "1200", cashFlowRole: "operating_inventory" }),
  recv("1250", "Inventory – Raw Materials", "current_asset", { parent: "1200", cashFlowRole: "operating_inventory" }),
  recv("1260", "Inventory – Retail Merchandise", "current_asset", { parent: "1200", cashFlowRole: "operating_inventory" }),
  recv("1270", "Inventory – Supplies", "current_asset", { parent: "1200", cashFlowRole: "operating_inventory" }),
  recv("1300", "Prepaid Expenses", "current_asset", { cashFlowRole: "operating_asset" }),
  recv("1390", "Other Current Assets", "current_asset", { cashFlowRole: "operating_asset" }),
  recv("2110", "Sales Tax Receivable", "current_asset", { system: true, cashFlowRole: "operating_asset" }),
  // Non-current Assets
  nca("1500", "Property & Equipment", "fixed_asset", { system: true, cashFlowRole: "investing" }),
  nca("1510", "Store Fixtures & Equipment", "fixed_asset", { parent: "1500", cashFlowRole: "investing" }),
  nca("1520", "Jewelry Equipment", "fixed_asset", { parent: "1500", cashFlowRole: "investing" }),
  nca("1530", "Computers & Office Equipment", "fixed_asset", { parent: "1500", cashFlowRole: "investing" }),
  nca("1540", "Vehicles", "fixed_asset", { parent: "1500", cashFlowRole: "investing" }),
  nca("1590", "Accumulated Depreciation", "fixed_asset", { system: true, detailType: "Contra fixed asset", contra: true, cashFlowRole: "investing" }),
  nca("1700", "Security Deposits", "fixed_asset", { cashFlowRole: "investing" }),
  nca("1790", "Other Long-Term Assets", "fixed_asset", { cashFlowRole: "investing" }),
  // Current Liabilities
  cl("2000", "Accounts Payable", "accounts_payable", { system: true, cashFlowRole: "operating_payable" }),
  cl("2050", "Credit Card Payable", "credit_card", { cashFlowRole: "financing" }),
  cl("2100", "Sales Tax Payable", "current_liability", { system: true, cashFlowRole: "operating_liability" }),
  cl("2150", "Goods Received Not Invoiced", "current_liability", { system: true, cashFlowRole: "operating_liability" }),
  cl("2200", "Customer Deposits", "current_liability", { cashFlowRole: "operating_liability" }),
  cl("2210", "Gift Cards / Store Credits Payable", "current_liability", { cashFlowRole: "operating_liability" }),
  cl("2300", "Payroll Liabilities", "current_liability", { cashFlowRole: "operating_liability" }),
  cl("2400", "Current Portion of Loans", "current_liability", { cashFlowRole: "financing" }),
  cl("2490", "Other Current Liabilities", "current_liability", { cashFlowRole: "operating_liability" }),
  // Non-current Liabilities
  ncl("2500", "Long-Term Loans Payable", "long_term_liability", { cashFlowRole: "financing" }),
  ncl("2600", "Notes Payable", "long_term_liability", { cashFlowRole: "financing" }),
  ncl("2700", "Long-Term Lease Liability", "long_term_liability", { cashFlowRole: "financing" }),
  ncl("2990", "Other Long-Term Liabilities", "long_term_liability", { cashFlowRole: "financing" }),
  // Equity
  eq("3000", "Owner's Capital / Common Stock", "equity", { system: true, cashFlowRole: "financing" }),
  eq("3100", "Additional Paid-In Capital", "equity", { cashFlowRole: "financing" }),
  eq("3200", "Retained Earnings", "equity", { cashFlowRole: "financing" }),
  eq("3300", "Owner's Draw / Distributions", "equity", { contra: true, cashFlowRole: "financing" }),
  eq("3900", "Opening Balance Equity", "equity", { system: true }),
  // Income
  inc("4000", "Sales Revenue", "income", { system: true, cashFlowRole: "operating" }),
  inc("4010", "Jewelry Sales", "income", { parent: "4000", cashFlowRole: "operating" }),
  inc("4020", "Retail Sales", "income", { parent: "4000", cashFlowRole: "operating" }),
  inc("4030", "Custom Jewelry Sales", "income", { parent: "4000", cashFlowRole: "operating" }),
  inc("4100", "Repair & Service Income", "income", { system: true, cashFlowRole: "operating" }),
  inc("4900", "Sales Returns & Allowances", "income", { contra: true, cashFlowRole: "operating" }),
  inc("4910", "Sales Discounts", "income", { contra: true, cashFlowRole: "operating" }),
  inc("7000", "Other Income", "other_income", { system: true, cashFlowRole: "operating" }),
  inc("7010", "Purchase Discounts Taken", "other_income", { system: true, cashFlowRole: "operating" }),
  inc("7990", "Gain on Asset Disposal", "other_income", { system: true }),
  // Cost of Goods Sold
  cogs("5000", "Cost of Goods Sold", "cost_of_goods_sold", { system: true, cashFlowRole: "operating" }),
  cogs("5010", "COGS – Jewelry", "cost_of_goods_sold", { parent: "5000", cashFlowRole: "operating" }),
  cogs("5020", "COGS – Retail Merchandise", "cost_of_goods_sold", { parent: "5000", cashFlowRole: "operating" }),
  cogs("5030", "COGS – Raw Materials", "cost_of_goods_sold", { parent: "5000", cashFlowRole: "operating" }),
  cogs("5040", "COGS – Custom Jewelry", "cost_of_goods_sold", { parent: "5000", cashFlowRole: "operating" }),
  cogs("5090", "Inventory Adjustments", "cost_of_goods_sold", { system: true, cashFlowRole: "operating" }),
  cogs("5100", "Freight / Shipping In", "cost_of_goods_sold", { cashFlowRole: "operating" }),
  // Operating Expenses
  opex("6000", "Operating Expenses", "expense", { system: true, cashFlowRole: "operating" }),
  opex("6010", "Salaries & Wages", "expense", { parent: "6000", cashFlowRole: "operating" }),
  opex("6020", "Payroll Taxes", "expense", { parent: "6000", cashFlowRole: "operating" }),
  opex("6030", "Rent", "expense", { parent: "6000", cashFlowRole: "operating" }),
  opex("6040", "Utilities", "expense", { parent: "6000", cashFlowRole: "operating" }),
  opex("6050", "Insurance", "expense", { parent: "6000", cashFlowRole: "operating" }),
  opex("6060", "Advertising & Marketing", "expense", { parent: "6000", cashFlowRole: "operating" }),
  opex("6070", "Merchant / Credit Card Fees", "expense", { parent: "6000", cashFlowRole: "operating" }),
  opex("6080", "Bank Charges", "expense", { parent: "6000", cashFlowRole: "operating" }),
  opex("6090", "Shipping & Delivery", "expense", { parent: "6000", cashFlowRole: "operating" }),
  opex("6100", "Repairs & Maintenance", "expense", { parent: "6000", cashFlowRole: "operating" }),
  opex("6110", "Office Supplies", "expense", { parent: "6000", cashFlowRole: "operating" }),
  opex("6120", "Software & Subscriptions", "expense", { parent: "6000", cashFlowRole: "operating" }),
  opex("6130", "Professional Fees", "expense", { parent: "6000", cashFlowRole: "operating" }),
  opex("6140", "Telephone & Internet", "expense", { parent: "6000", cashFlowRole: "operating" }),
  opex("6150", "Travel & Meals", "expense", { parent: "6000", cashFlowRole: "operating" }),
  opex("6160", "Taxes & Licenses", "expense", { parent: "6000", cashFlowRole: "operating" }),
  opex("6990", "Miscellaneous Expense", "expense", { parent: "6000", cashFlowRole: "operating" }),
  opex("6800", "Depreciation Expense", "expense", { system: true, cashFlowRole: "operating" }),
  opex("6900", "Bad Debt Expense", "expense", { system: true, cashFlowRole: "operating" }),
  // Other Expenses
  oexp("7500", "Other Expenses", "other_expense", { system: true, cashFlowRole: "operating" }),
  oexp("8990", "Loss on Asset Disposal", "other_expense", { system: true }),
];

export const CHART_TEMPLATES: Record<ChartTemplateKey, ChartTemplate> = {
  standard: {
    key: "standard",
    label: "Standard",
    description:
      "The starter chart every company has had: cash, bank, receivables, inventory, payables, sales tax, equity, income and expense accounts. Add your own accounts later.",
    accounts: [],
  },
  retail_jewelry: {
    key: "retail_jewelry",
    label: "Retail & Jewelry",
    description:
      "84 accounts for a jewelry or retail business: every bank account in one section, inventory by kind, fixtures and equipment, customer deposits and gift cards, long-term loans, and jewelry sales and cost of sales.",
    accounts: RETAIL_JEWELRY,
  },
};

export interface TemplateStatement {
  sql: string;
  params: unknown[];
}

const UPSERT = `
insert into acc_account (account_code, name, account_type, currency_code, is_posting_account, detail_type, is_contra, cash_flow_role)
values ($1, $2, $3::acc_account_type, 'USD', true, $4, $5, coalesce($6::text, 'unclassified'))
on conflict (account_code) do update
   set name = excluded.name,
       detail_type = coalesce(excluded.detail_type, acc_account.detail_type),
       is_contra = excluded.is_contra or acc_account.is_contra,
       cash_flow_role = coalesce($6::text, acc_account.cash_flow_role),
       updated_at = now()`;

const SET_PARENT = `
update acc_account c
   set parent_account_id = p.id, updated_at = now()
  from acc_account p
 where c.account_code = $1 and p.account_code = $2`;

/** The SQL that turns a freshly provisioned company's chart into this template's. */
export function chartTemplateStatements(key: ChartTemplateKey): TemplateStatement[] {
  const accounts = CHART_TEMPLATES[key].accounts;
  return [
    ...accounts.map((a) => ({
      sql: UPSERT,
      params: [a.code, a.name, a.type, a.detailType ?? null, a.contra ?? false, a.cashFlowRole ?? null],
    })),
    ...accounts.filter((a) => a.parent).map((a) => ({ sql: SET_PARENT, params: [a.code, a.parent] })),
  ];
}
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run tests/unit/chart-templates.test.ts` then `npm run typecheck`
Expected: PASS, 11 tests; exit 0. If the seeded-type test names a system code whose seeded type differs, stop and report it (the approved table must be corrected, not the test).

- [ ] **Step 5: Commit**

```bash
git add -- lib/domain/chart-templates.ts tests/unit/chart-templates.test.ts
printf '%s\n' "feat(accounts): the Retail & Jewelry chart as data, and the SQL that applies it" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

---

### Task 6: Choosing the chart when a company is created

**Files:**
- Modify: `ctyhp-accounting/lib/services/company-provisioning.ts` (`ProvisionCompanyInput`, apply + self-check)
- Modify: `ctyhp-accounting/lib/services/company-queue.ts` (pass `chart_template`)
- Modify: `ctyhp-accounting/lib/domain/schemas.ts` (`companyCreateSchema`)
- Modify: `ctyhp-accounting/app/(app)/settings/companies/actions.ts` (`requestCompanyAction`)
- Modify: `ctyhp-accounting/app/(app)/settings/companies/NewCompanyModal.tsx` (the choice)
- Modify: `ctyhp-accounting/scripts/verify-company-provisioning.mjs` (build a Retail & Jewelry company too)
- Modify tests: `tests/unit/company-queue.test.ts`, `tests/unit/company-provisioning-action.test.ts`, `tests/unit/company-provisioning-core.test.ts`

**Interfaces:**
- Consumes: `CHART_TEMPLATES`, `CHART_TEMPLATE_KEYS`, `chartTemplateStatements`, `ChartTemplateKey` (Task 5); `onebook.request_company(…, p_chart_template)` and `company_request.chart_template` (Task 1).
- Produces: `ProvisionCompanyInput.chartTemplate?: ChartTemplateKey`; `companyCreateSchema` field `chart_template` (default `"standard"`); the RPC call carries `p_chart_template`.

- [ ] **Step 1: Update the tests first**

`tests/unit/company-provisioning-action.test.ts` — in "queues the request against the register schema…", the expected RPC arguments gain the default:

```ts
    expect(client.rpc).toHaveBeenCalledWith("request_company", {
      p_slug: "north_star",
      p_legal_name: "North Star Bridal LLC",
      p_is_sample: false,
      p_display_order: 100,
      p_chart_template: "standard",
    });
```

and add, inside `describe("requestCompanyAction", …)`:

```ts
  it("passes the chart the requester chose", async () => {
    const client = registerClient();
    mocks.createClientForSchema.mockResolvedValue(client);

    await requestCompanyAction({ ...valid, chart_template: "retail_jewelry" });

    expect(client.rpc).toHaveBeenCalledWith(
      "request_company",
      expect.objectContaining({ p_chart_template: "retail_jewelry" }),
    );
  });

  it("refuses a chart it does not know, before touching the database", async () => {
    const client = registerClient();
    mocks.createClientForSchema.mockResolvedValue(client);

    const result = await requestCompanyAction({ ...valid, chart_template: "bakery" });

    expect(result.ok).toBe(false);
    expect(client.rpc).not.toHaveBeenCalled();
  });
```

`tests/unit/company-queue.test.ts` — in "provisions a claimed request inside its own transaction…", the expected `provision` input gains `chartTemplate: "standard",` after `adminUserIds: ["user-1"],` (the `request` fixture has no `chart_template`, as a row claimed before 0125 would not). Add:

```ts
  it("builds the chart the request asked for", async () => {
    const client = fakeClient([{ ...request, chart_template: "retail_jewelry" }, null]);
    const provision = vi.fn().mockResolvedValue(built);

    await runPendingCompanyProvisioning({
      createClient: async () => client,
      provision,
      loadSources: () => sources,
    });

    expect(provision).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ chartTemplate: "retail_jewelry" }),
      sources,
    );
  });
```

`tests/unit/company-provisioning-core.test.ts` — add `import { CHART_TEMPLATES } from "@/lib/domain/chart-templates";` and, at the end of the file:

```ts
/** The fake client, answering the template self-check with `rows`. */
function templateClient(rows: { account_code: string; parent_code: string | null }[]) {
  const client = fakeClient();
  return {
    sql: client.sql,
    async query(text: string, params?: unknown[]) {
      if (/as parent_code/.test(text)) {
        client.sql.push(text);
        return { rows };
      }
      return client.query(text, params);
    },
  };
}

const RETAIL = CHART_TEMPLATES.retail_jewelry.accounts;
const RETAIL_ROWS = RETAIL.map((a) => ({ account_code: a.code, parent_code: a.parent ?? null }));

describe("provisionCompany with a chart", () => {
  it("adds nothing to the Standard chart", async () => {
    const client = fakeClient();
    await provisionCompany(client, input, sources);
    expect(client.sql.some((s) => /insert into acc_account/i.test(s))).toBe(false);
  });

  it("writes the Retail & Jewelry chart after the migrations and before the company is registered", async () => {
    const client = templateClient(RETAIL_ROWS);
    await provisionCompany(client, { ...input, chartTemplate: "retail_jewelry" }, sources);

    expect(client.sql.filter((s) => /insert into acc_account/i.test(s))).toHaveLength(RETAIL.length);
    expect(client.sql.filter((s) => /set parent_account_id/i.test(s))).toHaveLength(RETAIL.filter((a) => a.parent).length);
    const order = client.sql.join("\n@@\n");
    expect(order.indexOf("create table acc_payment")).toBeLessThan(order.search(/insert into acc_account/i));
    expect(order.search(/set parent_account_id/i)).toBeLessThan(order.indexOf("insert into onebook.company"));
  });

  it("does not report success when an account is missing or under the wrong parent", async () => {
    const moved = RETAIL_ROWS.map((r) => (r.account_code === "1230" ? { ...r, parent_code: null } : r));
    await expect(
      provisionCompany(templateClient(moved), { ...input, chartTemplate: "retail_jewelry" }, sources),
    ).rejects.toThrow(/Retail & Jewelry chart — 1230/);

    const missing = RETAIL_ROWS.filter((r) => r.account_code !== "2500");
    await expect(
      provisionCompany(templateClient(missing), { ...input, chartTemplate: "retail_jewelry" }, sources),
    ).rejects.toThrow(/Retail & Jewelry chart — 2500/);
  });
});
```

Run them: `npx vitest run tests/unit/company-provisioning-action.test.ts tests/unit/company-queue.test.ts tests/unit/company-provisioning-core.test.ts` — Expected: FAIL on the new expectations.

- [ ] **Step 2: Provisioning applies and checks the template**

In `lib/services/company-provisioning.ts`:
- add, beside the existing relative imports (keep the `.ts` extension style this file uses):

```ts
import { CHART_TEMPLATES, chartTemplateStatements, type ChartTemplateKey } from "../domain/chart-templates.ts";
```

- in `ProvisionCompanyInput`, add:

```ts
  /** The chart the requester chose; Standard when absent. */
  chartTemplate?: ChartTemplateKey;
```

- in `provisionCompany`, right after the loop that runs `plan.statements` in batches, add:

```ts
  // The chart the requester chose, inside the same transaction: a template
  // that cannot be applied leaves no company behind.
  const template = CHART_TEMPLATES[input.chartTemplate ?? "standard"];
  for (const statement of chartTemplateStatements(template.key)) {
    await client.query(statement.sql, statement.params);
  }
```

- in the "Check the work" part, after the `missingTables || missingRoutines` check, add:

```ts
  if (template.accounts.length > 0) {
    const { rows } = await client.query(
      `select a.account_code, p.account_code as parent_code
         from ${schema}.acc_account a
         left join ${schema}.acc_account p on p.id = a.parent_account_id`,
    );
    const parentOf = new Map(
      rows.map((r) => [String(r.account_code), r.parent_code == null ? undefined : String(r.parent_code)]),
    );
    const wrong = template.accounts.filter((a) => !parentOf.has(a.code) || parentOf.get(a.code) !== a.parent);
    if (wrong.length > 0) {
      throw new Error(`${schema} does not have the ${template.label} chart — ${wrong.map((a) => a.code).join(", ")}`);
    }
  }
```

- [ ] **Step 3: The queue passes the choice**

In `lib/services/company-queue.ts`, add `import type { ChartTemplateKey } from "../domain/chart-templates.ts";` (match the file's existing import style) and, in the object passed to `provision(...)`, add after `adminUserIds`:

```ts
            chartTemplate: ((row.chart_template as ChartTemplateKey | null | undefined) ?? "standard"),
```

- [ ] **Step 4: The request carries it**

In `lib/domain/schemas.ts`, add `import { CHART_TEMPLATE_KEYS } from "./chart-templates";` beside the file's other relative imports and add to `companyCreateSchema`:

```ts
  chart_template: z.enum(CHART_TEMPLATE_KEYS).default("standard"),
```

In `app/(app)/settings/companies/actions.ts`, in the `request_company` RPC arguments add:

```ts
      p_chart_template: parsed.data.chart_template,
```

- [ ] **Step 5: The New Company form**

In `app/(app)/settings/companies/NewCompanyModal.tsx`:
- import `Radio` from `antd` (add to the existing antd import) and `import { CHART_TEMPLATES, CHART_TEMPLATE_KEYS, type ChartTemplateKey } from "@/lib/domain/chart-templates";`
- add `chart_template: ChartTemplateKey;` to `FormValues`;
- inside the component, after `const [form] = Form.useForm<FormValues>();`, add `const chartTemplate = (Form.useWatch("chart_template", form) as ChartTemplateKey | undefined) ?? "standard";`
- the `<Form>`'s `initialValues` becomes `{{ is_sample: false, display_order: 100, chart_template: "standard" }}` (so `form.resetFields()` after a request goes back to Standard);
- add this `Form.Item` right after the `slug` item:

```tsx
        <Form.Item
          name="chart_template"
          label="Chart of accounts"
          extra={CHART_TEMPLATES[chartTemplate].description}
        >
          <Radio.Group
            optionType="button"
            options={CHART_TEMPLATE_KEYS.map((key) => ({ value: key, label: CHART_TEMPLATES[key].label }))}
          />
        </Form.Item>
```

- [ ] **Step 6: The provisioning self-check builds a Retail & Jewelry company too**

In `scripts/verify-company-provisioning.mjs`, add `import { CHART_TEMPLATES } from "../lib/domain/chart-templates.ts";` beside the other imports and, at the end of the `try` block — after the `check("anon was given nothing", …)` call and before `} catch (error) {`, so it runs in the same transaction that the `finally` rolls back — add:

```js
  // --- A company built from the Retail & Jewelry chart ------------------------
  const RETAIL = "verify_retail_probe";
  await provisionCompany(
    client,
    {
      slug: RETAIL,
      legalName: "Verify Retail Probe Inc.",
      isSample: true,
      displayOrder: 998,
      adminUserIds: [],
      chartTemplate: "retail_jewelry",
    },
    sources,
  );
  const built = new Map(
    (
      await client.query(
        `select a.account_code, a.account_type::text as type, a.is_contra, a.detail_type, p.account_code as parent
           from co_${RETAIL}.acc_account a
           left join co_${RETAIL}.acc_account p on p.id = a.parent_account_id`,
      )
    ).rows.map((r) => [r.account_code, r]),
  );
  const template = CHART_TEMPLATES.retail_jewelry.accounts;
  check("every Retail & Jewelry account exists", template.every((a) => built.has(a.code)));
  check("each has its template type", template.every((a) => built.get(a.code)?.type === a.type));
  check("each has its template parent", template.every((a) => (built.get(a.code)?.parent ?? undefined) === a.parent));
  check("contra accounts are flagged", template.every((a) => Boolean(built.get(a.code)?.is_contra) === Boolean(a.contra)));
  check("Undeposited Funds sits with the bank accounts", built.get("1210")?.detail_type === "undeposited_funds");
  check(
    "the non-current liabilities are long-term",
    ["2500", "2600", "2700", "2990"].every((c) => built.get(c)?.type === "long_term_liability"),
  );
```

- [ ] **Step 7: Run the tests, typecheck, and the provisioning self-check (rolled back)**

Run: `npx vitest run tests/unit/company-provisioning-action.test.ts tests/unit/company-queue.test.ts tests/unit/company-provisioning-core.test.ts tests/unit/company-provisioning-ui-contract.test.ts tests/unit/company-provisioning-schema.test.ts tests/unit/rsc-antd.test.ts` then `npm run typecheck`, then `timeout 900 npm run verify:company-provisioning`
Expected: PASS; exit 0; the self-check prints `PASS` for every check including the six Retail & Jewelry checks, then `ROLLBACK — the probe company never existed.` (it builds two companies inside one transaction that is rolled back — nothing persists). The Retail & Jewelry company uses `long_term_liability` in the same transaction that created the type; that is allowed (verified on Postgres 17.6). If the self-check fails, stop and report its output.

- [ ] **Step 8: Commit**

```bash
git add -- lib/services/company-provisioning.ts lib/services/company-queue.ts lib/domain/schemas.ts "app/(app)/settings/companies/actions.ts" "app/(app)/settings/companies/NewCompanyModal.tsx" scripts/verify-company-provisioning.mjs tests/unit/company-provisioning-action.test.ts tests/unit/company-queue.test.ts tests/unit/company-provisioning-core.test.ts
printf '%s\n' "feat(companies): a new company can start from the Retail & Jewelry chart" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

---

### Task 7: The Chart of Accounts screen by section

**Files:**
- Modify (rewrite): `ctyhp-accounting/app/(app)/accounts/AccountsClient.tsx`
- Create: `ctyhp-accounting/app/(app)/accounts/accounts.module.css`

**Interfaces:**
- Consumes: `accountSections`, `withAncestors`, `parentChoices`, `AccountTreeRow` (Task 4); `detailLabel`, `detailTypeOptions` (Task 3); `AccountRow.is_contra` (Task 3); `ACCOUNT_TYPES` incl. `long_term_liability` (Task 2). Props unchanged: `{ accounts: AccountRow[]; currencies: CurrencyRow[]; taxCodes: TaxCodeRow[]; canWrite: boolean }`.

- [ ] **Step 1: The styles**

`ctyhp-accounting/app/(app)/accounts/accounts.module.css`:

```css
/* The chart of accounts, one block per section (lib/domain/account-sections.ts). */
.section {
  margin-top: 22px;
}

.section:first-of-type {
  margin-top: 10px;
}

.sectionHead {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin: 0 0 8px;
}

.sectionTitle {
  margin: 0;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ob-text-heading);
}

.sectionCount {
  font-size: 12px;
  color: var(--ob-text-secondary);
}

.subMark {
  color: var(--ob-text-secondary);
  margin-right: 4px;
}
```

- [ ] **Step 2: Rewrite `AccountsClient.tsx`**

Replace the whole file with:

```tsx
"use client";
import { useMemo, useState } from "react";
import {
  App,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Tag,
  type TableColumnsType,
} from "antd";
import { CheckOutlined, EditOutlined, PlusOutlined, StopOutlined } from "@ant-design/icons";
import DataTable from "@/components/ui/DataTable";
import { flexColumn, secondaryLine } from "@/components/ui/columns";
import { COLUMN } from "@/lib/design/table-metrics";
import FilterBar from "@/components/ui/FilterBar";
import ClassifyAccountsButton from "./ClassifyAccountsButton";
import IconActionButton from "@/components/ui/IconActionButton";
import {
  ACCOUNT_TYPES,
  ACCOUNT_TYPE_LABEL,
  normalBalanceOf,
  statementSectionOf,
  type AccountType,
} from "@/lib/domain/accounts";
import { detailLabel, detailTypeOptions } from "@/lib/domain/account-detail";
import { accountSections, parentChoices, withAncestors, type AccountTreeRow } from "@/lib/domain/account-sections";
import { CASH_FLOW_ROLES, defaultCashFlowRole, type CashFlowRole } from "@/lib/domain/cashflow";
import type { AccountRow, CurrencyRow, TaxCodeRow, AccountStatus } from "@/lib/db/types";
import { createAccountAction, updateAccountAction, setAccountStatusAction } from "./actions";
import styles from "./accounts.module.css";

const STATUS_LABELS: Record<AccountStatus, { text: string; color: string }> = {
  draft: { text: "Draft", color: "default" },
  active: { text: "Active", color: "green" },
  inactive: { text: "Inactive", color: "orange" },
  archived: { text: "Archived", color: "default" },
};

const CASH_FLOW_ROLE_LABELS: Record<CashFlowRole, string> = {
  cash: "Cash",
  cash_equivalent: "Cash equivalent",
  restricted_cash: "Restricted cash",
  operating: "Operating",
  operating_receivable: "Operating — receivable",
  operating_inventory: "Operating — inventory",
  operating_payable: "Operating — payable",
  operating_asset: "Operating — other asset",
  operating_liability: "Operating — other liability",
  investing: "Investing",
  financing: "Financing",
  exclude: "Exclude",
  unclassified: "Unclassified",
};

type Row = AccountTreeRow<AccountRow>;

interface FormValues {
  account_code: string;
  name: string;
  account_type: AccountType;
  cash_flow_role?: CashFlowRole;
  /** Offered for bank and current-asset types; see lib/domain/account-detail. */
  detail_type?: string | null;
  is_contra: boolean;
  parent_account_id?: string | null;
  currency_code?: string | null;
  default_tax_code_id?: string | null;
  is_posting_account: boolean;
  description?: string | null;
}

/**
 * The chart of accounts, read by section — bank accounts, receivables and
 * inventory, non-current assets, liabilities, equity, income, cost of goods
 * sold, expenses — each a tree of sub-accounts under their parent in number
 * order (lib/domain/account-sections.ts).
 */
export default function AccountsClient({
  accounts,
  currencies,
  taxCodes,
  canWrite,
}: {
  accounts: AccountRow[];
  currencies: CurrencyRow[];
  taxCodes: TaxCodeRow[];
  canWrite: boolean;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValues>();
  const watchedType = Form.useWatch("account_type", form);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AccountRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<AccountType | "all">("all");
  const [cashFlowFilter, setCashFlowFilter] = useState<CashFlowRole | "all">("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const filtering = search.trim() !== "" || typeFilter !== "all" || cashFlowFilter !== "all";

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    return accounts.filter(
      (a) =>
        (typeFilter === "all" || a.account_type === typeFilter) &&
        (cashFlowFilter === "all" || a.cash_flow_role === cashFlowFilter) &&
        (!q || a.account_code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)),
    );
  }, [accounts, search, typeFilter, cashFlowFilter]);

  // A match reads in its section under its parent, so the parents above it come along.
  const sections = useMemo(
    () => accountSections(filtering ? withAncestors(accounts, matches) : accounts),
    [accounts, matches, filtering],
  );

  const labelById = useMemo(
    () => new Map(accounts.map((a) => [a.id, `${a.account_code} — ${a.name}`])),
    [accounts],
  );

  const detailOptions = watchedType ? detailTypeOptions(watchedType) : [];

  function openCreate() {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ currency_code: "USD", is_posting_account: true, is_contra: false });
    setOpen(true);
  }

  function openEdit(row: AccountRow) {
    setEditing(row);
    form.setFieldsValue({
      account_code: row.account_code,
      name: row.name,
      account_type: row.account_type,
      cash_flow_role: row.cash_flow_role,
      detail_type: row.detail_type,
      is_contra: row.is_contra,
      parent_account_id: row.parent_account_id,
      currency_code: row.currency_code,
      default_tax_code_id: row.default_tax_code_id,
      is_posting_account: row.is_posting_account,
      description: row.description,
    });
    setOpen(true);
  }

  function onTypeChange(type: AccountType) {
    form.setFieldValue("cash_flow_role", defaultCashFlowRole(type));
    const detail = form.getFieldValue("detail_type") as string | null | undefined;
    if (!detailTypeOptions(type).some((o) => o.value === detail)) form.setFieldValue("detail_type", null);
    const parentId = form.getFieldValue("parent_account_id") as string | null | undefined;
    if (parentId && accounts.find((a) => a.id === parentId)?.account_type !== type) {
      form.setFieldValue("parent_account_id", null);
    }
  }

  async function onSubmit() {
    const values = await form.validateFields();
    setSaving(true);
    const result = editing ? await updateAccountAction(editing.id, values) : await createAccountAction(values);
    setSaving(false);
    if (result.ok) {
      message.success(editing ? "Account updated" : "Account created");
      setOpen(false);
    } else {
      message.error(result.error ?? "Save failed");
    }
  }

  async function toggleStatus(row: AccountRow) {
    const next: AccountStatus = row.status === "active" ? "inactive" : "active";
    setBusyId(row.id);
    const result = await setAccountStatusAction(row.id, next);
    setBusyId(null);
    if (result.ok) message.success(next === "active" ? "Account activated" : "Account deactivated");
    else message.error(result.error ?? "Failed to update status");
  }

  const columns: TableColumnsType<Row> = [
    {
      title: "Code",
      key: "code",
      width: COLUMN.CODE,
      render: (_: unknown, { account }: Row) => account.account_code,
    },
    {
      ...flexColumn<Row>({
        title: "Account name",
        key: "name",
        render: (_: unknown, { account, depth }: Row) => {
          const under = [
            detailLabel(account.account_type, account.detail_type),
            CASH_FLOW_ROLE_LABELS[account.cash_flow_role],
            normalBalanceOf(account.account_type) === "debit" ? "Debit normal" : "Credit normal",
            statementSectionOf(account.account_type) === "balance_sheet" ? "Balance Sheet" : "Profit & Loss",
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <div style={{ minWidth: 0, paddingLeft: depth * 20 }}>
              <span title={account.name}>
                {depth > 0 ? <span className={styles.subMark}>↳</span> : null}
                {account.name}
              </span>
              {account.is_contra ? (
                <Tag color="purple" style={{ marginInlineStart: 8 }}>
                  Contra
                </Tag>
              ) : null}
              {secondaryLine(under)}
            </div>
          );
        },
      }),
    },
    {
      title: "Type",
      key: "type",
      width: 150,
      render: (_: unknown, { account }: Row) => <Tag>{ACCOUNT_TYPE_LABEL[account.account_type]}</Tag>,
    },
    {
      title: "Cash flow",
      key: "cashFlow",
      width: COLUMN.STATUS,
      render: (_: unknown, { account }: Row) =>
        account.cash_flow_role === "unclassified" ? <Tag color="orange">Unclassified</Tag> : <Tag color="blue">Set</Tag>,
    },
    {
      title: "Status",
      key: "status",
      width: COLUMN.STATUS,
      render: (_: unknown, { account }: Row) => (
        <Tag color={STATUS_LABELS[account.status].color}>{STATUS_LABELS[account.status].text}</Tag>
      ),
    },
    ...(canWrite
      ? [
          {
            title: "Actions",
            key: "actions",
            width: COLUMN.ACTION * 2,
            align: "right" as const,
            render: (_: unknown, { account }: Row) => (
              <Space size={4}>
                <IconActionButton label="Edit account" icon={<EditOutlined />} onClick={() => openEdit(account)} />
                <IconActionButton
                  label={account.status === "active" ? "Deactivate account" : "Activate account"}
                  icon={account.status === "active" ? <StopOutlined /> : <CheckOutlined />}
                  loading={busyId === account.id}
                  onClick={() => toggleStatus(account)}
                  disabled={account.status !== "active" && account.status !== "inactive"}
                />
              </Space>
            ),
          } as TableColumnsType<Row>[number],
        ]
      : []),
  ];

  return (
    <div>
      <FilterBar
        resultCount={matches.length}
        actions={
          <Space wrap>
            <ClassifyAccountsButton canWrite={canWrite} />
            {canWrite ? (
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
                New account
              </Button>
            ) : null}
          </Space>
        }
      >
        <Input.Search
          placeholder="Search by code or name"
          allowClear
          style={{ width: 320 }}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select<AccountType | "all">
          aria-label="Account type"
          value={typeFilter}
          onChange={setTypeFilter}
          style={{ width: 200 }}
          options={[
            { value: "all", label: "All types" },
            ...ACCOUNT_TYPES.map((t) => ({ value: t, label: ACCOUNT_TYPE_LABEL[t] })),
          ]}
        />
        {/* How a reader finds every unclassified account — the one question the cash flow column is asked. */}
        <Select<CashFlowRole | "all">
          aria-label="Cash flow role"
          value={cashFlowFilter}
          onChange={setCashFlowFilter}
          style={{ width: 230 }}
          options={[
            { value: "all", label: "All cash flow roles" },
            ...CASH_FLOW_ROLES.map((role) => ({ value: role, label: CASH_FLOW_ROLE_LABELS[role] })),
          ]}
        />
      </FilterBar>

      {sections.length === 0 ? (
        <DataTable<Row>
          rowKey={(row) => row.account.id}
          columns={columns}
          dataSource={[]}
          pagination={false}
          emptyTitle={filtering ? "No matching accounts" : "No accounts yet"}
          emptyDescription={
            filtering
              ? "Try a different account code, name, type or cash flow role."
              : "Create an account to start building the chart of accounts."
          }
        />
      ) : (
        sections.map((section) => (
          <section key={section.key} className={styles.section} aria-labelledby={`coa-${section.key}`}>
            <div className={styles.sectionHead}>
              <h2 id={`coa-${section.key}`} className={styles.sectionTitle}>
                {section.title}
              </h2>
              <span className={styles.sectionCount}>
                {section.rows.length} {section.rows.length === 1 ? "account" : "accounts"}
              </span>
            </div>
            <DataTable<Row>
              rowKey={(row) => row.account.id}
              columns={columns}
              dataSource={section.rows}
              pagination={false}
            />
          </section>
        ))
      )}

      <Modal
        title={editing ? "Edit account" : "New account"}
        open={open}
        onOk={onSubmit}
        onCancel={() => setOpen(false)}
        confirmLoading={saving}
        okText="Save"
        cancelText="Cancel"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" requiredMark={false}>
          <Form.Item name="account_code" label="Account code" rules={[{ required: true, message: "Enter an account code" }]}>
            <Input disabled={!!editing} placeholder="e.g. 4000" />
          </Form.Item>
          <Form.Item name="name" label="Account name" rules={[{ required: true, message: "Enter a name" }]}>
            <Input placeholder="e.g. Sales Revenue" />
          </Form.Item>
          <Form.Item name="account_type" label="Account type" rules={[{ required: true, message: "Select a type" }]}>
            <Select
              options={ACCOUNT_TYPES.map((t) => ({ value: t, label: ACCOUNT_TYPE_LABEL[t] }))}
              placeholder="Select an account type"
              onChange={onTypeChange}
            />
          </Form.Item>
          <Form.Item
            name="cash_flow_role"
            label="Cash flow role"
            rules={[{ required: true, message: "Select a cash flow role" }]}
            extra="Unclassified accounts keep the Cash Flow Statement in review status until an accountant assigns a policy."
          >
            <Select
              options={CASH_FLOW_ROLES.map((role) => ({ value: role, label: CASH_FLOW_ROLE_LABELS[role] }))}
              placeholder="Select a cash flow role"
            />
          </Form.Item>
          {detailOptions.length > 0 ? (
            <Form.Item
              name="detail_type"
              label={watchedType === "bank" ? "Bank account detail" : "Detail"}
              rules={watchedType === "bank" ? [{ required: true, message: "Say which kind of account this is" }] : []}
              extra={
                watchedType === "bank"
                  ? "Cash on hand is physical cash; everything else is held at a financial institution."
                  : "Undeposited funds and transfer clearing are money on its way to a bank; the chart shows them with the bank accounts."
              }
            >
              <Select allowClear={watchedType !== "bank"} placeholder="Choose a detail" options={detailOptions} />
            </Form.Item>
          ) : null}
          <Form.Item
            name="parent_account_id"
            label="Parent account (optional)"
            extra="A sub-account has its parent's type, so only accounts of this type are offered."
          >
            <Select
              allowClear
              showSearch
              filterOption={(input, option) => String(option?.label ?? "").toLowerCase().includes(input.toLowerCase())}
              placeholder="None"
              options={parentChoices(accounts, watchedType, editing?.id ?? null).map((a) => ({
                value: a.id,
                label: labelById.get(a.id)!,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="is_contra"
            label="Contra account"
            valuePropName="checked"
            tooltip="An account that reduces another in its section — Accumulated Depreciation, Sales Returns, Owner's Draw. Its balance runs the other way, and the Exception Report does not question it for that."
          >
            <Switch />
          </Form.Item>
          <Form.Item name="currency_code" label="Currency">
            <Select
              disabled
              placeholder="USD"
              options={currencies.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` }))}
            />
          </Form.Item>
          <Form.Item name="default_tax_code_id" label="Default tax code (optional)">
            <Select
              allowClear
              placeholder="None"
              options={taxCodes.map((t) => ({ value: t.id, label: `${t.code} — ${t.name}` }))}
            />
          </Form.Item>
          <Form.Item
            name="is_posting_account"
            label="Posting account"
            valuePropName="checked"
            tooltip="Turn off for a summary account that does not receive direct postings"
          >
            <Switch />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck, lint and the gates**

Run: `npm run typecheck`, `npx eslint "app/(app)/accounts/AccountsClient.tsx"`, `npx vitest run tests/unit/account-sections.test.ts tests/unit/table-adoption.test.ts tests/unit/table-fit-contract.test.ts tests/unit/table-pagination-guard.test.ts tests/unit/data-table-contract.test.ts tests/unit/no-hardcoded-color.test.ts tests/unit/rsc-antd.test.ts`
Expected: all exit 0 / PASS. No test pins the old flat list (checked 2026-09-29). The screen is looked at in Task 9, after the migration is live — `is_contra` does not exist in the database until then, so do not start the app against it here.

- [ ] **Step 4: Commit**

```bash
git add -- "app/(app)/accounts/AccountsClient.tsx" "app/(app)/accounts/accounts.module.css"
printf '%s\n' "feat(accounts): the chart of accounts by section, sub-accounts under their parent" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

---

### Task 8: Changelog 1.67, and the four gates

**Files:**
- Modify: `ctyhp-accounting/lib/domain/changelog.ts`

- [ ] **Step 1: Add release 1.67** as the first element of `RELEASES`:

```ts
  {
    version: "1.67",
    date: "2026-09-29",
    headline: "A chart of accounts for jewelry and retail, and a chart you can read by section.",
    changes: [
      {
        kind: "added",
        title: "Start a new company with the Retail & Jewelry chart",
        detail:
          "When creating a company, choose Retail & Jewelry instead of Standard: 84 accounts with every bank account in one section, inventory by kind, fixtures and equipment, customer deposits and gift cards, long-term loans, and jewelry sales and cost of sales, each sub-account under its parent.",
        route: "/settings/companies",
      },
      {
        kind: "changed",
        title: "The chart of accounts reads by section",
        detail:
          "Accounts are grouped the way the statements read them — bank accounts, receivables and inventory, non-current assets, current and non-current liabilities, equity, income, cost of goods sold, operating expenses — with sub-accounts indented under their parent and codes in number order. Undeposited Funds sits with the bank accounts. A search shows each match in its section, under its parent.",
        route: "/accounts",
      },
      {
        kind: "added",
        title: "Non-current liabilities",
        detail:
          "A new account type for long-term loans, notes payable and lease liabilities. The Balance Sheet shows them in their own Long-term Liabilities group, and an import from QuickBooks or Wave now files long-term liabilities there instead of with current ones.",
        route: "/reports",
      },
      {
        kind: "fixed",
        title: "Contra accounts are no longer questioned for running the other way",
        detail:
          "An account can be marked Contra — Accumulated Depreciation, Allowance for Doubtful Accounts, Sales Returns, Owner's Draw. The Exception Report no longer lists them as balances pointing the wrong way. The two system contra accounts are marked already.",
        route: "/reports/exceptions",
      },
      {
        kind: "changed",
        title: "A sub-account has its parent's type",
        detail:
          "Choosing a parent now offers only accounts of the same type, and a mismatched parent is refused, so a sub-account always adds up inside its parent's section.",
        route: "/accounts",
      },
      {
        kind: "fixed",
        title: "Editing an inactive account no longer makes it active again",
        detail:
          "Saving a change to an inactive account — its name, its cash flow role — used to set it back to Active. An edit now changes only what was edited; use Activate to bring an account back.",
        route: "/accounts",
      },
    ],
  },
```

- [ ] **Step 2: Run the four gates, reading each output in full**

```bash
npm test > "$SCRATCH/gate-167-test.txt" 2>&1; echo "exit $?"
npm run typecheck > "$SCRATCH/gate-167-tsc.txt" 2>&1; echo "exit $?"
npm run lint > "$SCRATCH/gate-167-lint.txt" 2>&1; echo "exit $?"
npm run build > "$SCRATCH/gate-167-build.txt" 2>&1; echo "exit $?"
```

Expected: every test file passes; typecheck, lint (0 errors) and build exit 0.

- [ ] **Step 3: Commit**

```bash
git add -- lib/domain/changelog.ts
printf '%s\n' "chore(changelog): 1.67, the Retail & Jewelry chart and the chart by section" > "$SCRATCH/msg.txt"
git commit -F "$SCRATCH/msg.txt"
```

---

### Task 9: Apply, verify, look (controller)

- [ ] Ask the user to approve applying migration 0125 to all four companies. Only after approval: `node --env-file=.env.local scripts/migrate.mjs`, then confirm `0125_chart_of_accounts_structure.sql` is recorded in every schema's `acc_schema_migrations`.
- [ ] `timeout 400 node --env-file=.env.local scripts/verify-coa-structure.mjs` on the applied books (now also proves a long-term liability account can be created), and `timeout 900 npm run verify:company-provisioning`.
- [ ] The live parity test (read-only): `timeout 1200 node --env-file=.env.local ./node_modules/vitest/vitest.mjs run --config vitest.live.config.ts --pool=threads` — 4/4, including the liability groups.
- [ ] Build, start detached (PowerShell `Start-Process npm.cmd start`), `node --env-file=.env.local scripts/smoke-pages.mjs http://localhost:3000`.
- [ ] Temporary read-only Playwright script (deleted after): the Chart of Accounts on the sample company and on Aurora (Aurora has sub-accounts), light and dark; the New Company modal with Retail & Jewelry selected (open it, never submit); the account form showing the Contra switch and the parent list limited to one type. Measure that every section table fits at 1280 and 1470. Review the pictures, fix, re-shoot.
- [ ] Show the user; ask whether to create a real sample company with the Retail & Jewelry chart (it creates a schema in production — only on their say-so). Push after approval; the PR merges only after 0125 is live (it is, by this step).
