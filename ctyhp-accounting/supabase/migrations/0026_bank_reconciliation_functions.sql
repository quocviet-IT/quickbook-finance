-- supabase/migrations/0026_bank_reconciliation_functions.sql
-- ============================================================================
-- Bank reconciliation RPCs. Clearing posts nothing; only the optional adjustment
-- posts one balanced entry (source_type='reconciliation'). Completion recomputes
-- the difference server-side and requires zero. All staff-gated + audited.
-- ============================================================================

-- Signed base-currency amount of a bank GL line (debit-normal: deposit +, payment -).
create or replace function acc_recon_signed_base(p_line acc_journal_line) returns bigint
language sql immutable as $$
  select case when p_line.debit_minor > 0 then p_line.amount_base_minor else -p_line.amount_base_minor end;
$$;

-- Sum of signed base amounts of the lines cleared in a session.
create or replace function acc_recon_cleared_total(p_reconciliation_id uuid) returns bigint
language sql stable as $$
  select coalesce(sum(case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end), 0)::bigint
    from acc_reconciliation_line rl
    join acc_journal_line l on l.id = rl.journal_line_id
   where rl.reconciliation_id = p_reconciliation_id;
$$;

create or replace function acc_create_reconciliation(
  p_bank_account_id uuid, p_ending_date date, p_ending_balance_minor bigint
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_begin bigint; v_id uuid;
begin
  if not acc_is_staff() then raise exception 'Not authorized to start a reconciliation'; end if;
  if not exists (select 1 from acc_bank_account where id = p_bank_account_id) then
    raise exception 'Bank account not found';
  end if;
  if exists (select 1 from acc_statement_reconciliation
             where bank_account_id = p_bank_account_id and status = 'in_progress') then
    raise exception 'An in-progress reconciliation already exists for this bank account';
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

-- Toggle a journal line's cleared state within an in-progress session.
create or replace function acc_set_cleared(
  p_reconciliation_id uuid, p_journal_line_id uuid, p_cleared boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare v_rec acc_statement_reconciliation; v_gl uuid; v_line acc_journal_line; v_entry acc_journal_entry;
begin
  if not acc_is_staff() then raise exception 'Not authorized'; end if;
  select * into v_rec from acc_statement_reconciliation where id = p_reconciliation_id for update;
  if not found then raise exception 'Reconciliation not found'; end if;
  if v_rec.status <> 'in_progress' then raise exception 'Reconciliation is not in progress'; end if;

  if p_cleared then
    select account_id into v_gl from acc_bank_account where id = v_rec.bank_account_id;
    select * into v_line from acc_journal_line where id = p_journal_line_id;
    if not found then raise exception 'Journal line not found'; end if;
    if v_line.account_id <> v_gl then raise exception 'Line does not belong to this bank account'; end if;
    select * into v_entry from acc_journal_entry where id = v_line.journal_entry_id;
    if v_entry.status <> 'posted' then raise exception 'Line entry is not posted'; end if;
    if v_entry.entry_date > v_rec.statement_ending_date then
      raise exception 'Line is dated after the statement ending date';
    end if;
    -- Not already reconciled by a DIFFERENT completed session.
    if exists (
      select 1 from acc_reconciliation_line rl
      join acc_statement_reconciliation r on r.id = rl.reconciliation_id
      where rl.journal_line_id = p_journal_line_id and r.status = 'completed' and r.id <> p_reconciliation_id
    ) then
      raise exception 'Line already reconciled in a completed session';
    end if;
    insert into acc_reconciliation_line (reconciliation_id, journal_line_id)
      values (p_reconciliation_id, p_journal_line_id)
      on conflict (reconciliation_id, journal_line_id) do nothing;
  else
    delete from acc_reconciliation_line
     where reconciliation_id = p_reconciliation_id and journal_line_id = p_journal_line_id;
  end if;
end;
$$;

-- Record an adjustment for exactly the outstanding difference and auto-clear it.
create or replace function acc_record_reconciliation_adjustment(
  p_reconciliation_id uuid, p_offset_account_id uuid, p_reason text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_rec acc_statement_reconciliation; v_gl uuid; v_ccy text;
  v_cleared bigint; v_diff bigint; v_off_type acc_account_type;
  v_base bigint; v_entry uuid; v_bank_line uuid; v_lines jsonb;
begin
  if not acc_is_staff() then raise exception 'Not authorized'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'An adjustment reason is required'; end if;
  select * into v_rec from acc_statement_reconciliation where id = p_reconciliation_id for update;
  if not found then raise exception 'Reconciliation not found'; end if;
  if v_rec.status <> 'in_progress' then raise exception 'Reconciliation is not in progress'; end if;
  if v_rec.adjustment_entry_id is not null then raise exception 'An adjustment already exists'; end if;

  select account_type into v_off_type from acc_account where id = p_offset_account_id;
  if v_off_type is null then raise exception 'Offset account not found'; end if;
  if v_off_type not in ('income','other_income','expense','cost_of_goods_sold','other_expense') then
    raise exception 'Adjustment offset must be an income or expense account';
  end if;

  select account_id into v_gl from acc_bank_account where id = v_rec.bank_account_id;
  select currency_code into v_ccy from acc_account where id = v_gl;
  v_cleared := acc_recon_cleared_total(p_reconciliation_id);
  v_diff := v_rec.statement_ending_balance_minor - (v_rec.beginning_balance_minor + v_cleared);
  if v_diff = 0 then raise exception 'No difference to adjust'; end if;

  v_base := acc_to_base_minor(abs(v_diff), v_ccy, v_rec.statement_ending_date);
  -- diff>0: bank must increase -> DR bank / CR offset. diff<0: CR bank / DR offset.
  if v_diff > 0 then
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_gl, 'debit_minor', abs(v_diff), 'credit_minor', 0, 'amount_base_minor', v_base, 'memo', 'Reconciliation adjustment'),
      jsonb_build_object('account_id', p_offset_account_id, 'debit_minor', 0, 'credit_minor', abs(v_diff), 'amount_base_minor', v_base, 'memo', 'Reconciliation adjustment'));
  else
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_gl, 'debit_minor', 0, 'credit_minor', abs(v_diff), 'amount_base_minor', v_base, 'memo', 'Reconciliation adjustment'),
      jsonb_build_object('account_id', p_offset_account_id, 'debit_minor', abs(v_diff), 'credit_minor', 0, 'amount_base_minor', v_base, 'memo', 'Reconciliation adjustment'));
  end if;

  v_entry := acc_post_entry(v_rec.statement_ending_date, 'Reconciliation adjustment', 'reconciliation', p_reconciliation_id, v_ccy, v_lines);
  select id into v_bank_line from acc_journal_line where journal_entry_id = v_entry and account_id = v_gl;
  insert into acc_reconciliation_line (reconciliation_id, journal_line_id) values (p_reconciliation_id, v_bank_line);
  update acc_statement_reconciliation
     set adjustment_entry_id = v_entry, adjustment_reason = p_reason, updated_at = now()
   where id = p_reconciliation_id;

  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_statement_reconciliation', p_reconciliation_id, 'update', auth.uid());
  return v_entry;
