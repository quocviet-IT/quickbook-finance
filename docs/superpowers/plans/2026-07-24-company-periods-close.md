# Company Settings + Accounting Periods / Close (A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a versioned company profile and monthly accounting periods, and block any posting or void whose date falls in a closed period so reported figures stay reproducible.

**Architecture:** Two migrations add three config tables and the period machinery, redefine the single posting function `acc_post_entry` to reject postings in closed periods, and add a trigger that rejects voiding an entry in a closed period. Pure domain generates the monthly period calendar; a thin service calls admin-gated RPCs; Ant Design settings pages manage company info and periods. Corrections to closed periods flow through Module B reversals dated in an open period.

**Tech Stack:** Next.js (App Router), TypeScript, Supabase (Postgres/RLS), Ant Design, Zod, Vitest, `pg` for the verify script (DB reachable via the pooler; `scripts/migrate.mjs` applies pending migrations).

## Global Constraints

- Money is integer minor units; convert only at the UI edge. (This module has little money math — only display of nothing sensitive.)
- All financial writes go through the service → an atomic Postgres RPC. No SQL in components. Never trust client math.
- The closed-period guard lives in the database (`acc_post_entry` + a trigger), so no client path can bypass it. A date with **no** period row is NOT closed — the guard is inert until an admin generates and closes periods.
- Corrections to a closed period are made by a Module B reversal (`acc_reverse_entry`) dated in an open period; never by editing/voting the original.
- Period and company-settings **writes are admin-only** (`acc_is_admin()` in SQL, `isAdmin(role)` in actions). Reads are staff+viewer.
- EIN is masked in the UI and NEVER written to `acc_audit_log`.
- `fiscalYear` = the calendar year the fiscal year begins in; `computePeriods(7, 2026)` → Jul 2026 … Jun 2027. `period_month` is the 1..12 ordinal within the fiscal year (period 1 = start month). `label` = ISO `YYYY-MM` of `period_start`.
- Never swallow an error. RLS on every new table. Every close/reopen/settings write appends `acc_audit_log`.
- English is the canonical language. Commit messages must NOT contain any Claude attribution / Co-Authored-By / "Generated with Claude Code".
- All commands run from `c:/Users/pit010/QUICKBOOK_WEBAPP/ctyhp-accounting`. Migrations applied via `scripts/migrate.mjs` (or the Supabase SQL Editor) before the Task 9 live E2E.
- Next migration numbers: `0028`, `0029`.

---

## File Structure

- Create `supabase/migrations/0028_company_periods.sql` — enums + 3 tables + RLS.
- Create `supabase/migrations/0029_company_periods_functions.sql` — `acc_is_period_closed`, redefined `acc_post_entry`, void trigger, generate/close/reopen/save-settings RPCs.
- Create `lib/domain/periods.ts` — `computePeriods`, `periodLabelOf`.
- Modify `lib/domain/schemas.ts` — company settings / close / reopen schemas.
- Create `tests/unit/periods.test.ts`, `tests/unit/periods-schema.test.ts`.
- Modify `lib/db/types.ts` — row types.
- Create `lib/services/periods.ts`, `lib/services/company.ts`.
- Create `app/(app)/settings/company/{page.tsx,CompanySettingsClient.tsx,actions.ts}`.
- Create `app/(app)/settings/periods/{page.tsx,PeriodsClient.tsx,actions.ts}`.
- Modify `components/AppShell.tsx` — Settings nav entries.
- Create `scripts/verify-periods.mjs`.

---

## Task 1: Migration — schema

**Files:**
- Create: `supabase/migrations/0028_company_periods.sql`

**Interfaces:**
- Produces tables `acc_company_setting_version`, `acc_accounting_period`, `acc_period_event`; enums `acc_accounting_basis` (`accrual`|`cash`), `acc_period_status` (`open`|`closed`).

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0028_company_periods.sql
-- ============================================================================
-- Company settings (versioned) + accounting periods (monthly, open/closed) +
-- period-event history. No changes to existing tables. RLS: staff+viewer read,
-- admin write. The closed-period guard itself is in 0029.
-- ============================================================================

create type acc_accounting_basis as enum ('accrual', 'cash');
create type acc_period_status    as enum ('open', 'closed');

create table acc_company_setting_version (
  id                         uuid primary key default gen_random_uuid(),
  version                    int not null,
  effective_from             date not null default current_date,
  legal_name                 text not null,
  dba_name                   text,
  ein_ref                    text,                       -- masked in UI; never audited
  address_line1              text,
  address_line2              text,
  city                       text,
  region                     text,
  postal_code                text,
  country                    text,
  fiscal_year_start_month    int not null default 1 check (fiscal_year_start_month between 1 and 12),
  base_currency_code         text not null default 'USD' references acc_currency (code),
  time_zone                  text not null default 'America/New_York',
  accounting_basis           acc_accounting_basis not null default 'accrual',
  default_payment_terms_days int not null default 30 check (default_payment_terms_days >= 0),
  created_by                 uuid references auth.users (id),
  created_at                 timestamptz not null default now(),
  unique (version)
);

create table acc_accounting_period (
  id             uuid primary key default gen_random_uuid(),
  fiscal_year    int not null,
  period_month   int not null check (period_month between 1 and 12),
  period_start   date not null unique,
  period_end     date not null,
  label          text not null,
  status         acc_period_status not null default 'open',
  closed_by      uuid references auth.users (id),
  closed_at      timestamptz,
  close_reason   text,
  reopened_by    uuid references auth.users (id),
  reopened_at    timestamptz,
  reopen_reason  text,
  created_at     timestamptz not null default now(),
  unique (fiscal_year, period_month)
);
create index acc_period_range_idx on acc_accounting_period (period_start, period_end);

create table acc_period_event (
  id         uuid primary key default gen_random_uuid(),
  period_id  uuid not null references acc_accounting_period (id) on delete cascade,
  event      text not null,             -- 'close' | 'reopen'
  reason     text not null,
  actor_id   uuid references auth.users (id),
  created_at timestamptz not null default now()
);
create index acc_period_event_period_idx on acc_period_event (period_id);

alter table acc_company_setting_version enable row level security;
alter table acc_accounting_period       enable row level security;
alter table acc_period_event            enable row level security;

create policy acc_company_setting_sel on acc_company_setting_version
  for select using (acc_is_staff() or acc_current_role() = 'viewer');
create policy acc_company_setting_ins on acc_company_setting_version
  for insert with check (acc_is_admin());
create policy acc_period_sel on acc_accounting_period
  for select using (acc_is_staff() or acc_current_role() = 'viewer');
