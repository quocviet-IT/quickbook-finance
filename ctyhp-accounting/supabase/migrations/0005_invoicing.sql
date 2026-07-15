-- ============================================================================
-- Module 2 — Invoicing: customers, invoices (+ lines), payments (+ allocations).
-- Invoices post a balanced journal entry when issued; payments post one when
-- received; allocations link payments to invoices and maintain balance_due.
-- ============================================================================

create type acc_invoice_status as enum ('draft', 'issued', 'partial', 'paid', 'void');
create type acc_payment_status as enum ('unapplied', 'partial', 'applied', 'void');

-- ----------------------------------------------------------------------------
-- Customers
-- ----------------------------------------------------------------------------
create table acc_customer (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  email         text,
  currency_code text references acc_currency (code),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Invoices
-- ----------------------------------------------------------------------------
create table acc_invoice (
  id               uuid primary key default gen_random_uuid(),
  invoice_number   text unique,                 -- assigned on issue
  customer_id      uuid not null references acc_customer (id),
  issue_date       date not null default current_date,
  due_date         date,
  currency_code    text not null references acc_currency (code),
  subtotal_minor   bigint not null default 0,
  tax_total_minor  bigint not null default 0,
  total_minor      bigint not null default 0,
  balance_due_minor bigint not null default 0,
  status           acc_invoice_status not null default 'draft',
  order_id         uuid,                         -- optional production link (PRD FR-01)
  journal_entry_id uuid references acc_journal_entry (id),
  memo             text,
  created_by       uuid references auth.users (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index acc_invoice_customer_idx on acc_invoice (customer_id);
create index acc_invoice_status_idx   on acc_invoice (status);

create table acc_invoice_line (
  id                uuid primary key default gen_random_uuid(),
  invoice_id        uuid not null references acc_invoice (id) on delete cascade,
  line_order        int not null default 0,
  description       text not null default '',
  quantity          numeric(20, 4) not null default 1 check (quantity >= 0),
  unit_price_minor  bigint not null default 0,
  income_account_id uuid not null references acc_account (id),
  tax_code_id       uuid references acc_tax_code (id),
  line_subtotal_minor bigint not null default 0,
  line_tax_minor      bigint not null default 0,
  line_total_minor    bigint not null default 0
);
create index acc_invoice_line_invoice_idx on acc_invoice_line (invoice_id);

-- ----------------------------------------------------------------------------
-- Payments and allocations
-- ----------------------------------------------------------------------------
create table acc_payment (
  id                  uuid primary key default gen_random_uuid(),
  payment_number      text unique,
  customer_id         uuid not null references acc_customer (id),
  payment_date        date not null default current_date,
  currency_code       text not null references acc_currency (code),
  amount_minor        bigint not null check (amount_minor > 0),
  unapplied_minor     bigint not null default 0,
  method              text,
  deposit_account_id  uuid not null references acc_account (id),
  status              acc_payment_status not null default 'unapplied',
  journal_entry_id    uuid references acc_journal_entry (id),
  memo                text,
  created_by          uuid references auth.users (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index acc_payment_customer_idx on acc_payment (customer_id);

create table acc_payment_allocation (
  id           uuid primary key default gen_random_uuid(),
  payment_id   uuid not null references acc_payment (id) on delete cascade,
  invoice_id   uuid not null references acc_invoice (id),
  amount_minor bigint not null check (amount_minor > 0),
  created_at   timestamptz not null default now(),
  unique (payment_id, invoice_id)
);
create index acc_payment_alloc_invoice_idx on acc_payment_allocation (invoice_id);

-- ----------------------------------------------------------------------------
-- RLS: read for any role, writes for staff (mutations go through the service
-- layer / SECURITY DEFINER posting function).
-- ----------------------------------------------------------------------------
alter table acc_customer            enable row level security;
alter table acc_invoice             enable row level security;
alter table acc_invoice_line        enable row level security;
alter table acc_payment             enable row level security;
alter table acc_payment_allocation  enable row level security;

create policy acc_customer_read on acc_customer for select using (acc_current_role() is not null);
create policy acc_customer_write on acc_customer for all using (acc_is_staff()) with check (acc_is_staff());

create policy acc_invoice_read on acc_invoice for select using (acc_current_role() is not null);
create policy acc_invoice_write on acc_invoice for all using (acc_is_staff()) with check (acc_is_staff());

create policy acc_invoice_line_read on acc_invoice_line for select using (acc_current_role() is not null);
create policy acc_invoice_line_write on acc_invoice_line for all using (acc_is_staff()) with check (acc_is_staff());

create policy acc_payment_read on acc_payment for select using (acc_current_role() is not null);
create policy acc_payment_write on acc_payment for all using (acc_is_staff()) with check (acc_is_staff());

create policy acc_payment_alloc_read on acc_payment_allocation for select using (acc_current_role() is not null);
create policy acc_payment_alloc_write on acc_payment_allocation for all using (acc_is_staff()) with check (acc_is_staff());
