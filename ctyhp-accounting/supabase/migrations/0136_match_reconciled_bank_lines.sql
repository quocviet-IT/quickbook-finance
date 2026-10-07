-- ============================================================================
-- 1.85 — a bank line reconciled from a statement is matched in Bank
-- Transactions.
--
-- Importing a statement into a reconciliation puts its lines in Bank
-- Transactions as "For review", suggests a book line for each, and ticks the
-- book line each statement line pairs with. Nothing approved the bank match, so
-- after the month was signed off its bank lines still waited for review.
--
-- Now, once a reconciliation is completed, the app works out which bank line
-- each paired statement line was imported as and hands the pairs here. A pair
-- the person signed off outranks a suggestion guessed from amount and date, so
-- the bank line's other suggestions are rejected. A match already approved is
-- never changed: a bank line matched or ignored, or a book line matched to
-- another bank line, is left as it is and counted, so the screen can say so.
-- Running it again matches only what is still unmatched.
-- ============================================================================

create or replace function acc_match_reconciled_bank_lines(p_reconciliation_id uuid, p_pairs jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_rec       acc_statement_reconciliation;
  v_pair      jsonb;
  v_txn       acc_bank_transaction;
  v_line_id   uuid;
  v_signed    bigint;
  v_match_id  uuid;
  v_count     int;
  v_matched   int := 0;
  v_already   int := 0;
  v_elsewhere int := 0;
  v_ignored   int := 0;
  v_differs   int := 0;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to match bank lines';
  end if;
  if p_pairs is null or jsonb_typeof(p_pairs) <> 'array' then
    raise exception 'The pairs to match must be a list';
  end if;
  v_count := jsonb_array_length(p_pairs);
  if v_count > 5000 then
    raise exception 'At most 5,000 bank lines can be matched at a time';
  end if;

  select * into v_rec from acc_statement_reconciliation where id = p_reconciliation_id for share;
  if not found then raise exception 'Reconciliation not found'; end if;
  if v_rec.status <> 'completed' then
    raise exception 'Bank lines are matched only once the reconciliation is completed';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_pairs) x
     where x->>'bank_transaction_id' is null or x->>'journal_line_id' is null
  ) then
    raise exception 'Each pair needs its bank_transaction_id and journal_line_id';
  end if;
  if (select count(distinct x->>'bank_transaction_id') from jsonb_array_elements(p_pairs) x) <> v_count
     or (select count(distinct x->>'journal_line_id') from jsonb_array_elements(p_pairs) x) <> v_count then
    raise exception 'A bank line or a book line is listed twice';
  end if;

  for v_pair in select * from jsonb_array_elements(p_pairs) loop
    v_line_id := (v_pair->>'journal_line_id')::uuid;
    if not exists (
      select 1 from acc_reconciliation_line
       where reconciliation_id = p_reconciliation_id and journal_line_id = v_line_id
    ) then
      raise exception 'Book line % is not ticked in this reconciliation', v_line_id;
    end if;

    select * into v_txn from acc_bank_transaction where id = (v_pair->>'bank_transaction_id')::uuid for update;
    if not found or v_txn.bank_account_id <> v_rec.bank_account_id then
      raise exception 'Bank line % is not among this bank account''s transactions', v_pair->>'bank_transaction_id';
    end if;

    if exists (
      select 1 from acc_reconciliation
       where bank_transaction_id = v_txn.id and journal_line_id = v_line_id and status = 'approved'
    ) then
      v_already := v_already + 1;
      continue;
    end if;
    if v_txn.status = 'ignored' then
      v_ignored := v_ignored + 1;
      continue;
    end if;
    if v_txn.status <> 'unmatched' or exists (
      select 1 from acc_reconciliation
       where journal_line_id = v_line_id and status = 'approved' and bank_transaction_id <> v_txn.id
    ) then
      v_elsewhere := v_elsewhere + 1;
      continue;
    end if;
    select (case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end)::bigint
      into v_signed
      from acc_journal_line l
      join acc_journal_entry e on e.id = l.journal_entry_id
     where l.id = v_line_id and e.status = 'posted';
    if not found then
      raise exception 'Book line % is not part of a posted entry', v_line_id;
    end if;
    if v_signed <> v_txn.amount_minor then
      v_differs := v_differs + 1;
      continue;
    end if;

    update acc_reconciliation
       set status = 'rejected', updated_at = now()
     where bank_transaction_id = v_txn.id
       and status = 'suggested'
       and journal_line_id is distinct from v_line_id;
    insert into acc_reconciliation (bank_transaction_id, journal_line_id, rule_applied, confidence, status, approved_by)
    values (v_txn.id, v_line_id, 'statement_reconciliation', 1, 'approved', auth.uid())
    on conflict (bank_transaction_id, journal_line_id) where journal_line_id is not null
    do update set status = 'approved', approved_by = auth.uid(), confidence = 1,
                  rule_applied = 'statement_reconciliation', updated_at = now()
    returning id into v_match_id;
    update acc_bank_transaction set status = 'matched', updated_at = now() where id = v_txn.id;

    insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
    values ('acc_reconciliation', v_match_id, 'match_from_reconciliation', auth.uid(),
            jsonb_build_object('status', 'approved',
                               'bank_transaction_id', v_txn.id,
                               'journal_line_id', v_line_id,
                               'statement_reconciliation_id', p_reconciliation_id));
    v_matched := v_matched + 1;
  end loop;

  return jsonb_build_object('matched', v_matched, 'already', v_already,
                            'elsewhere', v_elsewhere, 'ignored', v_ignored, 'differs', v_differs);
end;
$$;

revoke all on function acc_match_reconciled_bank_lines(uuid, jsonb) from public, anon;
grant execute on function acc_match_reconciled_bank_lines(uuid, jsonb) to authenticated, service_role;
