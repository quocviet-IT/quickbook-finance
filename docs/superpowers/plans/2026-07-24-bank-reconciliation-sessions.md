# Bank Statement Reconciliation Sessions (F1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add period-end bank reconciliation: reconcile a bank GL account's posted journal lines to a statement ending balance, clear items, complete only at zero difference (or via an approved adjustment), lock, controlled reopen, and reconciliation + discrepancy reports.

**Architecture:** Two SQL migrations add `acc_statement_reconciliation` (session) + `acc_reconciliation_line` (session↔cleared journal line) and atomic `security definer` RPCs. A pure domain module computes the reconciliation math and the adjustment posting; a thin service calls the RPCs; Ant Design pages provide the workspace and reports. The ledger stays the single source of truth — reconciliation only links/flags existing posted lines and, for an adjustment, posts one balanced entry.

**Tech Stack:** Next.js (App Router), TypeScript, Supabase (Postgres/RLS), Ant Design, Zod, Vitest, `pg` for the verify script (DB reachable via the pooler).

## Global Constraints

- Money is integer minor units end-to-end; convert to decimal only at the UI edge via the currency's `decimal_places` (`fromMinor`/`toMinor`).
- All financial writes go through the service → an atomic Postgres RPC. No SQL in components. Never trust client-sent math — the server recomputes the difference on complete.
- Posting builders assert `debit == credit` via `assertBalanced` (`lib/domain/posting.ts`). Posting/money rules live ONLY in `lib/domain/`.
- Reconciliation posts NO journal entry except the optional adjustment; clearing/uncleared only inserts/deletes `acc_reconciliation_line` rows.
- Bank GL account is debit-normal: a cleared line's signed base amount = `amount_base_minor` if `debit_minor > 0`, else `-amount_base_minor`.
- Beginning balance is server-derived from the prior completed session; never trust a client value except for the first-ever session (which begins at 0).
- Completion requires difference = 0. A residual is resolved only by `acc_record_reconciliation_adjustment`, which posts an entry for exactly the outstanding difference and auto-clears it.
- Reopen is admin-only (`acc_is_admin()`) + a required reason; full maker-checker approval is deferred (Module C).
- Never swallow an error (no empty catch; always check `{ error }`). RLS on every new table (staff write, staff+viewer read). Every write RPC appends `acc_audit_log`.
- The adjustment entry uses `source_type='reconciliation'` (already in the `acc_journal_source` enum — no enum change).
- English is the canonical language. Commit messages must NOT contain any Claude attribution / Co-Authored-By / "Generated with Claude Code".
- All commands run from `c:/Users/pit010/QUICKBOOK_WEBAPP/ctyhp-accounting`. DB reachable over the pooler (`SUPABASE_DB_URL`); migrations applied via the Supabase SQL Editor before the live E2E.
- Next migration numbers: `0025`, `0026`.

---

## File Structure

- Create `supabase/migrations/0025_bank_reconciliation.sql` — tables + enum + RLS + indexes.
- Create `supabase/migrations/0026_bank_reconciliation_functions.sql` — write + read RPCs.
- Create `lib/domain/bankrec.ts` — `computeReconciliation`, `signedBaseMinor`, `buildAdjustmentPosting`.
- Modify `lib/domain/schemas.ts` — reconciliation create / adjustment / reopen schemas.
- Create `tests/unit/bankrec.test.ts`, `tests/unit/bankrec-schema.test.ts`.
- Modify `lib/db/types.ts` — row types.
- Create `lib/services/bankrec.ts` — service.
- Create `app/(app)/banking/reconcile/{page.tsx,ReconcileListClient.tsx,actions.ts}` — session list + create.
- Create `app/(app)/banking/reconcile/[id]/{page.tsx,ReconcileWorkspaceClient.tsx}` — session workspace.
- Create `app/(app)/banking/reconcile/[id]/report/page.tsx` — reconciliation report.
- Modify `components/AppShell.tsx` — nav "Reconcile".
- Create `scripts/verify-bankrec.mjs`.

---

## Task 1: Migration — schema

**Files:**
- Create: `supabase/migrations/0025_bank_reconciliation.sql`

**Interfaces:**
- Produces tables `acc_statement_reconciliation`, `acc_reconciliation_line`; enum `acc_reconciliation_session_status` (`in_progress`|`completed`).

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0025_bank_reconciliation.sql
-- ============================================================================
-- Bank statement reconciliation (F1). A session reconciles the posted journal
-- lines on a bank account's GL account to a statement ending balance. Separate
-- from acc_reconciliation (bank-line<->payment match suggestions). No changes to
-- existing tables.
-- ============================================================================

create type acc_reconciliation_session_status as enum ('in_progress', 'completed');

create table acc_statement_reconciliation (
  id                              uuid primary key default gen_random_uuid(),
  bank_account_id                 uuid not null references acc_bank_account (id),
  statement_ending_date           date not null,
  beginning_balance_minor         bigint not null default 0,
  statement_ending_balance_minor  bigint not null,
  status                          acc_reconciliation_session_status not null default 'in_progress',
  adjustment_entry_id             uuid references acc_journal_entry (id),
  adjustment_reason               text,
  statement_ref                   text,
  prepared_by                     uuid references auth.users (id),
  completed_by                    uuid references auth.users (id),
  completed_at                    timestamptz,
  reopened_by                     uuid references auth.users (id),
  reopen_reason                   text,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now()
);
create index acc_stmt_recon_account_idx on acc_statement_reconciliation (bank_account_id, status);
-- At most one in-progress session per bank account.
create unique index acc_stmt_recon_one_open
  on acc_statement_reconciliation (bank_account_id)
  where status = 'in_progress';

create table acc_reconciliation_line (
  id                uuid primary key default gen_random_uuid(),
  reconciliation_id uuid not null references acc_statement_reconciliation (id) on delete cascade,
  journal_line_id   uuid not null references acc_journal_line (id),
  cleared_at        timestamptz not null default now(),
  unique (reconciliation_id, journal_line_id)
);
create index acc_recon_line_journal_idx on acc_reconciliation_line (journal_line_id);

alter table acc_statement_reconciliation enable row level security;
alter table acc_reconciliation_line      enable row level security;

create policy acc_stmt_recon_sel on acc_statement_reconciliation
  for select using (acc_is_staff() or acc_current_role() = 'viewer');
create policy acc_stmt_recon_ins on acc_statement_reconciliation
  for insert with check (acc_is_staff());
create policy acc_stmt_recon_upd on acc_statement_reconciliation
  for update using (acc_is_staff());
create policy acc_recon_line_sel on acc_reconciliation_line
  for select using (acc_is_staff() or acc_current_role() = 'viewer');
create policy acc_recon_line_ins on acc_reconciliation_line
  for insert with check (acc_is_staff());
create policy acc_recon_line_del on acc_reconciliation_line
  for delete using (acc_is_staff());
```

- [ ] **Step 2: Sanity-check the SQL parses**

Run: `node -e "const fs=require('fs');const s=fs.readFileSync('supabase/migrations/0025_bank_reconciliation.sql','utf8');for(const t of ['acc_statement_reconciliation','acc_reconciliation_line'])if(!s.includes('create table '+t)){console.error('missing '+t);process.exit(1)}if(!/acc_stmt_recon_one_open/.test(s)){console.error('missing partial unique');process.exit(1)}console.log('ok')"`
Expected: prints `ok`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0025_bank_reconciliation.sql
git commit -m "feat: bank statement reconciliation session tables + RLS"
```

Note: apply 0025/0026 via the Supabase SQL Editor before the Task 9 live E2E.

---

## Task 2: Migration — RPCs

**Files:**
- Create: `supabase/migrations/0026_bank_reconciliation_functions.sql`

