-- ============================================================================
-- Sales Tax Center: remittance (tax payment) documents that reduce the Sales
-- Tax Payable liability. The enum value added here is used only in 0016 (a new
-- enum value cannot be used in the same transaction that adds it).
-- ============================================================================

alter type acc_journal_source add value if not exists 'tax_payment';

create type acc_tax_payment_status as enum ('posted', 'void');

create table acc_tax_payment (
  id                uuid primary key default gen_random_uuid(),
  payment_number    text unique,
  tax_account_id    uuid not null references acc_account (id),
  bank_account_id   uuid not null references acc_account (id),
  payment_date      date not null default current_date,
  currency_code     text not null references acc_currency (code),
  amount_minor      bigint not null check (amount_minor > 0),
  period_start      date,
  period_end        date,
  status            acc_tax_payment_status not null default 'posted',
  journal_entry_id  uuid references acc_journal_entry (id),
  memo              text,
  created_by        uuid references auth.users (id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index acc_tax_payment_date_idx on acc_tax_payment (payment_date);

insert into acc_sequence (key, prefix, next_value) values ('tax_payment', 'TAXPMT-', 1);

alter table acc_tax_payment enable row level security;
create policy acc_tax_payment_read  on acc_tax_payment for select using (acc_current_role() is not null);
create policy acc_tax_payment_write on acc_tax_payment for all using (acc_is_staff()) with check (acc_is_staff());
