# AR/AP Credits, Refunds, Write-offs, Ageing & Statements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add credit memos, vendor credits, customer refunds, write-offs, AR/AP ageing, and customer/vendor statements on top of the existing invoice/payment and bill/bill-payment subledgers.

**Architecture:** Three new SQL migrations (schema, write RPCs, read RPCs) add six document tables and their allocation tables plus atomic `security definer` RPCs that mirror the existing invoice/payment/bill patterns. Pure posting builders + an ageing helper + Zod schemas are unit-tested; thin services call the RPCs; Ant Design pages provide the UI. The ledger stays the single source of truth and ageing reconciles to the AR/AP control accounts.

**Tech Stack:** Next.js (App Router), TypeScript, Supabase (Postgres/RLS), Ant Design, Zod, Vitest, `pg` for the verify script (DB reachable via the pooler).

## Global Constraints

- Money is integer minor units end-to-end; convert to decimal only at the UI edge via the currency's `decimal_places` (`fromMinor`/`toMinor`).
- All financial writes go through the service → an atomic Postgres RPC. No SQL in components. Never trust client-sent totals — recompute/validate server-side.
- Posting builders must assert `debit == credit` via `assertBalanced` (`lib/domain/posting.ts`). Do NOT re-implement a posting/money rule anywhere except `lib/domain/`.
- **Void = mark the journal entry `status='void'` and restore balances; never post a reversal** (reports count `status='posted'` only — this is the established pattern from migration 0013 and `acc_void_bill`).
- **Allocation posts no journal entry** — a credit memo already credited AR on issue and the invoice debited AR, so applying one to the other only moves `balance_due_minor`/`balance_remaining_minor` and advances status.
- Allocation validation (mirror `acc_pay_bills`): target must belong to the same customer/vendor, same currency, be in an open state (`issued`/`partial` for invoices, `open`/`partial` for bills), and the amount must be ≤ both the credit's remaining balance and the target's balance due.
- AR account resolves via `acc_active_ar_account()`; AP via `coalesce(acc_vendor.ap_account_id, acc_active_ap_account())`. Base-currency conversion uses `acc_to_base_minor(minor, currency, date)`.
- RLS on every new table (staff write via `acc_is_staff()`, staff+viewer read). Every write RPC appends `acc_audit_log` atomically.
- English is the canonical language. Commit messages must NOT contain any Claude attribution / Co-Authored-By / "Generated with Claude Code".
- All commands run from `c:/Users/pit010/QUICKBOOK_WEBAPP/ctyhp-accounting`. DB is reachable over the pooler (`SUPABASE_DB_URL`); migrations are still applied via the Supabase SQL Editor before the live E2E.
- Next migration numbers: `0019`, `0020`, `0021`.

---

## File Structure

- Create `supabase/migrations/0019_ar_ap_credits.sql` — six tables + lines + allocations + RLS + sequences.
- Create `supabase/migrations/0020_ar_ap_credit_functions.sql` — write RPCs (issue/apply/void credit memo & vendor credit; refund; write-off).
- Create `supabase/migrations/0021_ar_ap_reports.sql` — read RPCs (AR/AP ageing, customer/vendor statement).
- Modify `lib/domain/posting.ts` — `buildCreditMemoPosting`, `buildVendorCreditPosting`, `buildRefundPosting`, `buildWriteOffPosting`.
- Create `lib/domain/ageing.ts` — `computeAgeing`.
- Modify `lib/domain/schemas.ts` — credit-memo / vendor-credit / allocation / refund / write-off schemas.
- Create `tests/unit/credits-posting.test.ts`, `tests/unit/ageing.test.ts`, `tests/unit/credits-schema.test.ts`.
- Modify `lib/db/types.ts` — new row types.
- Create `lib/services/credits.ts` and `lib/services/ageing.ts`.
- Create `app/(app)/credit-memos/{page.tsx,CreditMemosClient.tsx,actions.ts}`.
- Create `app/(app)/vendor-credits/{page.tsx,VendorCreditsClient.tsx,actions.ts}`.
- Create `app/(app)/reports/ar-ageing/{page.tsx,ArAgeingClient.tsx,actions.ts}` and `.../ap-ageing/{...}`.
- Create `app/(app)/reports/customer-statement/{page.tsx,CustomerStatementClient.tsx,actions.ts}` and `.../vendor-statement/{...}`.
- Modify `app/(app)/invoices/*` and `app/(app)/bills/*` — add a Write-off action; add a Refund action in `app/(app)/payments/*`.
- Modify `components/AppShell.tsx` — nav entries.
- Create `scripts/verify-ar-ap.mjs`.

---

## Task 1: Migration — schema

**Files:**
- Create: `supabase/migrations/0019_ar_ap_credits.sql`

**Interfaces:**
- Produces tables `acc_credit_memo`, `acc_credit_memo_line`, `acc_credit_memo_allocation`, `acc_vendor_credit`, `acc_vendor_credit_line`, `acc_vendor_credit_allocation`, `acc_customer_refund`, `acc_write_off`; enums `acc_credit_status`; sequences `credit_memo`, `vendor_credit`, `customer_refund`, `write_off`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0019_ar_ap_credits.sql
-- ============================================================================
-- AR/AP extension — schema only. Credit memos & vendor credits (negative
-- documents that leave an open credit and are allocated to invoices/bills),
-- customer refunds, and write-offs. No changes to existing tables. RLS mirrors
-- the acc_* staff-write / staff+viewer-read split.
-- ============================================================================

-- Shared status for credit-type documents.
create type acc_credit_status as enum ('draft', 'issued', 'partial', 'applied', 'void');
create type acc_writeoff_side as enum ('ar', 'ap');
create type acc_settlement_status as enum ('posted', 'void');
create type acc_refund_source as enum ('payment', 'credit_memo');