**Interfaces:**
- Consumes: `acc_post_entry`, `acc_is_staff`, `acc_is_admin`, `acc_to_base_minor`, tables from Task 1, `acc_bank_account`, `acc_journal_line`/`acc_journal_entry`.
- Produces RPCs: `acc_create_reconciliation(uuid,date,bigint) returns uuid`, `acc_set_cleared(uuid,uuid,boolean) returns void`, `acc_record_reconciliation_adjustment(uuid,uuid,text) returns uuid`, `acc_complete_reconciliation(uuid) returns void`, `acc_reopen_reconciliation(uuid,text) returns void`, and read functions `acc_reconciliation_lines(uuid)`, `acc_reconciliation_detail(uuid)`, `acc_reconciliation_discrepancies(uuid)`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0026_bank_reconciliation_functions.sql
-- ============================================================================
-- Bank reconciliation RPCs. Clearing posts nothing; only the optional adjustment
-- posts one balanced entry (source_type='reconciliation'). Completion recomputes
-- the difference server-side and requires zero. All staff-gated + audited.
-- ============================================================================

-- Signed base-currency amount of a bank GL line (debit-normal: deposit +, payment -).
create or replace function acc_recon_signed_base(p_line acc_journal_line) returns bigint
language sql immutable as $$
  select case when p_line.debit_minor > 0 then p_line.amount_base_minor else -p_line.amount_base_minor end;
$$;

-- Sum of signed base amounts of the lines cleared in a session.
create or replace function acc_recon_cleared_total(p_reconciliation_id uuid) returns bigint
language sql stable as $$
  select coalesce(sum(case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end), 0)::bigint
    from acc_reconciliation_line rl
    join acc_journal_line l on l.id = rl.journal_line_id
   where rl.reconciliation_id = p_reconciliation_id;
$$;

create or replace function acc_create_reconciliation(
  p_bank_account_id uuid, p_ending_date date, p_ending_balance_minor bigint
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_begin bigint; v_id uuid;
begin
  if not acc_is_staff() then raise exception 'Not authorized to start a reconciliation'; end if;
  if not exists (select 1 from acc_bank_account where id = p_bank_account_id) then
    raise exception 'Bank account not found';
  end if;
  if exists (select 1 from acc_statement_reconciliation
             where bank_account_id = p_bank_account_id and status = 'in_progress') then
    raise exception 'An in-progress reconciliation already exists for this bank account';
  end if;
  -- Beginning balance = the most recent completed session's ending balance (0 if none).
  select statement_ending_balance_minor into v_begin
    from acc_statement_reconciliation
   where bank_account_id = p_bank_account_id and status = 'completed'
   order by statement_ending_date desc, completed_at desc limit 1;
  v_begin := coalesce(v_begin, 0);

  insert into acc_statement_reconciliation
    (bank_account_id, statement_ending_date, beginning_balance_minor,
     statement_ending_balance_minor, status, prepared_by)
  values (p_bank_account_id, p_ending_date, v_begin, p_ending_balance_minor, 'in_progress', auth.uid())
  returning id into v_id;

  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_statement_reconciliation', v_id, 'insert', auth.uid());
  return v_id;
end;
$$;

-- Toggle a journal line's cleared state within an in-progress session.
create or replace function acc_set_cleared(
  p_reconciliation_id uuid, p_journal_line_id uuid, p_cleared boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare v_rec acc_statement_reconciliation; v_gl uuid; v_line acc_journal_line; v_entry acc_journal_entry;
begin
  if not acc_is_staff() then raise exception 'Not authorized'; end if;
  select * into v_rec from acc_statement_reconciliation where id = p_reconciliation_id for update;
  if not found then raise exception 'Reconciliation not found'; end if;
  if v_rec.status <> 'in_progress' then raise exception 'Reconciliation is not in progress'; end if;

  if p_cleared then
    select account_id into v_gl from acc_bank_account where id = v_rec.bank_account_id;
    select * into v_line from acc_journal_line where id = p_journal_line_id;
    if not found then raise exception 'Journal line not found'; end if;
    if v_line.account_id <> v_gl then raise exception 'Line does not belong to this bank account'; end if;
    select * into v_entry from acc_journal_entry where id = v_line.journal_entry_id;
    if v_entry.status <> 'posted' then raise exception 'Line entry is not posted'; end if;
    if v_entry.entry_date > v_rec.statement_ending_date then
      raise exception 'Line is dated after the statement ending date';
    end if;
    -- Not already reconciled by a DIFFERENT completed session.
    if exists (
      select 1 from acc_reconciliation_line rl
      join acc_statement_reconciliation r on r.id = rl.reconciliation_id
      where rl.journal_line_id = p_journal_line_id and r.status = 'completed' and r.id <> p_reconciliation_id
    ) then
      raise exception 'Line already reconciled in a completed session';
    end if;
    insert into acc_reconciliation_line (reconciliation_id, journal_line_id)
      values (p_reconciliation_id, p_journal_line_id)
      on conflict (reconciliation_id, journal_line_id) do nothing;
  else
    delete from acc_reconciliation_line
     where reconciliation_id = p_reconciliation_id and journal_line_id = p_journal_line_id;
  end if;
end;
$$;

-- Record an adjustment for exactly the outstanding difference and auto-clear it.
create or replace function acc_record_reconciliation_adjustment(
  p_reconciliation_id uuid, p_offset_account_id uuid, p_reason text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_rec acc_statement_reconciliation; v_gl uuid; v_ccy text;
  v_cleared bigint; v_diff bigint; v_off_type acc_account_type;
  v_base bigint; v_entry uuid; v_bank_line uuid; v_lines jsonb;
begin
  if not acc_is_staff() then raise exception 'Not authorized'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'An adjustment reason is required'; end if;
  select * into v_rec from acc_statement_reconciliation where id = p_reconciliation_id for update;
  if not found then raise exception 'Reconciliation not found'; end if;
  if v_rec.status <> 'in_progress' then raise exception 'Reconciliation is not in progress'; end if;
  if v_rec.adjustment_entry_id is not null then raise exception 'An adjustment already exists'; end if;

  select account_type into v_off_type from acc_account where id = p_offset_account_id;
  if v_off_type is null then raise exception 'Offset account not found'; end if;
  if v_off_type not in ('income','other_income','expense','cost_of_goods_sold','other_expense') then
    raise exception 'Adjustment offset must be an income or expense account';
  end if;

  select account_id into v_gl from acc_bank_account where id = v_rec.bank_account_id;
  select currency_code into v_ccy from acc_account where id = v_gl;
  v_cleared := acc_recon_cleared_total(p_reconciliation_id);
  v_diff := v_rec.statement_ending_balance_minor - (v_rec.beginning_balance_minor + v_cleared);
  if v_diff = 0 then raise exception 'No difference to adjust'; end if;

  v_base := acc_to_base_minor(abs(v_diff), v_ccy, v_rec.statement_ending_date);
  -- diff>0: bank must increase -> DR bank / CR offset. diff<0: CR bank / DR offset.
  if v_diff > 0 then
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_gl, 'debit_minor', abs(v_diff), 'credit_minor', 0, 'amount_base_minor', v_base, 'memo', 'Reconciliation adjustment'),
      jsonb_build_object('account_id', p_offset_account_id, 'debit_minor', 0, 'credit_minor', abs(v_diff), 'amount_base_minor', v_base, 'memo', 'Reconciliation adjustment'));
  else
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_gl, 'debit_minor', 0, 'credit_minor', abs(v_diff), 'amount_base_minor', v_base, 'memo', 'Reconciliation adjustment'),
      jsonb_build_object('account_id', p_offset_account_id, 'debit_minor', abs(v_diff), 'credit_minor', 0, 'amount_base_minor', v_base, 'memo', 'Reconciliation adjustment'));
  end if;

  v_entry := acc_post_entry(v_rec.statement_ending_date, 'Reconciliation adjustment', 'reconciliation', p_reconciliation_id, v_ccy, v_lines);
  select id into v_bank_line from acc_journal_line where journal_entry_id = v_entry and account_id = v_gl;
  insert into acc_reconciliation_line (reconciliation_id, journal_line_id) values (p_reconciliation_id, v_bank_line);
  update acc_statement_reconciliation
     set adjustment_entry_id = v_entry, adjustment_reason = p_reason, updated_at = now()
   where id = p_reconciliation_id;

  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_statement_reconciliation', p_reconciliation_id, 'update', auth.uid());
  return v_entry;
