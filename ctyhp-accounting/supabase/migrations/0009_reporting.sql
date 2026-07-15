-- ============================================================================
-- Module 4 — Reporting. A single aggregation function returns per-account
-- debit/credit totals (in base-currency minor units) over an optional date
-- window, from POSTED entries only. Trial Balance, P&L, and Balance Sheet are
-- all derived from this. Aggregation happens in SQL (not by pulling rows into
-- the app) so it stays fast as the ledger grows.
--   p_from NULL  -> from the beginning (cumulative, for as-of reports)
--   p_to         -> inclusive upper bound date
-- Runs as the invoker, so Row Level Security applies.
-- ============================================================================
create or replace function acc_ledger_balances(p_from date, p_to date)
returns table (
  account_id   uuid,
  account_code text,
  name         text,
  account_type acc_account_type,
  debit_base   bigint,
  credit_base  bigint
)
language sql stable as $$
  select
    a.id,
    a.account_code,
    a.name,
    a.account_type,
    coalesce(sum(case when l.debit_minor  > 0 then l.amount_base_minor else 0 end), 0)::bigint,
    coalesce(sum(case when l.credit_minor > 0 then l.amount_base_minor else 0 end), 0)::bigint
  from acc_account a
  left join acc_journal_line l
    on l.account_id = a.id
   and l.journal_entry_id in (
     select id from acc_journal_entry
      where status = 'posted'
        and entry_date <= p_to
        and (p_from is null or entry_date >= p_from)
   )
  where a.is_posting_account
  group by a.id, a.account_code, a.name, a.account_type
  order by a.account_code;
$$;
