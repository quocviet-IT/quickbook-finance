-- ============================================================================
-- Tell a checking account from the petty cash tin.
--
-- The chart types both as `bank` — which is right, and is what QuickBooks does:
-- "Bank" is the type that carries checking, savings, money market and cash on
-- hand, and all of them belong to Cash and cash equivalents on the balance
-- sheet. What was missing is the *detail* under that type, so the bank setup
-- screen offered "1000 — Cash on Hand" as somewhere to attach a bank feed or a
-- statement, which it is not: nobody imports a statement for the cash tin.
--
-- This adds the detail classification, backfills the two seeded accounts from
-- what they plainly are, and refuses at the database to attach a bank account
-- to a cash-on-hand ledger.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The classifications a bank-type account may carry. A null detail type
--    stays legal: accounts created before this migration are unclassified
--    rather than silently assumed to be checking accounts.
-- ----------------------------------------------------------------------------
alter table acc_account drop constraint if exists acc_account_bank_detail_ck;
alter table acc_account add constraint acc_account_bank_detail_ck check (
  account_type <> 'bank'
  or detail_type is null
  or detail_type in ('checking', 'savings', 'money_market', 'cash_on_hand', 'other_bank')
);

-- ----------------------------------------------------------------------------
-- 2. Backfill only what the account's own name settles. Anything else stays
--    null for a person to classify — guessing a classification onto a ledger
--    account is how a balance sheet ends up quietly wrong.
-- ----------------------------------------------------------------------------
update acc_account
   set detail_type = 'cash_on_hand'
 where account_type = 'bank' and detail_type is null
   and (name ilike '%cash on hand%' or name ilike '%petty cash%');

update acc_account
   set detail_type = 'checking'
 where account_type = 'bank' and detail_type is null
   and (name ilike '%checking%' or name ilike '%operating bank%' or name ilike '%current account%');

update acc_account
   set detail_type = 'savings'
 where account_type = 'bank' and detail_type is null and name ilike '%savings%';

update acc_account
   set detail_type = 'money_market'
 where account_type = 'bank' and detail_type is null and name ilike '%money market%';

-- ----------------------------------------------------------------------------
-- 3. A bank account record is a statement feed: it belongs to a ledger account
--    money moves through a financial institution in, never to the cash tin.
-- ----------------------------------------------------------------------------
create or replace function acc_guard_bank_account_ledger() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_type   acc_account_type;
  v_detail text;
  v_name   text;
begin
  select account_type, detail_type, name
    into v_type, v_detail, v_name
    from acc_account where id = new.account_id;

  if not found then
    raise exception 'Ledger account not found';
  end if;
  if v_type <> 'bank' then
    raise exception 'A bank account must be linked to a Bank-type ledger account (% is %)',
      v_name, v_type;
  end if;
  if v_detail = 'cash_on_hand' then
    raise exception
      'Cash on hand holds physical cash, not a bank balance — link this to a checking, savings or money market account (%)',
      v_name
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function acc_guard_bank_account_ledger() from public;

drop trigger if exists acc_bank_account_ledger_guard on acc_bank_account;
create trigger acc_bank_account_ledger_guard
  before insert or update of account_id on acc_bank_account
  for each row execute function acc_guard_bank_account_ledger();

notify pgrst, 'reload schema';
