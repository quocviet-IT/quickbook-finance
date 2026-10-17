-- ============================================================================
-- 0151  A reversed entry stops counting against an old reconciliation once its
--       reversal is reconciled (2.12)
--
--   acc_reconciliation_changes() is replaced with the same columns and the same
--   rules as 0150, except one: a "reversed" row is returned only while the
--   reversing entry has no line ticked on a COMPLETED reconciliation. Reversing a
--   ticked entry and reconciling the reversal on a later statement is the proper
--   way to put a cleared entry right; once that later statement is signed off the
--   books agree again, so the old reconciliation is no longer listed for it.
--   Until then it is.
--
-- Read only. No table or column changes; nothing else is touched.
-- ============================================================================

set search_path = public;

create or replace function acc_reconciliation_changes()
returns table (
  change_key text,
  reconciliation_id uuid,
  bank_account_id uuid,
  statement_ending_date date,
  completed_at timestamptz,
  kind text,
  entry_id uuid,
  entry_number text,
  entry_date date,
  signed_minor bigint,
  reversal_entry_id uuid,
  reversal_entry_number text,
  difference_minor bigint
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not (acc_is_staff() or coalesce(acc_current_role() = 'viewer', false)) then
    raise exception 'Not authorized to read changes to reconciliations';
  end if;
  return query
  with comp as (
    select r.id as rid, r.bank_account_id as bid, r.statement_ending_date as ending,
           r.completed_at as done_at, r.beginning_balance_minor as beginning,
           r.statement_ending_balance_minor as saved_ending, ba.account_id as gl_id,
           (select max(p.statement_ending_date)
              from acc_statement_reconciliation p
             where p.bank_account_id = r.bank_account_id
               and p.status = 'completed'
               and p.statement_ending_date < r.statement_ending_date) as prev_ending
      from acc_statement_reconciliation r
      join acc_bank_account ba on ba.id = r.bank_account_id
     where r.status = 'completed'
  ),
  ticked as (
    select c.rid, e.id as eid, e.entry_number as enum, e.entry_date as edate, e.status as estatus,
           sum(case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end)::bigint as signed
      from comp c
      join acc_reconciliation_line rl on rl.reconciliation_id = c.rid
      join acc_journal_line l on l.id = rl.journal_line_id
      join acc_journal_entry e on e.id = l.journal_entry_id
     group by c.rid, e.id, e.entry_number, e.entry_date, e.status
  ),
  changes as (
    -- voided
    select c.rid, c.bid, c.ending, c.done_at, 'voided'::text as kind,
           t.eid, t.enum, t.edate, t.signed,
           null::uuid as rev_id, null::text as rev_num, null::bigint as diff
      from comp c join ticked t on t.rid = c.rid
     where t.estatus = 'void'
    union all
    -- reversed, until the reversal itself is reconciled
    select c.rid, c.bid, c.ending, c.done_at, 'reversed'::text,
           t.eid, t.enum, t.edate, t.signed,
           x.id, x.entry_number, null::bigint
      from comp c
      join ticked t on t.rid = c.rid
      join acc_journal_reversal_link k on k.original_entry_id = t.eid
      join acc_journal_entry x on x.id = k.reversal_entry_id and x.status = 'posted'
     where t.estatus = 'posted'
       and not exists (
         select 1
           from acc_journal_line xl
           join acc_reconciliation_line xrl on xrl.journal_line_id = xl.id
           join acc_statement_reconciliation xr on xr.id = xrl.reconciliation_id and xr.status = 'completed'
          where xl.journal_entry_id = x.id
       )
    union all
    -- added after sign-off, inside the signed-off period
    select c.rid, c.bid, c.ending, c.done_at, 'added'::text,
           e.id, e.entry_number, e.entry_date,
           sum(case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end)::bigint,
           null::uuid, null::text, null::bigint
      from comp c
      join acc_journal_line l on l.account_id = c.gl_id
      join acc_journal_entry e on e.id = l.journal_entry_id and e.status = 'posted'
     where e.entry_date <= c.ending
       and (c.prev_ending is null or e.entry_date > c.prev_ending)
       and e.posted_at > c.done_at
       and not exists (select 1 from acc_reconciliation_line rl where rl.journal_line_id = l.id)
     group by c.rid, c.bid, c.ending, c.done_at, e.id, e.entry_number, e.entry_date
    union all
    -- drift: the saved ending against the saved beginning plus the posted ticked lines
    select c.rid, c.bid, c.ending, c.done_at, 'drift'::text,
           null::uuid, null::text, null::date, null::bigint,
           null::uuid, null::text,
           (c.saved_ending - (c.beginning + acc_recon_cleared_total(c.rid)))::bigint
      from comp c
     where c.saved_ending <> c.beginning + acc_recon_cleared_total(c.rid)
  )
  select u.kind || ':' || u.rid::text || ':' || coalesce(u.eid::text, ''),
         u.rid, u.bid, u.ending, u.done_at, u.kind,
         u.eid, u.enum, u.edate, u.signed, u.rev_id, u.rev_num, u.diff
    from changes u
   order by u.rid, (u.kind || ':' || u.rid::text || ':' || coalesce(u.eid::text, '')) collate "C";
end;
$$;
revoke all on function acc_reconciliation_changes() from public, anon;
grant execute on function acc_reconciliation_changes() to authenticated, service_role;
