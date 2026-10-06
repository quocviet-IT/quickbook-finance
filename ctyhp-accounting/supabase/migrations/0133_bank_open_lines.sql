-- ============================================================================
-- 0133 — A bank account's open lines (1.80).
--
-- Reconciling a run of statements walks the months against the books before
-- anything is written: it needs the bank account's posted lines that no
-- completed reconciliation holds yet, with the reference a statement's cheque
-- number pairs on — what acc_reconciliation_lines offers inside one
-- reconciliation, read for the account to a date instead.
--
-- Read only: no table changes, nothing written. Security invoker, so the
-- ledger's row-level security decides who sees which lines.
-- ============================================================================

set search_path = public;

create or replace function acc_bank_open_lines(p_bank_account_id uuid, p_through date)
returns table (journal_line_id uuid, entry_number text, entry_date date, signed_minor bigint, reference text)
language sql stable as $$
  select l.id, e.entry_number, e.entry_date,
         (case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end)::bigint,
         coalesce(nullif(btrim(e.source_ref), ''), p.reference, bp.reference)
    from acc_journal_line l
    join acc_journal_entry e on e.id = l.journal_entry_id
    left join acc_payment p on e.source_type = 'payment' and p.id = e.source_id
    left join acc_bill_payment bp on e.source_type = 'bill_payment' and bp.id = e.source_id
   where l.account_id = (select account_id from acc_bank_account where id = p_bank_account_id)
     and e.status = 'posted'
     and e.entry_date <= p_through
     and not exists (
       select 1 from acc_reconciliation_line rl
       join acc_statement_reconciliation r on r.id = rl.reconciliation_id
       where rl.journal_line_id = l.id and r.status = 'completed')
   order by e.entry_date, e.entry_number, l.id;
$$;
revoke all on function acc_bank_open_lines(uuid, date) from public, anon;
grant execute on function acc_bank_open_lines(uuid, date) to authenticated, service_role;