end;
$$;

create or replace function acc_complete_reconciliation(p_reconciliation_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_rec acc_statement_reconciliation; v_cleared bigint; v_diff bigint;
begin
  if not acc_is_staff() then raise exception 'Not authorized'; end if;
  select * into v_rec from acc_statement_reconciliation where id = p_reconciliation_id for update;
  if not found then raise exception 'Reconciliation not found'; end if;
  if v_rec.status <> 'in_progress' then raise exception 'Reconciliation is not in progress'; end if;
  v_cleared := acc_recon_cleared_total(p_reconciliation_id);
  v_diff := v_rec.statement_ending_balance_minor - (v_rec.beginning_balance_minor + v_cleared);
  if v_diff <> 0 then raise exception 'Cannot complete: unexplained difference of %', v_diff; end if;

  update acc_statement_reconciliation
     set status = 'completed', completed_by = auth.uid(), completed_at = now(), updated_at = now()
   where id = p_reconciliation_id;
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_statement_reconciliation', p_reconciliation_id, 'post', auth.uid());
end;
$$;

create or replace function acc_reopen_reconciliation(p_reconciliation_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_rec acc_statement_reconciliation;
begin
  if not acc_is_admin() then raise exception 'Only an admin can reopen a reconciliation'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reopen reason is required'; end if;
  select * into v_rec from acc_statement_reconciliation where id = p_reconciliation_id for update;
  if not found then raise exception 'Reconciliation not found'; end if;
  if v_rec.status <> 'completed' then raise exception 'Only a completed reconciliation can be reopened'; end if;
  -- Block reopen if a later completed session exists for the account (would break the beginning-balance chain).
  if exists (
    select 1 from acc_statement_reconciliation
     where bank_account_id = v_rec.bank_account_id and status = 'completed'
       and statement_ending_date > v_rec.statement_ending_date
  ) then
    raise exception 'A later completed reconciliation exists; reopen it first';
  end if;

  update acc_statement_reconciliation
     set status = 'in_progress', reopened_by = auth.uid(), reopen_reason = p_reason, completed_by = null, completed_at = null, updated_at = now()
   where id = p_reconciliation_id;
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_statement_reconciliation', p_reconciliation_id, 'void', auth.uid());
end;
$$;

-- Read: candidate + cleared lines for a session (with signed base amount + a cleared flag).
create or replace function acc_reconciliation_lines(p_reconciliation_id uuid)
returns table (journal_line_id uuid, entry_id uuid, entry_number text, entry_date date,
               source_type acc_journal_source, memo text, signed_minor bigint, cleared boolean)
language sql stable as $$
  with rec as (select * from acc_statement_reconciliation where id = p_reconciliation_id),
       gl as (select account_id from acc_bank_account where id = (select bank_account_id from rec))
  select l.id, e.id, e.entry_number, e.entry_date, e.source_type, l.memo,
         (case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end)::bigint,
         exists (select 1 from acc_reconciliation_line rl where rl.reconciliation_id = p_reconciliation_id and rl.journal_line_id = l.id)
    from acc_journal_line l
    join acc_journal_entry e on e.id = l.journal_entry_id
   where l.account_id = (select account_id from gl)
     and e.status = 'posted'
     and e.entry_date <= (select statement_ending_date from rec)
     and not exists (
       select 1 from acc_reconciliation_line rl2
       join acc_statement_reconciliation r2 on r2.id = rl2.reconciliation_id
       where rl2.journal_line_id = l.id and r2.status = 'completed' and r2.id <> p_reconciliation_id)
   order by e.entry_date, e.entry_number;
$$;

create or replace function acc_reconciliation_detail(p_reconciliation_id uuid)
returns table (beginning_minor bigint, statement_ending_minor bigint, cleared_total_minor bigint,
               reconciled_balance_minor bigint, difference_minor bigint, status acc_reconciliation_session_status)
language sql stable as $$
  select r.beginning_balance_minor, r.statement_ending_balance_minor,
         acc_recon_cleared_total(r.id),
         (r.beginning_balance_minor + acc_recon_cleared_total(r.id))::bigint,
         (r.statement_ending_balance_minor - (r.beginning_balance_minor + acc_recon_cleared_total(r.id)))::bigint,
         r.status
    from acc_statement_reconciliation r where r.id = p_reconciliation_id;
$$;

-- Discrepancies: lines reconciled in a completed session whose entry was later voided.
create or replace function acc_reconciliation_discrepancies(p_bank_account_id uuid)
returns table (reconciliation_id uuid, journal_line_id uuid, entry_number text, entry_date date, signed_minor bigint)
language sql stable as $$
  select r.id, l.id, e.entry_number, e.entry_date,
         (case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end)::bigint
    from acc_reconciliation_line rl
    join acc_statement_reconciliation r on r.id = rl.reconciliation_id
    join acc_journal_line l on l.id = rl.journal_line_id
    join acc_journal_entry e on e.id = l.journal_entry_id
   where r.bank_account_id = p_bank_account_id and r.status = 'completed' and e.status = 'void';
$$;
```

- [ ] **Step 2: Sanity-check**

Run: `node -e "const fs=require('fs');const s=fs.readFileSync('supabase/migrations/0026_bank_reconciliation_functions.sql','utf8');for(const f of ['acc_create_reconciliation','acc_set_cleared','acc_record_reconciliation_adjustment','acc_complete_reconciliation','acc_reopen_reconciliation','acc_reconciliation_lines','acc_reconciliation_detail','acc_reconciliation_discrepancies'])if(!s.includes('function '+f)){console.error('missing '+f);process.exit(1)}console.log('ok')"`
Expected: prints `ok`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0026_bank_reconciliation_functions.sql
git commit -m "feat: bank reconciliation RPCs (create, clear, adjust, complete, reopen, reports)"
```

---

## Task 3: Domain — reconciliation math + schemas

**Files:**
- Create: `lib/domain/bankrec.ts`
- Modify: `lib/domain/schemas.ts`
- Test: `tests/unit/bankrec.test.ts`, `tests/unit/bankrec-schema.test.ts`

**Interfaces:**
- Consumes: `JournalLineInput`, `assertBalanced`, `Minor` from `posting.ts`.
- Produces:
  - `ClearedLine = { debitMinor: number; creditMinor: number; amountBaseMinor: number }`
  - `signedBaseMinor(line: ClearedLine): number`
  - `computeReconciliation(beginningMinor: number, cleared: ClearedLine[], statementEndingMinor: number): { clearedTotalMinor: number; reconciledBalanceMinor: number; differenceMinor: number; isBalanced: boolean }`
  - `buildAdjustmentPosting(input: { bankAccountId: string; offsetAccountId: string; differenceMinor: number }): JournalLineInput[]`
  - schemas `reconciliationCreateSchema` → `ReconciliationCreateInput`, `reconciliationAdjustmentSchema` → `ReconciliationAdjustmentInput`, `reconciliationReopenSchema` → `ReconciliationReopenInput`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/bankrec.test.ts
import { describe, it, expect } from "vitest";
import { signedBaseMinor, computeReconciliation, buildAdjustmentPosting } from "@/lib/domain/bankrec";

const dep = { debitMinor: 100_00, creditMinor: 0, amountBaseMinor: 100_00 };  // deposit +
const pay = { debitMinor: 0, creditMinor: 40_00, amountBaseMinor: 40_00 };    // payment -

describe("signedBaseMinor", () => {
  it("deposits are positive, payments negative", () => {
    expect(signedBaseMinor(dep)).toBe(100_00);
    expect(signedBaseMinor(pay)).toBe(-40_00);
  });
});

describe("computeReconciliation", () => {
  it("reconciled = beginning + cleared; difference = statement - reconciled", () => {
    const r = computeReconciliation(10_00, [dep, pay], 70_00); // 10 + (100-40) = 70
    expect(r.clearedTotalMinor).toBe(60_00);
    expect(r.reconciledBalanceMinor).toBe(70_00);
    expect(r.differenceMinor).toBe(0);
    expect(r.isBalanced).toBe(true);
  });
  it("flags a non-zero difference", () => {
    const r = computeReconciliation(0, [dep], 90_00); // reconciled 100, statement 90 -> diff -10
    expect(r.differenceMinor).toBe(-10_00);
    expect(r.isBalanced).toBe(false);
  });
});

describe("buildAdjustmentPosting", () => {
  it("positive difference debits the bank (increase)", () => {
    const ls = buildAdjustmentPosting({ bankAccountId: "bank", offsetAccountId: "fee", differenceMinor: 5_00 });
    expect(ls.find((l) => l.accountId === "bank")!.debitMinor).toBe(5_00);
    expect(ls.find((l) => l.accountId === "fee")!.creditMinor).toBe(5_00);
  });
  it("negative difference credits the bank (decrease)", () => {
    const ls = buildAdjustmentPosting({ bankAccountId: "bank", offsetAccountId: "fee", differenceMinor: -5_00 });
    expect(ls.find((l) => l.accountId === "bank")!.creditMinor).toBe(5_00);
    expect(ls.find((l) => l.accountId === "fee")!.debitMinor).toBe(5_00);
  });
});
```

```typescript
// tests/unit/bankrec-schema.test.ts
import { describe, it, expect } from "vitest";
import { reconciliationCreateSchema, reconciliationAdjustmentSchema, reconciliationReopenSchema } from "@/lib/domain/schemas";

const uuid = "11111111-1111-4111-8111-111111111111";

describe("reconciliation schemas", () => {
  it("create requires bank account, date, ending balance (int)", () => {
    expect(reconciliationCreateSchema.safeParse({ bank_account_id: uuid, statement_ending_date: "2026-07-31", statement_ending_balance_minor: 100 }).success).toBe(true);
    expect(reconciliationCreateSchema.safeParse({ bank_account_id: uuid, statement_ending_date: "2026-07-31", statement_ending_balance_minor: 1.5 }).success).toBe(false);
  });
  it("adjustment requires offset account + non-empty reason", () => {
    expect(reconciliationAdjustmentSchema.safeParse({ offset_account_id: uuid, reason: "bank fee" }).success).toBe(true);
    expect(reconciliationAdjustmentSchema.safeParse({ offset_account_id: uuid, reason: "" }).success).toBe(false);
  });
  it("reopen requires a non-empty reason", () => {
    expect(reconciliationReopenSchema.safeParse({ reason: "" }).success).toBe(false);
    expect(reconciliationReopenSchema.safeParse({ reason: "error found" }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- bankrec`
Expected: FAIL — module/schemas not found.

- [ ] **Step 3: Implement the domain module**

```typescript
// lib/domain/bankrec.ts
/**
 * Pure bank-reconciliation math. The bank GL account is debit-normal, so a
 * cleared line's contribution is +amount_base when it debits the bank (a deposit)
 * and -amount_base when it credits it (a payment). Mirrors acc_recon_* in SQL.
 */
import { type JournalLineInput, type Minor, assertBalanced } from "./posting";

export interface ClearedLine {
  debitMinor: number;
  creditMinor: number;
  amountBaseMinor: number;
}

export function signedBaseMinor(line: ClearedLine): number {
  return line.debitMinor > 0 ? line.amountBaseMinor : -line.amountBaseMinor;
}

export function computeReconciliation(
  beginningMinor: number,
  cleared: ClearedLine[],
  statementEndingMinor: number,
): { clearedTotalMinor: number; reconciledBalanceMinor: number; differenceMinor: number; isBalanced: boolean } {
  const clearedTotalMinor = cleared.reduce((s, l) => s + signedBaseMinor(l), 0);
  const reconciledBalanceMinor = beginningMinor + clearedTotalMinor;
  const differenceMinor = statementEndingMinor - reconciledBalanceMinor;
  return { clearedTotalMinor, reconciledBalanceMinor, differenceMinor, isBalanced: differenceMinor === 0 };
}

/**
 * Adjustment for a residual difference. difference>0 → bank must increase (DR bank
 * / CR offset); difference<0 → bank must decrease (CR bank / DR offset).
 */
export function buildAdjustmentPosting(input: {
  bankAccountId: string;
  offsetAccountId: string;
  differenceMinor: number;
}): JournalLineInput[] {
  const amt: Minor = Math.abs(input.differenceMinor);
  if (amt === 0) throw new Error("No difference to adjust");
  const lines: JournalLineInput[] =
    input.differenceMinor > 0
      ? [
          { accountId: input.bankAccountId, debitMinor: amt, creditMinor: 0, memo: "Reconciliation adjustment" },
          { accountId: input.offsetAccountId, debitMinor: 0, creditMinor: amt, memo: "Reconciliation adjustment" },
        ]
      : [
          { accountId: input.bankAccountId, debitMinor: 0, creditMinor: amt, memo: "Reconciliation adjustment" },
          { accountId: input.offsetAccountId, debitMinor: amt, creditMinor: 0, memo: "Reconciliation adjustment" },
        ];
  assertBalanced(lines);
  return lines;
}
```

Append to `lib/domain/schemas.ts`:

```typescript
// --- Bank reconciliation ---
export const reconciliationCreateSchema = z.object({
  bank_account_id: z.uuid("Select a bank account"),
  statement_ending_date: z.string().min(1, "Statement ending date is required"),
  statement_ending_balance_minor: z.number().int("Ending balance must be a whole minor-unit amount"),
});
export type ReconciliationCreateInput = z.infer<typeof reconciliationCreateSchema>;

export const reconciliationAdjustmentSchema = z.object({
  offset_account_id: z.uuid("Select an offset account"),
  reason: z.string().trim().min(1, "A reason is required").max(300),
});
export type ReconciliationAdjustmentInput = z.infer<typeof reconciliationAdjustmentSchema>;

export const reconciliationReopenSchema = z.object({
  reason: z.string().trim().min(1, "A reopen reason is required").max(300),
});
export type ReconciliationReopenInput = z.infer<typeof reconciliationReopenSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- bankrec`
Expected: PASS (bankrec: 5 tests, bankrec-schema: 3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/domain/bankrec.ts lib/domain/schemas.ts tests/unit/bankrec.test.ts tests/unit/bankrec-schema.test.ts
git commit -m "feat: bank reconciliation domain math + adjustment builder + schemas"
```

---

## Task 4: db/types + service

**Files:**
- Modify: `lib/db/types.ts`
- Create: `lib/services/bankrec.ts`

**Interfaces:**
- Consumes: RPCs from Task 2; Zod input types from Task 3.
- Produces (all take `sb: SupabaseClient` first): `createReconciliation(sb, input: ReconciliationCreateInput): Promise<string>`, `setCleared(sb, reconciliationId, journalLineId, cleared): Promise<void>`, `recordAdjustment(sb, reconciliationId, input: ReconciliationAdjustmentInput): Promise<string>`, `completeReconciliation(sb, id): Promise<void>`, `reopenReconciliation(sb, id, input: ReconciliationReopenInput): Promise<void>`, `listReconciliations(sb, bankAccountId): Promise<StatementReconciliationRow[]>`, `getReconciliationLines(sb, id): Promise<ReconLineView[]>`, `getReconciliationDetail(sb, id): Promise<ReconDetail>`, `getDiscrepancies(sb, bankAccountId): Promise<DiscrepancyRow[]>`; `class BankRecError extends Error`; types `StatementReconciliationRow`, `ReconLineView`, `ReconDetail`, `DiscrepancyRow`.

- [ ] **Step 1: Add row types**

Append to `lib/db/types.ts`:

```typescript
export type ReconciliationSessionStatus = "in_progress" | "completed";

export interface StatementReconciliationRow {
  id: string;
  bank_account_id: string;
  statement_ending_date: string;
  beginning_balance_minor: number;
  statement_ending_balance_minor: number;
  status: ReconciliationSessionStatus;
  adjustment_entry_id: string | null;
  adjustment_reason: string | null;
  statement_ref: string | null;
  completed_at: string | null;
  created_at: string;
}
```

- [ ] **Step 2: Write the service**

```typescript
// lib/services/bankrec.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StatementReconciliationRow } from "@/lib/db/types";
import type { ReconciliationCreateInput, ReconciliationAdjustmentInput, ReconciliationReopenInput } from "@/lib/domain/schemas";

export class BankRecError extends Error {}

export interface ReconLineView {
  journalLineId: string; entryId: string; entryNumber: string | null; entryDate: string;
  sourceType: string; memo: string | null; signedMinor: number; cleared: boolean;
}
export interface ReconDetail {
  beginningMinor: number; statementEndingMinor: number; clearedTotalMinor: number;
  reconciledBalanceMinor: number; differenceMinor: number; status: string;
}
export interface DiscrepancyRow {
  reconciliationId: string; journalLineId: string; entryNumber: string | null; entryDate: string; signedMinor: number;
}

export async function createReconciliation(sb: SupabaseClient, input: ReconciliationCreateInput): Promise<string> {
  const { data, error } = await sb.rpc("acc_create_reconciliation", {
    p_bank_account_id: input.bank_account_id,
    p_ending_date: input.statement_ending_date,
    p_ending_balance_minor: input.statement_ending_balance_minor,
  });
  if (error) throw new BankRecError(error.message);
  return data as string;
}

export async function setCleared(sb: SupabaseClient, reconciliationId: string, journalLineId: string, cleared: boolean): Promise<void> {
  const { error } = await sb.rpc("acc_set_cleared", {
    p_reconciliation_id: reconciliationId, p_journal_line_id: journalLineId, p_cleared: cleared,
  });
  if (error) throw new BankRecError(error.message);
}

export async function recordAdjustment(sb: SupabaseClient, reconciliationId: string, input: ReconciliationAdjustmentInput): Promise<string> {
  const { data, error } = await sb.rpc("acc_record_reconciliation_adjustment", {
    p_reconciliation_id: reconciliationId, p_offset_account_id: input.offset_account_id, p_reason: input.reason,
  });
  if (error) throw new BankRecError(error.message);
  return data as string;
}

export async function completeReconciliation(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.rpc("acc_complete_reconciliation", { p_reconciliation_id: id });
  if (error) throw new BankRecError(error.message);
}

export async function reopenReconciliation(sb: SupabaseClient, id: string, input: ReconciliationReopenInput): Promise<void> {
  const { error } = await sb.rpc("acc_reopen_reconciliation", { p_reconciliation_id: id, p_reason: input.reason });
  if (error) throw new BankRecError(error.message);
}

export async function listReconciliations(sb: SupabaseClient, bankAccountId: string): Promise<StatementReconciliationRow[]> {
  const { data, error } = await sb.from("acc_statement_reconciliation")
    .select("id,bank_account_id,statement_ending_date,beginning_balance_minor,statement_ending_balance_minor,status,adjustment_entry_id,adjustment_reason,statement_ref,completed_at,created_at")
    .eq("bank_account_id", bankAccountId)
    .order("statement_ending_date", { ascending: false });
  if (error) throw new BankRecError(error.message);
  return (data ?? []) as unknown as StatementReconciliationRow[];
}

export async function getReconciliationLines(sb: SupabaseClient, id: string): Promise<ReconLineView[]> {
  const { data, error } = await sb.rpc("acc_reconciliation_lines", { p_reconciliation_id: id });
  if (error) throw new BankRecError(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    journalLineId: r.journal_line_id as string, entryId: r.entry_id as string,
    entryNumber: (r.entry_number as string) ?? null, entryDate: r.entry_date as string,
    sourceType: r.source_type as string, memo: (r.memo as string) ?? null,
    signedMinor: Number(r.signed_minor), cleared: Boolean(r.cleared),
  }));
}

export async function getReconciliationDetail(sb: SupabaseClient, id: string): Promise<ReconDetail> {
  const { data, error } = await sb.rpc("acc_reconciliation_detail", { p_reconciliation_id: id });
  if (error) throw new BankRecError(error.message);
  const r = (data ?? [])[0] as Record<string, unknown> | undefined;
  if (!r) throw new BankRecError("Reconciliation not found");
  return {
    beginningMinor: Number(r.beginning_minor), statementEndingMinor: Number(r.statement_ending_minor),
    clearedTotalMinor: Number(r.cleared_total_minor), reconciledBalanceMinor: Number(r.reconciled_balance_minor),
    differenceMinor: Number(r.difference_minor), status: r.status as string,
  };
}

export async function getDiscrepancies(sb: SupabaseClient, bankAccountId: string): Promise<DiscrepancyRow[]> {
  const { data, error } = await sb.rpc("acc_reconciliation_discrepancies", { p_bank_account_id: bankAccountId });
  if (error) throw new BankRecError(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    reconciliationId: r.reconciliation_id as string, journalLineId: r.journal_line_id as string,
    entryNumber: (r.entry_number as string) ?? null, entryDate: r.entry_date as string, signedMinor: Number(r.signed_minor),
  }));
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/db/types.ts lib/services/bankrec.ts
git commit -m "feat: bank reconciliation service (create, clear, adjust, complete, reopen, reads)"
```

---

## Task 5: Server actions

**Files:**
- Create: `app/(app)/banking/reconcile/actions.ts`

**Interfaces:**
- Consumes: Task 4 service; Task 3 schemas; `getUserRole`, `canWrite`, `isAdmin` from `@/lib/auth`.
- Produces `ActionResult<T>` actions: `createReconciliationAction`, `setClearedAction`, `recordAdjustmentAction`, `completeReconciliationAction`, `reopenReconciliationAction`, `listReconciliationsAction`, `reconciliationLinesAction`, `reconciliationDetailAction`, `discrepanciesAction`.

- [ ] **Step 1: Write the actions**

```typescript
// app/(app)/banking/reconcile/actions.ts
"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite, isAdmin } from "@/lib/auth";
import { reconciliationCreateSchema, reconciliationAdjustmentSchema, reconciliationReopenSchema } from "@/lib/domain/schemas";
import {
  createReconciliation, setCleared, recordAdjustment, completeReconciliation, reopenReconciliation,
  listReconciliations, getReconciliationLines, getReconciliationDetail, getDiscrepancies,
  BankRecError, type ReconLineView, type ReconDetail, type DiscrepancyRow,
} from "@/lib/services/bankrec";
import type { StatementReconciliationRow } from "@/lib/db/types";

export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }
async function guard(): Promise<string | null> {
  const role = await getUserRole();
  return canWrite(role) ? null : "You do not have permission to perform this action";
}
function msg(e: unknown): string { return e instanceof BankRecError || e instanceof Error ? e.message : "An unexpected error occurred"; }

export async function createReconciliationAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  const parsed = reconciliationCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try { const sb = await createSupabaseServerClient(); const id = await createReconciliation(sb, parsed.data); revalidatePath("/banking/reconcile"); return { ok: true, data: { id } }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

export async function setClearedAction(reconciliationId: string, journalLineId: string, cleared: boolean): Promise<ActionResult> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  try { const sb = await createSupabaseServerClient(); await setCleared(sb, reconciliationId, journalLineId, cleared); return { ok: true }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

export async function recordAdjustmentAction(reconciliationId: string, raw: unknown): Promise<ActionResult<{ entryId: string }>> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  const parsed = reconciliationAdjustmentSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try { const sb = await createSupabaseServerClient(); const entryId = await recordAdjustment(sb, reconciliationId, parsed.data); return { ok: true, data: { entryId } }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

export async function completeReconciliationAction(id: string): Promise<ActionResult> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  try { const sb = await createSupabaseServerClient(); await completeReconciliation(sb, id); revalidatePath("/banking/reconcile"); return { ok: true }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

export async function reopenReconciliationAction(id: string, raw: unknown): Promise<ActionResult> {
  const role = await getUserRole();
  if (!isAdmin(role)) return { ok: false, error: "Only an admin can reopen a reconciliation" };
  const parsed = reconciliationReopenSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try { const sb = await createSupabaseServerClient(); await reopenReconciliation(sb, id, parsed.data); revalidatePath("/banking/reconcile"); return { ok: true }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

export async function listReconciliationsAction(bankAccountId: string): Promise<ActionResult<StatementReconciliationRow[]>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await listReconciliations(sb, bankAccountId) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
export async function reconciliationLinesAction(id: string): Promise<ActionResult<ReconLineView[]>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await getReconciliationLines(sb, id) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
export async function reconciliationDetailAction(id: string): Promise<ActionResult<ReconDetail>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await getReconciliationDetail(sb, id) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
export async function discrepanciesAction(bankAccountId: string): Promise<ActionResult<DiscrepancyRow[]>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await getDiscrepancies(sb, bankAccountId) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `npm run typecheck`
Expected: clean.

```bash
git add "app/(app)/banking/reconcile/actions.ts"
git commit -m "feat: server actions for bank reconciliation"
```

---

## Task 6: UI — session list + create

**Files:**
- Create: `app/(app)/banking/reconcile/page.tsx`, `app/(app)/banking/reconcile/ReconcileListClient.tsx`

**Interfaces:**
- Consumes: `listReconciliationsAction`, `createReconciliationAction`; `listBankAccounts` (existing banking service), `listCurrencies`.

Read `app/(app)/banking/BankingClient.tsx` and `app/(app)/credit-memos/CreditMemosClient.tsx` first for this project's Ant Design v6 conventions (`App.useApp()`, the `eslint-disable react-hooks/set-state-in-effect` on the initial load effect, `fromMinor`/`toMinor`).

- [ ] **Step 1: Page (server component)**

```tsx
// app/(app)/banking/reconcile/page.tsx
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { listBankAccounts } from "@/lib/services/banking";
import { listCurrencies } from "@/lib/services/reference";
import PageHeader from "@/components/PageHeader";
import ReconcileListClient from "./ReconcileListClient";

export const dynamic = "force-dynamic";

export default async function ReconcilePage() {
  const sb = await createSupabaseServerClient();
  const role = await getUserRole();
  const [banks, currencies] = await Promise.all([listBankAccounts(sb), listCurrencies(sb)]);
  const base = currencies.find((c) => c.is_base);
  return (
    <div>
      <PageHeader title="Bank Reconciliation" description="Reconcile a bank account to its statement ending balance." />
      <ReconcileListClient
        canWrite={canWrite(role)}
        banks={banks.map((b) => ({ id: b.id, label: `${b.bank_name} · ${b.account_number_masked ?? ""}`.trim() }))}
        baseDecimals={base?.decimal_places ?? 2}
      />
    </div>
  );
}
```

(If `listBankAccounts` returns a different shape, map to `{ id, bank_name, account_number_masked }` — inspect `lib/services/banking.ts` `BankAccountWithGl` and adapt; note the adaptation.)

- [ ] **Step 2: Client component**

```tsx
// app/(app)/banking/reconcile/ReconcileListClient.tsx
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { App, Button, DatePicker, Form, InputNumber, Modal, Select, Space, Table, Tag } from "antd";
import { fromMinor, toMinor } from "@/lib/domain/money";
import { createReconciliationAction, listReconciliationsAction } from "./actions";
import type { StatementReconciliationRow } from "@/lib/db/types";

interface Bank { id: string; label: string; }
interface Props { canWrite: boolean; banks: Bank[]; baseDecimals: number; }

export default function ReconcileListClient({ canWrite, banks, baseDecimals }: Props) {
  const { message } = App.useApp();
  const [bankId, setBankId] = useState<string | undefined>(banks[0]?.id);
  const [rows, setRows] = useState<StatementReconciliationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();

  const load = async (id: string | undefined) => {
    if (!id) return;
    setLoading(true);
    const r = await listReconciliationsAction(id);
    setLoading(false);
    if (r.ok && r.data) setRows(r.data); else message.error(r.error ?? "Failed to load");
  };
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(bankId); }, [bankId]);

  const fmt = (m: number) => fromMinor(m, baseDecimals).toLocaleString(undefined, { minimumFractionDigits: baseDecimals });

  const submit = async () => {
    const v = await form.validateFields();
    const r = await createReconciliationAction({
      bank_account_id: bankId,
      statement_ending_date: v.ending_date.format("YYYY-MM-DD"),
      statement_ending_balance_minor: toMinor(v.ending_balance ?? 0, baseDecimals),
    });
    if (r.ok) { message.success("Reconciliation started"); setOpen(false); form.resetFields(); void load(bankId); }
    else message.error(r.error ?? "Failed");
  };

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      <Space wrap>
        <Select style={{ width: 320 }} value={bankId} onChange={setBankId} options={banks.map((b) => ({ value: b.id, label: b.label }))} />
        {canWrite && <Button type="primary" onClick={() => setOpen(true)} disabled={!bankId}>New reconciliation</Button>}
      </Space>
      <Table rowKey="id" loading={loading} dataSource={rows}
        columns={[
          { title: "Ending date", dataIndex: "statement_ending_date" },
          { title: "Beginning", align: "right", render: (_, r) => fmt(r.beginning_balance_minor) },
          { title: "Statement ending", align: "right", render: (_, r) => fmt(r.statement_ending_balance_minor) },
          { title: "Status", dataIndex: "status", render: (s) => <Tag color={s === "completed" ? "green" : "blue"}>{s}</Tag> },
          { title: "", render: (_, r) => <Link href={`/banking/reconcile/${r.id}`}>Open</Link> },
        ]} />
      <Modal open={open} title="New reconciliation" onCancel={() => setOpen(false)} onOk={submit}>
        <Form form={form} layout="vertical">
          <Form.Item name="ending_date" label="Statement ending date" rules={[{ required: true }]}><DatePicker /></Form.Item>
          <Form.Item name="ending_balance" label="Statement ending balance" rules={[{ required: true }]}>
            <InputNumber style={{ width: 200 }} precision={baseDecimals} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
```

- [ ] **Step 3: Build + lint**

Run: `npm run build && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/banking/reconcile/page.tsx" "app/(app)/banking/reconcile/ReconcileListClient.tsx"
git commit -m "feat: bank reconciliation session list + create"
```

---

## Task 7: UI — session workspace (clear / adjust / complete / reopen)

**Files:**
- Create: `app/(app)/banking/reconcile/[id]/page.tsx`, `app/(app)/banking/reconcile/[id]/ReconcileWorkspaceClient.tsx`

**Interfaces:**
- Consumes: `reconciliationLinesAction`, `reconciliationDetailAction`, `setClearedAction`, `recordAdjustmentAction`, `completeReconciliationAction`, `reopenReconciliationAction`.

- [ ] **Step 1: Page (server component)**

```tsx
// app/(app)/banking/reconcile/[id]/page.tsx
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite, isAdmin } from "@/lib/auth";
import { listAccounts } from "@/lib/services/accounts";
import { listCurrencies } from "@/lib/services/reference";
import PageHeader from "@/components/PageHeader";
import ReconcileWorkspaceClient from "./ReconcileWorkspaceClient";

export const dynamic = "force-dynamic";

export default async function ReconcileWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createSupabaseServerClient();
  const role = await getUserRole();
  const [accounts, currencies] = await Promise.all([listAccounts(sb), listCurrencies(sb)]);
  const base = currencies.find((c) => c.is_base);
  const offsets = accounts.filter(
    (a) => ["income", "other_income", "expense", "cost_of_goods_sold", "other_expense"].includes(a.account_type) && a.is_posting_account && a.status === "active",
  );
  return (
    <div>
      <PageHeader title="Reconciliation" description="Clear items until the difference is zero, then complete." />
      <ReconcileWorkspaceClient
        reconciliationId={id}
        canWrite={canWrite(role)}
        canReopen={isAdmin(role)}
        offsetAccounts={offsets.map((a) => ({ id: a.id, label: `${a.account_code} ${a.name}` }))}
        baseCurrency={base?.code ?? "USD"}
        baseDecimals={base?.decimal_places ?? 2}
      />
    </div>
  );
}
```

- [ ] **Step 2: Client component**

```tsx
// app/(app)/banking/reconcile/[id]/ReconcileWorkspaceClient.tsx
"use client";
import { useEffect, useState, useCallback } from "react";
import { App, Alert, Button, Form, Input, Modal, Select, Space, Statistic, Table, Tag } from "antd";
import { fromMinor } from "@/lib/domain/money";
import {
  reconciliationLinesAction, reconciliationDetailAction, setClearedAction,
  recordAdjustmentAction, completeReconciliationAction, reopenReconciliationAction,
} from "../actions";
import type { ReconLineView, ReconDetail } from "@/lib/services/bankrec";

interface Offset { id: string; label: string; }
interface Props { reconciliationId: string; canWrite: boolean; canReopen: boolean; offsetAccounts: Offset[]; baseCurrency: string; baseDecimals: number; }

export default function ReconcileWorkspaceClient({ reconciliationId, canWrite, canReopen, offsetAccounts, baseCurrency, baseDecimals }: Props) {
  const { message, modal } = App.useApp();
  const [lines, setLines] = useState<ReconLineView[]>([]);
  const [detail, setDetail] = useState<ReconDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [adjOpen, setAdjOpen] = useState(false);
  const [form] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    const [l, d] = await Promise.all([reconciliationLinesAction(reconciliationId), reconciliationDetailAction(reconciliationId)]);
    setLoading(false);
    if (l.ok && l.data) setLines(l.data); else message.error(l.error ?? "Failed");
    if (d.ok && d.data) setDetail(d.data); else message.error(d.error ?? "Failed");
  }, [reconciliationId, message]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const fmt = (m: number) => fromMinor(m, baseDecimals).toLocaleString(undefined, { minimumFractionDigits: baseDecimals });
  const completed = detail?.status === "completed";

  const toggle = async (line: ReconLineView, cleared: boolean) => {
    const r = await setClearedAction(reconciliationId, line.journalLineId, cleared);
    if (r.ok) void load(); else message.error(r.error ?? "Failed");
  };

  const submitAdjust = async () => {
    const v = await form.validateFields();
    const r = await recordAdjustmentAction(reconciliationId, { offset_account_id: v.offset_account_id, reason: v.reason });
    if (r.ok) { message.success("Adjustment recorded"); setAdjOpen(false); form.resetFields(); void load(); }
    else message.error(r.error ?? "Failed");
  };

  const complete = async () => {
    const r = await completeReconciliationAction(reconciliationId);
    if (r.ok) { message.success("Reconciliation completed"); void load(); } else message.error(r.error ?? "Failed");
  };

  const reopen = () => {
    let reason = "";
    modal.confirm({
      title: "Reopen reconciliation?",
      content: <Input placeholder="Reason" onChange={(e) => { reason = e.target.value; }} />,
      onOk: async () => {
        const r = await reopenReconciliationAction(reconciliationId, { reason });
        if (r.ok) { message.success("Reopened"); void load(); } else { message.error(r.error ?? "Failed"); throw new Error(r.error); }
      },
    });
  };

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      {detail && (
        <Space size="large" wrap>
          <Statistic title="Beginning" value={fmt(detail.beginningMinor)} />
          <Statistic title="Cleared" value={fmt(detail.clearedTotalMinor)} />
          <Statistic title="Reconciled balance" value={fmt(detail.reconciledBalanceMinor)} />
          <Statistic title="Statement ending" value={fmt(detail.statementEndingMinor)} />
          <Statistic title="Difference" value={fmt(detail.differenceMinor)} />
          <Tag color={completed ? "green" : "blue"}>{detail.status}</Tag>
        </Space>
      )}
      {detail && !completed && (
        <Alert type={detail.differenceMinor === 0 ? "success" : "warning"}
          message={detail.differenceMinor === 0 ? "Difference is zero — ready to complete." : `Unexplained difference: ${fmt(detail.differenceMinor)} ${baseCurrency}.`} />
      )}
      {canWrite && !completed && (
        <Space>
          <Button type="primary" disabled={!detail || detail.differenceMinor !== 0} onClick={complete}>Complete</Button>
          <Button disabled={!detail || detail.differenceMinor === 0} onClick={() => setAdjOpen(true)}>Record adjustment</Button>
        </Space>
      )}
      {completed && canReopen && <Button danger onClick={reopen}>Reopen</Button>}
      <Table rowKey="journalLineId" loading={loading} dataSource={lines}
        columns={[
          { title: "Cleared", render: (_, l) => (
            <input type="checkbox" checked={l.cleared} disabled={!canWrite || completed} onChange={(e) => toggle(l, e.target.checked)} />
          ) },
          { title: "Date", dataIndex: "entryDate" },
          { title: "Entry", dataIndex: "entryNumber" },
          { title: "Source", dataIndex: "sourceType", render: (s) => <Tag>{s}</Tag> },
          { title: "Memo", dataIndex: "memo" },
          { title: "Amount", align: "right", render: (_, l) => fmt(l.signedMinor) },
        ]} />
      <Modal open={adjOpen} title="Record adjustment" onCancel={() => setAdjOpen(false)} onOk={submitAdjust}>
        <p>An adjusting entry for the outstanding difference {detail ? `(${fmt(detail.differenceMinor)} ${baseCurrency})` : ""} will post to the selected account.</p>
        <Form form={form} layout="vertical">
          <Form.Item name="offset_account_id" label="Offset account (bank charges / interest)" rules={[{ required: true }]}>
            <Select showSearch optionFilterProp="label" options={offsetAccounts.map((a) => ({ value: a.id, label: a.label }))} />
          </Form.Item>
          <Form.Item name="reason" label="Reason" rules={[{ required: true }]}><Input /></Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
```

- [ ] **Step 3: Build + lint**

Run: `npm run build && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/banking/reconcile/[id]/page.tsx" "app/(app)/banking/reconcile/[id]/ReconcileWorkspaceClient.tsx"
git commit -m "feat: bank reconciliation workspace (clear, adjust, complete, reopen)"
```

---

## Task 8: UI — reconciliation report + discrepancies + nav

**Files:**
- Create: `app/(app)/banking/reconcile/[id]/report/page.tsx`
- Modify: `app/(app)/banking/reconcile/[id]/ReconcileWorkspaceClient.tsx` (add a "View report" link + a discrepancy note), or add a discrepancies panel to the list client
- Modify: `components/AppShell.tsx`

- [ ] **Step 1: Report page (server component, reproducible)**

```tsx
// app/(app)/banking/reconcile/[id]/report/page.tsx
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getReconciliationDetail, getReconciliationLines } from "@/lib/services/bankrec";
import { listCurrencies } from "@/lib/services/reference";
import { fromMinor } from "@/lib/domain/money";
import PageHeader from "@/components/PageHeader";

export const dynamic = "force-dynamic";

export default async function ReconciliationReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = await createSupabaseServerClient();
  const [detail, lines, currencies] = await Promise.all([
    getReconciliationDetail(sb, id), getReconciliationLines(sb, id), listCurrencies(sb),
  ]);
  const base = currencies.find((c) => c.is_base);
  const dec = base?.decimal_places ?? 2;
  const fmt = (m: number) => fromMinor(m, dec).toLocaleString(undefined, { minimumFractionDigits: dec });
  const cleared = lines.filter((l) => l.cleared);
  return (
    <div>
      <PageHeader title="Reconciliation report" description={`Base currency ${base?.code ?? "USD"} · Status ${detail.status}`} />
      <p><Link href={`/banking/reconcile/${id}`}>← Back to session</Link></p>
      <table>
        <tbody>
          <tr><td>Beginning balance</td><td style={{ textAlign: "right" }}>{fmt(detail.beginningMinor)}</td></tr>
          <tr><td>Cleared total</td><td style={{ textAlign: "right" }}>{fmt(detail.clearedTotalMinor)}</td></tr>
          <tr><td>Reconciled balance</td><td style={{ textAlign: "right" }}>{fmt(detail.reconciledBalanceMinor)}</td></tr>
          <tr><td>Statement ending</td><td style={{ textAlign: "right" }}>{fmt(detail.statementEndingMinor)}</td></tr>
          <tr><td>Difference</td><td style={{ textAlign: "right" }}>{fmt(detail.differenceMinor)}</td></tr>
        </tbody>
      </table>
      <h3>Cleared items ({cleared.length})</h3>
      <ul>
        {cleared.map((l) => (
          <li key={l.journalLineId}>{l.entryDate} · {l.entryNumber} · {l.sourceType} · {fmt(l.signedMinor)}</li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Add a "View report" link in the workspace**

In `ReconcileWorkspaceClient.tsx`, add near the action buttons (import `Link from "next/link"`):

```tsx
      <Link href={`/banking/reconcile/${reconciliationId}/report`}>View report</Link>
```

- [ ] **Step 3: Add nav entry**

In `components/AppShell.tsx`, add to `NAV` (reuse the already-imported `BankOutlined`):

```tsx
  { key: "/banking/reconcile", icon: <BankOutlined />, label: "Reconcile" },
```

- [ ] **Step 4: Build + lint + typecheck**

Run: `npm run build && npm run lint && npm run typecheck`
Expected: all clean.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/banking/reconcile/[id]/report/page.tsx" "app/(app)/banking/reconcile/[id]/ReconcileWorkspaceClient.tsx" components/AppShell.tsx
git commit -m "feat: reconciliation report page + nav"
```

---

## Task 9: End-to-end verify + full verification

**Files:**
- Create: `scripts/verify-bankrec.mjs`

**Interfaces:** consumes applied migrations 0025/0026; seeded admin login; a bank account (create one if none), a customer, `acc_record_payment`, an expense account for the adjustment offset.

- [ ] **Step 1: Write the verify script**

Follow the structure of `scripts/verify-journal.mjs` (admin login, `pg.Client` over `SUPABASE_DB_URL`, `check()` helper, void-before-delete self-cleanup). Steps:
1. Ensure a bank account exists (insert `acc_bank_account` referencing the seeded bank GL account `1010` if none); create a customer; record a payment of 500.00 to the bank via `acc_record_payment` (posts DR bank / CR AR).
2. `acc_create_reconciliation(bank_account_id, ending_date, 500_00)` → session; `acc_reconciliation_detail` shows difference = 500_00 (nothing cleared) then, after `acc_set_cleared(session, bankLineId, true)` for the payment's bank line, difference = 0.
3. `acc_complete_reconciliation(session)` → status completed; a NEW session's `acc_reconciliation_lines` no longer lists that line (reconciled by a completed session).
4. Adjustment path: new session with ending balance = current bank balance + 3_00; clear the relevant lines leaving a 3_00 difference; `acc_record_reconciliation_adjustment(session, expenseAccountId, 'bank fee')` → difference 0; complete.
5. `acc_reopen_reconciliation` (as admin) on the first completed session should fail because a later completed session exists (chain guard) — assert error; reopen the latest instead → status in_progress.
6. Void a reconciled entry (the payment) via `acc_void_invoice`/direct — actually void the payment's entry by setting the journal entry void through the payment void path if available, else `update acc_journal_entry set status='void'` in cleanup only. For the discrepancy check: mark the payment's entry void and assert `acc_reconciliation_discrepancies(bank_account_id)` returns it. (Do this as a dedicated check before cleanup.)

To find the payment's bank journal line: `select l.id from acc_journal_line l join acc_journal_entry e on e.id=l.journal_entry_id where e.id = <payment entry> and l.account_id = <bank GL account>`.

Cleanup (transaction, void-before-delete): delete `acc_reconciliation_line`; delete `acc_statement_reconciliation`; then void + delete journal lines/entries; delete the payment/customer/bank account created by the test; reset sequences.

- [ ] **Step 2: Apply migrations, then run**

Apply `0025`/`0026` via the Supabase SQL Editor.
Run: `node --env-file=.env.local scripts/verify-bankrec.mjs`
Expected: all checks `PASS`, clean cleanup. If a migration is not applied yet (RPC missing), apply it and re-run — do not claim a pass otherwise.

- [ ] **Step 3: Full project verification (mandatory, paste real output)**

Run: `npm run build && npm test && npm run typecheck && npm run lint`
Expected: build succeeds; all unit tests pass (existing + new bankrec, bankrec-schema); typecheck + lint clean.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-bankrec.mjs
git commit -m "test: end-to-end verify for bank reconciliation sessions"
```

---

## Self-Review

**Spec coverage:**
- US-FR-063 (session stores account/date/beginning/ending/status/preparer; beginning agrees with prior; cleared linked; complete requires zero or approved adjustment) → Tasks 1,2,3,4,7,9.
- US-FR-064 (lock completed; controlled reopen with reason/permission) → Tasks 2 (`acc_complete`/`acc_reopen` admin+reason), 5, 7.
- US-FR-065 (reconciliation report + discrepancy report, reproducible) → Tasks 2 (`acc_reconciliation_detail`/`_discrepancies`), 8, 9.
- Manual "beginning agrees with previous completed" → `acc_create_reconciliation` derives it; reopen chain-guard (Task 2) protects it.
- Manual "later changes to reconciled transactions create discrepancy history" → discrepancy RPC + report (void of a reconciled entry).
- Manual concurrency (one in-progress per account; line reconciled once) → partial unique index (Task 1) + `acc_set_cleared` completed-session guard (Task 2).
- Deferred (transaction review, bank rules, statement attachment, full approval) → out of scope per spec §1.

**Placeholder scan:** Task 9's verify script is described step-by-step with the exact RPC calls and the bank-line lookup query rather than one verbatim block (it mirrors the established verify-*.mjs structure); every other task has complete code. No "TBD"/"handle edge cases".

**Type consistency:** service names (`createReconciliation`, `setCleared`, `recordAdjustment`, `completeReconciliation`, `reopenReconciliation`, `listReconciliations`, `getReconciliationLines`, `getReconciliationDetail`, `getDiscrepancies`) match between Tasks 4 and 5. RPC names/params match between Tasks 2 and 4. Domain names (`computeReconciliation`, `signedBaseMinor`, `buildAdjustmentPosting`) and schema names match between Tasks 3, 7. `ReconLineView`/`ReconDetail` shapes match between Tasks 4, 7, 8.

**Note on adjustment amount:** the adjustment RPC derives the amount from the server-computed difference (does not trust a client amount) and posts exactly that, guaranteeing completion reaches zero — the `reconciliationAdjustmentSchema` intentionally carries only `offset_account_id` + `reason`. This is a deliberate refinement over the spec's mention of an amount field, and is the safer design.