end;
$$;

create or replace function acc_complete_reconciliation(p_reconciliation_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_rec acc_statement_reconciliation; v_cleared bigint; v_diff bigint;
begin
  if not acc_is_staff() then raise exception 'Not authorized'; end if;
  select * into v_rec from acc_statement_reconciliation where id = p_reconciliation_id for update;
  if not found then raise exception 'Reconciliation not found'; end if;
  if v_rec.status <> 'in_progress' then raise exception 'Reconciliation is not in progress'; end if;
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

create or replace function acc_reopen_reconciliation(p_reconciliation_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_rec acc_statement_reconciliation;
begin
  if not acc_is_admin() then raise exception 'Only an admin can reopen a reconciliation'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reopen reason is required'; end if;
  select * into v_rec from acc_statement_reconciliation where id = p_reconciliation_id for update;
  if not found then raise exception 'Reconciliation not found'; end if;
  if v_rec.status <> 'completed' then raise exception 'Only a completed reconciliation can be reopened'; end if;
  -- Block reopen if a later completed session exists for the account (would break the beginning-balance chain).
  if exists (
    select 1 from acc_statement_reconciliation
     where bank_account_id = v_rec.bank_account_id and status = 'completed'
       and statement_ending_date > v_rec.statement_ending_date
  ) then
    raise exception 'A later completed reconciliation exists; reopen it first';
  end if;

  update acc_statement_reconciliation
     set status = 'in_progress', reopened_by = auth.uid(), reopen_reason = p_reason, completed_by = null, completed_at = null, updated_at = now()
   where id = p_reconciliation_id;
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_statement_reconciliation', p_reconciliation_id, 'void', auth.uid());
end;
$$;

-- Read: candidate + cleared lines for a session (with signed base amount + a cleared flag).
create or replace function acc_reconciliation_lines(p_reconciliation_id uuid)
returns table (journal_line_id uuid, entry_id uuid, entry_number text, entry_date date,
               source_type acc_journal_source, memo text, signed_minor bigint, cleared boolean)
language sql stable as $$
  with rec as (select * from acc_statement_reconciliation where id = p_reconciliation_id),
       gl as (select account_id from acc_bank_account where id = (select bank_account_id from rec))
  select l.id, e.id, e.entry_number, e.entry_date, e.source_type, l.memo,
         (case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end)::bigint,
         exists (select 1 from acc_reconciliation_line rl where rl.reconciliation_id = p_reconciliation_id and rl.journal_line_id = l.id)
    from acc_journal_line l
    join acc_journal_entry e on e.id = l.journal_entry_id
   where l.account_id = (select account_id from gl)
     and e.status = 'posted'
     and e.entry_date <= (select statement_ending_date from rec)
     and not exists (
       select 1 from acc_reconciliation_line rl2
       join acc_statement_reconciliation r2 on r2.id = rl2.reconciliation_id
       where rl2.journal_line_id = l.id and r2.status = 'completed' and r2.id <> p_reconciliation_id)
   order by e.entry_date, e.entry_number;
$$;

create or replace function acc_reconciliation_detail(p_reconciliation_id uuid)
returns table (beginning_minor bigint, statement_ending_minor bigint, cleared_total_minor bigint,
               reconciled_balance_minor bigint, difference_minor bigint, status acc_reconciliation_session_status)
language sql stable as $$
  select r.beginning_balance_minor, r.statement_ending_balance_minor,
         acc_recon_cleared_total(r.id),
         (r.beginning_balance_minor + acc_recon_cleared_total(r.id))::bigint,
         (r.statement_ending_balance_minor - (r.beginning_balance_minor + acc_recon_cleared_total(r.id)))::bigint,
         r.status
    from acc_statement_reconciliation r where r.id = p_reconciliation_id;
$$;

-- Discrepancies: lines reconciled in a completed session whose entry was later voided.
create or replace function acc_reconciliation_discrepancies(p_bank_account_id uuid)
returns table (reconciliation_id uuid, journal_line_id uuid, entry_number text, entry_date date, signed_minor bigint)
language sql stable as $$
  select r.id, l.id, e.entry_number, e.entry_date,
         (case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end)::bigint
    from acc_reconciliation_line rl
    join acc_statement_reconciliation r on r.id = rl.reconciliation_id
    join acc_journal_line l on l.id = rl.journal_line_id
    join acc_journal_entry e on e.id = l.journal_entry_id
   where r.bank_account_id = p_bank_account_id and r.status = 'completed' and e.status = 'void';
$$;
