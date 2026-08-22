-- ============================================================================
-- 0121  Twelve months of ledger balances, in one round trip
--
-- Phase 5 of the accounting cockpit
-- (docs/superpowers/plans/2026-08-21-accounting-cockpit-phase5.md).
--
-- `getMonthlyPerformance` called `acc_ledger_balances` once per month and
-- awaited twelve round trips to draw one chart. This is the same data in one.
--
-- **This function aggregates and nothing else.** The obvious version sums
-- income and expense here, and that would be a second answer to "what counts as
-- revenue" living next to `buildProfitAndLoss` in lib/domain/reports.ts, free
-- to disagree with it the first time either side is edited. Which accounts are
-- income, what `other_income` means, how a contra account signs — none of that
-- is knowledge this function has or should acquire. It returns debits and
-- credits per account per month, and the one profit-and-loss rule the codebase
-- has does the rest, unchanged, on data it already holds.
--
-- The month key is derived from the entry date, so a month with no postings
-- simply has no rows and the caller fills the gap. Manufacturing empty rows
-- here would mean this function knowing the calendar as well.
-- ============================================================================

set search_path = public;

create or replace function acc_monthly_ledger_balances(p_to date, p_months int)
returns table (
  month_key    text,
  account_id   uuid,
  account_code text,
  name         text,
  account_type acc_account_type,
  debit_base   bigint,
  credit_base  bigint
)
language sql stable as $$
  with window_start as (
    -- Inclusive: p_months counting back from and including p_to's month.
    select (date_trunc('month', p_to) - make_interval(months => greatest(coalesce(p_months, 12), 1) - 1))::date as from_date
  )
  select
    to_char(e.entry_date, 'YYYY-MM'),
    a.id,
    a.account_code,
    a.name,
    a.account_type,
    coalesce(sum(case when l.debit_minor  > 0 then l.amount_base_minor else 0 end), 0)::bigint,
    coalesce(sum(case when l.credit_minor > 0 then l.amount_base_minor else 0 end), 0)::bigint
  from acc_journal_entry e
  join acc_journal_line l on l.journal_entry_id = e.id
  join acc_account a on a.id = l.account_id
  where e.status = 'posted'
    and a.is_posting_account
    and e.entry_date <= p_to
    and e.entry_date >= (select from_date from window_start)
  group by to_char(e.entry_date, 'YYYY-MM'), a.id, a.account_code, a.name, a.account_type
  order by 1, a.account_code;
$$;

revoke all on function acc_monthly_ledger_balances(date, int) from public, anon;
grant execute on function acc_monthly_ledger_balances(date, int) to authenticated, service_role;