create policy acc_period_write on acc_accounting_period
  for all using (acc_is_admin()) with check (acc_is_admin());
create policy acc_period_event_sel on acc_period_event
  for select using (acc_is_staff() or acc_current_role() = 'viewer');
create policy acc_period_event_ins on acc_period_event
  for insert with check (acc_is_admin());
```

- [ ] **Step 2: Sanity-check the SQL parses**

Run: `node -e "const fs=require('fs');const s=fs.readFileSync('supabase/migrations/0028_company_periods.sql','utf8');for(const t of ['acc_company_setting_version','acc_accounting_period','acc_period_event'])if(!s.includes('create table '+t)){console.error('missing '+t);process.exit(1)}console.log('ok')"`
Expected: prints `ok`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0028_company_periods.sql
git commit -m "feat: company settings + accounting period tables + RLS"
```

Note: apply 0028/0029 via `scripts/migrate.mjs` before the Task 9 live E2E.

---

## Task 2: Migration — guard + RPCs

**Files:**
- Create: `supabase/migrations/0029_company_periods_functions.sql`

**Interfaces:**
- Consumes: `acc_is_staff`, `acc_is_admin`, `acc_next_number`, tables from Task 1, and the existing `acc_post_entry` body (0001) which is redefined here.
- Produces: `acc_is_period_closed(date) returns boolean`; redefined `acc_post_entry(...)`; trigger `acc_block_closed_period_void` on `acc_journal_entry`; `acc_generate_periods(int) returns int`; `acc_close_period(uuid,text)`; `acc_reopen_period(uuid,text)`; `acc_save_company_settings(...) returns uuid`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0029_company_periods_functions.sql
-- ============================================================================
-- Closed-period guard + period/company-settings RPCs. The guard is enforced in
-- the database: acc_post_entry rejects a posting dated in a closed period, and a
-- trigger rejects voiding an entry dated in a closed period. A date with no
-- period row is NOT closed, so the guard is inert until periods are generated
-- and closed. Corrections to a closed period use a Module B reversal into an
-- open period.
-- ============================================================================

-- True iff a period row covers d and it is closed. No row -> not closed.
create or replace function acc_is_period_closed(d date) returns boolean
language sql stable as $$
  select exists (
    select 1 from acc_accounting_period
     where d between period_start and period_end and status = 'closed'
  );
$$;

