-- 0158_reconciliation_report_lines.sql
--
-- The reconciliation report (2.40), set out as the approved design sets one
-- out: what the bank confirmed on this statement, and what it had not seen yet.
--
-- acc_reconciliation_lines serves the workspace, and leaves out every line
-- signed off on another reconciliation. A line that was outstanding on this
-- statement and cleared on a later one is therefore missing from it, yet on the
-- report of a signed-off statement that line is exactly what was outstanding on
-- the day; without it the statement's closing balance plus what was outstanding
-- no longer comes to the book balance, which is the whole point of the report.
--
-- This function keeps it. A line on the bank account's ledger account, posted
-- and dated on or before the statement, is listed unless a different completed
-- reconciliation for a statement ending on or before this one cleared it; it
-- is marked cleared when this reconciliation cleared it.
--
-- Read only. A new function: nothing that exists changes.
set search_path = public;

create or replace function acc_reconciliation_report_lines(p_reconciliation_id uuid)
returns table (journal_line_id uuid, entry_id uuid, entry_number text, entry_date date,
               source_type acc_journal_source, memo text, signed_minor bigint, cleared boolean,
               reference text)
language sql stable as $$
  with rec as (select * from acc_statement_reconciliation where id = p_reconciliation_id),
       gl as (select account_id from acc_bank_account where id = (select bank_account_id from rec))
  select l.id, e.id, e.entry_number, e.entry_date, e.source_type, l.memo,
         (case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end)::bigint,
         exists (select 1 from acc_reconciliation_line rl
                  where rl.reconciliation_id = p_reconciliation_id and rl.journal_line_id = l.id),
         coalesce(nullif(btrim(e.source_ref), ''), p.reference, bp.reference)
    from acc_journal_line l
    join acc_journal_entry e on e.id = l.journal_entry_id
    left join acc_payment p on e.source_type = 'payment' and p.id = e.source_id
    left join acc_bill_payment bp on e.source_type = 'bill_payment' and bp.id = e.source_id
   where l.account_id = (select account_id from gl)
     and e.status = 'posted'
     and e.entry_date <= (select statement_ending_date from rec)
     and not exists (
       select 1 from acc_reconciliation_line rl2
       join acc_statement_reconciliation r2 on r2.id = rl2.reconciliation_id
       where rl2.journal_line_id = l.id and r2.status = 'completed' and r2.id <> p_reconciliation_id
         and r2.statement_ending_date <= (select statement_ending_date from rec))
   order by e.entry_date, e.entry_number;
$$;
revoke all on function acc_reconciliation_report_lines(uuid) from public, anon;
grant execute on function acc_reconciliation_report_lines(uuid) to authenticated, service_role;
