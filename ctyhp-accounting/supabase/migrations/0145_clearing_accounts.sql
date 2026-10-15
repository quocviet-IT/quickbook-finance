-- ============================================================================
-- 0145  Clearing accounts (2.06)
--
--   acc_account.is_clearing      a tick on a current asset or a current
--                                liability that is meant to empty: money
--                                received waits in it until it is banked,
--                                wages until they are paid.
--   acc_clearing_standing(date)  one row per ticked account: its balance, its
--                                last movement, and the items still open,
--                                first in, first out. Read only.
--
-- Backfill: the accounts the application already treats as clearing accounts
-- are ticked (detail type Undeposited funds or Transfer clearing, or a current
-- asset with "undeposited" in its name), and only current assets, so the type
-- rule below never refuses an existing row. Nothing else about an account
-- changes.
--
-- Type rule: a check constraint lets only a current asset or a current
-- liability carry the tick. A company provisioned from the migrations gets the
-- tick on Undeposited Funds from the backfill above; the chart template that
-- follows ticks Transfer Clearing (lib/domain/chart-templates.ts).
--
-- Open items. An item is a posted line on the side the balance stands on:
-- debits when the balance is a debit, credits when it is a credit. Lines on the
-- other side clear the oldest items first, ordered by entry date, then entry
-- number, then line. An item part cleared is open for what remains, so the open
-- items always add up to the whole balance. A zero balance has no open items.
-- Everything is as at p_as_of; entries that are not posted never count.
--
-- Security definer with the search path pinned; staff or a viewer may read,
-- anyone else is refused; executable by signed-in users and the service role
-- only. Additive.
-- ============================================================================

set search_path = public;

-- ----------------------------------------------------------------------------
-- 1. The tick, and its backfill (current assets only).
-- ----------------------------------------------------------------------------
alter table acc_account add column if not exists is_clearing boolean not null default false;

update acc_account
   set is_clearing = true
 where is_clearing = false
   and account_type = 'current_asset'
   and (
     detail_type in ('undeposited_funds', 'transfer_clearing')
     or name ilike '%undeposited%'
   );

-- ----------------------------------------------------------------------------
-- 2. Only a current asset or a current liability may be ticked.
-- ----------------------------------------------------------------------------
alter table acc_account drop constraint if exists acc_account_clearing_type_ck;
alter table acc_account
  add constraint acc_account_clearing_type_ck
  check (not is_clearing or account_type in ('current_asset', 'current_liability'));

-- ----------------------------------------------------------------------------
-- 3. What each clearing account still holds, first in, first out.
-- ----------------------------------------------------------------------------
create or replace function acc_clearing_standing(p_as_of date)
returns table (
  account_id uuid,
  balance_minor bigint,
  last_movement_date date,
  open_count integer,
  open_oldest_date date,
  open_minor bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (acc_is_staff() or coalesce(acc_current_role() = 'viewer', false)) then
    raise exception 'Not authorized to read clearing accounts';
  end if;
  if p_as_of is null then
    raise exception 'Choose the date to read the clearing accounts at';
  end if;
  return query
  with ticked as (
    select a.id as acct, a.account_code as code
      from acc_account a
     where a.is_clearing
  ),
  -- One pass over the posted lines of the ticked accounts through the date.
  -- A debit is positive, a credit negative.
  posted as (
    select t.acct, e.entry_date as dated, e.entry_number as entry_no, l.line_order as line_no, l.id as line_id,
           (case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end)::bigint as signed_minor
      from ticked t
      join acc_journal_line l on l.account_id = t.acct
      join acc_journal_entry e on e.id = l.journal_entry_id
     where e.status = 'posted' and e.entry_date <= p_as_of
  ),
  totals as (
    select p.acct,
           sum(p.signed_minor)::bigint as bal,
           max(p.dated) as last_on,
           coalesce(sum(p.signed_minor) filter (where p.signed_minor > 0), 0)::bigint as debits,
           coalesce(-sum(p.signed_minor) filter (where p.signed_minor < 0), 0)::bigint as credits
      from posted p
     group by p.acct
  ),
  -- The lines on the side the balance stands on, with a running total in the
  -- order they came in.
  items as (
    select p.acct, p.dated,
           sum(abs(p.signed_minor)) over (
             partition by p.acct
             order by p.dated, p.entry_no, p.line_no, p.line_id
             rows between unbounded preceding and current row
           )::bigint as running_minor
      from posted p
      join totals s on s.acct = p.acct
     where s.bal <> 0 and sign(p.signed_minor) = sign(s.bal)
  ),
  -- An item is still open when the amounts out have not yet used it up: the
  -- running total through it is beyond everything on the other side.
  open_items as (
    select i.acct, count(*)::integer as n, min(i.dated) as oldest_on
      from items i
      join totals s on s.acct = i.acct
     where i.running_minor > case when s.bal > 0 then s.credits else s.debits end
     group by i.acct
  )
  select t.acct,
         coalesce(s.bal, 0)::bigint,
         s.last_on,
         coalesce(o.n, 0)::integer,
         o.oldest_on,
         abs(coalesce(s.bal, 0))::bigint
    from ticked t
    left join totals s on s.acct = t.acct
    left join open_items o on o.acct = t.acct
   order by t.code, t.acct;
end;
$$;
revoke all on function acc_clearing_standing(date) from public, anon;
grant execute on function acc_clearing_standing(date) to authenticated, service_role;