-- Redefine the single posting function to add the closed-period guard. Body is
-- identical to migration 0001 plus the guard after the balance/empty checks.
create or replace function acc_post_entry(
  p_entry_date  date,
  p_description text,
  p_source_type acc_journal_source,
  p_source_id   uuid,
  p_currency    text,
  p_lines       jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_entry_id uuid;
  v_number   text;
  v_debit    bigint;
  v_credit   bigint;
  v_order    int := 0;
  v_line     jsonb;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to post journal entries';
  end if;

  select coalesce(sum((l->>'debit_minor')::bigint), 0),
         coalesce(sum((l->>'credit_minor')::bigint), 0)
    into v_debit, v_credit
    from jsonb_array_elements(p_lines) as l;

  if v_debit <> v_credit then
    raise exception 'Unbalanced posting: debit % <> credit %', v_debit, v_credit;
  end if;
  if v_debit = 0 then
    raise exception 'Refusing to post an empty/zero journal entry';
  end if;

  if acc_is_period_closed(p_entry_date) then
    raise exception 'Accounting period for % is closed', p_entry_date;
  end if;

  v_number := acc_next_number('journal_entry');

  insert into acc_journal_entry
    (entry_number, entry_date, description, source_type, source_id, currency_code, created_by)
  values
    (v_number, p_entry_date, p_description, p_source_type, p_source_id, p_currency, auth.uid())
  returning id into v_entry_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into acc_journal_line
      (journal_entry_id, account_id, debit_minor, credit_minor,
       amount_base_minor, tax_code_id, memo, line_order)
    values
      (v_entry_id,
       (v_line->>'account_id')::uuid,
       coalesce((v_line->>'debit_minor')::bigint, 0),
       coalesce((v_line->>'credit_minor')::bigint, 0),
       coalesce((v_line->>'amount_base_minor')::bigint, 0),
       nullif(v_line->>'tax_code_id', '')::uuid,
       v_line->>'memo',
       v_order);
    v_order := v_order + 1;
  end loop;

  return v_entry_id;
end;
$$;

-- Block voiding a journal entry dated in a closed period (all document void paths
-- do `update acc_journal_entry set status='void'`).
create or replace function acc_block_closed_period_void() returns trigger
language plpgsql as $$
begin
  if new.status = 'void' and old.status <> 'void' and acc_is_period_closed(old.entry_date) then
    raise exception 'Cannot void an entry in a closed period (%); reverse it into an open period', old.entry_date;
  end if;
  return new;
end;
$$;

create trigger acc_journal_entry_closed_period_void
  before update on acc_journal_entry
  for each row execute function acc_block_closed_period_void();

-- Generate the 12 monthly periods for a fiscal year from the current settings'
-- fiscal_year_start_month. Idempotent. Returns the number of periods created.
create or replace function acc_generate_periods(p_fiscal_year int) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_start_month int;
  v_created int := 0;
  i int;
  v_cal_year int;
  v_cal_month int;
  v_start date;
  v_end date;
begin
  if not acc_is_admin() then raise exception 'Only an admin can generate periods'; end if;

  select fiscal_year_start_month into v_start_month
    from acc_company_setting_version order by effective_from desc, version desc limit 1;
  v_start_month := coalesce(v_start_month, 1);

  for i in 1..12 loop
    v_cal_month := ((v_start_month - 1 + (i - 1)) % 12) + 1;
    v_cal_year  := p_fiscal_year + ((v_start_month - 1 + (i - 1)) / 12);
    v_start := make_date(v_cal_year, v_cal_month, 1);
    v_end   := (v_start + interval '1 month' - interval '1 day')::date;
    insert into acc_accounting_period (fiscal_year, period_month, period_start, period_end, label, status)
      values (p_fiscal_year, i, v_start, v_end, to_char(v_start, 'YYYY-MM'), 'open')
      on conflict (fiscal_year, period_month) do nothing;
    if found then v_created := v_created + 1; end if;
  end loop;
  return v_created;
end;
$$;

create or replace function acc_close_period(p_period_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_p acc_accounting_period;
begin
  if not acc_is_admin() then raise exception 'Only an admin can close a period'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A close reason is required'; end if;
  select * into v_p from acc_accounting_period where id = p_period_id for update;
  if not found then raise exception 'Period not found'; end if;
  if v_p.status = 'closed' then raise exception 'Period is already closed'; end if;
  update acc_accounting_period
     set status = 'closed', closed_by = auth.uid(), closed_at = now(), close_reason = p_reason
   where id = p_period_id;
  insert into acc_period_event (period_id, event, reason, actor_id) values (p_period_id, 'close', p_reason, auth.uid());
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_accounting_period', p_period_id, 'close', auth.uid());
end;
$$;

create or replace function acc_reopen_period(p_period_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_p acc_accounting_period;
begin
  if not acc_is_admin() then raise exception 'Only an admin can reopen a period'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reopen reason is required'; end if;
  select * into v_p from acc_accounting_period where id = p_period_id for update;
  if not found then raise exception 'Period not found'; end if;
  if v_p.status = 'open' then raise exception 'Period is already open'; end if;
  update acc_accounting_period
     set status = 'open', reopened_by = auth.uid(), reopened_at = now(), reopen_reason = p_reason
   where id = p_period_id;
  insert into acc_period_event (period_id, event, reason, actor_id) values (p_period_id, 'reopen', p_reason, auth.uid());
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_accounting_period', p_period_id, 'reopen', auth.uid());
end;
$$;

-- Append a new company-settings version. EIN is stored but not written to the
-- audit payload (only the action + record id are audited).
create or replace function acc_save_company_settings(
  p_legal_name text, p_dba_name text, p_ein_ref text,
  p_address_line1 text, p_address_line2 text, p_city text, p_region text, p_postal_code text, p_country text,
  p_fiscal_year_start_month int, p_base_currency_code text, p_time_zone text,
  p_accounting_basis text, p_default_payment_terms_days int
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_version int; v_id uuid;
begin
  if not acc_is_admin() then raise exception 'Only an admin can change company settings'; end if;
  if coalesce(btrim(p_legal_name), '') = '' then raise exception 'Legal name is required'; end if;
  select coalesce(max(version), 0) + 1 into v_version from acc_company_setting_version;
  insert into acc_company_setting_version
    (version, legal_name, dba_name, ein_ref, address_line1, address_line2, city, region, postal_code, country,
     fiscal_year_start_month, base_currency_code, time_zone, accounting_basis, default_payment_terms_days, created_by)
  values
    (v_version, p_legal_name, p_dba_name, p_ein_ref, p_address_line1, p_address_line2, p_city, p_region, p_postal_code, p_country,
     coalesce(p_fiscal_year_start_month, 1), coalesce(p_base_currency_code, 'USD'), coalesce(p_time_zone, 'America/New_York'),
     coalesce(p_accounting_basis, 'accrual')::acc_accounting_basis, coalesce(p_default_payment_terms_days, 30), auth.uid())
  returning id into v_id;
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_company_setting_version', v_id, 'insert', auth.uid());
  return v_id;
end;
$$;
```

- [ ] **Step 2: Sanity-check**

Run: `node -e "const fs=require('fs');const s=fs.readFileSync('supabase/migrations/0029_company_periods_functions.sql','utf8');for(const f of ['acc_is_period_closed','acc_post_entry','acc_block_closed_period_void','acc_generate_periods','acc_close_period','acc_reopen_period','acc_save_company_settings'])if(!s.includes(f)){console.error('missing '+f);process.exit(1)}if(!/acc_is_period_closed\(p_entry_date\)/.test(s)){console.error('post guard missing');process.exit(1)}console.log('ok')"`
Expected: prints `ok`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0029_company_periods_functions.sql
git commit -m "feat: closed-period guard in acc_post_entry + void trigger + period/settings RPCs"
```

---

## Task 3: Domain — period calendar + schemas

**Files:**
- Create: `lib/domain/periods.ts`
- Modify: `lib/domain/schemas.ts`
- Test: `tests/unit/periods.test.ts`, `tests/unit/periods-schema.test.ts`

**Interfaces:**
- Produces:
  - `PeriodRange = { fiscalYear: number; periodMonth: number; periodStart: string; periodEnd: string; label: string }`
  - `computePeriods(fiscalYearStartMonth: number, fiscalYear: number): PeriodRange[]` (12 entries)
  - `periodLabelOf(dateIso: string, fiscalYearStartMonth: number): string`
  - schemas `companySettingsSchema` → `CompanySettingsInput`, `closePeriodSchema`, `reopenPeriodSchema`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/periods.test.ts
import { describe, it, expect } from "vitest";
import { computePeriods, periodLabelOf } from "@/lib/domain/periods";

describe("computePeriods", () => {
  it("January fiscal start → Jan..Dec of the same calendar year", () => {
    const p = computePeriods(1, 2026);
    expect(p).toHaveLength(12);
    expect(p[0]).toEqual({ fiscalYear: 2026, periodMonth: 1, periodStart: "2026-01-01", periodEnd: "2026-01-31", label: "2026-01" });
    expect(p[1].periodEnd).toBe("2026-02-28"); // 2026 not a leap year
    expect(p[11]).toEqual({ fiscalYear: 2026, periodMonth: 12, periodStart: "2026-12-01", periodEnd: "2026-12-31", label: "2026-12" });
  });
  it("July fiscal start → Jul 2026 .. Jun 2027", () => {
    const p = computePeriods(7, 2026);
    expect(p[0]).toEqual({ fiscalYear: 2026, periodMonth: 1, periodStart: "2026-07-01", periodEnd: "2026-07-31", label: "2026-07" });
    expect(p[6]).toEqual({ fiscalYear: 2026, periodMonth: 7, periodStart: "2027-01-01", periodEnd: "2027-01-31", label: "2027-01" });
    expect(p[11]).toEqual({ fiscalYear: 2026, periodMonth: 12, periodStart: "2027-06-01", periodEnd: "2027-06-30", label: "2027-06" });
  });
});

describe("periodLabelOf", () => {
  it("returns the calendar-month label a date falls in", () => {
    expect(periodLabelOf("2027-01-15", 7)).toBe("2027-01");
    expect(periodLabelOf("2026-07-01", 7)).toBe("2026-07");
  });
});
```

```typescript
// tests/unit/periods-schema.test.ts
import { describe, it, expect } from "vitest";
import { companySettingsSchema, closePeriodSchema } from "@/lib/domain/schemas";

describe("companySettingsSchema", () => {
  it("requires legal name and a valid fiscal start month", () => {
    expect(companySettingsSchema.safeParse({ legal_name: "CTYHP LLC", fiscal_year_start_month: 1, accounting_basis: "accrual", default_payment_terms_days: 30 }).success).toBe(true);
    expect(companySettingsSchema.safeParse({ legal_name: "", fiscal_year_start_month: 1, accounting_basis: "accrual", default_payment_terms_days: 30 }).success).toBe(false);
    expect(companySettingsSchema.safeParse({ legal_name: "X", fiscal_year_start_month: 13, accounting_basis: "accrual", default_payment_terms_days: 30 }).success).toBe(false);
  });
});

describe("closePeriodSchema", () => {
  it("requires a non-empty reason", () => {
    expect(closePeriodSchema.safeParse({ reason: "" }).success).toBe(false);
    expect(closePeriodSchema.safeParse({ reason: "month-end close" }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- periods`
Expected: FAIL — module/schemas not found.

- [ ] **Step 3: Implement**

```typescript
// lib/domain/periods.ts
/**
 * Pure accounting-period calendar. Periods are monthly. `fiscalYear` is the
 * calendar year the fiscal year begins in; a non-January start spans two calendar
 * years. `periodMonth` is the 1..12 ordinal within the fiscal year (period 1 = the
 * start month). `label` is the ISO YYYY-MM of the period start.
 */
export interface PeriodRange {
  fiscalYear: number;
  periodMonth: number;
  periodStart: string;
  periodEnd: string;
  label: string;
}

function iso(y: number, m1: number, d: number): string {
  return `${y}-${String(m1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function lastDay(y: number, m1: number): number {
  // m1 is 1-based; Date.UTC(y, m1, 0) → last day of month m1.
  return new Date(Date.UTC(y, m1, 0)).getUTCDate();
}

export function computePeriods(fiscalYearStartMonth: number, fiscalYear: number): PeriodRange[] {
  const out: PeriodRange[] = [];
  for (let i = 0; i < 12; i++) {
    const offset = fiscalYearStartMonth - 1 + i;
    const calMonth = (offset % 12) + 1;
    const calYear = fiscalYear + Math.floor(offset / 12);
    out.push({
      fiscalYear,
      periodMonth: i + 1,
      periodStart: iso(calYear, calMonth, 1),
      periodEnd: iso(calYear, calMonth, lastDay(calYear, calMonth)),
      label: `${calYear}-${String(calMonth).padStart(2, "0")}`,
    });
  }
  return out;
}

export function periodLabelOf(dateIso: string, _fiscalYearStartMonth: number): string {
  // The display label is the calendar YYYY-MM of the date (independent of fiscal start).
  return dateIso.slice(0, 7);
}
```

Append to `lib/domain/schemas.ts`:

```typescript
// --- Company settings + accounting periods ---
export const companySettingsSchema = z.object({
  legal_name: z.string().trim().min(1, "Legal name is required").max(200),
  dba_name: z.string().trim().max(200).optional().or(z.literal("")).nullable(),
  ein_ref: z.string().trim().max(40).optional().or(z.literal("")).nullable(),
  address_line1: z.string().trim().max(200).optional().or(z.literal("")).nullable(),
  address_line2: z.string().trim().max(200).optional().or(z.literal("")).nullable(),
  city: z.string().trim().max(120).optional().or(z.literal("")).nullable(),
  region: z.string().trim().max(120).optional().or(z.literal("")).nullable(),
  postal_code: z.string().trim().max(20).optional().or(z.literal("")).nullable(),
  country: z.string().trim().max(80).optional().or(z.literal("")).nullable(),
  fiscal_year_start_month: z.number().int().min(1, "Month 1-12").max(12, "Month 1-12"),
  base_currency_code: z.string().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code").default("USD"),
  time_zone: z.string().trim().min(1).max(60).default("America/New_York"),
  accounting_basis: z.enum(["accrual", "cash"]),
  default_payment_terms_days: z.number().int().min(0, "Terms must be >= 0"),
});
export type CompanySettingsInput = z.infer<typeof companySettingsSchema>;

export const closePeriodSchema = z.object({ reason: z.string().trim().min(1, "A reason is required").max(300) });
export const reopenPeriodSchema = z.object({ reason: z.string().trim().min(1, "A reason is required").max(300) });
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- periods`
Expected: PASS (periods: 3 tests, periods-schema: 2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/domain/periods.ts lib/domain/schemas.ts tests/unit/periods.test.ts tests/unit/periods-schema.test.ts
git commit -m "feat: monthly period calendar helper + company-settings/period schemas"
```

---

## Task 4: db/types + services

**Files:**
- Modify: `lib/db/types.ts`
- Create: `lib/services/periods.ts`, `lib/services/company.ts`

**Interfaces:**
- Consumes: RPCs from Task 2; `CompanySettingsInput` from Task 3.
- Produces (all take `sb: SupabaseClient` first):
  - periods: `generatePeriods(sb, fiscalYear): Promise<number>`, `closePeriod(sb, id, reason): Promise<void>`, `reopenPeriod(sb, id, reason): Promise<void>`, `listPeriods(sb, fiscalYear): Promise<AccountingPeriodRow[]>`; `class PeriodsError extends Error`.
  - company: `getCurrentCompanySettings(sb): Promise<CompanySettingRow | null>`, `listCompanySettingVersions(sb): Promise<CompanySettingRow[]>`, `saveCompanySettings(sb, input): Promise<string>`; `class CompanyError extends Error`.

- [ ] **Step 1: Add row types**

Append to `lib/db/types.ts`:

```typescript
export type AccountingBasis = "accrual" | "cash";
export type PeriodStatus = "open" | "closed";

export interface AccountingPeriodRow {
  id: string; fiscal_year: number; period_month: number; period_start: string; period_end: string;
  label: string; status: PeriodStatus; close_reason: string | null; reopen_reason: string | null;
}
export interface CompanySettingRow {
  id: string; version: number; effective_from: string; legal_name: string; dba_name: string | null;
  ein_ref: string | null; address_line1: string | null; address_line2: string | null; city: string | null;
  region: string | null; postal_code: string | null; country: string | null; fiscal_year_start_month: number;
  base_currency_code: string; time_zone: string; accounting_basis: AccountingBasis; default_payment_terms_days: number;
  created_at: string;
}
```

- [ ] **Step 2: Write the services**

```typescript
// lib/services/periods.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountingPeriodRow } from "@/lib/db/types";

export class PeriodsError extends Error {}

export async function generatePeriods(sb: SupabaseClient, fiscalYear: number): Promise<number> {
  const { data, error } = await sb.rpc("acc_generate_periods", { p_fiscal_year: fiscalYear });
  if (error) throw new PeriodsError(error.message);
  return Number(data ?? 0);
}
export async function closePeriod(sb: SupabaseClient, id: string, reason: string): Promise<void> {
  const { error } = await sb.rpc("acc_close_period", { p_period_id: id, p_reason: reason });
  if (error) throw new PeriodsError(error.message);
}
export async function reopenPeriod(sb: SupabaseClient, id: string, reason: string): Promise<void> {
  const { error } = await sb.rpc("acc_reopen_period", { p_period_id: id, p_reason: reason });
  if (error) throw new PeriodsError(error.message);
}
export async function listPeriods(sb: SupabaseClient, fiscalYear: number): Promise<AccountingPeriodRow[]> {
  const { data, error } = await sb.from("acc_accounting_period")
    .select("id,fiscal_year,period_month,period_start,period_end,label,status,close_reason,reopen_reason")
    .eq("fiscal_year", fiscalYear)
    .order("period_month");
  if (error) throw new PeriodsError(error.message);
  return (data ?? []) as unknown as AccountingPeriodRow[];
}
```

```typescript
// lib/services/company.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompanySettingRow } from "@/lib/db/types";
import type { CompanySettingsInput } from "@/lib/domain/schemas";

export class CompanyError extends Error {}

const COLS =
  "id,version,effective_from,legal_name,dba_name,ein_ref,address_line1,address_line2,city,region,postal_code,country," +
  "fiscal_year_start_month,base_currency_code,time_zone,accounting_basis,default_payment_terms_days,created_at";

export async function getCurrentCompanySettings(sb: SupabaseClient): Promise<CompanySettingRow | null> {
  const { data, error } = await sb.from("acc_company_setting_version")
    .select(COLS).order("effective_from", { ascending: false }).order("version", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new CompanyError(error.message);
  return (data as unknown as CompanySettingRow) ?? null;
}
export async function listCompanySettingVersions(sb: SupabaseClient): Promise<CompanySettingRow[]> {
  const { data, error } = await sb.from("acc_company_setting_version").select(COLS).order("version", { ascending: false });
  if (error) throw new CompanyError(error.message);
  return (data ?? []) as unknown as CompanySettingRow[];
}
export async function saveCompanySettings(sb: SupabaseClient, input: CompanySettingsInput): Promise<string> {
  const { data, error } = await sb.rpc("acc_save_company_settings", {
    p_legal_name: input.legal_name, p_dba_name: input.dba_name || null, p_ein_ref: input.ein_ref || null,
    p_address_line1: input.address_line1 || null, p_address_line2: input.address_line2 || null, p_city: input.city || null,
    p_region: input.region || null, p_postal_code: input.postal_code || null, p_country: input.country || null,
    p_fiscal_year_start_month: input.fiscal_year_start_month, p_base_currency_code: input.base_currency_code,
    p_time_zone: input.time_zone, p_accounting_basis: input.accounting_basis, p_default_payment_terms_days: input.default_payment_terms_days,
  });
  if (error) throw new CompanyError(error.message);
  return data as string;
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/db/types.ts lib/services/periods.ts lib/services/company.ts
git commit -m "feat: periods + company-settings services"
```

---

## Task 5: Server actions

**Files:**
- Create: `app/(app)/settings/periods/actions.ts`, `app/(app)/settings/company/actions.ts`

**Interfaces:**
- Consumes: Task 4 services; Task 3 schemas; `getUserRole`, `isAdmin` from `@/lib/auth`.
- Produces `ActionResult<T>` actions: periods — `generatePeriodsAction`, `closePeriodAction`, `reopenPeriodAction`, `listPeriodsAction`; company — `saveCompanySettingsAction`, `listCompanySettingVersionsAction`.

- [ ] **Step 1: Periods actions**

```typescript
// app/(app)/settings/periods/actions.ts
"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, isAdmin } from "@/lib/auth";
import { closePeriodSchema, reopenPeriodSchema } from "@/lib/domain/schemas";
import { generatePeriods, closePeriod, reopenPeriod, listPeriods, PeriodsError } from "@/lib/services/periods";
import type { AccountingPeriodRow } from "@/lib/db/types";

export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }
async function adminGuard(): Promise<string | null> {
  const role = await getUserRole();
  return isAdmin(role) ? null : "Only an admin can manage accounting periods";
}
function msg(e: unknown): string { return e instanceof PeriodsError || e instanceof Error ? e.message : "An unexpected error occurred"; }

export async function generatePeriodsAction(fiscalYear: number): Promise<ActionResult<{ created: number }>> {
  const denied = await adminGuard(); if (denied) return { ok: false, error: denied };
  try { const sb = await createSupabaseServerClient(); const created = await generatePeriods(sb, fiscalYear); revalidatePath("/settings/periods"); return { ok: true, data: { created } }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
export async function closePeriodAction(id: string, raw: unknown): Promise<ActionResult> {
  const denied = await adminGuard(); if (denied) return { ok: false, error: denied };
  const parsed = closePeriodSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try { const sb = await createSupabaseServerClient(); await closePeriod(sb, id, parsed.data.reason); revalidatePath("/settings/periods"); return { ok: true }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
export async function reopenPeriodAction(id: string, raw: unknown): Promise<ActionResult> {
  const denied = await adminGuard(); if (denied) return { ok: false, error: denied };
  const parsed = reopenPeriodSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try { const sb = await createSupabaseServerClient(); await reopenPeriod(sb, id, parsed.data.reason); revalidatePath("/settings/periods"); return { ok: true }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
export async function listPeriodsAction(fiscalYear: number): Promise<ActionResult<AccountingPeriodRow[]>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await listPeriods(sb, fiscalYear) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
```

- [ ] **Step 2: Company actions**

```typescript
// app/(app)/settings/company/actions.ts
"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, isAdmin } from "@/lib/auth";
import { companySettingsSchema } from "@/lib/domain/schemas";
import { saveCompanySettings, listCompanySettingVersions, CompanyError } from "@/lib/services/company";
import type { CompanySettingRow } from "@/lib/db/types";

export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }
function msg(e: unknown): string { return e instanceof CompanyError || e instanceof Error ? e.message : "An unexpected error occurred"; }

export async function saveCompanySettingsAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const role = await getUserRole();
  if (!isAdmin(role)) return { ok: false, error: "Only an admin can change company settings" };
  const parsed = companySettingsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try { const sb = await createSupabaseServerClient(); const id = await saveCompanySettings(sb, parsed.data); revalidatePath("/settings/company"); return { ok: true, data: { id } }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
export async function listCompanySettingVersionsAction(): Promise<ActionResult<CompanySettingRow[]>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await listCompanySettingVersions(sb) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
```

- [ ] **Step 3: Typecheck + commit**

Run: `npm run typecheck`
Expected: clean.

```bash
git add "app/(app)/settings/periods/actions.ts" "app/(app)/settings/company/actions.ts"
git commit -m "feat: server actions for periods + company settings"
```

---

## Task 6: UI — Company settings

**Files:**
- Create: `app/(app)/settings/company/page.tsx`, `app/(app)/settings/company/CompanySettingsClient.tsx`

**Interfaces:**
- Consumes: `getCurrentCompanySettings`, `listCompanySettingVersions` (server); `saveCompanySettingsAction`.

Read `app/(app)/sales-tax` (a settings-like page) and `app/(app)/credit-memos/CreditMemosClient.tsx` for AntD conventions (`App.useApp()`, the `set-state-in-effect` eslint-disable if a load effect is used).

- [ ] **Step 1: Page (server component)**

```tsx
// app/(app)/settings/company/page.tsx
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, isAdmin } from "@/lib/auth";
import { getCurrentCompanySettings } from "@/lib/services/company";
import PageHeader from "@/components/PageHeader";
import CompanySettingsClient from "./CompanySettingsClient";

export const dynamic = "force-dynamic";

export default async function CompanySettingsPage() {
  const sb = await createSupabaseServerClient();
  const role = await getUserRole();
  const current = await getCurrentCompanySettings(sb);
  return (
    <div>
      <PageHeader title="Company Settings" description="Legal profile, fiscal year, and accounting basis. Changes are versioned." />
      <CompanySettingsClient canEdit={isAdmin(role)} current={current} />
    </div>
  );
}
```

- [ ] **Step 2: Client component**

`CompanySettingsClient.tsx` (`"use client"`):
- shows the current settings (EIN masked via a helper `maskEin(s)` → keep last 4, e.g. `••‑••‑1234`);
- an "Edit" form (admin only) pre-filled from `current`, fields: legal_name, dba_name, ein_ref, address lines, city/region/postal/country, fiscal_year_start_month (Select 1..12 with month names), accounting_basis (Select accrual/cash), default_payment_terms_days (InputNumber);
- submit → `saveCompanySettingsAction`; on success show a success message and reload;
- a "Version history" table via `listCompanySettingVersionsAction` (version, effective_from, legal_name, basis) — EIN shown masked there too.
Use `App.useApp()` for `message`. Guard the Edit/Save controls behind `canEdit`.

Full reference:

```tsx
// app/(app)/settings/company/CompanySettingsClient.tsx
"use client";
import { useEffect, useState } from "react";
import { App, Button, Card, Descriptions, Form, Input, InputNumber, Select, Space, Table } from "antd";
import { saveCompanySettingsAction, listCompanySettingVersionsAction } from "./actions";
import type { CompanySettingRow } from "@/lib/db/types";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
function maskEin(s: string | null | undefined): string {
  if (!s) return "—";
  const t = s.replace(/\s/g, "");
  return t.length <= 4 ? "••" : `•••••${t.slice(-4)}`;
}

export default function CompanySettingsClient({ canEdit, current }: { canEdit: boolean; current: CompanySettingRow | null }) {
  const { message } = App.useApp();
  const [editing, setEditing] = useState(false);
  const [form] = Form.useForm();
  const [versions, setVersions] = useState<CompanySettingRow[]>([]);

  const loadVersions = async () => {
    const r = await listCompanySettingVersionsAction();
    if (r.ok && r.data) setVersions(r.data); else message.error(r.error ?? "Failed to load versions");
  };
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadVersions(); }, []);

  const startEdit = () => {
    form.setFieldsValue({
      legal_name: current?.legal_name, dba_name: current?.dba_name, ein_ref: current?.ein_ref,
      address_line1: current?.address_line1, address_line2: current?.address_line2, city: current?.city,
      region: current?.region, postal_code: current?.postal_code, country: current?.country,
      fiscal_year_start_month: current?.fiscal_year_start_month ?? 1,
      base_currency_code: current?.base_currency_code ?? "USD",
      time_zone: current?.time_zone ?? "America/New_York",
      accounting_basis: current?.accounting_basis ?? "accrual",
      default_payment_terms_days: current?.default_payment_terms_days ?? 30,
    });
    setEditing(true);
  };

  const submit = async () => {
    const v = await form.validateFields();
    const r = await saveCompanySettingsAction(v);
    if (r.ok) { message.success("Settings saved (new version)"); setEditing(false); void loadVersions(); }
    else message.error(r.error ?? "Failed to save");
  };

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      {!editing && (
        <Card
          title="Current settings"
          extra={canEdit ? <Button type="primary" onClick={startEdit}>Edit</Button> : null}
        >
          {current ? (
            <Descriptions column={2} size="small">
              <Descriptions.Item label="Legal name">{current.legal_name}</Descriptions.Item>
              <Descriptions.Item label="DBA">{current.dba_name ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="EIN">{maskEin(current.ein_ref)}</Descriptions.Item>
              <Descriptions.Item label="Fiscal year start">{MONTHS[(current.fiscal_year_start_month ?? 1) - 1]}</Descriptions.Item>
              <Descriptions.Item label="Accounting basis">{current.accounting_basis}</Descriptions.Item>
              <Descriptions.Item label="Base currency">{current.base_currency_code}</Descriptions.Item>
              <Descriptions.Item label="Time zone">{current.time_zone}</Descriptions.Item>
              <Descriptions.Item label="Default terms (days)">{current.default_payment_terms_days}</Descriptions.Item>
            </Descriptions>
          ) : (
            <p>No company settings yet.{canEdit ? " Click Edit to create them." : ""}</p>
          )}
        </Card>
      )}
      {editing && (
        <Card title="Edit settings">
          <Form form={form} layout="vertical">
            <Form.Item name="legal_name" label="Legal name" rules={[{ required: true }]}><Input /></Form.Item>
            <Form.Item name="dba_name" label="DBA name"><Input /></Form.Item>
            <Form.Item name="ein_ref" label="EIN reference"><Input /></Form.Item>
            <Form.Item name="address_line1" label="Address line 1"><Input /></Form.Item>
            <Form.Item name="address_line2" label="Address line 2"><Input /></Form.Item>
            <Space wrap>
              <Form.Item name="city" label="City"><Input /></Form.Item>
              <Form.Item name="region" label="State/Region"><Input /></Form.Item>
              <Form.Item name="postal_code" label="Postal code"><Input /></Form.Item>
              <Form.Item name="country" label="Country"><Input /></Form.Item>
            </Space>
            <Space wrap>
              <Form.Item name="fiscal_year_start_month" label="Fiscal year start" rules={[{ required: true }]}>
                <Select style={{ width: 160 }} options={MONTHS.map((m, i) => ({ value: i + 1, label: m }))} />
              </Form.Item>
              <Form.Item name="accounting_basis" label="Accounting basis" rules={[{ required: true }]}>
                <Select style={{ width: 140 }} options={[{ value: "accrual", label: "Accrual" }, { value: "cash", label: "Cash" }]} />
              </Form.Item>
              <Form.Item name="base_currency_code" label="Base currency"><Input style={{ width: 100 }} /></Form.Item>
              <Form.Item name="time_zone" label="Time zone"><Input /></Form.Item>
              <Form.Item name="default_payment_terms_days" label="Default terms (days)"><InputNumber min={0} /></Form.Item>
            </Space>
            <Space>
              <Button type="primary" onClick={submit}>Save new version</Button>
              <Button onClick={() => setEditing(false)}>Cancel</Button>
            </Space>
          </Form>
        </Card>
      )}
      <Card title="Version history">
        <Table rowKey="id" size="small" dataSource={versions} pagination={false}
          columns={[
            { title: "Version", dataIndex: "version" },
            { title: "Effective", dataIndex: "effective_from" },
            { title: "Legal name", dataIndex: "legal_name" },
            { title: "Basis", dataIndex: "accounting_basis" },
            { title: "EIN", render: (_, r) => maskEin(r.ein_ref) },
          ]} />
      </Card>
    </Space>
  );
}
```

- [ ] **Step 3: Build + lint**

Run: `npm run build && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/settings/company/page.tsx" "app/(app)/settings/company/CompanySettingsClient.tsx"
git commit -m "feat: Company Settings page (versioned profile, masked EIN)"
```

---

## Task 7: UI — Periods + close/reopen + checklist + nav

**Files:**
- Create: `app/(app)/settings/periods/page.tsx`, `app/(app)/settings/periods/PeriodsClient.tsx`
- Modify: `components/AppShell.tsx`

**Interfaces:**
- Consumes: `listPeriodsAction`, `generatePeriodsAction`, `closePeriodAction`, `reopenPeriodAction`.

- [ ] **Step 1: Page (server component)**

```tsx
// app/(app)/settings/periods/page.tsx
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, isAdmin } from "@/lib/auth";
import { getCurrentCompanySettings } from "@/lib/services/company";
import PageHeader from "@/components/PageHeader";
import PeriodsClient from "./PeriodsClient";

export const dynamic = "force-dynamic";

export default async function PeriodsPage() {
  const sb = await createSupabaseServerClient();
  const role = await getUserRole();
  const current = await getCurrentCompanySettings(sb);
  return (
    <div>
      <PageHeader title="Accounting Periods" description="Generate monthly periods and close them to lock the ledger. Closed periods reject new postings and voids." />
      <PeriodsClient canEdit={isAdmin(role)} fiscalStartMonth={current?.fiscal_year_start_month ?? 1} />
    </div>
  );
}
```

- [ ] **Step 2: Client component**

`PeriodsClient.tsx` (`"use client"`):
- a fiscal-year `InputNumber` (default current year, computed client-side with `new Date().getFullYear()`), a "Generate periods" button (admin), and a table of periods for the selected year (label, start, end, status) with Close/Reopen row actions (admin) that open a reason modal (`modal.confirm` with an `Input`, like the Journal reverse flow);
- a "Closing checklist" `Card` listing links to `/reports/ar-ageing`, `/reports/ap-ageing`, `/banking/reconcile`, `/sales-tax` as controls to review before closing;
- loads via `listPeriodsAction(fiscalYear)` on year change; `App.useApp()`; eslint-disable on the load effect.

Full reference:

```tsx
// app/(app)/settings/periods/PeriodsClient.tsx
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { App, Button, Card, Input, InputNumber, Space, Table, Tag } from "antd";
import { listPeriodsAction, generatePeriodsAction, closePeriodAction, reopenPeriodAction } from "./actions";
import type { AccountingPeriodRow } from "@/lib/db/types";

export default function PeriodsClient({ canEdit, fiscalStartMonth }: { canEdit: boolean; fiscalStartMonth: number }) {
  const { message, modal } = App.useApp();
  const [year, setYear] = useState<number>(2026);
  const [rows, setRows] = useState<AccountingPeriodRow[]>([]);
  const [loading, setLoading] = useState(false);

  // Default to the current fiscal year on mount (client-only; avoids SSR Date drift).
  useEffect(() => { setYear(new Date().getFullYear()); }, []);

  const load = async (fy: number) => {
    setLoading(true);
    const r = await listPeriodsAction(fy);
    setLoading(false);
    if (r.ok && r.data) setRows(r.data); else message.error(r.error ?? "Failed to load");
  };
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(year); }, [year]);

  const generate = async () => {
    const r = await generatePeriodsAction(year);
    if (r.ok) { message.success(`Generated ${r.data?.created ?? 0} period(s)`); void load(year); }
    else message.error(r.error ?? "Failed");
  };

  const act = (row: AccountingPeriodRow, kind: "close" | "reopen") => {
    let reason = "";
    modal.confirm({
      title: `${kind === "close" ? "Close" : "Reopen"} ${row.label}?`,
      content: <Input placeholder="Reason" onChange={(e) => { reason = e.target.value; }} />,
      onOk: async () => {
        const r = kind === "close" ? await closePeriodAction(row.id, { reason }) : await reopenPeriodAction(row.id, { reason });
        if (r.ok) { message.success(kind === "close" ? "Period closed" : "Period reopened"); void load(year); }
        else { message.error(r.error ?? "Failed"); throw new Error(r.error); }
      },
    });
  };

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      <Space wrap>
        <span>Fiscal year:</span>
        <InputNumber value={year} onChange={(v) => setYear((v as number) ?? year)} />
        {canEdit && <Button type="primary" onClick={generate}>Generate periods</Button>}
      </Space>
      <Table rowKey="id" loading={loading} dataSource={rows} pagination={false}
        columns={[
          { title: "Period", dataIndex: "label" },
          { title: "Start", dataIndex: "period_start" },
          { title: "End", dataIndex: "period_end" },
          { title: "Status", dataIndex: "status", render: (s) => <Tag color={s === "closed" ? "red" : "green"}>{s}</Tag> },
          { title: "", render: (_, r) => canEdit ? (
            r.status === "open"
              ? <Button size="small" onClick={() => act(r, "close")}>Close</Button>
              : <Button size="small" onClick={() => act(r, "reopen")}>Reopen</Button>
          ) : null },
        ]} />
      <Card title="Closing checklist" size="small">
        <p>Review these controls before closing a period:</p>
        <ul>
          <li><Link href="/reports/ar-ageing">AR ageing reconciles to the AR control account</Link></li>
          <li><Link href="/reports/ap-ageing">AP ageing reconciles to the AP control account</Link></li>
          <li><Link href="/banking/reconcile">Bank accounts are reconciled</Link></li>
          <li><Link href="/sales-tax">Sales-tax liability is reviewed</Link></li>
        </ul>
      </Card>
    </Space>
  );
}
```

- [ ] **Step 3: Add nav entries**

In `components/AppShell.tsx`, add to `NAV` (reuse an already-imported icon, e.g. `TableOutlined` for periods and `SettingOutlined` if present — otherwise reuse an existing one; do NOT add a new import unless it already exists):

```tsx
  { key: "/settings/company", icon: <TableOutlined />, label: "Company" },
  { key: "/settings/periods", icon: <TableOutlined />, label: "Periods" },
```

(If `TableOutlined` is not already imported, use any icon already imported in the file.)

- [ ] **Step 4: Build + lint + typecheck**

Run: `npm run build && npm run lint && npm run typecheck`
Expected: all clean.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/settings/periods/page.tsx" "app/(app)/settings/periods/PeriodsClient.tsx" components/AppShell.tsx
git commit -m "feat: Accounting Periods page (generate, close/reopen, checklist) + nav"
```

---

## Task 8: E2E verify + full verification

**Files:**
- Create: `scripts/verify-periods.mjs`

**Interfaces:** consumes applied migrations 0028/0029; seeded admin login; the bank/income accounts for a manual JE.

- [ ] **Step 1: Write the verify script**

Follow the structure of `scripts/verify-journal.mjs` (admin login, `pg.Client`, `check()` helper, void-before-delete self-cleanup). Steps:
1. Ensure at least one company settings row exists (call `acc_save_company_settings` with `p_fiscal_year_start_month=1` if none) so `acc_generate_periods` has a fiscal start; `acc_generate_periods(2026)` → returns 12 (or 0 if already present — assert periods exist for 2026 either way by selecting count).
2. Pick an open month, say `2026-03`; post a manual JE dated `2026-03-15` via `acc_post_manual_journal` (bank `1010` / income `4000`, 100.00 each side) → succeeds; capture its entry id.
3. `acc_close_period` the `2026-03` period (look up its id by `fiscal_year=2026 and label='2026-03'`).
4. Attempt `acc_post_manual_journal` dated `2026-03-20` → expect ERROR (closed period). Attempt to void the first entry (`update acc_journal_entry set status='void' where id=<id>` via the pg client, or the manual-journal reverse path) → expect ERROR (closed-period void trigger).
5. `acc_reverse_entry(<first entry id>, 'correction', '2026-04-01')` → succeeds (reversal into open April).
6. `acc_reopen_period` the `2026-03` period → then `acc_post_manual_journal` dated `2026-03-21` → succeeds.
7. Company settings versioning: call `acc_save_company_settings` twice with different legal names → two versions; assert the current (latest) is the second; assert the `acc_audit_log` row for the settings insert does NOT contain the EIN value (select before_json/after_json is null / no EIN).

Note: the void attempt in step 4 must run as the authenticated admin via the `authed` supabase client's `.from('acc_journal_entry').update(...)` (so RLS + trigger apply) rather than the raw `db` pg client (which bypasses RLS as the DB owner) — the trigger fires regardless of client, but use the `authed` path so the test reflects real app behavior; capture and assert the error.

Cleanup (transaction, void-before-delete): first `delete from acc_period_event`; `delete from acc_accounting_period`; `delete from acc_company_setting_version` (only the rows this test created, or all if the DB is a dedicated test DB — match the existing verify scripts' approach); then reopen nothing needed; void + delete journal lines/entries created; reset sequences. IMPORTANT: because periods will have been deleted, the closed-period guard no longer blocks the cleanup's void/delete of the test journal entries.

- [ ] **Step 2: Apply migrations, then run**

Apply 0028/0029: `node --env-file=.env.local scripts/migrate.mjs` (applies pending migrations).
Run: `node --env-file=.env.local scripts/verify-periods.mjs`
Expected: all checks `PASS`, clean cleanup. If an RPC is missing, the migration is not applied — apply and re-run; do not claim a pass otherwise.

- [ ] **Step 3: Full project verification (mandatory, paste real output)**

Run: `npm run build && npm test && npm run typecheck && npm run lint`
Expected: build succeeds; all unit tests pass (existing + new periods, periods-schema); typecheck + lint clean.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-periods.mjs
git commit -m "test: end-to-end verify for accounting periods close/reopen guard"
```

---

## Self-Review

**Spec coverage:**
- US-FR-001 (versioned company settings; EIN protected) → Tasks 1,2 (`acc_save_company_settings`, EIN not audited), 4, 6.
- US-FR-003 (periods + close dates; posting to closed blocked; reopen needs reason + audit) → Tasks 1,2 (guard + trigger + close/reopen RPCs), 3 (calendar), 5, 7, 8.
- US-FR-004 (numbering unique/atomic/never reused) → already satisfied by `acc_sequence`; this cycle does not regress it (noted out-of-scope for a config UI).
- Manual "closed periods reject new or changed postings" → `acc_post_entry` guard + void trigger (Task 2), verified in Task 8.
- Manual "reopening requires reason; changes after reopening appear in an exception report" → reason enforced; `acc_period_event` + audit provide the history (a dedicated exception report view is a later enhancement — noted).
- Manual "closing checklist covers bank rec, AR/AP, sales tax" → checklist panel (Task 7).
- Deferred (cash-basis reporting, soft_closed, numbering UI, full approval) → out of scope per spec §1.

**Placeholder scan:** Task 8's verify script is described step-by-step with the exact RPC calls (mirrors the established verify-*.mjs structure); all other tasks contain complete code. No "TBD"/"handle edge cases".

**Type consistency:** service names (`generatePeriods`, `closePeriod`, `reopenPeriod`, `listPeriods`, `getCurrentCompanySettings`, `listCompanySettingVersions`, `saveCompanySettings`) match between Tasks 4 and 5. RPC names/params match between Tasks 2 and 4. `computePeriods`/`periodLabelOf`/schema names match between Tasks 3, 4, 6, 7. `AccountingPeriodRow`/`CompanySettingRow` shapes match between Tasks 4, 6, 7.

**Guard-coverage note:** `acc_post_entry` is the sole posting path, so the closed-period post guard covers every document type without touching each service. The void trigger covers every void path (all set `status='void'`). Reversal (`acc_reverse_entry`) posts through `acc_post_entry`, so it is itself blocked if the reversal date is in a closed period — correct: you reverse into an open period.
