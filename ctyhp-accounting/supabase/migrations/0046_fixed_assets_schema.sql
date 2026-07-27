-- ============================================================================
-- Fixed Asset Register: master records and exact monthly depreciation plans.
-- Acquisition accounting remains linked to the original bill/journal; the
-- register does not duplicate-post asset cost.
-- ============================================================================

alter type acc_journal_source add value if not exists 'depreciation';
alter type acc_journal_source add value if not exists 'asset_disposal';

create type acc_fixed_asset_method as enum ('straight_line', 'none');
create type acc_fixed_asset_status as enum
  ('in_service', 'fully_depreciated', 'disposed');
create type acc_depreciation_schedule_status as enum ('planned', 'posted');

insert into acc_sequence (key, prefix, next_value)
values ('fixed_asset', 'FA-', 1)
on conflict (key) do nothing;

-- Minimum posting accounts required by the module. Existing installations keep
-- any account already using these codes.
insert into acc_account
  (account_code, name, account_type, detail_type, currency_code, is_posting_account, status)
select '1590', 'Accumulated Depreciation', 'fixed_asset', 'Contra fixed asset', code, true, 'active'
  from acc_currency where is_base
on conflict (account_code) do nothing;

insert into acc_account
  (account_code, name, account_type, detail_type, currency_code, is_posting_account, status)
select '6800', 'Depreciation Expense', 'expense', 'Depreciation expense', code, true, 'active'
  from acc_currency where is_base
on conflict (account_code) do nothing;

create table acc_fixed_asset (
  id                                  uuid primary key default gen_random_uuid(),
  asset_number                        text not null unique,
  name                                text not null,
  description                         text,
  category                            text not null,
  serial_number                       text,
  location                            text,
  acquisition_date                    date not null,
  in_service_date                     date not null,
  currency_code                       text not null references acc_currency (code),
  cost_minor                          bigint not null check (cost_minor > 0),
  salvage_value_minor                 bigint not null default 0
    check (salvage_value_minor >= 0 and salvage_value_minor <= cost_minor),
  useful_life_months                  int check (useful_life_months > 0),
  depreciation_method                 acc_fixed_asset_method not null default 'straight_line',
  asset_account_id                    uuid not null references acc_account (id),
  accumulated_depreciation_account_id uuid references acc_account (id),
  depreciation_expense_account_id     uuid references acc_account (id),
  vendor_id                           uuid references acc_vendor (id),
  source_bill_id                      uuid references acc_bill (id),
  status                              acc_fixed_asset_status not null default 'in_service',
  disposed_at                         date,
  notes                               text,
  created_by                          uuid references auth.users (id),
  created_at                          timestamptz not null default now(),
  updated_at                          timestamptz not null default now(),
  check (in_service_date >= acquisition_date),
  check (
    (depreciation_method = 'none' and useful_life_months is null
      and accumulated_depreciation_account_id is null
      and depreciation_expense_account_id is null)
    or
    (depreciation_method = 'straight_line' and useful_life_months is not null
      and accumulated_depreciation_account_id is not null
      and depreciation_expense_account_id is not null
      and salvage_value_minor < cost_minor)
  ),
  check ((status = 'disposed' and disposed_at is not null) or status <> 'disposed')
);

create index acc_fixed_asset_status_idx on acc_fixed_asset (status, category, asset_number);
create index acc_fixed_asset_source_bill_idx on acc_fixed_asset (source_bill_id)
  where source_bill_id is not null;

create table acc_asset_depreciation_schedule (
  id                   uuid primary key default gen_random_uuid(),
  asset_id             uuid not null references acc_fixed_asset (id) on delete cascade,
  sequence_number      int not null check (sequence_number > 0),
  period_start         date not null,
  period_end           date not null,
  planned_amount_minor bigint not null check (planned_amount_minor > 0),
  posted_amount_minor  bigint not null default 0 check (posted_amount_minor >= 0),
  status               acc_depreciation_schedule_status not null default 'planned',
  journal_entry_id     uuid references acc_journal_entry (id),
  posted_by            uuid references auth.users (id),
  posted_at            timestamptz,
  created_at           timestamptz not null default now(),
  unique (asset_id, sequence_number),
  unique (asset_id, period_start),
  check (period_end >= period_start),
  check (
    (status = 'planned' and posted_amount_minor = 0 and journal_entry_id is null)
    or
    (status = 'posted' and posted_amount_minor = planned_amount_minor
      and journal_entry_id is not null and posted_at is not null)
  )
);

create index acc_asset_depreciation_due_idx
  on acc_asset_depreciation_schedule (period_end, status);

insert into acc_permission (key, label, category, description, is_enforced) values
  ('fixed_assets.manage', 'Manage fixed assets', 'Accounting',
   'Create and maintain the fixed asset register', true),
  ('fixed_assets.post', 'Post asset depreciation', 'Accounting',
   'Post scheduled depreciation into the General Ledger', true)
on conflict (key) do update
  set label = excluded.label,
      category = excluded.category,
      description = excluded.description,
      is_enforced = true;

insert into acc_role_permission (role, permission_key, allowed)
select r.role, p.key, r.role in ('admin'::acc_app_role, 'accountant'::acc_app_role)
  from (values ('admin'::acc_app_role), ('accountant'::acc_app_role), ('viewer'::acc_app_role)) r(role)
  cross join (values ('fixed_assets.manage'), ('fixed_assets.post')) p(key)
on conflict (role, permission_key) do nothing;

alter table acc_fixed_asset enable row level security;
alter table acc_asset_depreciation_schedule enable row level security;

create policy acc_fixed_asset_read on acc_fixed_asset
  for select using (acc_current_role() is not null);
create policy acc_asset_depreciation_schedule_read on acc_asset_depreciation_schedule
  for select using (acc_current_role() is not null);
