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
