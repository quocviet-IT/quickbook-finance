-- ============================================================================
-- CTYHP Accounting — Foundation migration
-- Double-entry ledger backbone: currencies, tax codes, chart of accounts,
-- journal entries/lines (balance enforced in the DB), audit log, sequences,
-- roles + RLS, and an atomic posting function.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------
create type acc_account_type as enum (
  'bank', 'accounts_receivable', 'current_asset', 'fixed_asset',
  'accounts_payable', 'credit_card', 'current_liability', 'equity',
  'income', 'cost_of_goods_sold', 'expense', 'other_income', 'other_expense'
);

create type acc_account_status as enum ('draft', 'active', 'inactive', 'archived');
create type acc_tax_direction  as enum ('sales', 'purchase', 'none');
create type acc_journal_source as enum
  ('invoice', 'payment', 'manual', 'bank', 'reconciliation', 'opening_balance');
create type acc_journal_status as enum ('posted', 'void');
create type acc_app_role       as enum ('admin', 'accountant', 'viewer');

-- ----------------------------------------------------------------------------
-- App users & roles (single-tenant; role gates writes)
-- ----------------------------------------------------------------------------
create table acc_app_user (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text not null default '',
  role       acc_app_role not null default 'viewer',
  created_at timestamptz not null default now()
);

create or replace function acc_current_role() returns acc_app_role
language sql stable security definer set search_path = public as $$
  select role from acc_app_user where id = auth.uid();
$$;

create or replace function acc_is_staff() returns boolean
language sql stable as $$
  select acc_current_role() in ('admin', 'accountant');
$$;

create or replace function acc_is_admin() returns boolean
language sql stable as $$
  select acc_current_role() = 'admin';
$$;

-- ----------------------------------------------------------------------------
-- Configuration: currencies, exchange rates, tax codes
-- ----------------------------------------------------------------------------
create table acc_currency (
  code           text primary key check (code ~ '^[A-Z]{3}$'),
  name           text not null,
  symbol         text not null default '',
  decimal_places smallint not null default 2 check (decimal_places between 0 and 6),
  is_base        boolean not null default false
);
-- Exactly one base currency.
create unique index acc_currency_one_base on acc_currency ((true)) where is_base;

create table acc_exchange_rate (
  id            uuid primary key default gen_random_uuid(),
  currency_code text not null references acc_currency (code),
  rate_date     date not null,
  rate_to_base  numeric(20, 10) not null check (rate_to_base > 0),
  unique (currency_code, rate_date)
);

