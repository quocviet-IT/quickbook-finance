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
