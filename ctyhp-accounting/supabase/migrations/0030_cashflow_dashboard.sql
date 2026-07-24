-- supabase/migrations/0030_cashflow_dashboard.sql
-- ============================================================================
-- Read-only aggregations for the Cash Flow Statement (direct method) and the
-- dashboard. No writes. Runs as invoker (RLS applies).
--
-- Cash = accounts of type 'bank'. Cash-flow category totals come from the
-- NON-bank lines of posted entries that touch a bank account in the window,
-- summed as (credit - debit) in base currency (positive = cash in). Because
-- each entry is balanced, the category totals sum to the bank movement, so the
-- statement ties out to the change in cash balances.
-- ============================================================================

create or replace function acc_cash_flow(p_from date, p_to date)
returns table (category text, amount_minor bigint)
language sql stable as $$
  with bank_entries as (
    select distinct l.journal_entry_id
      from acc_journal_line l
      join acc_account a       on a.id = l.account_id
      join acc_journal_entry e on e.id = l.journal_entry_id
     where a.account_type = 'bank'
       and e.status = 'posted'
       and e.entry_date between p_from and p_to
  )
  select
    case
      when a.account_type = 'fixed_asset'             then 'investing'
      when a.account_type in ('equity','credit_card') then 'financing'
      else 'operating'
    end as category,
    coalesce(sum(case when l.credit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end), 0)::bigint
    from acc_journal_line l
    join acc_account a on a.id = l.account_id
   where l.journal_entry_id in (select journal_entry_id from bank_entries)
     and a.account_type <> 'bank'
   group by 1;
$$;

-- Bank GL lines (posted) not reconciled by any completed statement reconciliation,
-- as of a date. Returns the count and the net signed base amount.
create or replace function acc_unreconciled_bank(p_as_of date)
returns table (item_count bigint, amount_minor bigint)
language sql stable as $$
  select
    count(*)::bigint,
    coalesce(sum(case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end), 0)::bigint
    from acc_journal_line l
    join acc_account a       on a.id = l.account_id
    join acc_journal_entry e on e.id = l.journal_entry_id
   where a.account_type = 'bank'
     and e.status = 'posted'
     and e.entry_date <= p_as_of
     and not exists (
       select 1 from acc_reconciliation_line rl
       join acc_statement_reconciliation r on r.id = rl.reconciliation_id
       where rl.journal_line_id = l.id and r.status = 'completed'
     );
$$;
