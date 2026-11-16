-- ============================================================================
-- 0199  Transfers between the company's own bank accounts, by month (3.0.40)
--
-- The dashboard's Cash flow card charts money in and money out by month: the
-- debits and credits to bank-type accounts (acc_monthly_ledger_balances,
-- 0121). One movement of money between two of the company's own bank
-- accounts is neither money in nor money out of the business, but it is a
-- debit to one bank account and a credit to another, so it counted on both
-- sides. This function says how much of each month's bank debits and credits
-- was such a movement, so the dashboard can leave it out of both.
--
-- A transfer is recorded as one posted journal entry that debits one
-- bank-type account and credits another: the app's own transfer pairing
-- (0127) posts it that way. So, per posted entry, the bank debits and the bank
-- credits are summed, and the smaller of the two is the part of the entry
-- that moved from one of the company's bank accounts to another. An entry
-- with only one side touching a bank moved nothing between them and adds 0.
-- Undeposited Funds is a current asset, not a bank, so a deposit (debit
-- Checking, credit Undeposited Funds) is still money in; paying a credit card
-- from Checking is still money out.
--
-- A transfer coded as two entries through a clearing account (Checking to
-- Transfer Clearing, then Transfer Clearing to Savings) would not be found:
-- each entry has a bank on one side only. No company records transfers that
-- way today.
--
-- The window is acc_monthly_ledger_balances's: p_months months counting back
-- from and including p_to's month, posted entries dated on or before p_to,
-- posting accounts only. A month with nothing moved has no row. Like 0121 it
-- is a security-invoker read, so the journal's own row-level security
-- applies, and it aggregates and nothing else.
-- ============================================================================

set search_path = public;

create or replace function acc_monthly_bank_transfers(p_to date, p_months int)
returns table (
  month_key      text,
  transfer_base  bigint
)
language sql stable security invoker as $$
  with window_start as (
    -- Inclusive: p_months counting back from and including p_to's month.
    select (date_trunc('month', p_to) - make_interval(months => greatest(coalesce(p_months, 12), 1) - 1))::date as from_date
  ),
  per_entry as (
    -- Each posted entry's debits and credits to bank-type accounts.
    select
      e.entry_date,
      coalesce(sum(case when l.debit_minor  > 0 then l.amount_base_minor else 0 end), 0) as bank_debit,
      coalesce(sum(case when l.credit_minor > 0 then l.amount_base_minor else 0 end), 0) as bank_credit
    from acc_journal_entry e
    join acc_journal_line l on l.journal_entry_id = e.id
    join acc_account a on a.id = l.account_id
    where e.status = 'posted'
      and a.is_posting_account
      and a.account_type = 'bank'
      and e.entry_date <= p_to
      and e.entry_date >= (select from_date from window_start)
    group by e.id, e.entry_date
  )
  select
    to_char(entry_date, 'YYYY-MM'),
    -- The part of the entry that moved from one bank account to another.
    sum(least(bank_debit, bank_credit))::bigint
  from per_entry
  group by to_char(entry_date, 'YYYY-MM')
  having sum(least(bank_debit, bank_credit)) > 0
  order by 1;
$$;

revoke all on function acc_monthly_bank_transfers(date, int) from public, anon;
grant execute on function acc_monthly_bank_transfers(date, int) to authenticated, service_role;
