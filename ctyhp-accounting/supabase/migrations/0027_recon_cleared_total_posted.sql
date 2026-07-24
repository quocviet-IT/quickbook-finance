-- supabase/migrations/0027_recon_cleared_total_posted.sql
-- Fix: reconciliation cleared-total must exclude cleared lines whose journal
-- entry was later voided, so a void can never leave a false-zero difference
-- that lets a session complete. acc_complete_reconciliation and
-- acc_reconciliation_detail both derive from this function, so both are fixed.
create or replace function acc_recon_cleared_total(p_reconciliation_id uuid) returns bigint
language sql stable as $$
  select coalesce(sum(case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end), 0)::bigint
    from acc_reconciliation_line rl
    join acc_journal_line l on l.id = rl.journal_line_id
    join acc_journal_entry e on e.id = l.journal_entry_id
   where rl.reconciliation_id = p_reconciliation_id
     and e.status = 'posted';
$$;
