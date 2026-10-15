-- ============================================================================
-- 0144  Bank standing: where each bank account stands against its statements
--       (2.05)
--
--   acc_bank_standing(p_as_of)   one row per bank account: the latest completed
--                                reconciliation (its statement ending date and
--                                closing balance, and whether it was brought
--                                forward), what has happened on the account
--                                since then that no statement holds, the
--                                items still outstanding from before it, the
--                                lines ticked in a completed reconciliation
--                                whose entry has since been voided, and the
--                                book balance. Read only.
--   acc_unreconciled_bank        redefined (0030) so the dashboard's
--                                "Unreconciled bank activity" leaves out Cash on
--                                Hand lines. Cash on Hand has the bank account
--                                type but is not a bank account (0072), so it
--                                can never be reconciled. Nothing else changes.
--
-- Definitions are the ones 0133 and 0142 use:
--   * A line is HELD when a COMPLETED reconciliation holds it
--     (acc_reconciliation_line joined to a completed
--     acc_statement_reconciliation). Brought-forward reconciliations (0132,
--     0142) are completed and hold their lines like any other.
--   * Amounts are signed as the pairing signs them: a debit to the bank ledger
--     account is money in.
--   * Only posted entries count for the since, earlier and book columns.
--
-- Everything is as at p_as_of: a reconciliation whose statement ends after
-- that date does not exist yet, and neither do the lines dated after it. The
-- closing is the reconciliation's statement ending balance: the figure taken
-- from the statement or, for a brought-forward one, the balance the person
-- proved. The voided ticks follow the 0026 discrepancy rule (the ticked lines
-- of completed reconciliations whose entry is now void), counted for all the
-- accounts in one pass; their date is the statement ending date of the latest
-- reconciliation affected.
--
-- Security definer with the search path pinned; staff or a viewer may read,
-- anyone else is refused; executable by signed-in users and the service role
-- only. Additive and read only.
-- ============================================================================

set search_path = public;

-- ----------------------------------------------------------------------------
-- 1. Bank activity no completed reconciliation holds, without Cash on Hand.
--    Same signature, return shape and (invoker) security as 0030.
-- ----------------------------------------------------------------------------
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
     and a.detail_type is distinct from 'cash_on_hand'
     and e.status = 'posted'
     and e.entry_date <= p_as_of
     and not exists (
       select 1 from acc_reconciliation_line rl
       join acc_statement_reconciliation r on r.id = rl.reconciliation_id
       where rl.journal_line_id = l.id and r.status = 'completed'
     );
$$;

-- ----------------------------------------------------------------------------
-- 2. Every bank account's standing at a date, one row each.
-- ----------------------------------------------------------------------------
create or replace function acc_bank_standing(p_as_of date)
returns table (
  bank_account_id uuid,
  last_completed_id uuid,
  last_completed_date date,
  last_closing_minor bigint,
  last_brought_forward boolean,
  since_count integer,
  since_net_minor bigint,
  earlier_open_count integer,
  earlier_open_net_minor bigint,
  void_ticked_count integer,
  void_ticked_minor bigint,
  void_reconciliation_date date,
  book_minor bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (acc_is_staff() or coalesce(acc_current_role() = 'viewer', false)) then
    raise exception 'Not authorized to read bank standing';
  end if;
  if p_as_of is null then
    raise exception 'Choose the date to read the bank accounts at';
  end if;
  return query
  with banks as (
    select b.id as bank_id, b.account_id as gl_id, b.created_at as made_at
      from acc_bank_account b
  ),
  -- The latest completed reconciliation of each account that ends on or before
  -- the date: the latest ending date, the later one created winning a tie.
  last_done as (
    select distinct on (r.bank_account_id)
           r.bank_account_id as bank_id, r.id as rec_id, r.statement_ending_date as ended_on,
           r.statement_ending_balance_minor as closing_minor, r.brought_forward as carried
      from acc_statement_reconciliation r
     where r.status = 'completed' and r.statement_ending_date <= p_as_of
     order by r.bank_account_id, r.statement_ending_date desc, r.created_at desc, r.id desc
  ),
  -- One pass over the posted lines of the bank ledger accounts through the
  -- date, each marked held or not by a completed reconciliation that already
  -- ended by then.
  bank_lines as (
    select k.bank_id, e.entry_date as dated,
           (case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end)::bigint as signed_minor,
           exists (
             select 1 from acc_reconciliation_line rl
               join acc_statement_reconciliation r on r.id = rl.reconciliation_id
              where rl.journal_line_id = l.id
                and r.status = 'completed'
                and r.statement_ending_date <= p_as_of
           ) as is_held
      from banks k
      join acc_journal_line l on l.account_id = k.gl_id
      join acc_journal_entry e on e.id = l.journal_entry_id
     where e.status = 'posted' and e.entry_date <= p_as_of
  ),
  standing as (
    select bl.bank_id,
           count(*) filter (where not bl.is_held and (d.ended_on is null or bl.dated > d.ended_on))::integer as since_n,
           coalesce(sum(bl.signed_minor) filter (where not bl.is_held and (d.ended_on is null or bl.dated > d.ended_on)), 0)::bigint as since_net,
           count(*) filter (where not bl.is_held and d.ended_on is not null and bl.dated <= d.ended_on)::integer as earlier_n,
           coalesce(sum(bl.signed_minor) filter (where not bl.is_held and d.ended_on is not null and bl.dated <= d.ended_on), 0)::bigint as earlier_net,
           coalesce(sum(bl.signed_minor), 0)::bigint as book
      from bank_lines bl
      left join last_done d on d.bank_id = bl.bank_id
     group by bl.bank_id
  ),
  -- The 0026 rule for every account at once: ticked in a completed
  -- reconciliation (ended by the date), entry void now.
  voided as (
    select r.bank_account_id as bank_id,
           count(*)::integer as n,
           coalesce(sum(case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end), 0)::bigint as net,
           max(r.statement_ending_date) as latest_on
      from acc_reconciliation_line rl
      join acc_statement_reconciliation r on r.id = rl.reconciliation_id
      join acc_journal_line l on l.id = rl.journal_line_id
      join acc_journal_entry e on e.id = l.journal_entry_id
     where r.status = 'completed' and r.statement_ending_date <= p_as_of and e.status = 'void'
       and r.bank_account_id in (select bank_id from banks)
     group by r.bank_account_id
  )
  select k.bank_id, d.rec_id, d.ended_on, d.closing_minor, d.carried,
         coalesce(s.since_n, 0), coalesce(s.since_net, 0),
         coalesce(s.earlier_n, 0), coalesce(s.earlier_net, 0),
         coalesce(v.n, 0), coalesce(v.net, 0), v.latest_on,
         coalesce(s.book, 0)
    from banks k
    left join last_done d on d.bank_id = k.bank_id
    left join standing s on s.bank_id = k.bank_id
    left join voided v on v.bank_id = k.bank_id
   order by k.made_at, k.bank_id;
end;
$$;
revoke all on function acc_bank_standing(date) from public, anon;
grant execute on function acc_bank_standing(date) to authenticated, service_role;
