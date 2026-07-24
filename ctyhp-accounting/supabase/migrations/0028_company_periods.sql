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
