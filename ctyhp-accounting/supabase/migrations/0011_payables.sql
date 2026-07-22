-- ============================================================================
-- Module 3b — Payables: vendors, bills (+lines), expenses (+lines),
-- bill payments (+allocations). Buy-side mirror of Module 2 (invoicing).
-- US tax model: line amounts are tax-inclusive; no separate purchase-tax line.
-- Enum values added here; the posting functions in 0012 use them (a new enum
-- value cannot be used in the same transaction that adds it).
-- ============================================================================

alter type acc_journal_source add value if not exists 'bill';
alter type acc_journal_source add value if not exists 'expense';
alter type acc_journal_source add value if not exists 'bill_payment';

create type acc_bill_status         as enum ('draft', 'open', 'partial', 'paid', 'void');
create type acc_expense_status      as enum ('posted', 'void');
create type acc_bill_payment_status as enum ('unapplied', 'partial', 'applied', 'void');

-- ----------------------------------------------------------------------------
-- Vendors (mirror of acc_customer)
-- ----------------------------------------------------------------------------
create table acc_vendor (
  id                         uuid primary key default gen_random_uuid(),
  name                       text not null,
  email                      text,
  phone                      text,
  currency_code              text references acc_currency (code),
  ap_account_id              uuid references acc_account (id),
  default_expense_account_id uuid references acc_account (id),
  payment_terms              text,
  is_active                  boolean not null default true,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Bills
-- ----------------------------------------------------------------------------
create table acc_bill (
  id                uuid primary key default gen_random_uuid(),
  bill_number       text unique,                 -- assigned on post
  vendor_ref        text,                        -- vendor's own invoice number
  vendor_id         uuid not null references acc_vendor (id),
  bill_date         date not null default current_date,
  due_date          date,
  currency_code     text not null references acc_currency (code),
  total_minor       bigint not null default 0,
  balance_due_minor bigint not null default 0,
  status            acc_bill_status not null default 'draft',
  journal_entry_id  uuid references acc_journal_entry (id),
  memo              text,
  created_by        uuid references auth.users (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index acc_bill_vendor_idx on acc_bill (vendor_id);
create index acc_bill_status_idx on acc_bill (status);

create table acc_bill_line (
  id                 uuid primary key default gen_random_uuid(),
  bill_id            uuid not null references acc_bill (id) on delete cascade,
  line_order         int not null default 0,
  description        text not null default '',
  expense_account_id uuid not null references acc_account (id),
  amount_minor       bigint not null default 0
);
create index acc_bill_line_bill_idx on acc_bill_line (bill_id);

-- ----------------------------------------------------------------------------
-- Expenses (paid immediately)
-- ----------------------------------------------------------------------------
create table acc_expense (
  id                 uuid primary key default gen_random_uuid(),
  expense_number     text unique,
  vendor_id          uuid references acc_vendor (id),
  payment_account_id uuid not null references acc_account (id),
  expense_date       date not null default current_date,
  currency_code      text not null references acc_currency (code),
  total_minor        bigint not null default 0,
  status             acc_expense_status not null default 'posted',
  journal_entry_id   uuid references acc_journal_entry (id),
  memo               text,
  created_by         uuid references auth.users (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index acc_expense_vendor_idx on acc_expense (vendor_id);

create table acc_expense_line (
  id                 uuid primary key default gen_random_uuid(),
  expense_id         uuid not null references acc_expense (id) on delete cascade,
  line_order         int not null default 0,
  description        text not null default '',
  expense_account_id uuid not null references acc_account (id),
  amount_minor       bigint not null default 0
);
create index acc_expense_line_expense_idx on acc_expense_line (expense_id);

-- ----------------------------------------------------------------------------
-- Bill payments and allocations
-- ----------------------------------------------------------------------------
create table acc_bill_payment (
  id                 uuid primary key default gen_random_uuid(),
  payment_number     text unique,
  vendor_id          uuid not null references acc_vendor (id),
  payment_date       date not null default current_date,
  currency_code      text not null references acc_currency (code),
  amount_minor       bigint not null check (amount_minor > 0),
  unapplied_minor    bigint not null default 0,
  payment_account_id uuid not null references acc_account (id),
  method             text,
  status             acc_bill_payment_status not null default 'unapplied',
  journal_entry_id   uuid references acc_journal_entry (id),
  memo               text,
  created_by         uuid references auth.users (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index acc_bill_payment_vendor_idx on acc_bill_payment (vendor_id);

create table acc_bill_payment_allocation (
  id              uuid primary key default gen_random_uuid(),
  bill_payment_id uuid not null references acc_bill_payment (id) on delete cascade,
  bill_id         uuid not null references acc_bill (id),
  amount_minor    bigint not null check (amount_minor > 0),
  created_at      timestamptz not null default now(),
  unique (bill_payment_id, bill_id)
);
create index acc_bill_payment_alloc_bill_idx on acc_bill_payment_allocation (bill_id);

-- ----------------------------------------------------------------------------
-- Sequences
-- ----------------------------------------------------------------------------
insert into acc_sequence (key, prefix, next_value) values
  ('bill',         'BILL-', 1),
  ('expense',      'EXP-',  1),
  ('bill_payment', 'BP-',   1);

-- ----------------------------------------------------------------------------
-- RLS: read for any role, writes for staff (mutations go through SECURITY
-- DEFINER posting functions in 0012).
-- ----------------------------------------------------------------------------
alter table acc_vendor                  enable row level security;
alter table acc_bill                    enable row level security;
alter table acc_bill_line               enable row level security;
alter table acc_expense                 enable row level security;
alter table acc_expense_line            enable row level security;
alter table acc_bill_payment            enable row level security;
alter table acc_bill_payment_allocation enable row level security;

create policy acc_vendor_read  on acc_vendor  for select using (acc_current_role() is not null);
create policy acc_vendor_write on acc_vendor  for all using (acc_is_staff()) with check (acc_is_staff());

create policy acc_bill_read  on acc_bill  for select using (acc_current_role() is not null);
create policy acc_bill_write on acc_bill  for all using (acc_is_staff()) with check (acc_is_staff());

create policy acc_bill_line_read  on acc_bill_line  for select using (acc_current_role() is not null);
create policy acc_bill_line_write on acc_bill_line  for all using (acc_is_staff()) with check (acc_is_staff());

create policy acc_expense_read  on acc_expense  for select using (acc_current_role() is not null);
create policy acc_expense_write on acc_expense  for all using (acc_is_staff()) with check (acc_is_staff());

create policy acc_expense_line_read  on acc_expense_line  for select using (acc_current_role() is not null);
create policy acc_expense_line_write on acc_expense_line  for all using (acc_is_staff()) with check (acc_is_staff());

create policy acc_bill_payment_read  on acc_bill_payment  for select using (acc_current_role() is not null);
create policy acc_bill_payment_write on acc_bill_payment  for all using (acc_is_staff()) with check (acc_is_staff());

create policy acc_bp_alloc_read  on acc_bill_payment_allocation for select using (acc_current_role() is not null);
create policy acc_bp_alloc_write on acc_bill_payment_allocation for all using (acc_is_staff()) with check (acc_is_staff());
