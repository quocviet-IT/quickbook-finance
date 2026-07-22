-- ============================================================================
-- Module 3 — Banking & Reconciliation.
-- Raw bank statement lines are ingested into an IMMUTABLE table (PRD FR-03) and
-- reconciled against recorded payments by rule (PRD FR-04). Reconciliation is a
-- confirmation/link — the payment already posted DR bank / CR AR when recorded,
-- so approving a match does not create a new journal entry.
-- ============================================================================

create type acc_bank_txn_status   as enum ('unmatched', 'matched', 'ignored');
create type acc_reconciliation_status as enum ('suggested', 'approved', 'rejected');

create table acc_bank_account (
  id                    uuid primary key default gen_random_uuid(),
  account_id            uuid not null references acc_account (id),  -- the GL bank account
  bank_name             text not null default '',
  account_number_masked text,
  currency_code         text not null references acc_currency (code),
  created_at            timestamptz not null default now(),
  unique (account_id)
);

create table acc_bank_import_batch (
  id              uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references acc_bank_account (id) on delete cascade,
  filename        text,
  row_count       int not null default 0,
  imported_by     uuid references auth.users (id),
  imported_at     timestamptz not null default now()
);

create table acc_bank_transaction (
  id               uuid primary key default gen_random_uuid(),
  bank_account_id  uuid not null references acc_bank_account (id) on delete cascade,
  import_batch_id  uuid references acc_bank_import_batch (id) on delete set null,
  txn_date         date not null,
  description      text not null default '',
  reference        text,
  amount_minor     bigint not null,                 -- signed: >0 money in, <0 money out
  running_balance_minor bigint,
  raw_line         text,                            -- original text, preserved
  raw_hash         text not null,                   -- dedupe key
  status           acc_bank_txn_status not null default 'unmatched',
  created_at       timestamptz not null default now(),
  unique (bank_account_id, raw_hash)
);
create index acc_bank_txn_account_idx on acc_bank_transaction (bank_account_id, status);
create index acc_bank_txn_date_idx    on acc_bank_transaction (txn_date);

create table acc_reconciliation (
  id                  uuid primary key default gen_random_uuid(),
  bank_transaction_id uuid not null references acc_bank_transaction (id) on delete cascade,
  payment_id          uuid references acc_payment (id) on delete cascade,
  rule_applied        text,
  confidence          numeric(4, 3) not null default 0,   -- 0.000 .. 1.000
  status              acc_reconciliation_status not null default 'suggested',
  approved_by         uuid references auth.users (id),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (bank_transaction_id, payment_id)
);
create index acc_reconciliation_txn_idx on acc_reconciliation (bank_transaction_id);

-- Raw bank data is immutable once imported (amounts/dates/description cannot be
-- edited); only the status may change via reconciliation. Enforce with a trigger.
create or replace function acc_block_bank_txn_edit() returns trigger
language plpgsql as $$
begin
  if new.amount_minor <> old.amount_minor
     or new.txn_date <> old.txn_date
     or new.description is distinct from old.description
     or new.reference is distinct from old.reference
     or new.raw_hash <> old.raw_hash then
    raise exception 'Bank transactions are immutable; only status may change';
  end if;
  return new;
end;
$$;
create trigger acc_bank_txn_immutable
  before update on acc_bank_transaction
  for each row execute function acc_block_bank_txn_edit();

-- RLS: read for any role, writes for staff.
alter table acc_bank_account       enable row level security;
alter table acc_bank_import_batch  enable row level security;
alter table acc_bank_transaction   enable row level security;
alter table acc_reconciliation     enable row level security;

create policy acc_bank_account_read  on acc_bank_account       for select using (acc_current_role() is not null);
create policy acc_bank_account_write on acc_bank_account       for all using (acc_is_staff()) with check (acc_is_staff());
create policy acc_bank_batch_read    on acc_bank_import_batch  for select using (acc_current_role() is not null);
create policy acc_bank_batch_write   on acc_bank_import_batch  for all using (acc_is_staff()) with check (acc_is_staff());
create policy acc_bank_txn_read      on acc_bank_transaction   for select using (acc_current_role() is not null);
create policy acc_bank_txn_write     on acc_bank_transaction   for all using (acc_is_staff()) with check (acc_is_staff());
create policy acc_recon_read         on acc_reconciliation     for select using (acc_current_role() is not null);
create policy acc_recon_write        on acc_reconciliation     for all using (acc_is_staff()) with check (acc_is_staff());
