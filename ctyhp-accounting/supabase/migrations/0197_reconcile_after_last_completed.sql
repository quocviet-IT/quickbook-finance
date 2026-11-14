-- ============================================================================
-- 0197  A statement period already reconciled is not reconciled again (3.0.36)
--
-- A controlled test on 13 Nov 2026 started a second reconciliation for an
-- account already reconciled to Oct 31, with the same ending date. It moved no
-- money: its beginning balance is the completed one's closing, and the lines
-- it read were already ticked there, so nothing paired and nothing could be
-- added. But with nothing ticked its difference was $0.00, so it could be
-- completed: the same month signed off twice, and a reconciliation dated
-- before the last one (one company has a Jul 14 reconciliation open behind a
-- completed Jul 31) could be completed out of order.
--
-- acc_create_reconciliation now refuses an ending date on or before the
-- account's latest completed reconciliation, and acc_complete_reconciliation
-- refuses to complete one when another reconciliation of the account is
-- already completed to that date or later. Reopening is untouched: it is
-- allowed only on the latest completed reconciliation (0037), so a reopened
-- month never has a completed one after it and completes as before.
--
-- Both functions are their last definitions (0026, 0169) with that one check
-- added; nothing else in them changes. No table, column or grant changes.
-- ============================================================================
set search_path = public;

create or replace function acc_create_reconciliation(
  p_bank_account_id uuid, p_ending_date date, p_ending_balance_minor bigint
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_begin bigint; v_id uuid; v_last date;
begin
  if not acc_is_staff() then raise exception 'Not authorized to start a reconciliation'; end if;
  if not exists (select 1 from acc_bank_account where id = p_bank_account_id) then
    raise exception 'Bank account not found';
  end if;
  if exists (select 1 from acc_statement_reconciliation
             where bank_account_id = p_bank_account_id and status = 'in_progress') then
    raise exception 'An in-progress reconciliation already exists for this bank account';
  end if;
  -- A period already signed off is not reconciled a second time (3.0.36).
  select max(statement_ending_date) into v_last
    from acc_statement_reconciliation
   where bank_account_id = p_bank_account_id and status = 'completed';
  if v_last is not null and p_ending_date <= v_last then
    raise exception 'This account is already reconciled to %. A new reconciliation is for a statement that ends after that date; to change that month, reopen its reconciliation.',
      to_char(v_last, 'Mon FMDD, YYYY');
  end if;
  -- Beginning balance = the most recent completed session's ending balance (0 if none).
  select statement_ending_balance_minor into v_begin
    from acc_statement_reconciliation
   where bank_account_id = p_bank_account_id and status = 'completed'
   order by statement_ending_date desc, completed_at desc limit 1;
  v_begin := coalesce(v_begin, 0);

  insert into acc_statement_reconciliation
    (bank_account_id, statement_ending_date, beginning_balance_minor,
     statement_ending_balance_minor, status, prepared_by)
  values (p_bank_account_id, p_ending_date, v_begin, p_ending_balance_minor, 'in_progress', auth.uid())
  returning id into v_id;

  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_statement_reconciliation', v_id, 'insert', auth.uid());
  return v_id;
end;
$$;

create or replace function acc_complete_reconciliation(p_reconciliation_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_rec acc_statement_reconciliation; v_cleared bigint; v_diff bigint; v_last date;
begin
  if not acc_is_staff() then raise exception 'Not authorized'; end if;
  if not acc_has_permission('reconciliation.complete') then
    raise exception 'You do not have permission to complete reconciliations';
  end if;
  select * into v_rec from acc_statement_reconciliation where id = p_reconciliation_id for update;
  if not found then raise exception 'Reconciliation not found'; end if;
  if v_rec.status <> 'in_progress' then raise exception 'Reconciliation is not in progress'; end if;
  -- Another reconciliation already signed off this period or a later one (3.0.36).
  select max(statement_ending_date) into v_last
    from acc_statement_reconciliation
   where bank_account_id = v_rec.bank_account_id and status = 'completed' and id <> p_reconciliation_id;
  if v_last is not null and v_rec.statement_ending_date <= v_last then
    raise exception 'This account is already reconciled to %, so this reconciliation to % is not completed. Discard it; to change that month, reopen its reconciliation.',
      to_char(v_last, 'Mon FMDD, YYYY'), to_char(v_rec.statement_ending_date, 'Mon FMDD, YYYY');
  end if;
  v_cleared := acc_recon_cleared_total(p_reconciliation_id);
  v_diff := v_rec.statement_ending_balance_minor - (v_rec.beginning_balance_minor + v_cleared);
  if v_diff <> 0 then raise exception 'Cannot complete: unexplained difference of %', v_diff; end if;

  update acc_statement_reconciliation
     set status = 'completed', completed_by = auth.uid(), completed_at = now(), updated_at = now()
   where id = p_reconciliation_id;
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_statement_reconciliation', p_reconciliation_id, 'post', auth.uid());
end;
$$;
