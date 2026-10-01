-- ============================================================================
-- 0129 — Cards and loans: what a payment out of the bank repays.
--
-- Paying a credit card repays a balance; it is never an expense — the costs
-- were the card's own charges. A loan instalment is principal and interest,
-- and only the interest is an expense. Each company lists its cards and loans
-- with the words its bank prints for their payments, or their last four
-- digits; lib/domain/repayments.ts recognises such a line before any rule or
-- history. A card posts through acc_categorise_bank_transaction as before.
-- A loan's interest settings are kept here; the split is posted by a later
-- migration.
--
-- Nothing existing changes.
-- ============================================================================

set search_path = public;

create table if not exists acc_repayment_account (
  id                   uuid primary key default gen_random_uuid(),
  kind                 text not null check (kind in ('card', 'loan')),
  account_id           uuid not null unique references acc_account (id),
  match_words          text not null default '' check (length(match_words) <= 200),
  match_digits         text check (match_digits ~ '^[0-9]{4}$'),
  interest_account_id  uuid references acc_account (id),
  interest_method      text check (interest_method in ('rate', 'fixed', 'entered')),
  annual_rate          numeric(6,3) check (annual_rate >= 0 and annual_rate <= 100),
  fixed_interest_minor bigint check (fixed_interest_minor >= 0),
  is_active            boolean not null default true,
  created_by           uuid references auth.users (id),
  created_at           timestamptz not null default now(),
  updated_by           uuid references auth.users (id),
  updated_at           timestamptz not null default now(),
  constraint acc_repayment_account_says_how_ck
    check (btrim(match_words) <> '' or match_digits is not null),
  constraint acc_repayment_account_card_ck
    check (kind <> 'card' or (interest_account_id is null and interest_method is null
                              and annual_rate is null and fixed_interest_minor is null)),
  constraint acc_repayment_account_loan_ck
    check (kind <> 'loan' or (interest_account_id is not null and interest_method is not null)),
  constraint acc_repayment_account_rate_ck
    check (interest_method is distinct from 'rate' or annual_rate is not null),
  constraint acc_repayment_account_fixed_ck
    check (interest_method is distinct from 'fixed' or fixed_interest_minor is not null)
);

drop trigger if exists acc_repayment_account_actor_stamp on acc_repayment_account;
create trigger acc_repayment_account_actor_stamp
  before insert or update on acc_repayment_account
  for each row execute function acc_stamp_actor();

drop trigger if exists acc_repayment_account_atomic_audit on acc_repayment_account;
create trigger acc_repayment_account_atomic_audit
  after insert or update or delete on acc_repayment_account
  for each row execute function acc_audit_row_change();

alter table acc_repayment_account enable row level security;

drop policy if exists acc_repayment_account_sel on acc_repayment_account;
create policy acc_repayment_account_sel on acc_repayment_account
  for select using (acc_is_staff() or acc_current_role() = 'viewer');
drop policy if exists acc_repayment_account_ins on acc_repayment_account;
create policy acc_repayment_account_ins on acc_repayment_account
  for insert with check (acc_is_staff());
drop policy if exists acc_repayment_account_upd on acc_repayment_account;
create policy acc_repayment_account_upd on acc_repayment_account
  for update using (acc_is_staff()) with check (acc_is_staff());
drop policy if exists acc_repayment_account_del on acc_repayment_account;
create policy acc_repayment_account_del on acc_repayment_account
  for delete using (acc_is_staff());

revoke all on acc_repayment_account from public, anon;
grant select, insert, update, delete on acc_repayment_account to authenticated;
grant all on acc_repayment_account to service_role;
