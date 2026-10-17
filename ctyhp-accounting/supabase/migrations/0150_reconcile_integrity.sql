-- ============================================================================
-- 0150  What changed after a reconciliation was signed off, and the legs of
--       each transfer (2.12)
--
--   acc_reconciliation_changes()  one row per change to a COMPLETED
--                                 reconciliation, of four kinds:
--       voided    a line ticked on it belongs to an entry that is now void
--                 (the 0026 rule, acc_reconciliation_discrepancies).
--       reversed  a line ticked on it belongs to a posted entry that has a
--                 posted reversal (acc_journal_reversal_link). The original
--                 stays posted, so nothing else notices.
--       added     a posted entry on the reconciliation's bank ledger account,
--                 dated on or before its statement ending date and after the
--                 ending date of the account's previous completed
--                 reconciliation, with a line ticked on no reconciliation,
--                 posted after the reconciliation was completed
--                 (posted_at > completed_at).
--       drift     the saved statement ending differs from the saved beginning
--                 plus the posted ticked lines. That is exactly the sum
--                 acc_complete_reconciliation (0026) requires to be zero at
--                 sign-off, taken from acc_recon_cleared_total (0027), so
--                 difference_minor = ending - (beginning + cleared) has the
--                 sign of the "unexplained difference" sign-off would print.
--
--   acc_transfer_legs()           the facts behind "a transfer cleared on one
--                                 side only", in one paged result with a
--                                 row_kind:
--       leg       each of the two bank legs of every posted entry that has
--                 exactly two lines on bank ledger accounts, one debit and one
--                 credit, on two different bank accounts: the leg's account,
--                 signed amount, entry number and date, whether it is ticked on
--                 a completed reconciliation (and that statement's ending
--                 date), how far the account's completed statements reach, and
--                 the reversal link where there is one.
--       candidate evidence for an OPEN leg: an unticked leg whose other leg is
--                 ticked on a completed reconciliation and whose own account
--                 has a completed reconciliation ending on or after the entry
--                 date. One row per place the same signed amount shows up on
--                 ANOTHER bank account within 7 days, either as a statement
--                 line held by a completed reconciliation of that account
--                 (acc_reconciliation_statement_line, lines set aside left
--                 out) or as a posted ledger line on that account. Bank lines
--                 (acc_bank_transaction) are not read at all: backfilled ones
--                 would only echo the ledger.
--       skipped   an entry with more than two lines on bank ledger accounts,
--                 so the report can say how many it left out.
--
-- Whether a leg is open (the 30 days, the rest of the rule) is the app's call:
-- it needs today in the company's time zone.
--
-- Amounts are signed as the reconciliation signs them: a debit to the bank is
-- money in, in base-currency minor units. Both functions are stable security
-- definer with the search path pinned; staff or a viewer may read, anyone else
-- is refused; executable by signed-in users and the service role only. Each
-- orders its rows by a key that is unique, so a caller can page through them.
-- Additive: no table or column changes, and no existing function is touched.
-- ============================================================================

set search_path = public;

-- ----------------------------------------------------------------------------
-- 1. Changes to a completed reconciliation.
-- ----------------------------------------------------------------------------
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
    -- reversed
    select c.rid, c.bid, c.ending, c.done_at, 'reversed'::text,
           t.eid, t.enum, t.edate, t.signed,
           x.id, x.entry_number, null::bigint
      from comp c
      join ticked t on t.rid = c.rid
      join acc_journal_reversal_link k on k.original_entry_id = t.eid
      join acc_journal_entry x on x.id = k.reversal_entry_id and x.status = 'posted'
     where t.estatus = 'posted'
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