-- ----------------------------------------------------------------------------
-- Chart of Accounts (self-referencing hierarchy)
-- ----------------------------------------------------------------------------
create table acc_account (
  id                  uuid primary key default gen_random_uuid(),
  account_code        text not null unique,
  name                text not null,
  account_type        acc_account_type not null,
  detail_type         text,
  parent_account_id   uuid references acc_account (id),
  description         text,
  default_tax_code_id uuid,  -- FK added after acc_tax_code exists
  currency_code       text references acc_currency (code),
  is_posting_account  boolean not null default true,
  status              acc_account_status not null default 'active',
  effective_from      date,
  effective_to        date,
  created_by          uuid references auth.users (id),
  approved_by         uuid references auth.users (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (parent_account_id is null or parent_account_id <> id)
);
create index acc_account_parent_idx on acc_account (parent_account_id);
create index acc_account_type_idx   on acc_account (account_type);

create table acc_tax_code (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  name           text not null,
  rate_percent   numeric(7, 4) not null default 0 check (rate_percent >= 0),
  direction      acc_tax_direction not null default 'sales',
  tax_account_id uuid references acc_account (id),
  is_active      boolean not null default true
);

alter table acc_account
  add constraint acc_account_default_tax_fk
  foreign key (default_tax_code_id) references acc_tax_code (id);

-- Prevent hierarchy cycles on write (defence in depth alongside app validation).
create or replace function acc_account_no_cycle() returns trigger
language plpgsql as $$
declare
  cursor_id uuid := new.parent_account_id;
  hops int := 0;
begin
  while cursor_id is not null loop
    if cursor_id = new.id then
      raise exception 'Account hierarchy cycle involving %', new.id;
    end if;
    select parent_account_id into cursor_id from acc_account where id = cursor_id;
    hops := hops + 1;
    if hops > 100 then
      raise exception 'Account hierarchy too deep or cyclic at %', new.id;
    end if;
  end loop;
  return new;
end;
$$;

create trigger acc_account_no_cycle_trg
  before insert or update of parent_account_id on acc_account
  for each row execute function acc_account_no_cycle();

-- ----------------------------------------------------------------------------
-- Document numbering sequences (atomic)
-- ----------------------------------------------------------------------------
create table acc_sequence (
  key        text primary key,
  prefix     text not null default '',
  next_value bigint not null default 1
);

insert into acc_sequence (key, prefix, next_value) values
  ('journal_entry', 'JE-', 1),
  ('invoice',       'INV-', 1),
  ('payment',       'PMT-', 1);

create or replace function acc_next_number(p_key text) returns text
language plpgsql as $$
declare
  v_prefix text;
  v_value  bigint;
begin
  update acc_sequence
     set next_value = next_value + 1
   where key = p_key
   returning prefix, next_value - 1 into v_prefix, v_value;
  if not found then
    raise exception 'Unknown sequence key: %', p_key;
  end if;
  return v_prefix || lpad(v_value::text, 6, '0');
end;
$$;

-- ----------------------------------------------------------------------------
-- Ledger: journal entries and lines
-- ----------------------------------------------------------------------------
create table acc_journal_entry (
  id            uuid primary key default gen_random_uuid(),
  entry_number  text not null unique,
  entry_date    date not null,
  description   text,
  source_type   acc_journal_source not null,
  source_id     uuid,
  currency_code text not null references acc_currency (code),
  status        acc_journal_status not null default 'posted',
  created_by    uuid references auth.users (id),
  posted_at     timestamptz not null default now(),
  voided_at     timestamptz
);
create index acc_journal_entry_source_idx on acc_journal_entry (source_type, source_id);
create index acc_journal_entry_date_idx   on acc_journal_entry (entry_date);

create table acc_journal_line (
  id               uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null references acc_journal_entry (id) on delete cascade,
  account_id       uuid not null references acc_account (id),
  debit_minor      bigint not null default 0 check (debit_minor >= 0),
  credit_minor     bigint not null default 0 check (credit_minor >= 0),
  amount_base_minor bigint not null default 0,
  tax_code_id      uuid references acc_tax_code (id),
  memo             text,
  line_order       int not null default 0,
  -- Exactly one side positive.
  constraint acc_journal_line_one_sided check ((debit_minor = 0) <> (credit_minor = 0))
);
create index acc_journal_line_entry_idx   on acc_journal_line (journal_entry_id);
create index acc_journal_line_account_idx on acc_journal_line (account_id);

-- Balance invariant: enforced at COMMIT via a deferred constraint trigger, so
-- an unbalanced entry can never persist regardless of the write path.
create or replace function acc_check_entry_balanced() returns trigger
language plpgsql as $$
declare
  v_entry uuid := coalesce(new.journal_entry_id, old.journal_entry_id);
  v_diff  bigint;
begin
  select coalesce(sum(debit_minor), 0) - coalesce(sum(credit_minor), 0)
    into v_diff
    from acc_journal_line
   where journal_entry_id = v_entry;
  if v_diff <> 0 then
    raise exception 'Journal entry % is not balanced (debit - credit = %)', v_entry, v_diff;
  end if;
  return null;
end;
$$;

create constraint trigger acc_journal_line_balanced
  after insert or update or delete on acc_journal_line
  deferrable initially deferred
  for each row execute function acc_check_entry_balanced();

-- Posted entries are immutable: corrections are made by voiding + reposting.
create or replace function acc_block_posted_line_change() returns trigger
language plpgsql as $$
declare
  v_status acc_journal_status;
begin
  select status into v_status
    from acc_journal_entry
   where id = coalesce(old.journal_entry_id, new.journal_entry_id);
  if v_status = 'posted' then
    raise exception 'Cannot modify or delete lines of a posted journal entry';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger acc_journal_line_immutable
  before update or delete on acc_journal_line
  for each row execute function acc_block_posted_line_change();

-- ----------------------------------------------------------------------------
-- Atomic posting function
-- p_lines is a JSON array of objects:
--   { "account_id": uuid, "debit_minor": bigint, "credit_minor": bigint,
--     "amount_base_minor": bigint, "tax_code_id": uuid|null, "memo": text }
-- Returns the created journal entry id. Balance is guaranteed by the deferred
-- constraint trigger above; this function additionally checks up-front for a
-- clear error message.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- Audit log
-- ----------------------------------------------------------------------------
create table acc_audit_log (
  id          uuid primary key default gen_random_uuid(),
  table_name  text not null,
  record_id   uuid,
  action      text not null,
  actor_id    uuid references auth.users (id),
  before_json jsonb,
  after_json  jsonb,
  created_at  timestamptz not null default now()
);
create index acc_audit_log_record_idx on acc_audit_log (table_name, record_id);

-- ----------------------------------------------------------------------------
-- Row Level Security
--   * All authenticated users with a role may read.
--   * Staff (admin/accountant) may write operational config here.
--   * Journal tables are written only by acc_post_entry (SECURITY DEFINER),
--     so they expose SELECT only — no direct INSERT/UPDATE/DELETE policy.
-- ----------------------------------------------------------------------------
alter table acc_app_user       enable row level security;
alter table acc_currency       enable row level security;
alter table acc_exchange_rate  enable row level security;
alter table acc_account        enable row level security;
alter table acc_tax_code       enable row level security;
alter table acc_sequence       enable row level security;
alter table acc_journal_entry  enable row level security;
alter table acc_journal_line   enable row level security;
alter table acc_audit_log      enable row level security;

-- Every authenticated user can read their own app_user row; admins read all.
create policy acc_app_user_self_read on acc_app_user
  for select using (id = auth.uid() or acc_is_admin());
create policy acc_app_user_admin_write on acc_app_user
  for all using (acc_is_admin()) with check (acc_is_admin());

-- Read-for-all-roles on reference/ledger data.
create policy acc_currency_read      on acc_currency      for select using (acc_current_role() is not null);
create policy acc_exchange_read      on acc_exchange_rate for select using (acc_current_role() is not null);
create policy acc_account_read       on acc_account       for select using (acc_current_role() is not null);
create policy acc_tax_code_read      on acc_tax_code      for select using (acc_current_role() is not null);
create policy acc_journal_entry_read on acc_journal_entry for select using (acc_current_role() is not null);
create policy acc_journal_line_read  on acc_journal_line  for select using (acc_current_role() is not null);
create policy acc_audit_read         on acc_audit_log     for select using (acc_current_role() is not null);

-- Admin-managed configuration.
create policy acc_currency_admin  on acc_currency      for all using (acc_is_admin()) with check (acc_is_admin());
create policy acc_exchange_admin  on acc_exchange_rate for all using (acc_is_admin()) with check (acc_is_admin());
create policy acc_tax_code_admin  on acc_tax_code      for all using (acc_is_admin()) with check (acc_is_admin());

-- Chart of Accounts: staff may create/edit; admin approval handled in service layer.
create policy acc_account_write on acc_account
  for all using (acc_is_staff()) with check (acc_is_staff());

-- Audit log is append-only for staff (writes normally happen via service layer).
create policy acc_audit_insert on acc_audit_log
  for insert with check (acc_is_staff());
