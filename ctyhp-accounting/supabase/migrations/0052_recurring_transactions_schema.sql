-- ============================================================================
-- Recurring Transactions
-- Schedules and immutable occurrence history for invoices, bills, expenses,
-- and manual journals. Recurring automation only creates drafts or review
-- items; it never silently posts to the General Ledger.
-- ============================================================================

create type acc_recurring_document_type as enum ('invoice', 'bill', 'expense', 'journal');
create type acc_recurring_frequency as enum ('weekly', 'monthly', 'quarterly', 'yearly');
create type acc_recurring_template_status as enum ('active', 'paused', 'ended');
create type acc_recurring_run_status as enum (
  'processing', 'generated', 'pending_review', 'awaiting_approval', 'failed'
);

create table acc_recurring_template (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (btrim(name) <> ''),
  document_type    acc_recurring_document_type not null,
  frequency        acc_recurring_frequency not null,
  interval_count   smallint not null default 1 check (interval_count between 1 and 24),
  start_date       date not null,
  next_run_date    date not null,
  end_date         date,
  payload          jsonb not null check (jsonb_typeof(payload) = 'object'),
  total_minor      bigint not null default 0 check (total_minor >= 0),
  status           acc_recurring_template_status not null default 'active',
  last_run_at      timestamptz,
  last_run_status  acc_recurring_run_status,
  last_error       text,
  created_by       uuid references auth.users (id),
  updated_by       uuid references auth.users (id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (end_date is null or end_date >= start_date),
  check (next_run_date >= start_date)
);

create index acc_recurring_template_due_idx
  on acc_recurring_template (status, next_run_date)
  where status = 'active';
create index acc_recurring_template_type_idx on acc_recurring_template (document_type, status);

create table acc_recurring_run (
  id                  uuid primary key default gen_random_uuid(),
  template_id         uuid not null references acc_recurring_template (id),
  document_type       acc_recurring_document_type not null,
  scheduled_date      date not null,
  payload_snapshot    jsonb not null check (jsonb_typeof(payload_snapshot) = 'object'),
  status              acc_recurring_run_status not null default 'processing',
  document_id         uuid,
  approval_request_id uuid references acc_approval_request (id),
  error_message       text,
  generated_by        uuid references auth.users (id),
  started_at          timestamptz not null default now(),
  completed_at        timestamptz,
  created_at          timestamptz not null default now(),
  unique (template_id, scheduled_date)
);

create index acc_recurring_run_status_idx on acc_recurring_run (status, scheduled_date);
create index acc_recurring_run_template_idx on acc_recurring_run (template_id, scheduled_date desc);

-- Typed document links make generation idempotent even if an application
-- request loses its response after the draft was inserted.
alter table acc_invoice add column recurring_run_id uuid references acc_recurring_run (id);
alter table acc_bill add column recurring_run_id uuid references acc_recurring_run (id);
alter table acc_expense add column recurring_run_id uuid references acc_recurring_run (id);
alter table acc_journal_entry add column recurring_run_id uuid references acc_recurring_run (id);

create unique index acc_invoice_recurring_run_uq
  on acc_invoice (recurring_run_id) where recurring_run_id is not null;
create unique index acc_bill_recurring_run_uq
  on acc_bill (recurring_run_id) where recurring_run_id is not null;
create unique index acc_expense_recurring_run_uq
  on acc_expense (recurring_run_id) where recurring_run_id is not null;
create unique index acc_journal_recurring_run_uq
  on acc_journal_entry (recurring_run_id) where recurring_run_id is not null;

insert into acc_permission (key, label, category, description, is_enforced)
values (
  'recurring.manage',
  'Manage recurring transactions',
  'Accounting',
  'Create, pause, resume, generate, and review recurring transaction schedules',
  true
)
on conflict (key) do update
set label = excluded.label,
    category = excluded.category,
    description = excluded.description,
    is_enforced = excluded.is_enforced;

insert into acc_role_permission (role, permission_key, allowed)
select role, 'recurring.manage',
       role in ('admin'::acc_app_role, 'accountant'::acc_app_role)
  from unnest(enum_range(null::acc_app_role)) as role
on conflict (role, permission_key) do update set allowed = excluded.allowed;

alter table acc_recurring_template enable row level security;
alter table acc_recurring_run enable row level security;

create policy acc_recurring_template_read on acc_recurring_template
  for select using (acc_current_role() is not null);
create policy acc_recurring_template_insert on acc_recurring_template
  for insert with check (acc_has_permission('recurring.manage'));
create policy acc_recurring_template_update on acc_recurring_template
  for update using (acc_has_permission('recurring.manage'))
  with check (acc_has_permission('recurring.manage'));

create policy acc_recurring_run_read on acc_recurring_run
  for select using (acc_current_role() is not null);