-- --- Credit memo (AR) -------------------------------------------------------
create table acc_credit_memo (
  id                       uuid primary key default gen_random_uuid(),
  credit_memo_number       text unique,                 -- assigned on issue
  customer_id              uuid not null references acc_customer (id),
  memo_date                date not null default current_date,
  currency_code            text not null references acc_currency (code),
  subtotal_minor           bigint not null default 0,
  tax_total_minor          bigint not null default 0,
  total_minor              bigint not null default 0,
  balance_remaining_minor  bigint not null default 0,
  status                   acc_credit_status not null default 'draft',
  reason                   text,
  journal_entry_id         uuid references acc_journal_entry (id),
  memo                     text,
  created_by               uuid references auth.users (id),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index acc_credit_memo_customer_idx on acc_credit_memo (customer_id);
create index acc_credit_memo_status_idx   on acc_credit_memo (status);

create table acc_credit_memo_line (
  id                  uuid primary key default gen_random_uuid(),
  credit_memo_id      uuid not null references acc_credit_memo (id) on delete cascade,
  line_order          int not null default 0,
  description         text not null default '',
  quantity            numeric(20, 4) not null default 1 check (quantity >= 0),
  unit_price_minor    bigint not null default 0,
  income_account_id   uuid not null references acc_account (id),
  tax_code_id         uuid references acc_tax_code (id),
  line_subtotal_minor bigint not null default 0,
  line_tax_minor      bigint not null default 0,
  line_total_minor    bigint not null default 0
);
create index acc_credit_memo_line_memo_idx on acc_credit_memo_line (credit_memo_id);

create table acc_credit_memo_allocation (
  id             uuid primary key default gen_random_uuid(),
  credit_memo_id uuid not null references acc_credit_memo (id) on delete cascade,
  invoice_id     uuid not null references acc_invoice (id),
  amount_minor   bigint not null check (amount_minor > 0),
  created_at     timestamptz not null default now(),
  unique (credit_memo_id, invoice_id)
);
create index acc_credit_memo_alloc_invoice_idx on acc_credit_memo_allocation (invoice_id);

-- --- Vendor credit (AP) -----------------------------------------------------
create table acc_vendor_credit (
  id                       uuid primary key default gen_random_uuid(),
  vendor_credit_number     text unique,
  vendor_id                uuid not null references acc_vendor (id),
  credit_date              date not null default current_date,
  currency_code            text not null references acc_currency (code),
  total_minor              bigint not null default 0,
  balance_remaining_minor  bigint not null default 0,
  status                   acc_credit_status not null default 'draft',
  vendor_ref               text,
  reason                   text,
  journal_entry_id         uuid references acc_journal_entry (id),
  memo                     text,
  created_by               uuid references auth.users (id),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index acc_vendor_credit_vendor_idx on acc_vendor_credit (vendor_id);
create index acc_vendor_credit_status_idx on acc_vendor_credit (status);

create table acc_vendor_credit_line (
  id                 uuid primary key default gen_random_uuid(),
  vendor_credit_id   uuid not null references acc_vendor_credit (id) on delete cascade,
  line_order         int not null default 0,
  description        text not null default '',
  expense_account_id uuid not null references acc_account (id),
  amount_minor       bigint not null default 0
);
create index acc_vendor_credit_line_vc_idx on acc_vendor_credit_line (vendor_credit_id);

create table acc_vendor_credit_allocation (
  id               uuid primary key default gen_random_uuid(),
  vendor_credit_id uuid not null references acc_vendor_credit (id) on delete cascade,
  bill_id          uuid not null references acc_bill (id),
  amount_minor     bigint not null check (amount_minor > 0),
  created_at       timestamptz not null default now(),
  unique (vendor_credit_id, bill_id)
);
create index acc_vendor_credit_alloc_bill_idx on acc_vendor_credit_allocation (bill_id);

-- --- Customer refund --------------------------------------------------------
create table acc_customer_refund (
  id               uuid primary key default gen_random_uuid(),
  refund_number    text unique,
  customer_id      uuid not null references acc_customer (id),
  refund_date      date not null default current_date,
  currency_code    text not null references acc_currency (code),
  amount_minor     bigint not null check (amount_minor > 0),
  source_type      acc_refund_source not null,
  payment_id       uuid references acc_payment (id),
  credit_memo_id   uuid references acc_credit_memo (id),
  bank_account_id  uuid not null references acc_account (id),
  status           acc_settlement_status not null default 'posted',
  journal_entry_id uuid references acc_journal_entry (id),
  memo             text,
  created_by       uuid references auth.users (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint acc_refund_source_ck check (
    (source_type = 'payment'     and payment_id is not null and credit_memo_id is null) or
    (source_type = 'credit_memo' and credit_memo_id is not null and payment_id is null)
  )
);
create index acc_customer_refund_customer_idx on acc_customer_refund (customer_id);

-- --- Write-off --------------------------------------------------------------
create table acc_write_off (
  id                uuid primary key default gen_random_uuid(),
  write_off_number  text unique,
  side              acc_writeoff_side not null,
  invoice_id        uuid references acc_invoice (id),
  bill_id           uuid references acc_bill (id),
  write_off_date    date not null default current_date,
  currency_code     text not null references acc_currency (code),
  amount_minor      bigint not null check (amount_minor > 0),
  offset_account_id uuid not null references acc_account (id),
  reason            text not null,
  status            acc_settlement_status not null default 'posted',
  journal_entry_id  uuid references acc_journal_entry (id),
  created_by        uuid references auth.users (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint acc_write_off_target_ck check (
    (side = 'ar' and invoice_id is not null and bill_id is null) or
    (side = 'ap' and bill_id is not null and invoice_id is null)
  )
);

-- --- Sequences --------------------------------------------------------------
insert into acc_sequence (key, prefix, next_value) values
  ('credit_memo',     'CM-',  1),
  ('vendor_credit',   'VC-',  1),
  ('customer_refund', 'REF-', 1),
  ('write_off',       'WO-',  1)
  on conflict (key) do nothing;

-- --- RLS --------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'acc_credit_memo','acc_credit_memo_line','acc_credit_memo_allocation',
    'acc_vendor_credit','acc_vendor_credit_line','acc_vendor_credit_allocation',
    'acc_customer_refund','acc_write_off'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format($f$create policy %I on %I for select using (acc_is_staff() or acc_current_role() = 'viewer')$f$, t||'_sel', t);
    execute format($f$create policy %I on %I for insert with check (acc_is_staff())$f$, t||'_ins', t);
    execute format($f$create policy %I on %I for update using (acc_is_staff())$f$, t||'_upd', t);
  end loop;
end $$;
```

- [ ] **Step 2: Sanity-check the SQL parses**

Run: `node -e "const fs=require('fs');const s=fs.readFileSync('supabase/migrations/0019_ar_ap_credits.sql','utf8');for(const t of ['acc_credit_memo','acc_vendor_credit','acc_customer_refund','acc_write_off','acc_credit_memo_allocation','acc_vendor_credit_allocation'])if(!s.includes('create table '+t)){console.error('missing '+t);process.exit(1)}console.log('ok')"`
Expected: prints `ok`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0019_ar_ap_credits.sql
git commit -m "feat: AR/AP credit memo, vendor credit, refund, write-off tables + RLS"
```

Note: apply this migration (and 0020/0021) via the Supabase SQL Editor before the Task 15 live E2E.

---

## Task 2: Migration — write RPCs

**Files:**
- Create: `supabase/migrations/0020_ar_ap_credit_functions.sql`

**Interfaces:**
- Consumes: `acc_post_entry`, `acc_next_number`, `acc_to_base_minor`, `acc_active_ar_account`, `acc_active_ap_account`, `acc_is_staff`, tables from Task 1.
- Produces RPCs: `acc_issue_credit_memo(uuid)`, `acc_apply_credit_memo(uuid, jsonb)`, `acc_void_credit_memo(uuid)`, `acc_issue_vendor_credit(uuid)`, `acc_apply_vendor_credit(uuid, jsonb)`, `acc_void_vendor_credit(uuid)`, `acc_record_customer_refund(...)`, `acc_void_customer_refund(uuid)`, `acc_write_off(text, uuid, uuid, bigint, date, text)`, `acc_void_write_off(uuid)`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0020_ar_ap_credit_functions.sql
-- ============================================================================
-- AR/AP credit write RPCs. All atomic, staff-gated, and append acc_audit_log.
-- Issue posts a reversed-invoice/bill entry; allocation posts NOTHING (both
-- documents already sit in AR/AP) and only moves balances; void marks the entry
-- 'void' and restores balances (no reversal), per the 0013 / acc_void_bill rule.
-- ============================================================================

-- Issue a credit memo: DR income (per line), DR tax payable, CR AR = total.
create or replace function acc_issue_credit_memo(p_credit_memo_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_cm    acc_credit_memo;
  v_ar    uuid;
  v_number text;
  v_lines jsonb := '[]'::jsonb;
  v_entry uuid;
  rec     record;
begin
  if not acc_is_staff() then raise exception 'Not authorized to issue credit memos'; end if;
  select * into v_cm from acc_credit_memo where id = p_credit_memo_id for update;
  if not found then raise exception 'Credit memo not found'; end if;
  if v_cm.status <> 'draft' then raise exception 'Only draft credit memos can be issued'; end if;
  if v_cm.total_minor <= 0 then raise exception 'Credit memo total must be positive'; end if;

  v_ar := acc_active_ar_account();
  if v_ar is null then raise exception 'No active Accounts Receivable account configured'; end if;

  -- DR income (grouped by income account)
  for rec in
    select income_account_id as acc, sum(line_subtotal_minor) as amt
      from acc_credit_memo_line where credit_memo_id = p_credit_memo_id
      group by income_account_id having sum(line_subtotal_minor) <> 0
  loop
    v_lines := v_lines || jsonb_build_object('account_id', rec.acc, 'debit_minor', rec.amt,
      'credit_minor', 0, 'amount_base_minor', acc_to_base_minor(rec.amt, v_cm.currency_code, v_cm.memo_date),
      'memo', 'Credit memo income');
  end loop;
  -- DR sales tax payable (grouped by tax account)
  for rec in
    select tc.tax_account_id as acc, sum(l.line_tax_minor) as amt
      from acc_credit_memo_line l join acc_tax_code tc on tc.id = l.tax_code_id
     where l.credit_memo_id = p_credit_memo_id and l.line_tax_minor > 0 and tc.tax_account_id is not null
     group by tc.tax_account_id
  loop
    v_lines := v_lines || jsonb_build_object('account_id', rec.acc, 'debit_minor', rec.amt,
      'credit_minor', 0, 'amount_base_minor', acc_to_base_minor(rec.amt, v_cm.currency_code, v_cm.memo_date),
      'memo', 'Credit memo tax');
  end loop;
  -- CR Accounts Receivable (total)
  v_lines := v_lines || jsonb_build_object('account_id', v_ar, 'debit_minor', 0,
    'credit_minor', v_cm.total_minor, 'amount_base_minor', acc_to_base_minor(v_cm.total_minor, v_cm.currency_code, v_cm.memo_date),
    'memo', 'Accounts receivable credit');

  v_number := acc_next_number('credit_memo');
  v_entry := acc_post_entry(v_cm.memo_date, 'Credit memo ' || v_number, 'manual', p_credit_memo_id, v_cm.currency_code, v_lines);

  update acc_credit_memo set credit_memo_number = v_number, status = 'issued',
      balance_remaining_minor = total_minor, journal_entry_id = v_entry, updated_at = now()
   where id = p_credit_memo_id;
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_credit_memo', p_credit_memo_id, 'post', auth.uid());
  return v_entry;
end;
$$;

-- Apply a credit memo to invoices: allocation only, no posting.
create or replace function acc_apply_credit_memo(p_credit_memo_id uuid, p_allocations jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_cm  acc_credit_memo;
  v_inv acc_invoice;
  rec   record;
begin
  if not acc_is_staff() then raise exception 'Not authorized to apply credit memos'; end if;
  select * into v_cm from acc_credit_memo where id = p_credit_memo_id for update;
  if not found then raise exception 'Credit memo not found'; end if;
  if v_cm.status not in ('issued','partial') then raise exception 'Credit memo is not open for allocation'; end if;

  for rec in select (a->>'invoice_id')::uuid as invoice_id, (a->>'amount_minor')::bigint as amt
               from jsonb_array_elements(coalesce(p_allocations,'[]'::jsonb)) a
  loop
    if rec.amt is null or rec.amt <= 0 then continue; end if;
    select * into v_inv from acc_invoice where id = rec.invoice_id for update;
    if not found then raise exception 'Invoice not found: %', rec.invoice_id; end if;
    if v_inv.customer_id <> v_cm.customer_id then raise exception 'Invoice % is not for this customer', rec.invoice_id; end if;
    if v_inv.currency_code <> v_cm.currency_code then raise exception 'Invoice % currency mismatch', rec.invoice_id; end if;
    if v_inv.status not in ('issued','partial') then raise exception 'Invoice % is not open', rec.invoice_id; end if;
    if rec.amt > v_inv.balance_due_minor then raise exception 'Allocation % exceeds invoice balance %', rec.amt, v_inv.balance_due_minor; end if;
    if rec.amt > v_cm.balance_remaining_minor then raise exception 'Allocation % exceeds credit remaining %', rec.amt, v_cm.balance_remaining_minor; end if;

    insert into acc_credit_memo_allocation (credit_memo_id, invoice_id, amount_minor)
      values (p_credit_memo_id, rec.invoice_id, rec.amt)
      on conflict (credit_memo_id, invoice_id)
      do update set amount_minor = acc_credit_memo_allocation.amount_minor + excluded.amount_minor;
    update acc_invoice set balance_due_minor = balance_due_minor - rec.amt,
        status = case when balance_due_minor - rec.amt = 0 then 'paid' else 'partial' end, updated_at = now()
     where id = rec.invoice_id;
    v_cm.balance_remaining_minor := v_cm.balance_remaining_minor - rec.amt;
  end loop;

  update acc_credit_memo set balance_remaining_minor = v_cm.balance_remaining_minor,
      status = case when v_cm.balance_remaining_minor = 0 then 'applied' else 'partial' end, updated_at = now()
   where id = p_credit_memo_id;
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_credit_memo', p_credit_memo_id, 'update', auth.uid());
end;
$$;

-- Void a credit memo: blocked if allocations or refunds reference it.
create or replace function acc_void_credit_memo(p_credit_memo_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_cm acc_credit_memo;
begin
  if not acc_is_staff() then raise exception 'Not authorized to void credit memos'; end if;
  select * into v_cm from acc_credit_memo where id = p_credit_memo_id for update;
  if not found then raise exception 'Credit memo not found'; end if;
  if v_cm.status = 'void' then raise exception 'Credit memo is already void'; end if;
  if v_cm.status = 'draft' then
    update acc_credit_memo set status='void', updated_at=now() where id=p_credit_memo_id; return;
  end if;
  if exists (select 1 from acc_credit_memo_allocation where credit_memo_id = p_credit_memo_id) then
    raise exception 'Remove credit-memo allocations before voiding';
  end if;
  if exists (select 1 from acc_customer_refund where credit_memo_id = p_credit_memo_id and status <> 'void') then
    raise exception 'Void the refund of this credit memo first';
  end if;
  if v_cm.journal_entry_id is not null then
    update acc_journal_entry set status='void', voided_at=now() where id = v_cm.journal_entry_id;
  end if;
  update acc_credit_memo set status='void', balance_remaining_minor=0, updated_at=now() where id=p_credit_memo_id;
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_credit_memo', p_credit_memo_id, 'void', auth.uid());
end;
$$;

-- Issue a vendor credit: DR AP = total, CR expense (per line). (US: tax-inclusive.)
create or replace function acc_issue_vendor_credit(p_vendor_credit_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_vc acc_vendor_credit; v_ap uuid; v_number text; v_lines jsonb := '[]'::jsonb; v_entry uuid; rec record;
begin
  if not acc_is_staff() then raise exception 'Not authorized to issue vendor credits'; end if;
  select * into v_vc from acc_vendor_credit where id = p_vendor_credit_id for update;
  if not found then raise exception 'Vendor credit not found'; end if;
  if v_vc.status <> 'draft' then raise exception 'Only draft vendor credits can be issued'; end if;
  if v_vc.total_minor <= 0 then raise exception 'Vendor credit total must be positive'; end if;

  v_ap := coalesce((select ap_account_id from acc_vendor where id = v_vc.vendor_id), acc_active_ap_account());
  if v_ap is null then raise exception 'No active Accounts Payable account configured'; end if;

  v_lines := v_lines || jsonb_build_object('account_id', v_ap, 'debit_minor', v_vc.total_minor, 'credit_minor', 0,
    'amount_base_minor', acc_to_base_minor(v_vc.total_minor, v_vc.currency_code, v_vc.credit_date), 'memo', 'Accounts payable credit');
  for rec in
    select expense_account_id as acc, sum(amount_minor) as amt
      from acc_vendor_credit_line where vendor_credit_id = p_vendor_credit_id
      group by expense_account_id having sum(amount_minor) <> 0
  loop
    v_lines := v_lines || jsonb_build_object('account_id', rec.acc, 'debit_minor', 0, 'credit_minor', rec.amt,
      'amount_base_minor', acc_to_base_minor(rec.amt, v_vc.currency_code, v_vc.credit_date), 'memo', 'Vendor credit expense');
  end loop;

  v_number := acc_next_number('vendor_credit');
  v_entry := acc_post_entry(v_vc.credit_date, 'Vendor credit ' || v_number, 'manual', p_vendor_credit_id, v_vc.currency_code, v_lines);
  update acc_vendor_credit set vendor_credit_number = v_number, status='issued',
      balance_remaining_minor = total_minor, journal_entry_id = v_entry, updated_at=now()
   where id = p_vendor_credit_id;
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_vendor_credit', p_vendor_credit_id, 'post', auth.uid());
  return v_entry;
end;
$$;

-- Apply a vendor credit to bills: allocation only, no posting.
create or replace function acc_apply_vendor_credit(p_vendor_credit_id uuid, p_allocations jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_vc acc_vendor_credit; v_bill acc_bill; rec record;
begin
  if not acc_is_staff() then raise exception 'Not authorized to apply vendor credits'; end if;
  select * into v_vc from acc_vendor_credit where id = p_vendor_credit_id for update;
  if not found then raise exception 'Vendor credit not found'; end if;
  if v_vc.status not in ('issued','partial') then raise exception 'Vendor credit is not open for allocation'; end if;

  for rec in select (a->>'bill_id')::uuid as bill_id, (a->>'amount_minor')::bigint as amt
               from jsonb_array_elements(coalesce(p_allocations,'[]'::jsonb)) a
  loop
    if rec.amt is null or rec.amt <= 0 then continue; end if;
    select * into v_bill from acc_bill where id = rec.bill_id for update;
    if not found then raise exception 'Bill not found: %', rec.bill_id; end if;
    if v_bill.vendor_id <> v_vc.vendor_id then raise exception 'Bill % is not for this vendor', rec.bill_id; end if;
    if v_bill.currency_code <> v_vc.currency_code then raise exception 'Bill % currency mismatch', rec.bill_id; end if;
    if v_bill.status not in ('open','partial') then raise exception 'Bill % is not open', rec.bill_id; end if;
    if rec.amt > v_bill.balance_due_minor then raise exception 'Allocation % exceeds bill balance %', rec.amt, v_bill.balance_due_minor; end if;
    if rec.amt > v_vc.balance_remaining_minor then raise exception 'Allocation % exceeds credit remaining %', rec.amt, v_vc.balance_remaining_minor; end if;

    insert into acc_vendor_credit_allocation (vendor_credit_id, bill_id, amount_minor)
      values (p_vendor_credit_id, rec.bill_id, rec.amt)
      on conflict (vendor_credit_id, bill_id)
      do update set amount_minor = acc_vendor_credit_allocation.amount_minor + excluded.amount_minor;
    update acc_bill set balance_due_minor = balance_due_minor - rec.amt,
        status = (case when balance_due_minor - rec.amt = 0 then 'paid' else 'partial' end)::acc_bill_status, updated_at=now()
     where id = rec.bill_id;
    v_vc.balance_remaining_minor := v_vc.balance_remaining_minor - rec.amt;
  end loop;

  update acc_vendor_credit set balance_remaining_minor = v_vc.balance_remaining_minor,
      status = case when v_vc.balance_remaining_minor = 0 then 'applied' else 'partial' end, updated_at=now()
   where id = p_vendor_credit_id;
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_vendor_credit', p_vendor_credit_id, 'update', auth.uid());
end;
$$;

create or replace function acc_void_vendor_credit(p_vendor_credit_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_vc acc_vendor_credit;
begin
  if not acc_is_staff() then raise exception 'Not authorized to void vendor credits'; end if;
  select * into v_vc from acc_vendor_credit where id = p_vendor_credit_id for update;
  if not found then raise exception 'Vendor credit not found'; end if;
  if v_vc.status = 'void' then raise exception 'Vendor credit is already void'; end if;
  if v_vc.status = 'draft' then
    update acc_vendor_credit set status='void', updated_at=now() where id=p_vendor_credit_id; return;
  end if;
  if exists (select 1 from acc_vendor_credit_allocation where vendor_credit_id = p_vendor_credit_id) then
    raise exception 'Remove vendor-credit allocations before voiding';
  end if;
  if v_vc.journal_entry_id is not null then
    update acc_journal_entry set status='void', voided_at=now() where id = v_vc.journal_entry_id;
  end if;
  update acc_vendor_credit set status='void', balance_remaining_minor=0, updated_at=now() where id=p_vendor_credit_id;
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_vendor_credit', p_vendor_credit_id, 'void', auth.uid());
end;
$$;

-- Customer refund: DR AR / CR bank; reduce the source's remaining balance.
create or replace function acc_record_customer_refund(
  p_customer_id uuid, p_refund_date date, p_currency text, p_amount_minor bigint,
  p_source_type text, p_payment_id uuid, p_credit_memo_id uuid, p_bank_account_id uuid, p_memo text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_ar uuid; v_number text; v_entry uuid; v_base bigint; v_id uuid; v_pay acc_payment; v_cm acc_credit_memo;
begin
  if not acc_is_staff() then raise exception 'Not authorized to record refunds'; end if;
  if p_amount_minor <= 0 then raise exception 'Refund amount must be positive'; end if;
  v_ar := acc_active_ar_account();
  if v_ar is null then raise exception 'No active Accounts Receivable account configured'; end if;

  if p_source_type = 'payment' then
    select * into v_pay from acc_payment where id = p_payment_id for update;
    if not found then raise exception 'Payment not found'; end if;
    if v_pay.customer_id <> p_customer_id then raise exception 'Payment is not for this customer'; end if;
    if v_pay.status = 'void' then raise exception 'Payment is void'; end if;
    if p_amount_minor > v_pay.unapplied_minor then raise exception 'Refund % exceeds unapplied payment %', p_amount_minor, v_pay.unapplied_minor; end if;
    update acc_payment set unapplied_minor = unapplied_minor - p_amount_minor, updated_at=now() where id = p_payment_id;
  elsif p_source_type = 'credit_memo' then
    select * into v_cm from acc_credit_memo where id = p_credit_memo_id for update;
    if not found then raise exception 'Credit memo not found'; end if;
    if v_cm.customer_id <> p_customer_id then raise exception 'Credit memo is not for this customer'; end if;
    if v_cm.status not in ('issued','partial') then raise exception 'Credit memo is not open'; end if;
    if p_amount_minor > v_cm.balance_remaining_minor then raise exception 'Refund % exceeds credit remaining %', p_amount_minor, v_cm.balance_remaining_minor; end if;
    update acc_credit_memo set balance_remaining_minor = balance_remaining_minor - p_amount_minor,
        status = case when balance_remaining_minor - p_amount_minor = 0 then 'applied' else 'partial' end, updated_at=now()
     where id = p_credit_memo_id;
  else
    raise exception 'Invalid refund source %', p_source_type;
  end if;

  v_base := acc_to_base_minor(p_amount_minor, p_currency, p_refund_date);
  v_number := acc_next_number('customer_refund');
  v_entry := acc_post_entry(p_refund_date, 'Customer refund ' || v_number, 'payment', null, p_currency,
    jsonb_build_array(
      jsonb_build_object('account_id', v_ar, 'debit_minor', p_amount_minor, 'credit_minor', 0, 'amount_base_minor', v_base, 'memo', 'Refund to customer'),
      jsonb_build_object('account_id', p_bank_account_id, 'debit_minor', 0, 'credit_minor', p_amount_minor, 'amount_base_minor', v_base, 'memo', 'Bank payment')
    ));
  insert into acc_customer_refund (refund_number, customer_id, refund_date, currency_code, amount_minor,
      source_type, payment_id, credit_memo_id, bank_account_id, status, journal_entry_id, memo, created_by)
    values (v_number, p_customer_id, p_refund_date, p_currency, p_amount_minor,
      p_source_type::acc_refund_source, p_payment_id, p_credit_memo_id, p_bank_account_id, 'posted', v_entry, p_memo, auth.uid())
    returning id into v_id;
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_customer_refund', v_id, 'post', auth.uid());
  return v_id;
end;
$$;

create or replace function acc_void_customer_refund(p_refund_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_r acc_customer_refund;
begin
  if not acc_is_staff() then raise exception 'Not authorized to void refunds'; end if;
  select * into v_r from acc_customer_refund where id = p_refund_id for update;
  if not found then raise exception 'Refund not found'; end if;
  if v_r.status = 'void' then raise exception 'Refund is already void'; end if;
  -- Restore the source balance.
  if v_r.source_type = 'payment' then
    update acc_payment set unapplied_minor = unapplied_minor + v_r.amount_minor, updated_at=now() where id = v_r.payment_id;
  else
    update acc_credit_memo set balance_remaining_minor = balance_remaining_minor + v_r.amount_minor,
        status = case when status='applied' then 'partial' else status end, updated_at=now()
     where id = v_r.credit_memo_id;
  end if;
  if v_r.journal_entry_id is not null then
    update acc_journal_entry set status='void', voided_at=now() where id = v_r.journal_entry_id;
  end if;
  update acc_customer_refund set status='void', updated_at=now() where id = p_refund_id;
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_customer_refund', p_refund_id, 'void', auth.uid());
end;
$$;

-- Write-off. AR: DR offset expense / CR AR against an invoice. AP: DR AP / CR
-- offset income against a bill. Offset account type is validated per side.
create or replace function acc_write_off(
  p_side text, p_target_id uuid, p_offset_account_id uuid, p_amount_minor bigint, p_date date, p_reason text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_number text; v_entry uuid; v_base bigint; v_id uuid; v_offtype acc_account_type;
  v_ar uuid; v_ap uuid; v_inv acc_invoice; v_bill acc_bill; v_ccy text;
begin
  if not acc_is_staff() then raise exception 'Not authorized to write off balances'; end if;
  if p_amount_minor <= 0 then raise exception 'Write-off amount must be positive'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'A write-off reason is required'; end if;
  select account_type into v_offtype from acc_account where id = p_offset_account_id;
  if v_offtype is null then raise exception 'Offset account not found'; end if;

  if p_side = 'ar' then
    if v_offtype not in ('expense','cost_of_goods_sold','other_expense') then
      raise exception 'AR write-off offset must be an expense account';
    end if;
    select * into v_inv from acc_invoice where id = p_target_id for update;
    if not found then raise exception 'Invoice not found'; end if;
    if v_inv.status not in ('issued','partial') then raise exception 'Invoice is not open'; end if;
    if p_amount_minor > v_inv.balance_due_minor then raise exception 'Write-off % exceeds invoice balance %', p_amount_minor, v_inv.balance_due_minor; end if;
    v_ccy := v_inv.currency_code;
    v_ar := acc_active_ar_account();
    v_base := acc_to_base_minor(p_amount_minor, v_ccy, p_date);
    v_number := acc_next_number('write_off');
    v_entry := acc_post_entry(p_date, 'Write-off ' || v_number, 'manual', p_target_id, v_ccy,
      jsonb_build_array(
        jsonb_build_object('account_id', p_offset_account_id, 'debit_minor', p_amount_minor, 'credit_minor', 0, 'amount_base_minor', v_base, 'memo', 'Bad debt write-off'),
        jsonb_build_object('account_id', v_ar, 'debit_minor', 0, 'credit_minor', p_amount_minor, 'amount_base_minor', v_base, 'memo', 'Write off receivable')
      ));
    update acc_invoice set balance_due_minor = balance_due_minor - p_amount_minor,
        status = case when balance_due_minor - p_amount_minor = 0 then 'paid' else 'partial' end, updated_at=now()
     where id = p_target_id;
    insert into acc_write_off (write_off_number, side, invoice_id, write_off_date, currency_code, amount_minor, offset_account_id, reason, status, journal_entry_id, created_by)
      values (v_number, 'ar', p_target_id, p_date, v_ccy, p_amount_minor, p_offset_account_id, p_reason, 'posted', v_entry, auth.uid())
      returning id into v_id;
  elsif p_side = 'ap' then
    if v_offtype not in ('income','other_income') then
      raise exception 'AP write-off offset must be an income account';
    end if;
    select * into v_bill from acc_bill where id = p_target_id for update;
    if not found then raise exception 'Bill not found'; end if;
    if v_bill.status not in ('open','partial') then raise exception 'Bill is not open'; end if;
    if p_amount_minor > v_bill.balance_due_minor then raise exception 'Write-off % exceeds bill balance %', p_amount_minor, v_bill.balance_due_minor; end if;
    v_ccy := v_bill.currency_code;
    v_ap := coalesce((select ap_account_id from acc_vendor where id = v_bill.vendor_id), acc_active_ap_account());
    v_base := acc_to_base_minor(p_amount_minor, v_ccy, p_date);
    v_number := acc_next_number('write_off');
    v_entry := acc_post_entry(p_date, 'Write-off ' || v_number, 'manual', p_target_id, v_ccy,
      jsonb_build_array(
        jsonb_build_object('account_id', v_ap, 'debit_minor', p_amount_minor, 'credit_minor', 0, 'amount_base_minor', v_base, 'memo', 'Write off payable'),
        jsonb_build_object('account_id', p_offset_account_id, 'debit_minor', 0, 'credit_minor', p_amount_minor, 'amount_base_minor', v_base, 'memo', 'Payable write-off income')
      ));
    update acc_bill set balance_due_minor = balance_due_minor - p_amount_minor,
        status = (case when balance_due_minor - p_amount_minor = 0 then 'paid' else 'partial' end)::acc_bill_status, updated_at=now()
     where id = p_target_id;
    insert into acc_write_off (write_off_number, side, bill_id, write_off_date, currency_code, amount_minor, offset_account_id, reason, status, journal_entry_id, created_by)
      values (v_number, 'ap', p_target_id, p_date, v_ccy, p_amount_minor, p_offset_account_id, p_reason, 'posted', v_entry, auth.uid())
      returning id into v_id;
  else
    raise exception 'Invalid write-off side %', p_side;
  end if;

  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_write_off', v_id, 'post', auth.uid());
  return v_id;
end;
$$;

create or replace function acc_void_write_off(p_write_off_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_w acc_write_off;
begin
  if not acc_is_staff() then raise exception 'Not authorized to void write-offs'; end if;
  select * into v_w from acc_write_off where id = p_write_off_id for update;
  if not found then raise exception 'Write-off not found'; end if;
  if v_w.status = 'void' then raise exception 'Write-off is already void'; end if;
  if v_w.side = 'ar' then
    update acc_invoice set balance_due_minor = balance_due_minor + v_w.amount_minor,
        status = 'partial', updated_at=now() where id = v_w.invoice_id and status <> 'void';
  else
    update acc_bill set balance_due_minor = balance_due_minor + v_w.amount_minor,
        status = 'partial'::acc_bill_status, updated_at=now() where id = v_w.bill_id and status <> 'void';
  end if;
  if v_w.journal_entry_id is not null then
    update acc_journal_entry set status='void', voided_at=now() where id = v_w.journal_entry_id;
  end if;
  update acc_write_off set status='void', updated_at=now() where id = p_write_off_id;
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_write_off', p_write_off_id, 'void', auth.uid());
end;
$$;
```

- [ ] **Step 2: Sanity-check the SQL parses**

Run: `node -e "const fs=require('fs');const s=fs.readFileSync('supabase/migrations/0020_ar_ap_credit_functions.sql','utf8');for(const f of ['acc_issue_credit_memo','acc_apply_credit_memo','acc_void_credit_memo','acc_issue_vendor_credit','acc_apply_vendor_credit','acc_void_vendor_credit','acc_record_customer_refund','acc_void_customer_refund','acc_write_off','acc_void_write_off'])if(!s.includes('function '+f)){console.error('missing '+f);process.exit(1)}console.log('ok')"`
Expected: prints `ok`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0020_ar_ap_credit_functions.sql
git commit -m "feat: AR/AP credit memo, vendor credit, refund, write-off RPCs"
```

---

## Task 3: Migration — read RPCs (ageing + statements)

**Files:**
- Create: `supabase/migrations/0021_ar_ap_reports.sql`

**Interfaces:**
- Produces `acc_ar_ageing(p_as_of date)`, `acc_ap_ageing(p_as_of date)`, `acc_customer_statement(p_customer_id uuid, p_from date, p_to date)`, `acc_vendor_statement(p_vendor_id uuid, p_from date, p_to date)`.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0021_ar_ap_reports.sql
-- ============================================================================
-- AR/AP read RPCs: open-item ageing and statements. Ageing returns one row per
-- open document (positive) and open credit/unapplied payment (negative) with its
-- due date, so the app can bucket by age and reconcile the total to the AR/AP
-- control account. Runs as invoker (RLS applies).
-- ============================================================================

-- AR ageing: open invoices (balance_due>0) as positives; open credit memos and
-- unapplied customer payments as negatives (Current). Reference date = due date
-- for invoices, document date for credits/payments.
create or replace function acc_ar_ageing(p_as_of date)
returns table (customer_id uuid, customer_name text, doc_type text, doc_number text,
               doc_date date, due_date date, balance_minor bigint)
language sql stable as $$
  select c.id, c.name, 'invoice', i.invoice_number, i.issue_date, coalesce(i.due_date, i.issue_date), i.balance_due_minor
    from acc_invoice i join acc_customer c on c.id = i.customer_id
   where i.status in ('issued','partial') and i.balance_due_minor > 0 and i.issue_date <= p_as_of
  union all
  select c.id, c.name, 'credit_memo', m.credit_memo_number, m.memo_date, m.memo_date, -m.balance_remaining_minor
    from acc_credit_memo m join acc_customer c on c.id = m.customer_id
   where m.status in ('issued','partial') and m.balance_remaining_minor > 0 and m.memo_date <= p_as_of
  union all
  select c.id, c.name, 'payment', p.payment_number, p.payment_date, p.payment_date, -p.unapplied_minor
    from acc_payment p join acc_customer c on c.id = p.customer_id
   where p.status in ('unapplied','partial') and p.unapplied_minor > 0 and p.payment_date <= p_as_of;
$$;

create or replace function acc_ap_ageing(p_as_of date)
returns table (vendor_id uuid, vendor_name text, doc_type text, doc_number text,
               doc_date date, due_date date, balance_minor bigint)
language sql stable as $$
  select v.id, v.name, 'bill', b.bill_number, b.bill_date, coalesce(b.due_date, b.bill_date), b.balance_due_minor
    from acc_bill b join acc_vendor v on v.id = b.vendor_id
   where b.status in ('open','partial') and b.balance_due_minor > 0 and b.bill_date <= p_as_of
  union all
  select v.id, v.name, 'vendor_credit', vc.vendor_credit_number, vc.credit_date, vc.credit_date, -vc.balance_remaining_minor
    from acc_vendor_credit vc join acc_vendor v on v.id = vc.vendor_id
   where vc.status in ('issued','partial') and vc.balance_remaining_minor > 0 and vc.credit_date <= p_as_of
  union all
  select v.id, v.name, 'bill_payment', bp.payment_number, bp.payment_date, bp.payment_date, -bp.unapplied_minor
    from acc_bill_payment bp join acc_vendor v on v.id = bp.vendor_id
   where bp.status in ('unapplied','partial') and bp.unapplied_minor > 0 and bp.payment_date <= p_as_of;
$$;

-- Customer statement: activity rows in [p_from, p_to] with a signed AR effect
-- (invoice + / payment - / credit memo - / refund +). The app adds the opening
-- balance (activity before p_from) to produce a running balance.
create or replace function acc_customer_statement(p_customer_id uuid, p_from date, p_to date)
returns table (txn_date date, doc_type text, doc_number text, amount_minor bigint)
language sql stable as $$
  select i.issue_date, 'invoice', i.invoice_number, i.total_minor
    from acc_invoice i where i.customer_id = p_customer_id and i.status <> 'void' and i.issue_date between p_from and p_to
  union all
  select p.payment_date, 'payment', p.payment_number, -p.amount_minor
    from acc_payment p where p.customer_id = p_customer_id and p.status <> 'void' and p.payment_date between p_from and p_to
  union all
  select m.memo_date, 'credit_memo', m.credit_memo_number, -m.total_minor
    from acc_credit_memo m where m.customer_id = p_customer_id and m.status <> 'void' and m.memo_date between p_from and p_to
  union all
  select r.refund_date, 'refund', r.refund_number, r.amount_minor
    from acc_customer_refund r where r.customer_id = p_customer_id and r.status <> 'void' and r.refund_date between p_from and p_to
  order by 1, 3;
$$;

create or replace function acc_vendor_statement(p_vendor_id uuid, p_from date, p_to date)
returns table (txn_date date, doc_type text, doc_number text, amount_minor bigint)
language sql stable as $$
  select b.bill_date, 'bill', b.bill_number, b.total_minor
    from acc_bill b where b.vendor_id = p_vendor_id and b.status <> 'void' and b.bill_date between p_from and p_to
  union all
  select bp.payment_date, 'bill_payment', bp.payment_number, -bp.amount_minor
    from acc_bill_payment bp where bp.vendor_id = p_vendor_id and bp.status <> 'void' and bp.payment_date between p_from and p_to
  union all
  select vc.credit_date, 'vendor_credit', vc.vendor_credit_number, -vc.total_minor
    from acc_vendor_credit vc where vc.vendor_id = p_vendor_id and vc.status <> 'void' and vc.credit_date between p_from and p_to
  order by 1, 3;
$$;
```

- [ ] **Step 2: Sanity-check**

Run: `node -e "const fs=require('fs');const s=fs.readFileSync('supabase/migrations/0021_ar_ap_reports.sql','utf8');for(const f of ['acc_ar_ageing','acc_ap_ageing','acc_customer_statement','acc_vendor_statement'])if(!s.includes('function '+f)){console.error('missing '+f);process.exit(1)}console.log('ok')"`
Expected: prints `ok`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0021_ar_ap_reports.sql
git commit -m "feat: AR/AP ageing + customer/vendor statement read RPCs"
```

---

## Task 4: Domain — posting builders

**Files:**
- Modify: `lib/domain/posting.ts`
- Test: `tests/unit/credits-posting.test.ts`

**Interfaces:**
- Consumes: `JournalLineInput`, `assertBalanced`, `Minor`.
- Produces:
  - `buildCreditMemoPosting(input: { arAccountId: string; taxPayableAccountId: string | null; lines: InvoicePostingLine[] }): JournalLineInput[]` — DR income (per line), DR tax, CR AR (mirror-reverse of `buildInvoicePosting`).
  - `buildVendorCreditPosting(input: { apAccountId: string; lines: ExpenseAllocationLine[] }): JournalLineInput[]` — DR AP (total), CR expense (grouped).
  - `buildRefundPosting(input: { arAccountId: string; bankAccountId: string; amountMinor: Minor }): JournalLineInput[]` — DR AR / CR bank.
  - `buildWriteOffPosting(input: { side: "ar" | "ap"; controlAccountId: string; offsetAccountId: string; amountMinor: Minor }): JournalLineInput[]` — AR: DR offset / CR control; AP: DR control / CR offset.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/credits-posting.test.ts
import { describe, it, expect } from "vitest";
import {
  buildCreditMemoPosting, buildVendorCreditPosting, buildRefundPosting, buildWriteOffPosting,
} from "@/lib/domain/posting";

const bal = (ls: { debitMinor: number; creditMinor: number }[]) =>
  ls.reduce((s, l) => s + l.debitMinor, 0) === ls.reduce((s, l) => s + l.creditMinor, 0);

describe("buildCreditMemoPosting", () => {
  it("debits income and tax, credits AR for the total", () => {
    const ls = buildCreditMemoPosting({
      arAccountId: "ar", taxPayableAccountId: "tax",
      lines: [{ incomeAccountId: "inc", subtotalMinor: 100_00, taxMinor: 8_00 }],
    });
    const ar = ls.find((l) => l.accountId === "ar")!;
    expect(ar.creditMinor).toBe(108_00);
    expect(ls.find((l) => l.accountId === "inc")!.debitMinor).toBe(100_00);
    expect(ls.find((l) => l.accountId === "tax")!.debitMinor).toBe(8_00);
    expect(bal(ls)).toBe(true);
  });
});

describe("buildVendorCreditPosting", () => {
  it("debits AP total and credits expense", () => {
    const ls = buildVendorCreditPosting({ apAccountId: "ap", lines: [{ expenseAccountId: "exp", amountMinor: 50_00 }] });
    expect(ls.find((l) => l.accountId === "ap")!.debitMinor).toBe(50_00);
    expect(ls.find((l) => l.accountId === "exp")!.creditMinor).toBe(50_00);
    expect(bal(ls)).toBe(true);
  });
});

describe("buildRefundPosting", () => {
  it("debits AR and credits bank", () => {
    const ls = buildRefundPosting({ arAccountId: "ar", bankAccountId: "bank", amountMinor: 25_00 });
    expect(ls.find((l) => l.accountId === "ar")!.debitMinor).toBe(25_00);
    expect(ls.find((l) => l.accountId === "bank")!.creditMinor).toBe(25_00);
    expect(bal(ls)).toBe(true);
  });
});

describe("buildWriteOffPosting", () => {
  it("AR write-off debits offset expense and credits AR", () => {
    const ls = buildWriteOffPosting({ side: "ar", controlAccountId: "ar", offsetAccountId: "baddebt", amountMinor: 40_00 });
    expect(ls.find((l) => l.accountId === "baddebt")!.debitMinor).toBe(40_00);
    expect(ls.find((l) => l.accountId === "ar")!.creditMinor).toBe(40_00);
    expect(bal(ls)).toBe(true);
  });
  it("AP write-off debits AP and credits offset income", () => {
    const ls = buildWriteOffPosting({ side: "ap", controlAccountId: "ap", offsetAccountId: "otherinc", amountMinor: 3_00 });
    expect(ls.find((l) => l.accountId === "ap")!.debitMinor).toBe(3_00);
    expect(ls.find((l) => l.accountId === "otherinc")!.creditMinor).toBe(3_00);
    expect(bal(ls)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- credits-posting`
Expected: FAIL — builders not exported.

- [ ] **Step 3: Implement**

Append to `lib/domain/posting.ts` (reuse the existing `InvoicePostingLine` and `ExpenseAllocationLine` interfaces already defined in the file):

```typescript
export interface CreditMemoPostingInput {
  arAccountId: string;
  taxPayableAccountId: string | null;
  lines: InvoicePostingLine[];
}

/** Credit memo issued: DR income (per account), DR tax payable, CR AR = total. */
export function buildCreditMemoPosting(input: CreditMemoPostingInput): JournalLineInput[] {
  const totalMinor = input.lines.reduce((s, l) => s + l.subtotalMinor + l.taxMinor, 0);
  const taxTotalMinor = input.lines.reduce((s, l) => s + l.taxMinor, 0);
  const lines: JournalLineInput[] = [];
  const byIncome = new Map<string, Minor>();
  for (const l of input.lines) {
    byIncome.set(l.incomeAccountId, (byIncome.get(l.incomeAccountId) ?? 0) + l.subtotalMinor);
  }
  for (const [accountId, amount] of byIncome) {
    if (amount !== 0) lines.push({ accountId, debitMinor: amount, creditMinor: 0, memo: "Credit memo income" });
  }
  if (taxTotalMinor > 0) {
    if (!input.taxPayableAccountId) throw new Error("Credit memo has tax but no tax payable account was provided");
    lines.push({ accountId: input.taxPayableAccountId, debitMinor: taxTotalMinor, creditMinor: 0, memo: "Credit memo tax" });
  }
  lines.push({ accountId: input.arAccountId, debitMinor: 0, creditMinor: totalMinor, memo: "Accounts receivable credit" });
  assertBalanced(lines);
  return lines;
}

export interface VendorCreditPostingInput {
  apAccountId: string;
  lines: ExpenseAllocationLine[];
}

/** Vendor credit issued: DR AP = total, CR expense (grouped per account). */
export function buildVendorCreditPosting(input: VendorCreditPostingInput): JournalLineInput[] {
  const byAccount = new Map<string, Minor>();
  for (const l of input.lines) byAccount.set(l.expenseAccountId, (byAccount.get(l.expenseAccountId) ?? 0) + l.amountMinor);
  let total: Minor = 0;
  const credits: JournalLineInput[] = [];
  for (const [accountId, amount] of byAccount) {
    if (amount !== 0) { credits.push({ accountId, debitMinor: 0, creditMinor: amount, memo: "Vendor credit expense" }); total += amount; }
  }
  const lines: JournalLineInput[] = [
    { accountId: input.apAccountId, debitMinor: total, creditMinor: 0, memo: "Accounts payable credit" },
    ...credits,
  ];
  assertBalanced(lines);
  return lines;
}

/** Customer refund: DR AR / CR bank. */
export function buildRefundPosting(input: { arAccountId: string; bankAccountId: string; amountMinor: Minor }): JournalLineInput[] {
  const lines: JournalLineInput[] = [
    { accountId: input.arAccountId, debitMinor: input.amountMinor, creditMinor: 0, memo: "Refund to customer" },
    { accountId: input.bankAccountId, debitMinor: 0, creditMinor: input.amountMinor, memo: "Bank payment" },
  ];
  assertBalanced(lines);
  return lines;
}

/** Write-off. AR: DR offset expense / CR AR. AP: DR AP / CR offset income. */
export function buildWriteOffPosting(input: {
  side: "ar" | "ap"; controlAccountId: string; offsetAccountId: string; amountMinor: Minor;
}): JournalLineInput[] {
  const lines: JournalLineInput[] =
    input.side === "ar"
      ? [
          { accountId: input.offsetAccountId, debitMinor: input.amountMinor, creditMinor: 0, memo: "Bad debt write-off" },
          { accountId: input.controlAccountId, debitMinor: 0, creditMinor: input.amountMinor, memo: "Write off receivable" },
        ]
      : [
          { accountId: input.controlAccountId, debitMinor: input.amountMinor, creditMinor: 0, memo: "Write off payable" },
          { accountId: input.offsetAccountId, debitMinor: 0, creditMinor: input.amountMinor, memo: "Payable write-off income" },
        ];
  assertBalanced(lines);
  return lines;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- credits-posting`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/domain/posting.ts tests/unit/credits-posting.test.ts
git commit -m "feat: posting builders for credit memo, vendor credit, refund, write-off"
```

---

## Task 5: Domain — ageing helper

**Files:**
- Create: `lib/domain/ageing.ts`
- Test: `tests/unit/ageing.test.ts`

**Interfaces:**
- Produces:
  - `AGEING_BUCKETS: { key: string; label: string }[]` = Current, 1-30, 31-60, 61-90, 90+.
  - `AgeingItem = { dueDate: string; balanceMinor: number }`.
  - `bucketOf(dueDate: string, asOf: string): string` — bucket key by days past due (≤0 → current).
  - `computeAgeing(items: AgeingItem[], asOf: string): { buckets: Record<string, number>; total: number }`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/ageing.test.ts
import { describe, it, expect } from "vitest";
import { computeAgeing, bucketOf } from "@/lib/domain/ageing";

describe("bucketOf", () => {
  it("classifies by days past due relative to as-of", () => {
    expect(bucketOf("2026-07-23", "2026-07-23")).toBe("current"); // due today
    expect(bucketOf("2026-07-24", "2026-07-23")).toBe("current"); // not yet due
    expect(bucketOf("2026-07-22", "2026-07-23")).toBe("d1_30");   // 1 day
    expect(bucketOf("2026-06-23", "2026-07-23")).toBe("d1_30");   // 30 days
    expect(bucketOf("2026-06-22", "2026-07-23")).toBe("d31_60");  // 31 days
    expect(bucketOf("2026-04-23", "2026-07-23")).toBe("d90_plus");// 91 days
  });
});

describe("computeAgeing", () => {
  it("sums balances into buckets and totals (credits are negative in current)", () => {
    const r = computeAgeing([
      { dueDate: "2026-07-23", balanceMinor: 100_00 },  // current
      { dueDate: "2026-06-01", balanceMinor: 50_00 },   // 31-60
      { dueDate: "2026-07-20", balanceMinor: -20_00 },  // current credit
    ], "2026-07-23");
    expect(r.buckets.current).toBe(80_00);
    expect(r.buckets.d31_60).toBe(50_00);
    expect(r.total).toBe(130_00);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ageing`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
// lib/domain/ageing.ts
/**
 * Pure AR/AP ageing. Buckets an open-item list by days past due relative to an
 * as-of date. Credits/unapplied payments carry a negative balance and land in
 * "Current". The grand total equals the net subledger balance, which must match
 * the AR/AP control-account balance from the ledger.
 */
export const AGEING_BUCKETS = [
  { key: "current", label: "Current" },
  { key: "d1_30", label: "1–30" },
  { key: "d31_60", label: "31–60" },
  { key: "d61_90", label: "61–90" },
  { key: "d90_plus", label: "90+" },
] as const;

export interface AgeingItem {
  dueDate: string;
  balanceMinor: number;
}

/** Whole days between two ISO dates (asOf - dueDate), UTC, calendar-day based. */
function daysPastDue(dueDate: string, asOf: string): number {
  const d = (s: string) => {
    const [y, m, day] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, day);
  };
  return Math.round((d(asOf) - d(dueDate)) / 86_400_000);
}

export function bucketOf(dueDate: string, asOf: string): string {
  const n = daysPastDue(dueDate, asOf);
  if (n <= 0) return "current";
  if (n <= 30) return "d1_30";
  if (n <= 60) return "d31_60";
  if (n <= 90) return "d61_90";
  return "d90_plus";
}

export function computeAgeing(items: AgeingItem[], asOf: string): { buckets: Record<string, number>; total: number } {
  const buckets: Record<string, number> = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
  let total = 0;
  for (const it of items) {
    buckets[bucketOf(it.dueDate, asOf)] += it.balanceMinor;
    total += it.balanceMinor;
  }
  return { buckets, total };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- ageing`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/domain/ageing.ts tests/unit/ageing.test.ts
git commit -m "feat: pure AR/AP ageing bucketing helper"
```

---

## Task 6: Domain — Zod schemas

**Files:**
- Modify: `lib/domain/schemas.ts`
- Test: `tests/unit/credits-schema.test.ts`

**Interfaces:**
- Produces: `creditMemoLineSchema`, `creditMemoCreateSchema` → `CreditMemoCreateInput`; `vendorCreditLineSchema`, `vendorCreditCreateSchema` → `VendorCreditCreateInput`; `creditAllocationSchema` (array of `{ target_id, amount_minor }`); `customerRefundSchema` → `CustomerRefundInput`; `writeOffSchema` → `WriteOffInput`.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/credits-schema.test.ts
import { describe, it, expect } from "vitest";
import { creditMemoCreateSchema, customerRefundSchema, writeOffSchema } from "@/lib/domain/schemas";

const uuid = "11111111-1111-4111-8111-111111111111";

describe("creditMemoCreateSchema", () => {
  it("accepts a one-line memo", () => {
    expect(creditMemoCreateSchema.safeParse({
      customer_id: uuid, currency_code: "USD",
      lines: [{ description: "x", quantity: 1, unit_price_minor: 1000, income_account_id: uuid }],
    }).success).toBe(true);
  });
  it("rejects zero lines", () => {
    expect(creditMemoCreateSchema.safeParse({ customer_id: uuid, currency_code: "USD", lines: [] }).success).toBe(false);
  });
});

describe("customerRefundSchema", () => {
  it("requires exactly one source", () => {
    const base = { customer_id: uuid, currency_code: "USD", amount_minor: 100, bank_account_id: uuid };
    expect(customerRefundSchema.safeParse({ ...base, source_type: "payment", payment_id: uuid }).success).toBe(true);
    expect(customerRefundSchema.safeParse({ ...base, source_type: "payment" }).success).toBe(false);
    expect(customerRefundSchema.safeParse({ ...base, source_type: "credit_memo", payment_id: uuid, credit_memo_id: uuid }).success).toBe(false);
  });
});

describe("writeOffSchema", () => {
  it("requires a reason and a target matching the side", () => {
    const base = { offset_account_id: uuid, amount_minor: 100, reason: "bad debt" };
    expect(writeOffSchema.safeParse({ ...base, side: "ar", invoice_id: uuid }).success).toBe(true);
    expect(writeOffSchema.safeParse({ ...base, side: "ar" }).success).toBe(false);
    expect(writeOffSchema.safeParse({ side: "ar", invoice_id: uuid, offset_account_id: uuid, amount_minor: 100, reason: "" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- credits-schema`
Expected: FAIL — schemas not exported.

- [ ] **Step 3: Implement**

Append to `lib/domain/schemas.ts`:

```typescript
// --- AR/AP credits, refunds, write-offs ---
export const creditMemoLineSchema = z.object({
  description: z.string().trim().max(300).default(""),
  quantity: z.number().positive("Quantity must be greater than 0"),
  unit_price_minor: z.number().int("Unit price must be a whole minor-unit amount").min(0),
  income_account_id: z.uuid("Select an income account"),
  tax_code_id: z.uuid().optional().nullable(),
});

export const creditMemoCreateSchema = z.object({
  customer_id: z.uuid("Select a customer"),
  currency_code: z.string().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code"),
  memo_date: z.string().optional(),
  reason: z.string().trim().max(300).optional().or(z.literal("")).nullable(),
  memo: z.string().trim().max(500).optional().nullable(),
  lines: z.array(creditMemoLineSchema).min(1, "Add at least one line"),
});
export type CreditMemoCreateInput = z.infer<typeof creditMemoCreateSchema>;

export const vendorCreditLineSchema = z.object({
  description: z.string().trim().max(300).default(""),
  expense_account_id: z.uuid("Select an expense account"),
  amount_minor: z.number().int("Amount must be a whole minor-unit amount").positive("Amount must be greater than 0"),
});

export const vendorCreditCreateSchema = z.object({
  vendor_id: z.uuid("Select a vendor"),
  currency_code: z.string().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code"),
  credit_date: z.string().optional(),
  vendor_ref: z.string().trim().max(80).optional().or(z.literal("")).nullable(),
  reason: z.string().trim().max(300).optional().or(z.literal("")).nullable(),
  memo: z.string().trim().max(500).optional().nullable(),
  lines: z.array(vendorCreditLineSchema).min(1, "Add at least one line"),
});
export type VendorCreditCreateInput = z.infer<typeof vendorCreditCreateSchema>;

export const creditAllocationSchema = z.object({
  target_id: z.uuid(),
  amount_minor: z.number().int().positive(),
});
export type CreditAllocationInput = z.infer<typeof creditAllocationSchema>;

export const customerRefundSchema = z
  .object({
    customer_id: z.uuid("Select a customer"),
    refund_date: z.string().optional(),
    currency_code: z.string().regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code"),
    amount_minor: z.number().int().positive("Amount must be greater than 0"),
    source_type: z.enum(["payment", "credit_memo"]),
    payment_id: z.uuid().optional().nullable(),
    credit_memo_id: z.uuid().optional().nullable(),
    bank_account_id: z.uuid("Select a bank account"),
    memo: z.string().trim().max(500).optional().nullable(),
  })
  .refine((v) => (v.source_type === "payment" ? !!v.payment_id && !v.credit_memo_id : !!v.credit_memo_id && !v.payment_id), {
    message: "Provide exactly the source matching the selected type",
    path: ["source_type"],
  });
export type CustomerRefundInput = z.infer<typeof customerRefundSchema>;

export const writeOffSchema = z
  .object({
    side: z.enum(["ar", "ap"]),
    invoice_id: z.uuid().optional().nullable(),
    bill_id: z.uuid().optional().nullable(),
    offset_account_id: z.uuid("Select an offset account"),
    amount_minor: z.number().int().positive("Amount must be greater than 0"),
    write_off_date: z.string().optional(),
    reason: z.string().trim().min(1, "A reason is required").max(300),
  })
  .refine((v) => (v.side === "ar" ? !!v.invoice_id && !v.bill_id : !!v.bill_id && !v.invoice_id), {
    message: "Provide the target matching the selected side",
    path: ["side"],
  });
export type WriteOffInput = z.infer<typeof writeOffSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- credits-schema`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/domain/schemas.ts tests/unit/credits-schema.test.ts
git commit -m "feat: Zod schemas for credit memos, vendor credits, refunds, write-offs"
```

---

## Task 7: db/types + credits service

**Files:**
- Modify: `lib/db/types.ts`
- Create: `lib/services/credits.ts`

**Interfaces:**
- Consumes: RPCs from Task 2; money helpers `computeInvoiceLine`, `sumInvoiceTotals` from `lib/domain/money`; Zod input types from Task 6.
- Produces (all take `sb: SupabaseClient` first):
  - `createCreditMemo(sb, input: CreditMemoCreateInput): Promise<string>` (insert draft + lines, compute line/total minor server-side, then `acc_issue_credit_memo`).
  - `applyCreditMemo(sb, creditMemoId: string, allocations: CreditAllocationInput[]): Promise<void>`
  - `voidCreditMemo(sb, id: string): Promise<void>`
  - `listCreditMemos(sb): Promise<CreditMemoRow[]>` and `listOpenInvoices(sb, customerId, currency): Promise<{id,invoice_number,balance_due_minor}[]>`
  - `createVendorCredit`, `applyVendorCredit`, `voidVendorCredit`, `listVendorCredits`, `listOpenBills`
  - `recordCustomerRefund(sb, input: CustomerRefundInput): Promise<string>`, `voidCustomerRefund(sb, id)`
  - `writeOff(sb, input: WriteOffInput): Promise<string>`, `voidWriteOff(sb, id)`
  - `class CreditsError extends Error`.

- [ ] **Step 1: Add row types**

Append to `lib/db/types.ts`:

```typescript
export type CreditStatus = "draft" | "issued" | "partial" | "applied" | "void";

export interface CreditMemoRow {
  id: string; credit_memo_number: string | null; customer_id: string; memo_date: string;
  currency_code: string; subtotal_minor: number; tax_total_minor: number; total_minor: number;
  balance_remaining_minor: number; status: CreditStatus; reason: string | null; memo: string | null;
}
export interface VendorCreditRow {
  id: string; vendor_credit_number: string | null; vendor_id: string; credit_date: string;
  currency_code: string; total_minor: number; balance_remaining_minor: number; status: CreditStatus;
  vendor_ref: string | null; reason: string | null; memo: string | null;
}
export interface CustomerRefundRow {
  id: string; refund_number: string | null; customer_id: string; refund_date: string;
  currency_code: string; amount_minor: number; source_type: "payment" | "credit_memo";
  payment_id: string | null; credit_memo_id: string | null; status: "posted" | "void";
}
export interface WriteOffRow {
  id: string; write_off_number: string | null; side: "ar" | "ap"; invoice_id: string | null;
  bill_id: string | null; amount_minor: number; offset_account_id: string; reason: string; status: "posted" | "void";
}
```

- [ ] **Step 2: Write the service**

```typescript
// lib/services/credits.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CreditMemoRow, VendorCreditRow } from "@/lib/db/types";
import { computeInvoiceLine } from "@/lib/domain/money";
import type {
  CreditMemoCreateInput, VendorCreditCreateInput, CreditAllocationInput, CustomerRefundInput, WriteOffInput,
} from "@/lib/domain/schemas";

export class CreditsError extends Error {}

// --- Credit memo (AR) ---
export async function createCreditMemo(sb: SupabaseClient, input: CreditMemoCreateInput): Promise<string> {
  // Compute line + document totals server-side (never trust the client).
  const lines = input.lines.map((l, i) => {
    const amt = computeInvoiceLine({ quantity: l.quantity, unitPriceMinor: l.unit_price_minor, taxRatePercent: 0 });
    return { ...l, i, amt };
  });
  // Tax rate is resolved from the tax code server-side by re-reading; for simplicity we
  // let the DB tax accounts drive posting and compute tax here from the code's rate.
  const rates = await taxRates(sb, input.lines.map((l) => l.tax_code_id).filter(Boolean) as string[]);
  const subtotal = lines.reduce((s, l) => s + l.amt.subtotalMinor, 0);
  const memoRows = lines.map((l) => {
    const rate = l.tax_code_id ? rates[l.tax_code_id] ?? 0 : 0;
    const a = computeInvoiceLine({ quantity: l.quantity, unitPriceMinor: l.unit_price_minor, taxRatePercent: rate });
    return { l, a };
  });
  const tax = memoRows.reduce((s, r) => s + r.a.taxMinor, 0);
  const total = subtotal + tax;

  const ins = await sb.from("acc_credit_memo").insert({
    customer_id: input.customer_id, currency_code: input.currency_code,
    memo_date: input.memo_date || undefined, reason: input.reason || null, memo: input.memo || null,
    subtotal_minor: subtotal, tax_total_minor: tax, total_minor: total, balance_remaining_minor: 0, status: "draft",
  }).select("id").single();
  if (ins.error) throw new CreditsError(ins.error.message);
  const id = (ins.data as { id: string }).id;

  const lineRows = memoRows.map((r, i) => ({
    credit_memo_id: id, line_order: i, description: r.l.description ?? "", quantity: r.l.quantity,
    unit_price_minor: r.l.unit_price_minor, income_account_id: r.l.income_account_id, tax_code_id: r.l.tax_code_id || null,
    line_subtotal_minor: r.a.subtotalMinor, line_tax_minor: r.a.taxMinor, line_total_minor: r.a.totalMinor,
  }));
  const lineIns = await sb.from("acc_credit_memo_line").insert(lineRows);
  if (lineIns.error) throw new CreditsError(lineIns.error.message);

  const rpc = await sb.rpc("acc_issue_credit_memo", { p_credit_memo_id: id });
  if (rpc.error) throw new CreditsError(rpc.error.message);
  return id;
}

async function taxRates(sb: SupabaseClient, ids: string[]): Promise<Record<string, number>> {
  if (ids.length === 0) return {};
  const { data, error } = await sb.from("acc_tax_code").select("id,rate_percent").in("id", ids);
  if (error) throw new CreditsError(error.message);
  const out: Record<string, number> = {};
  for (const r of data ?? []) out[(r as { id: string }).id] = Number((r as { rate_percent: number }).rate_percent);
  return out;
}

export async function applyCreditMemo(sb: SupabaseClient, creditMemoId: string, allocations: CreditAllocationInput[]): Promise<void> {
  const { error } = await sb.rpc("acc_apply_credit_memo", {
    p_credit_memo_id: creditMemoId,
    p_allocations: allocations.map((a) => ({ invoice_id: a.target_id, amount_minor: a.amount_minor })),
  });
  if (error) throw new CreditsError(error.message);
}
export async function voidCreditMemo(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.rpc("acc_void_credit_memo", { p_credit_memo_id: id });
  if (error) throw new CreditsError(error.message);
}
export async function listCreditMemos(sb: SupabaseClient): Promise<CreditMemoRow[]> {
  const { data, error } = await sb.from("acc_credit_memo")
    .select("id,credit_memo_number,customer_id,memo_date,currency_code,subtotal_minor,tax_total_minor,total_minor,balance_remaining_minor,status,reason,memo")
    .order("created_at", { ascending: false });
  if (error) throw new CreditsError(error.message);
  return (data ?? []) as unknown as CreditMemoRow[];
}
export async function listOpenInvoices(sb: SupabaseClient, customerId: string, currency: string) {
  const { data, error } = await sb.from("acc_invoice")
    .select("id,invoice_number,balance_due_minor")
    .eq("customer_id", customerId).eq("currency_code", currency).in("status", ["issued", "partial"]).gt("balance_due_minor", 0)
    .order("issue_date");
  if (error) throw new CreditsError(error.message);
  return (data ?? []) as unknown as { id: string; invoice_number: string; balance_due_minor: number }[];
}

// --- Vendor credit (AP) ---
export async function createVendorCredit(sb: SupabaseClient, input: VendorCreditCreateInput): Promise<string> {
  const total = input.lines.reduce((s, l) => s + l.amount_minor, 0);
  const ins = await sb.from("acc_vendor_credit").insert({
    vendor_id: input.vendor_id, currency_code: input.currency_code, credit_date: input.credit_date || undefined,
    vendor_ref: input.vendor_ref || null, reason: input.reason || null, memo: input.memo || null,
    total_minor: total, balance_remaining_minor: 0, status: "draft",
  }).select("id").single();
  if (ins.error) throw new CreditsError(ins.error.message);
  const id = (ins.data as { id: string }).id;
  const lineRows = input.lines.map((l, i) => ({
    vendor_credit_id: id, line_order: i, description: l.description ?? "", expense_account_id: l.expense_account_id, amount_minor: l.amount_minor,
  }));
  const lineIns = await sb.from("acc_vendor_credit_line").insert(lineRows);
  if (lineIns.error) throw new CreditsError(lineIns.error.message);
  const rpc = await sb.rpc("acc_issue_vendor_credit", { p_vendor_credit_id: id });
  if (rpc.error) throw new CreditsError(rpc.error.message);
  return id;
}
export async function applyVendorCredit(sb: SupabaseClient, vendorCreditId: string, allocations: CreditAllocationInput[]): Promise<void> {
  const { error } = await sb.rpc("acc_apply_vendor_credit", {
    p_vendor_credit_id: vendorCreditId,
    p_allocations: allocations.map((a) => ({ bill_id: a.target_id, amount_minor: a.amount_minor })),
  });
  if (error) throw new CreditsError(error.message);
}
export async function voidVendorCredit(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.rpc("acc_void_vendor_credit", { p_vendor_credit_id: id });
  if (error) throw new CreditsError(error.message);
}
export async function listVendorCredits(sb: SupabaseClient): Promise<VendorCreditRow[]> {
  const { data, error } = await sb.from("acc_vendor_credit")
    .select("id,vendor_credit_number,vendor_id,credit_date,currency_code,total_minor,balance_remaining_minor,status,vendor_ref,reason,memo")
    .order("created_at", { ascending: false });
  if (error) throw new CreditsError(error.message);
  return (data ?? []) as unknown as VendorCreditRow[];
}
export async function listOpenBills(sb: SupabaseClient, vendorId: string, currency: string) {
  const { data, error } = await sb.from("acc_bill")
    .select("id,bill_number,balance_due_minor")
    .eq("vendor_id", vendorId).eq("currency_code", currency).in("status", ["open", "partial"]).gt("balance_due_minor", 0)
    .order("bill_date");
  if (error) throw new CreditsError(error.message);
  return (data ?? []) as unknown as { id: string; bill_number: string; balance_due_minor: number }[];
}

// --- Refund + write-off ---
export async function recordCustomerRefund(sb: SupabaseClient, input: CustomerRefundInput): Promise<string> {
  const { data, error } = await sb.rpc("acc_record_customer_refund", {
    p_customer_id: input.customer_id, p_refund_date: input.refund_date || undefined, p_currency: input.currency_code,
    p_amount_minor: input.amount_minor, p_source_type: input.source_type, p_payment_id: input.payment_id || null,
    p_credit_memo_id: input.credit_memo_id || null, p_bank_account_id: input.bank_account_id, p_memo: input.memo || null,
  });
  if (error) throw new CreditsError(error.message);
  return data as string;
}
export async function voidCustomerRefund(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.rpc("acc_void_customer_refund", { p_refund_id: id });
  if (error) throw new CreditsError(error.message);
}
export async function writeOff(sb: SupabaseClient, input: WriteOffInput): Promise<string> {
  const { data, error } = await sb.rpc("acc_write_off", {
    p_side: input.side, p_target_id: (input.invoice_id ?? input.bill_id) as string,
    p_offset_account_id: input.offset_account_id, p_amount_minor: input.amount_minor,
    p_date: input.write_off_date || undefined, p_reason: input.reason,
  });
  if (error) throw new CreditsError(error.message);
  return data as string;
}
export async function voidWriteOff(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.rpc("acc_void_write_off", { p_write_off_id: id });
  if (error) throw new CreditsError(error.message);
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/db/types.ts lib/services/credits.ts
git commit -m "feat: credits service (credit memo, vendor credit, refund, write-off)"
```

---

## Task 8: Ageing/statements service

**Files:**
- Create: `lib/services/ageing.ts`

**Interfaces:**
- Consumes: `computeAgeing`, `AgeingItem` (Task 5); the read RPCs (Task 3); `acc_ledger_balances` for control-account reconciliation.
- Produces:
  - `getArAgeing(sb, asOf: string): Promise<AgeingReport>` and `getApAgeing(sb, asOf): Promise<AgeingReport>` where `AgeingReport = { rows: AgeingReportRow[]; byCustomerOrVendor: {...}; buckets: Record<string,number>; total: number; controlBalanceMinor: number; reconciled: boolean }`.
  - `getCustomerStatement(sb, customerId, from, to): Promise<StatementReport>` and `getVendorStatement(...)`.

- [ ] **Step 1: Write the service**

```typescript
// lib/services/ageing.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeAgeing, bucketOf, type AgeingItem } from "@/lib/domain/ageing";

export class AgeingError extends Error {}

export interface AgeingReportRow {
  entityId: string; entityName: string; docType: string; docNumber: string | null;
  docDate: string; dueDate: string; balanceMinor: number; bucket: string;
}
export interface AgeingReport {
  rows: AgeingReportRow[];
  buckets: Record<string, number>;
  total: number;
  controlBalanceMinor: number;
  reconciled: boolean;
}

async function controlBalance(sb: SupabaseClient, accountType: string, asOf: string): Promise<number> {
  // Net (debit - credit) of the control account(s) of the given type, base currency.
  const { data, error } = await sb.rpc("acc_ledger_balances", { p_from: null, p_to: asOf });
  if (error) throw new AgeingError(error.message);
  return (data ?? [])
    .filter((r: Record<string, unknown>) => r.account_type === accountType)
    .reduce((s: number, r: Record<string, unknown>) => s + (Number(r.debit_base) - Number(r.credit_base)), 0);
}

async function ageing(sb: SupabaseClient, rpc: string, asOf: string, idKey: string, nameKey: string, accountType: string): Promise<AgeingReport> {
  const { data, error } = await sb.rpc(rpc, { p_as_of: asOf });
  if (error) throw new AgeingError(error.message);
  const rows: AgeingReportRow[] = (data ?? []).map((r: Record<string, unknown>) => ({
    entityId: r[idKey] as string, entityName: r[nameKey] as string, docType: r.doc_type as string,
    docNumber: (r.doc_number as string) ?? null, docDate: r.doc_date as string, dueDate: r.due_date as string,
    balanceMinor: Number(r.balance_minor), bucket: bucketOf(r.due_date as string, asOf),
  }));
  const items: AgeingItem[] = rows.map((r) => ({ dueDate: r.dueDate, balanceMinor: r.balanceMinor }));
  const { buckets, total } = computeAgeing(items, asOf);
  const control = await controlBalance(sb, accountType, asOf);
  // AR control net is debit-positive; AP control net is credit-positive (so negate).
  const controlBalanceMinor = accountType === "accounts_receivable" ? control : -control;
  return { rows, buckets, total, controlBalanceMinor, reconciled: total === controlBalanceMinor };
}

export function getArAgeing(sb: SupabaseClient, asOf: string): Promise<AgeingReport> {
  return ageing(sb, "acc_ar_ageing", asOf, "customer_id", "customer_name", "accounts_receivable");
}
export function getApAgeing(sb: SupabaseClient, asOf: string): Promise<AgeingReport> {
  return ageing(sb, "acc_ap_ageing", asOf, "vendor_id", "vendor_name", "accounts_payable");
}

export interface StatementRow { txnDate: string; docType: string; docNumber: string | null; amountMinor: number; runningMinor: number; }
export interface StatementReport { openingMinor: number; rows: StatementRow[]; closingMinor: number; }

async function statement(sb: SupabaseClient, rpc: string, idParam: string, entityId: string, from: string, to: string, ageingRpc: string, asOfIdField: string): Promise<StatementReport> {
  // Opening balance = the entity's open balance strictly before `from`, derived by
  // running the ageing RPC as of the day before `from` and summing this entity's items.
  const dayBefore = shiftBack(from);
  const openRes = await sb.rpc(ageingRpc, { p_as_of: dayBefore });
  if (openRes.error) throw new AgeingError(openRes.error.message);
  const openingMinor = (openRes.data ?? [])
    .filter((r: Record<string, unknown>) => r[asOfIdField] === entityId)
    .reduce((s: number, r: Record<string, unknown>) => s + Number(r.balance_minor), 0);

  const { data, error } = await sb.rpc(rpc, { [idParam]: entityId, p_from: from, p_to: to } as Record<string, unknown>);
  if (error) throw new AgeingError(error.message);
  let running = openingMinor;
  const rows: StatementRow[] = (data ?? []).map((r: Record<string, unknown>) => {
    running += Number(r.amount_minor);
    return { txnDate: r.txn_date as string, docType: r.doc_type as string, docNumber: (r.doc_number as string) ?? null, amountMinor: Number(r.amount_minor), runningMinor: running };
  });
  return { openingMinor, rows, closingMinor: running };
}

export function getCustomerStatement(sb: SupabaseClient, customerId: string, from: string, to: string): Promise<StatementReport> {
  return statement(sb, "acc_customer_statement", "p_customer_id", customerId, from, to, "acc_ar_ageing", "customer_id");
}
export function getVendorStatement(sb: SupabaseClient, vendorId: string, from: string, to: string): Promise<StatementReport> {
  return statement(sb, "acc_vendor_statement", "p_vendor_id", vendorId, from, to, "acc_ap_ageing", "vendor_id");
}

function shiftBack(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/services/ageing.ts
git commit -m "feat: AR/AP ageing + statement service with control-account reconciliation"
```

---

## Task 9: Server actions

**Files:**
- Create: `app/(app)/credit-memos/actions.ts`, `app/(app)/vendor-credits/actions.ts`
- Create: `app/(app)/reports/ar-ageing/actions.ts`, `app/(app)/reports/ap-ageing/actions.ts`
- Create: `app/(app)/reports/customer-statement/actions.ts`, `app/(app)/reports/vendor-statement/actions.ts`
- Modify: `app/(app)/payments/actions.ts` (add refund actions), and add write-off actions used by invoices/bills — put shared write-off + refund actions in `app/(app)/credit-memos/actions.ts` re-exported, OR create `app/(app)/settlements/actions.ts`. **Decision: create `app/(app)/settlements/actions.ts`** for refund + write-off (invoked from payments/invoices/bills pages).

**Interfaces:**
- Consumes: Task 7/8 services; Zod schemas (Task 6); `getUserRole`, `canWrite`; `createSupabaseServerClient`.
- Produces `ActionResult<T>` functions (same shape as existing modules): `createCreditMemoAction`, `applyCreditMemoAction`, `voidCreditMemoAction`, `listCreditMemosAction`, `listOpenInvoicesAction`; the vendor-credit mirror; `arAgeingAction`, `apAgeingAction`, `customerStatementAction`, `vendorStatementAction`; and in settlements: `recordRefundAction`, `voidRefundAction`, `writeOffAction`, `voidWriteOffAction`.

- [ ] **Step 1: Credit-memos actions**

```typescript
// app/(app)/credit-memos/actions.ts
"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { creditMemoCreateSchema, creditAllocationSchema } from "@/lib/domain/schemas";
import { z } from "zod";
import {
  createCreditMemo, applyCreditMemo, voidCreditMemo, listCreditMemos, listOpenInvoices, CreditsError,
} from "@/lib/services/credits";
import type { CreditMemoRow } from "@/lib/db/types";

export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }
async function guard(): Promise<string | null> {
  const role = await getUserRole();
  return canWrite(role) ? null : "You do not have permission to perform this action";
}
function msg(e: unknown): string { return e instanceof CreditsError || e instanceof Error ? e.message : "An unexpected error occurred"; }

export async function createCreditMemoAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  const parsed = creditMemoCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const id = await createCreditMemo(sb, parsed.data);
    revalidatePath("/credit-memos");
    return { ok: true, data: { id } };
  } catch (e) { return { ok: false, error: msg(e) }; }
}

export async function applyCreditMemoAction(id: string, rawAllocs: unknown): Promise<ActionResult> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  const parsed = z.array(creditAllocationSchema).safeParse(rawAllocs);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid allocations" };
  try {
    const sb = await createSupabaseServerClient();
    await applyCreditMemo(sb, id, parsed.data);
    revalidatePath("/credit-memos");
    return { ok: true };
  } catch (e) { return { ok: false, error: msg(e) }; }
}

export async function voidCreditMemoAction(id: string): Promise<ActionResult> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  try { const sb = await createSupabaseServerClient(); await voidCreditMemo(sb, id); revalidatePath("/credit-memos"); return { ok: true }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

export async function listCreditMemosAction(): Promise<ActionResult<CreditMemoRow[]>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await listCreditMemos(sb) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}

export async function listOpenInvoicesAction(customerId: string, currency: string): Promise<ActionResult<{ id: string; invoice_number: string; balance_due_minor: number }[]>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await listOpenInvoices(sb, customerId, currency) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
```

- [ ] **Step 2: Vendor-credits actions**

Create `app/(app)/vendor-credits/actions.ts` — the exact mirror of Step 1 using `vendorCreditCreateSchema`, `createVendorCredit`, `applyVendorCredit`, `voidVendorCredit`, `listVendorCredits`, `listOpenBills`, `VendorCreditRow`, revalidating `/vendor-credits`, with actions `createVendorCreditAction`, `applyVendorCreditAction(id, rawAllocs)`, `voidVendorCreditAction`, `listVendorCreditsAction`, `listOpenBillsAction(vendorId, currency)`.

```typescript
// app/(app)/vendor-credits/actions.ts
"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { vendorCreditCreateSchema, creditAllocationSchema } from "@/lib/domain/schemas";
import {
  createVendorCredit, applyVendorCredit, voidVendorCredit, listVendorCredits, listOpenBills, CreditsError,
} from "@/lib/services/credits";
import type { VendorCreditRow } from "@/lib/db/types";

export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }
async function guard(): Promise<string | null> {
  const role = await getUserRole();
  return canWrite(role) ? null : "You do not have permission to perform this action";
}
function msg(e: unknown): string { return e instanceof CreditsError || e instanceof Error ? e.message : "An unexpected error occurred"; }

export async function createVendorCreditAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  const parsed = vendorCreditCreateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try { const sb = await createSupabaseServerClient(); const id = await createVendorCredit(sb, parsed.data); revalidatePath("/vendor-credits"); return { ok: true, data: { id } }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
export async function applyVendorCreditAction(id: string, rawAllocs: unknown): Promise<ActionResult> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  const parsed = z.array(creditAllocationSchema).safeParse(rawAllocs);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid allocations" };
  try { const sb = await createSupabaseServerClient(); await applyVendorCredit(sb, id, parsed.data); revalidatePath("/vendor-credits"); return { ok: true }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
export async function voidVendorCreditAction(id: string): Promise<ActionResult> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  try { const sb = await createSupabaseServerClient(); await voidVendorCredit(sb, id); revalidatePath("/vendor-credits"); return { ok: true }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
export async function listVendorCreditsAction(): Promise<ActionResult<VendorCreditRow[]>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await listVendorCredits(sb) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
export async function listOpenBillsAction(vendorId: string, currency: string): Promise<ActionResult<{ id: string; bill_number: string; balance_due_minor: number }[]>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await listOpenBills(sb, vendorId, currency) }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
```

- [ ] **Step 3: Settlements (refund + write-off) actions**

```typescript
// app/(app)/settlements/actions.ts
"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { customerRefundSchema, writeOffSchema } from "@/lib/domain/schemas";
import { recordCustomerRefund, voidCustomerRefund, writeOff, voidWriteOff, CreditsError } from "@/lib/services/credits";

export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }
async function guard(): Promise<string | null> {
  const role = await getUserRole();
  return canWrite(role) ? null : "You do not have permission to perform this action";
}
function msg(e: unknown): string { return e instanceof CreditsError || e instanceof Error ? e.message : "An unexpected error occurred"; }

export async function recordRefundAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  const parsed = customerRefundSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try { const sb = await createSupabaseServerClient(); const id = await recordCustomerRefund(sb, parsed.data); revalidatePath("/payments"); return { ok: true, data: { id } }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
export async function voidRefundAction(id: string): Promise<ActionResult> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  try { const sb = await createSupabaseServerClient(); await voidCustomerRefund(sb, id); revalidatePath("/payments"); return { ok: true }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
export async function writeOffAction(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  const parsed = writeOffSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid data" };
  try {
    const sb = await createSupabaseServerClient();
    const id = await writeOff(sb, parsed.data);
    revalidatePath(parsed.data.side === "ar" ? "/invoices" : "/bills");
    return { ok: true, data: { id } };
  } catch (e) { return { ok: false, error: msg(e) }; }
}
export async function voidWriteOffAction(id: string, side: "ar" | "ap"): Promise<ActionResult> {
  const denied = await guard(); if (denied) return { ok: false, error: denied };
  try { const sb = await createSupabaseServerClient(); await voidWriteOff(sb, id); revalidatePath(side === "ar" ? "/invoices" : "/bills"); return { ok: true }; }
  catch (e) { return { ok: false, error: msg(e) }; }
}
```

- [ ] **Step 4: Report actions (ageing + statements)**

```typescript
// app/(app)/reports/ar-ageing/actions.ts
"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getArAgeing, AgeingError, type AgeingReport } from "@/lib/services/ageing";
export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }
export async function arAgeingAction(asOf: string): Promise<ActionResult<AgeingReport>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await getArAgeing(sb, asOf) }; }
  catch (e) { return { ok: false, error: e instanceof AgeingError || e instanceof Error ? e.message : "An unexpected error occurred" }; }
}
```

```typescript
// app/(app)/reports/ap-ageing/actions.ts
"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getApAgeing, AgeingError, type AgeingReport } from "@/lib/services/ageing";
export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }
export async function apAgeingAction(asOf: string): Promise<ActionResult<AgeingReport>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await getApAgeing(sb, asOf) }; }
  catch (e) { return { ok: false, error: e instanceof AgeingError || e instanceof Error ? e.message : "An unexpected error occurred" }; }
}
```

```typescript
// app/(app)/reports/customer-statement/actions.ts
"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getCustomerStatement, AgeingError, type StatementReport } from "@/lib/services/ageing";
export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }
export async function customerStatementAction(customerId: string, from: string, to: string): Promise<ActionResult<StatementReport>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await getCustomerStatement(sb, customerId, from, to) }; }
  catch (e) { return { ok: false, error: e instanceof AgeingError || e instanceof Error ? e.message : "An unexpected error occurred" }; }
}
```

```typescript
// app/(app)/reports/vendor-statement/actions.ts
"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getVendorStatement, AgeingError, type StatementReport } from "@/lib/services/ageing";
export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }
export async function vendorStatementAction(vendorId: string, from: string, to: string): Promise<ActionResult<StatementReport>> {
  try { const sb = await createSupabaseServerClient(); return { ok: true, data: await getVendorStatement(sb, vendorId, from, to) }; }
  catch (e) { return { ok: false, error: e instanceof AgeingError || e instanceof Error ? e.message : "An unexpected error occurred" }; }
}
```

- [ ] **Step 5: Typecheck + commit**

Run: `npm run typecheck`
Expected: clean.

```bash
git add "app/(app)/credit-memos/actions.ts" "app/(app)/vendor-credits/actions.ts" "app/(app)/settlements/actions.ts" "app/(app)/reports/ar-ageing/actions.ts" "app/(app)/reports/ap-ageing/actions.ts" "app/(app)/reports/customer-statement/actions.ts" "app/(app)/reports/vendor-statement/actions.ts"
git commit -m "feat: server actions for credits, refunds, write-offs, ageing, statements"
```

---

## Task 10: UI — Credit Memos page

**Files:**
- Create: `app/(app)/credit-memos/page.tsx`, `app/(app)/credit-memos/CreditMemosClient.tsx`

**Interfaces:**
- Consumes: actions from Task 9; `listCustomers` (existing service), `listCurrencies`, `listAccounts`; `fromMinor`/`toMinor`.

Read `app/(app)/invoices/InvoicesClient.tsx` and `app/(app)/journal/JournalClient.tsx` first to match this project's Ant Design v6 conventions (`App.useApp()`, the `set-state-in-effect` eslint-disable on the initial load effect, Select/Table/Modal usage).

- [ ] **Step 1: Page (server component)**

```tsx
// app/(app)/credit-memos/page.tsx
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, canWrite } from "@/lib/auth";
import { listCurrencies } from "@/lib/services/reference";
import { listAccounts } from "@/lib/services/accounts";
import PageHeader from "@/components/PageHeader";
import CreditMemosClient from "./CreditMemosClient";

export const dynamic = "force-dynamic";

export default async function CreditMemosPage() {
  const sb = await createSupabaseServerClient();
  const role = await getUserRole();
  const [currencies, accounts, customersRes] = await Promise.all([
    listCurrencies(sb),
    listAccounts(sb),
    sb.from("acc_customer").select("id,name,currency_code").order("name"),
  ]);
  const base = currencies.find((c) => c.is_base);
  const income = accounts.filter((a) => a.account_type === "income" && a.is_posting_account && a.status === "active");
  return (
    <div>
      <PageHeader title="Credit Memos" description="Issue customer credit memos and apply them to open invoices." />
      <CreditMemosClient
        canWrite={canWrite(role)}
        customers={(customersRes.data ?? []) as { id: string; name: string; currency_code: string | null }[]}
        incomeAccounts={income as { id: string; account_code: string; name: string }[]}
        baseCurrency={base?.code ?? "USD"}
        baseDecimals={base?.decimal_places ?? 2}
      />
    </div>
  );
}
```

- [ ] **Step 2: Client component**

Implement `CreditMemosClient.tsx` as a `"use client"` component that:
- loads memos via `listCreditMemosAction` in an effect (with the eslint-disable comment as the Journal client does);
- shows a table (number, customer, date, total, remaining, status) with a "Void" action (calls `voidCreditMemoAction`) for `issued`/`partial` rows and an "Apply" action opening an allocation modal;
- "New Credit Memo" modal: customer + currency (default base), a line grid (description, quantity, unit price via `InputNumber` with `precision={baseDecimals}`, income account Select, optional tax-code Select), a live total; submit maps unit price via `toMinor` and calls `createCreditMemoAction`;
- "Apply" modal: fetch open invoices via `listOpenInvoicesAction(customerId, currency)`, let the user enter an amount per invoice (≤ balance_due and ≤ memo remaining shown), submit an allocations array `[{ target_id, amount_minor }]` to `applyCreditMemoAction`.
- All money via `fromMinor`/`toMinor`; guard write controls behind `canWrite`.

Full reference implementation:

```tsx
// app/(app)/credit-memos/CreditMemosClient.tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import { App, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Select, Space, Table, Tag } from "antd";
import { fromMinor, toMinor } from "@/lib/domain/money";
import { createCreditMemoAction, listCreditMemosAction, voidCreditMemoAction, applyCreditMemoAction, listOpenInvoicesAction } from "./actions";
import type { CreditMemoRow } from "@/lib/db/types";

interface Customer { id: string; name: string; currency_code: string | null; }
interface Account { id: string; account_code: string; name: string; }
interface Props { canWrite: boolean; customers: Customer[]; incomeAccounts: Account[]; baseCurrency: string; baseDecimals: number; }
interface LineForm { description?: string; quantity?: number; unit_price?: number; income_account_id?: string; }

export default function CreditMemosClient({ canWrite, customers, incomeAccounts, baseCurrency, baseDecimals }: Props) {
  const { message } = App.useApp();
  const [memos, setMemos] = useState<CreditMemoRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm();
  const [lines, setLines] = useState<LineForm[]>([{}]);
  const [applyFor, setApplyFor] = useState<CreditMemoRow | null>(null);
  const [openInvoices, setOpenInvoices] = useState<{ id: string; invoice_number: string; balance_due_minor: number }[]>([]);
  const [allocs, setAllocs] = useState<Record<string, number>>({});

  const load = async () => {
    setLoading(true);
    const r = await listCreditMemosAction();
    setLoading(false);
    if (r.ok && r.data) setMemos(r.data); else message.error(r.error ?? "Failed to load");
  };
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, []);

  const fmt = (m: number) => fromMinor(m, baseDecimals).toLocaleString(undefined, { minimumFractionDigits: baseDecimals });
  const total = useMemo(() => lines.reduce((s, l) => s + toMinor((l.quantity ?? 0) * (l.unit_price ?? 0), baseDecimals), 0), [lines, baseDecimals]);

  const submit = async () => {
    const h = await form.validateFields();
    const payload = {
      customer_id: h.customer_id, currency_code: baseCurrency, memo_date: h.memo_date?.format("YYYY-MM-DD"),
      reason: h.reason ?? null, memo: h.memo ?? null,
      lines: lines.filter((l) => l.income_account_id && (l.unit_price ?? 0) > 0).map((l) => ({
        description: l.description ?? "", quantity: l.quantity ?? 1, unit_price_minor: toMinor(l.unit_price ?? 0, baseDecimals), income_account_id: l.income_account_id!,
      })),
    };
    const r = await createCreditMemoAction(payload);
    if (r.ok) { message.success("Credit memo issued"); setOpen(false); setLines([{}]); form.resetFields(); void load(); }
    else message.error(r.error ?? "Failed");
  };

  const openApply = async (m: CreditMemoRow) => {
    setApplyFor(m); setAllocs({});
    const r = await listOpenInvoicesAction(m.customer_id, m.currency_code);
    if (r.ok && r.data) setOpenInvoices(r.data); else message.error(r.error ?? "Failed to load invoices");
  };
  const submitApply = async () => {
    if (!applyFor) return;
    const arr = Object.entries(allocs).filter(([, v]) => v > 0).map(([target_id, v]) => ({ target_id, amount_minor: toMinor(v, baseDecimals) }));
    const r = await applyCreditMemoAction(applyFor.id, arr);
    if (r.ok) { message.success("Applied"); setApplyFor(null); void load(); } else message.error(r.error ?? "Failed");
  };

  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      {canWrite && <Button type="primary" onClick={() => setOpen(true)}>New Credit Memo</Button>}
      <Table rowKey="id" loading={loading} dataSource={memos}
        columns={[
          { title: "Number", dataIndex: "credit_memo_number" },
          { title: "Date", dataIndex: "memo_date" },
          { title: "Total", align: "right", render: (_, m) => fmt(m.total_minor) },
          { title: "Remaining", align: "right", render: (_, m) => fmt(m.balance_remaining_minor) },
          { title: "Status", dataIndex: "status", render: (s) => <Tag>{s}</Tag> },
          { title: "", render: (_, m) => canWrite && (m.status === "issued" || m.status === "partial") ? (
            <Space><Button size="small" onClick={() => openApply(m)}>Apply</Button>
              <Button size="small" danger onClick={async () => { const r = await voidCreditMemoAction(m.id); if (r.ok) { message.success("Voided"); void load(); } else message.error(r.error ?? "Failed"); }}>Void</Button></Space>
          ) : null },
        ]} />

      <Modal open={open} title="New Credit Memo" width={780} onCancel={() => setOpen(false)} onOk={submit} okButtonProps={{ disabled: total <= 0 }}>
        <Form form={form} layout="vertical">
          <Space>
            <Form.Item name="customer_id" label="Customer" rules={[{ required: true }]}>
              <Select style={{ width: 280 }} showSearch optionFilterProp="label" options={customers.map((c) => ({ value: c.id, label: c.name }))} />
            </Form.Item>
            <Form.Item name="memo_date" label="Date"><DatePicker /></Form.Item>
          </Space>
          <Form.Item name="reason" label="Reason"><Input /></Form.Item>
        </Form>
        <Card size="small" title={`Lines (${baseCurrency})`}>
          {lines.map((l, i) => (
            <Space key={i} style={{ display: "flex", marginBottom: 8 }} wrap>
              <Input placeholder="Description" style={{ width: 200 }} value={l.description} onChange={(e) => setLines((p) => p.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} />
              <InputNumber placeholder="Qty" min={0} value={l.quantity} onChange={(v) => setLines((p) => p.map((x, j) => j === i ? { ...x, quantity: v ?? undefined } : x))} />
              <InputNumber placeholder="Unit price" min={0} precision={baseDecimals} value={l.unit_price} onChange={(v) => setLines((p) => p.map((x, j) => j === i ? { ...x, unit_price: v ?? undefined } : x))} />
              <Select placeholder="Income account" style={{ width: 220 }} showSearch optionFilterProp="label" value={l.income_account_id}
                options={incomeAccounts.map((a) => ({ value: a.id, label: `${a.account_code} ${a.name}` }))}
                onChange={(v) => setLines((p) => p.map((x, j) => j === i ? { ...x, income_account_id: v } : x))} />
              <Button danger onClick={() => setLines((p) => p.filter((_, j) => j !== i))} disabled={lines.length <= 1}>×</Button>
            </Space>
          ))}
          <Button onClick={() => setLines((p) => [...p, {}])}>Add line</Button>
          <div style={{ marginTop: 12 }}>Total: {fmt(total)} {baseCurrency}</div>
        </Card>
      </Modal>

      <Modal open={!!applyFor} title={`Apply ${applyFor?.credit_memo_number ?? ""}`} onCancel={() => setApplyFor(null)} onOk={submitApply}>
        <p>Remaining: {applyFor ? fmt(applyFor.balance_remaining_minor) : ""} {baseCurrency}</p>
        <Table rowKey="id" pagination={false} dataSource={openInvoices}
          columns={[
            { title: "Invoice", dataIndex: "invoice_number" },
            { title: "Balance", align: "right", render: (_, r) => fmt(r.balance_due_minor) },
            { title: "Apply", render: (_, r) => (
              <InputNumber min={0} precision={baseDecimals} max={fromMinor(r.balance_due_minor, baseDecimals)}
                onChange={(v) => setAllocs((p) => ({ ...p, [r.id]: (v as number) ?? 0 }))} />
            ) },
          ]} />
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
git add "app/(app)/credit-memos/page.tsx" "app/(app)/credit-memos/CreditMemosClient.tsx"
git commit -m "feat: Credit Memos page (issue + apply to invoices + void)"
```

---

## Task 11: UI — Vendor Credits page

**Files:**
- Create: `app/(app)/vendor-credits/page.tsx`, `app/(app)/vendor-credits/VendorCreditsClient.tsx`

**Interfaces:** mirror Task 10 for AP — vendors instead of customers, expense accounts instead of income, a single `amount` per line (no quantity/tax; US tax-inclusive), applying to open bills.

- [ ] **Step 1: Page + client**

Build the AP mirror of Task 10:
- `page.tsx` loads vendors (`acc_vendor`), expense accounts (`account_type in ('expense','cost_of_goods_sold','other_expense')`, active posting), currencies; renders `VendorCreditsClient`.
- `VendorCreditsClient.tsx` mirrors `CreditMemosClient` but: line grid has `description` + `expense account` Select + `amount` (`InputNumber precision={baseDecimals}`); total = sum of amounts; submit calls `createVendorCreditAction` with `lines: [{ description, expense_account_id, amount_minor: toMinor(amount) }]`; the Apply modal fetches open bills via `listOpenBillsAction(vendorId, currency)` and posts allocations to `applyVendorCreditAction`; Void calls `voidVendorCreditAction`. Reuse the same conventions (`App.useApp()`, eslint-disable on the load effect, `fromMinor`/`toMinor`).

- [ ] **Step 2: Build + lint**

Run: `npm run build && npm run lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/vendor-credits/page.tsx" "app/(app)/vendor-credits/VendorCreditsClient.tsx"
git commit -m "feat: Vendor Credits page (issue + apply to bills + void)"
```

---

## Task 12: UI — Refund flow + Write-off actions

**Files:**
- Create: `app/(app)/settlements/RefundModal.tsx`, `app/(app)/settlements/WriteOffModal.tsx` (shared client components)
- Modify: `app/(app)/payments/*` (add a "Refund" entry point), `app/(app)/invoices/*` and `app/(app)/bills/*` (add a "Write off" row action on open documents).

**Interfaces:** consumes `recordRefundAction`, `writeOffAction` from `app/(app)/settlements/actions.ts`.

- [ ] **Step 1: RefundModal + WriteOffModal**

`RefundModal.tsx` — props `{ open, onClose, onDone, customerId, currency, baseDecimals, sources }` where `sources` is a pre-fetched list of the customer's unapplied payments and open credit memos; user picks one source + amount (≤ that source's remaining) + bank account; submits to `recordRefundAction` with `source_type` and the matching id.

`WriteOffModal.tsx` — props `{ open, onClose, onDone, side, targetId, currency, balanceMinor, baseDecimals, offsetAccounts }`; user enters amount (≤ balance), picks an offset account (expense list for AR, income list for AP), and a required reason; submits to `writeOffAction`.

Both use `App.useApp()`, `fromMinor`/`toMinor`, and disable OK until valid (amount>0 & ≤ max; reason non-empty for write-off).

- [ ] **Step 2: Wire into invoices/bills/payments**

- In the invoices list client, add a "Write off" action for rows with status `issued`/`partial`, opening `WriteOffModal` with `side="ar"`, `targetId=invoice.id`, `balanceMinor=invoice.balance_due_minor`, and the page's expense accounts.
- In the bills list client, the same with `side="ap"` and income accounts.
- In the payments list client, add a "Refund" action for payments with `unapplied_minor > 0`, opening `RefundModal` (source = that payment). Fetching open credit memos for the credit-memo source can reuse `listCreditMemos` filtered client-side, or offer only the payment source when opened from a payment row.
- The invoices/bills/payments pages must pass the needed account lists (expense/income/bank) and `baseDecimals` to their clients; add those props to the server components if not already present.

- [ ] **Step 3: Build + lint + typecheck**

Run: `npm run build && npm run lint && npm run typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/settlements" "app/(app)/invoices" "app/(app)/bills" "app/(app)/payments"
git commit -m "feat: customer refund flow + AR/AP write-off actions on invoices/bills"
```

---

## Task 13: UI — AR/AP Ageing reports

**Files:**
- Create: `app/(app)/reports/ar-ageing/{page.tsx,ArAgeingClient.tsx}`, `app/(app)/reports/ap-ageing/{page.tsx,ApAgeingClient.tsx}`

**Interfaces:** consumes `arAgeingAction`/`apAgeingAction`.

- [ ] **Step 1: AR ageing page + client**

```tsx
// app/(app)/reports/ar-ageing/page.tsx
import { createSupabaseServerClient } from "@/lib/db/server";
import { listCurrencies } from "@/lib/services/reference";
import PageHeader from "@/components/PageHeader";
import ArAgeingClient from "./ArAgeingClient";
export const dynamic = "force-dynamic";
export default async function ArAgeingPage() {
  const sb = await createSupabaseServerClient();
  const base = (await listCurrencies(sb)).find((c) => c.is_base);
  return (
    <div>
      <PageHeader title="AR Ageing" description="Open receivables by age, reconciled to the Accounts Receivable control account." />
      <ArAgeingClient baseCurrency={base?.code ?? "USD"} baseDecimals={base?.decimal_places ?? 2} />
    </div>
  );
}
```

```tsx
// app/(app)/reports/ar-ageing/ArAgeingClient.tsx
"use client";
import { useState } from "react";
import { App, Alert, Button, DatePicker, Space, Table, Tag, Typography } from "antd";
import { fromMinor } from "@/lib/domain/money";
import { arAgeingAction } from "./actions";
import type { AgeingReport } from "@/lib/services/ageing";

const BUCKETS = [["current","Current"],["d1_30","1–30"],["d31_60","31–60"],["d61_90","61–90"],["d90_plus","90+"]] as const;

export default function ArAgeingClient({ baseCurrency, baseDecimals }: { baseCurrency: string; baseDecimals: number }) {
  const { message } = App.useApp();
  const [rep, setRep] = useState<AgeingReport | null>(null);
  const [asOf, setAsOf] = useState<import("dayjs").Dayjs | null>(null);
  const [loading, setLoading] = useState(false);
  const fmt = (m: number) => fromMinor(m, baseDecimals).toLocaleString(undefined, { minimumFractionDigits: baseDecimals });
  const run = async () => {
    if (!asOf) { message.warning("Pick an as-of date"); return; }
    setLoading(true);
    const r = await arAgeingAction(asOf.format("YYYY-MM-DD"));
    setLoading(false);
    if (r.ok && r.data) setRep(r.data); else message.error(r.error ?? "Failed");
  };
  return (
    <Space direction="vertical" style={{ width: "100%" }} size="large">
      <Space><DatePicker value={asOf} onChange={setAsOf} placeholder="As of" /><Button type="primary" loading={loading} onClick={run}>Run</Button></Space>
      {rep && (
        <>
          <Typography.Text type="secondary">Base currency {baseCurrency} · Accrual basis</Typography.Text>
          <Alert type={rep.reconciled ? "success" : "warning"}
            message={rep.reconciled
              ? `Reconciled to AR control account: ${fmt(rep.total)} ${baseCurrency}.`
              : `Ageing total ${fmt(rep.total)} does not match AR control ${fmt(rep.controlBalanceMinor)} — investigate.`} />
          <Space size="large">{BUCKETS.map(([k, label]) => <Tag key={k}>{label}: {fmt(rep.buckets[k])}</Tag>)}<b>Total: {fmt(rep.total)}</b></Space>
          <Table rowKey={(r) => `${r.docType}-${r.docNumber}`} loading={loading} dataSource={rep.rows}
            columns={[
              { title: "Customer", dataIndex: "entityName" },
              { title: "Type", dataIndex: "docType" },
              { title: "Number", dataIndex: "docNumber" },
              { title: "Due", dataIndex: "dueDate" },
              { title: "Bucket", dataIndex: "bucket" },
              { title: "Balance", align: "right", render: (_, r) => fmt(r.balanceMinor) },
            ]} />
        </>
      )}
    </Space>
  );
}
```

- [ ] **Step 2: AP ageing page + client**

Mirror Step 1 into `app/(app)/reports/ap-ageing/` using `apAgeingAction`, titled "AP Ageing", label "Accounts Payable control account", column header "Vendor".

- [ ] **Step 3: Build + lint**

Run: `npm run build && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/reports/ar-ageing" "app/(app)/reports/ap-ageing"
git commit -m "feat: AR/AP ageing reports with control-account reconciliation"
```

---

## Task 14: UI — Statements + navigation

**Files:**
- Create: `app/(app)/reports/customer-statement/{page.tsx,CustomerStatementClient.tsx}`, `app/(app)/reports/vendor-statement/{page.tsx,VendorStatementClient.tsx}`
- Modify: `components/AppShell.tsx`

- [ ] **Step 1: Customer statement page + client**

`page.tsx` loads customers + base currency. `CustomerStatementClient.tsx`: pick a customer + date range, call `customerStatementAction(customerId, from, to)`, render opening balance, an activity table (date, type, number, amount, running), and the closing balance. Money via `fromMinor`. Standard header (base currency, generated context). Use `App.useApp()`.

- [ ] **Step 2: Vendor statement page + client**

Mirror Step 1 with vendors + `vendorStatementAction`.

- [ ] **Step 3: Navigation**

In `components/AppShell.tsx`, add to `NAV` (reuse already-imported icons — e.g. `FileTextOutlined`, `BarChartOutlined`):

```tsx
  { key: "/credit-memos", icon: <FileTextOutlined />, label: "Credit Memos" },
  { key: "/vendor-credits", icon: <FileTextOutlined />, label: "Vendor Credits" },
```

The reports live under `/reports/*` and are reachable at `/reports/ar-ageing`, `/reports/ap-ageing`, `/reports/customer-statement`, `/reports/vendor-statement`.

- [ ] **Step 4: Build + lint + typecheck**

Run: `npm run build && npm run lint && npm run typecheck`
Expected: all clean.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/reports/customer-statement" "app/(app)/reports/vendor-statement" components/AppShell.tsx
git commit -m "feat: customer/vendor statements + nav entries"
```

---

## Task 15: End-to-end verify + full verification

**Files:**
- Create: `scripts/verify-ar-ap.mjs`

**Interfaces:** consumes applied migrations 0019/0020/0021; seeded admin login and COA (AR `1100`, AP `2000`, bank `1010`, income `4000`, an expense account, other income `7000`).

- [ ] **Step 1: Write the verify script**

Follow the exact structure of `scripts/verify-journal.mjs` (admin login, `pg.Client` over `SUPABASE_DB_URL`, `check()` helper, and a **void-before-delete** self-cleanup). Cover:
1. Create + issue an invoice (via existing `acc_issue_invoice`) for a customer; issue a credit memo for that customer; apply part of it to the invoice → invoice balance drops by the applied amount; credit memo `balance_remaining` drops.
2. Refund the credit memo's remaining balance → credit memo remaining = 0, status `applied`; a bank credit posts.
3. Run `acc_ar_ageing(as_of)` → sum of `balance_minor` equals the AR control-account net (`acc_ledger_balances` filtered to `accounts_receivable`).
4. Create + post a bill; issue a vendor credit; apply it → bill balance drops; `acc_ap_ageing` ties to the AP control account.
5. Write off the invoice's remaining balance (offset = an expense account) → invoice balance 0; a Trial-Balance query (`sum(debit)=sum(credit)` over posted) stays balanced.
6. Voiding a credit memo that still has an allocation is rejected; after voiding the allocation-holding refund/allocation, void succeeds.

Cleanup (transaction): delete `acc_credit_memo_allocation`, `acc_vendor_credit_allocation`, `acc_customer_refund`, `acc_write_off`, `acc_credit_memo_line`, `acc_vendor_credit_line`, `acc_credit_memo`, `acc_vendor_credit`, then void all journal entries and delete lines/entries, delete the test invoice/bill/customer/vendor, reset sequences.

- [ ] **Step 2: Apply migrations, then run the verify script**

Apply `0019`, `0020`, `0021` via the Supabase SQL Editor.
Run: `node --env-file=.env.local scripts/verify-ar-ap.mjs`
Expected: all checks `PASS` and a clean cleanup. If a step fails only because a migration is not yet applied (RPC not found), apply it and re-run — do not claim a pass otherwise.

- [ ] **Step 3: Full project verification (mandatory, paste real output)**

Run: `npm run build && npm test && npm run typecheck && npm run lint`
Expected: build succeeds; all unit tests pass (existing + the new credits-posting, ageing, credits-schema suites); typecheck and lint clean.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-ar-ap.mjs
git commit -m "test: end-to-end verify for AR/AP credits, refunds, write-offs, ageing"
```

---

## Self-Review

**Spec coverage:**
- US-FR-033 (credit memos, write-offs, customer refunds; ledger + customer balances reconciled) → Tasks 1,2,4,6,7,9,10,12,15.
- US-FR-035 (customer statements, AR ageing, reconciliation to AR control) → Tasks 3,5,8,13,14,15.
- US-FR-043 (vendor credits applied to eligible bills; AP subledger reconciled) → Tasks 1,2,4,6,7,9,11,15.
- US-FR-045 (AP ageing, vendor statements, reconciliation to AP control) → Tasks 3,5,8,13,14,15.
- Manual "allocation cannot exceed payment or invoice balance", "same customer and currency" → enforced in `acc_apply_credit_memo`/`acc_apply_vendor_credit` (Task 2) and mirrored client-side.
- Manual "credit memos and write-offs use explicit reason" → `reason` on credit memo/write-off (Tasks 1,6); independent approval deferred (Module C) per spec.
- Manual "refunds reference the customer credit or payment" → refund source XOR (Tasks 1,2,6).

**Placeholder scan:** Tasks 11, 12, 14 describe mirror/wiring UI in prose with an explicit reference implementation to mirror (Task 10 / Task 13 give full code); this is intentional to avoid duplicating ~400 lines verbatim, and each names exact props, actions, and behavior. No "TBD"/"implement later" remain. All backend tasks (1–9) and the primary UI (10, 13) contain complete code.

**Type consistency:** service function names (`createCreditMemo`, `applyCreditMemo`, `voidCreditMemo`, `listCreditMemos`, `listOpenInvoices`, and vendor/refund/write-off mirrors) match between Tasks 7 and 9. RPC names/params match between Tasks 2/3 and Tasks 7/8. `AgeingReport`/`StatementReport` shapes match between Tasks 8, 13, 14. `CreditAllocationInput.target_id` is mapped to `invoice_id`/`bill_id` in the service (Task 7) before hitting the RPC (Task 2), which expects those keys — consistent.

**Ambiguity check:** Credit-memo tax is computed server-side in the service from the tax code's `rate_percent` (Task 7) rather than trusting the client — matches the "totals calculated server-side" rule. Ageing reconciliation compares the subledger total to the control-account net with the AR/AP sign convention made explicit in Task 8.

**Reconciliation risk (flagged, not blocking):** AR/AP ageing reconciles to the control account only when every AR/AP posting flows through these documents. Opening balances or manual journals posted directly to the AR/AP account would not appear as open items and would break the tie. The reconciliation Alert (Task 13) surfaces any mismatch rather than hiding it — correct behavior; a "direct-to-control-account" guard is a later-phase concern (Module A/close).