-- ----------------------------------------------------------------------------
-- 2. The legs of each transfer, the evidence for an open leg, and the entries
--    left out.
-- ----------------------------------------------------------------------------
create or replace function acc_transfer_legs()
returns table (
  row_key text,
  row_kind text,
  entry_id uuid,
  entry_number text,
  entry_date date,
  bank_account_id uuid,
  journal_line_id uuid,
  signed_minor bigint,
  ticked_reconciliation_id uuid,
  ticked_statement_date date,
  covered_through date,
  reversed_by_entry_id uuid,
  reversed_by_entry_number text,
  reversal_of_entry_id uuid,
  reversal_of_entry_number text,
  candidate_source text,
  candidate_id uuid,
  candidate_bank_account_id uuid,
  candidate_date date,
  candidate_entry_id uuid,
  candidate_entry_number text
)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not (acc_is_staff() or coalesce(acc_current_role() = 'viewer', false)) then
    raise exception 'Not authorized to read transfers';
  end if;
  return query
  with bl as (
    select l.id as lid, e.id as eid, e.entry_number as enum, e.entry_date as edate, ba.id as bid,
           (l.debit_minor > 0) as is_debit,
           (case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end)::bigint as signed
      from acc_journal_line l
      join acc_bank_account ba on ba.account_id = l.account_id
      join acc_journal_entry e on e.id = l.journal_entry_id and e.status = 'posted'
  ),
  shape as (
    select b.eid,
           count(*) as n,
           count(*) filter (where b.is_debit) as debits,
           count(distinct b.bid) as banks
      from bl b
     group by b.eid
  ),
  covered as (
    select r.bank_account_id as bid, max(r.statement_ending_date) as through
      from acc_statement_reconciliation r
     where r.status = 'completed'
     group by r.bank_account_id
  ),
  legs as (
    select b.lid, b.eid, b.enum, b.edate, b.bid, b.signed,
           t.rid as tick_rid, t.ending as tick_date,
           cv.through,
           rb.id as rb_id, rb.entry_number as rb_num,
           ro.id as ro_id, ro.entry_number as ro_num
      from bl b
      join shape s on s.eid = b.eid and s.n = 2 and s.debits = 1 and s.banks = 2
      left join lateral (
        select r.id as rid, r.statement_ending_date as ending
          from acc_reconciliation_line rl
          join acc_statement_reconciliation r on r.id = rl.reconciliation_id and r.status = 'completed'
         where rl.journal_line_id = b.lid
         order by r.statement_ending_date, r.id
         limit 1
      ) t on true
      left join covered cv on cv.bid = b.bid
      left join lateral (
        select x.id, x.entry_number
          from acc_journal_reversal_link k
          join acc_journal_entry x on x.id = k.reversal_entry_id and x.status = 'posted'
         where k.original_entry_id = b.eid
         limit 1
      ) rb on true
      left join lateral (
        select x.id, x.entry_number
          from acc_journal_reversal_link k
          join acc_journal_entry x on x.id = k.original_entry_id
         where k.reversal_entry_id = b.eid
         limit 1
      ) ro on true
  ),
  open_legs as (
    select g.*
      from legs g
     where g.tick_rid is null
       and g.through is not null
       and g.through >= g.edate
       and exists (select 1 from legs o where o.eid = g.eid and o.lid <> g.lid and o.tick_rid is not null)
  ),
  evidence as (
    select o.lid, 'statement_line'::text as src, s.id as cid, r.bank_account_id as cbid,
           s.txn_date as cdate, null::uuid as ceid, null::text as cenum
      from open_legs o
      join acc_reconciliation_statement_line s
        on s.amount_minor = o.signed and not s.set_aside and abs(s.txn_date - o.edate) <= 7
      join acc_statement_reconciliation r
        on r.id = s.reconciliation_id and r.status = 'completed' and r.bank_account_id <> o.bid
    union all
    select o.lid, 'ledger_line'::text, b.lid, b.bid, b.edate, b.eid, b.enum
      from open_legs o
      join bl b
        on b.signed = o.signed and b.bid <> o.bid and b.eid <> o.eid and abs(b.edate - o.edate) <= 7
  ),
  everything as (
    select 'leg:' || g.lid::text as k, 'leg'::text as rk,
           g.eid, g.enum, g.edate, g.bid, g.lid, g.signed,
           g.tick_rid, g.tick_date, g.through,
           g.rb_id, g.rb_num, g.ro_id, g.ro_num,
           null::text as csrc, null::uuid as cid, null::uuid as cbid, null::date as cdate,
           null::uuid as ceid, null::text as cenum
      from legs g
    union all
    select 'candidate:' || o.lid::text || ':' || v.src || ':' || v.cid::text, 'candidate'::text,
           o.eid, o.enum, o.edate, o.bid, o.lid, o.signed,
           null::uuid, null::date, o.through,
           null::uuid, null::text, null::uuid, null::text,
           v.src, v.cid, v.cbid, v.cdate, v.ceid, v.cenum
      from open_legs o join evidence v on v.lid = o.lid
    union all
    select 'skipped:' || e.id::text, 'skipped'::text,
           e.id, e.entry_number, e.entry_date, null::uuid, null::uuid, null::bigint,
           null::uuid, null::date, null::date,
           null::uuid, null::text, null::uuid, null::text,
           null::text, null::uuid, null::uuid, null::date, null::uuid, null::text
      from shape s join acc_journal_entry e on e.id = s.eid
     where s.n > 2
  )
  select x.k, x.rk, x.eid, x.enum, x.edate, x.bid, x.lid, x.signed,
         x.tick_rid, x.tick_date, x.through,
         x.rb_id, x.rb_num, x.ro_id, x.ro_num,
         x.csrc, x.cid, x.cbid, x.cdate, x.ceid, x.cenum
    from everything x
   order by x.rk collate "C", x.edate, x.k collate "C";
end;
$$;
revoke all on function acc_transfer_legs() from public, anon;
grant execute on function acc_transfer_legs() to authenticated, service_role;
