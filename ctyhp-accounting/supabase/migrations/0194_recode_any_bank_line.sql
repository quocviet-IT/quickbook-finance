-- ============================================================================
-- 0194  A line coded in Bank Transactions can be moved to another account,
--       reconciled or not (3.0.25)
--
-- Item A of the defect report of 11 Nov 2026: once a month was reconciled, a
-- transaction in it could not be moved to a different expense or income
-- account. Change voids the line's entry, and voiding an entry ticked on a
-- completed reconciliation would change a month somebody signed off, so it is
-- refused (0134, 0177). Recode moved a line only out of Uncategorized (0134).
--
-- A recode never touches the bank side. It posts a second entry, dated the
-- same day, that moves the amount from the account the line's own entry
-- posted to onto the account it belongs in. The bank line, its entry's bank
-- line and every reconciliation tick stay exactly as they were, so a
-- completed reconciliation still agrees, and nothing new lands on the bank
-- account for acc_reconciliation_changes (0150) to report.
--
-- 1. acc_recode_bank_transaction(line, account): any line Banking coded itself
--    to one account, reconciled or not. A line already recoded is recoded
--    from its own entry again: the recode it had is voided and one new recode
--    posted, so there is only ever one; recoding it to the account its own
--    entry names takes the recode back. Refused, each in its own words: a line
--    from a transactions import, a line posted by something that owns its
--    entry, a line split across accounts, a bank account, an account that is
--    not an active posting account, the account it is on already, and a
--    closed period (by acc_post_entry and the void guard, as everywhere). The
--    audit log keeps the account before and after.
-- 2. acc_bank_recodes reads the account a recode moved the money to as the
--    recode's line that is not on the line's own account. It read it as the
--    line that is not on an Uncategorized account, which only works when the
--    money came from Uncategorized. For every recode made before this, the
--    two readings are the same row.
-- 3. acc_uncategorise_bank_transaction (Change) still refuses a line of a
--    reconciled month, and now names Recode as the way to move it. Its body
--    is 0177's, copied from the file, with only those words changed.
-- ============================================================================
set search_path = public;

-- ----------------------------------------------------------------------------
-- 1. Recode a line coded in Bank Transactions.
-- ----------------------------------------------------------------------------
create or replace function acc_recode_bank_transaction(p_bank_transaction_id uuid, p_account_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_txn     acc_bank_transaction;
  v_gl      uuid;
  v_entry   acc_journal_entry;
  v_other   acc_journal_line;
  v_lines   integer;
  v_from    acc_account;
  v_target  acc_account;
  v_recode  acc_journal_entry;
  v_current uuid;
  v_new     uuid;
  v_number  text;
  v_amount  bigint;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to recode a bank transaction' using errcode = '42501';
  end if;

  select * into v_txn from acc_bank_transaction where id = p_bank_transaction_id;
  if v_txn.id is null then raise exception 'Bank transaction not found'; end if;
  -- An import's Undo voids the entries it made; a recode it knows nothing of
  -- would be left moving money off an account that no longer holds it.
  if v_txn.transaction_batch_id is not null then
    raise exception 'This line came from a transactions import, which owns its entry. Correct it with a journal entry instead.';
  end if;
  select account_id into v_gl from acc_bank_account where id = v_txn.bank_account_id;

  select e.* into v_entry
    from acc_reconciliation r
    join acc_journal_line l on l.id = r.journal_line_id
    join acc_journal_entry e on e.id = l.journal_entry_id
   where r.bank_transaction_id = p_bank_transaction_id and r.status = 'approved'
   limit 1;
  if v_entry.id is null then raise exception 'This line is not coded'; end if;
  if v_entry.source_type <> 'bank' or v_entry.source_id is not null then
    raise exception 'This line was posted by something that owns its entry (%), so it is not recoded here.', v_entry.source_type;
  end if;
  -- One change at a time: a second click, or Change or Undo recode in another
  -- tab, waits here, then finds the entry as whatever finished first left it.
  select * into v_entry from acc_journal_entry where id = v_entry.id for update;
  if v_entry.status <> 'posted' then
    raise exception 'This line''s entry was taken back meanwhile, so there is nothing to recode';
  end if;

  select count(*) into v_lines from acc_journal_line where journal_entry_id = v_entry.id;
  select * into v_other from acc_journal_line where journal_entry_id = v_entry.id and account_id <> v_gl limit 1;
  if v_lines <> 2 or v_other.id is null then
    raise exception 'This line is posted to more than one account, so it is not recoded here. Correct it with a journal entry.';
  end if;
  select * into v_from from acc_account where id = v_other.account_id;

  select * into v_target from acc_account where id = p_account_id;
  if v_target.id is null then raise exception 'Account not found'; end if;
  if v_target.status <> 'active' or not v_target.is_posting_account then
    raise exception 'Money cannot be posted to % — it is not an active posting account', v_target.name;
  end if;
  if v_target.account_type = 'bank' or v_target.id = v_gl then
    raise exception 'A bank account is not a category: record a transfer instead';
  end if;

  -- Where the money is now: on its recode's account, or on its own entry's.
  select * into v_recode
    from acc_journal_entry
   where source_type = 'bank' and source_id = v_entry.id and status = 'posted'
   for update;
  if v_recode.id is not null then
    select l.account_id into v_current
      from acc_journal_line l
     where l.journal_entry_id = v_recode.id and l.account_id <> v_from.id
     limit 1;
  end if;
  v_current := coalesce(v_current, v_from.id);
  if v_target.id = v_current then
    raise exception 'This line is already posted to %', v_target.name;
  end if;

  -- The recode it had goes: the new one is made from the line's own entry, so
  -- there is only ever one, and a closed period refuses here as it would anywhere.
  if v_recode.id is not null then
    update acc_journal_entry set status = 'void', voided_at = now() where id = v_recode.id;
  end if;

  -- Back to its own entry's account: taking the recode back is the whole change.
  if v_target.id <> v_from.id then
    v_amount := v_other.debit_minor + v_other.credit_minor;
    v_new := acc_post_entry(
      v_entry.entry_date,
      left('Recode: ' || coalesce(nullif(btrim(v_entry.description), ''), 'bank line'), 500),
      'bank', v_entry.id, v_entry.currency_code,
      case when v_other.debit_minor > 0 then
        jsonb_build_array(
          jsonb_build_object('account_id', v_target.id, 'debit_minor', v_amount, 'credit_minor', 0,
            'amount_base_minor', v_other.amount_base_minor, 'memo', v_other.memo),
          jsonb_build_object('account_id', v_from.id, 'debit_minor', 0, 'credit_minor', v_amount,
            'amount_base_minor', v_other.amount_base_minor, 'memo', v_other.memo)
        )
      else
        jsonb_build_array(
          jsonb_build_object('account_id', v_from.id, 'debit_minor', v_amount, 'credit_minor', 0,
            'amount_base_minor', v_other.amount_base_minor, 'memo', v_other.memo),
          jsonb_build_object('account_id', v_target.id, 'debit_minor', 0, 'credit_minor', v_amount,
            'amount_base_minor', v_other.amount_base_minor, 'memo', v_other.memo)
        )
      end);
    select entry_number into v_number from acc_journal_entry where id = v_new;
  end if;

  insert into acc_audit_log (table_name, record_id, action, actor_id, before_json, after_json)
  values ('acc_bank_transaction', p_bank_transaction_id, 'recode', auth.uid(),
          jsonb_build_object('account_id', v_current,
                             'account', (select account_code || ' ' || name from acc_account where id = v_current),
                             'journal_entry_id', v_entry.id,
                             'recode_entry_id', v_recode.id),
          jsonb_build_object('account_id', v_target.id,
                             'account', v_target.account_code || ' ' || v_target.name,
                             'recode_entry_id', v_new));

  return jsonb_build_object('entry_id', v_new, 'entry_number', v_number,
                            'account_code', v_target.account_code, 'account_name', v_target.name);
end;
$$;

revoke all on function acc_recode_bank_transaction(uuid, uuid) from public, anon;
grant execute on function acc_recode_bank_transaction(uuid, uuid) to authenticated, service_role;

comment on function acc_recode_bank_transaction(uuid, uuid) is
  'Move a line coded in Bank Transactions to another account by a second entry the same day. The bank side and its reconciliation stay as they are.';

-- ----------------------------------------------------------------------------
-- 2. Which coded lines have been recoded, and to what.
-- ----------------------------------------------------------------------------
create or replace function acc_bank_recodes(p_bank_account_id uuid default null)
returns table (
  bank_transaction_id uuid,
  original_entry_id   uuid,
  recode_entry_id     uuid,
  entry_number        text,
  account_id          uuid,
  account_code        text,
  account_name        text
)
language sql stable security invoker set search_path = public as $$
  select r.bank_transaction_id, e.id, re.id, re.entry_number, a.id, a.account_code, a.name
    from acc_reconciliation r
    join acc_bank_transaction t on t.id = r.bank_transaction_id
    join acc_journal_line bl on bl.id = r.journal_line_id
    join acc_journal_entry e on e.id = bl.journal_entry_id
                            and e.status = 'posted' and e.source_type = 'bank' and e.source_id is null
    -- The account the line's own entry names beside the bank.
    join acc_journal_line ol on ol.journal_entry_id = e.id and ol.id <> bl.id
    join acc_journal_entry re on re.source_type = 'bank' and re.source_id = e.id and re.status = 'posted'
    -- The recode's other line is where the money went.
    join acc_journal_line rl on rl.journal_entry_id = re.id and rl.account_id <> ol.account_id
    join acc_account a on a.id = rl.account_id
   where r.status = 'approved'
     and (p_bank_account_id is null or t.bank_account_id = p_bank_account_id)
   order by r.bank_transaction_id;
$$;

revoke all on function acc_bank_recodes(uuid) from public, anon;
grant execute on function acc_bank_recodes(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. Change on a line of a reconciled month names Recode (0177's body).
-- ----------------------------------------------------------------------------
create or replace function acc_uncategorise_bank_transaction(
  p_transaction_id uuid,
  p_reason text default null
) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_txn     acc_bank_transaction;
  v_entry   uuid;
  v_source  acc_journal_source;
  v_ref     uuid;
  v_voided  int;
  v_signed  date;
  v_holding boolean;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to change a bank transaction';
  end if;

  select * into v_txn from acc_bank_transaction where id = p_transaction_id;
  if v_txn.id is null then raise exception 'Bank transaction not found'; end if;
  if v_txn.transaction_batch_id is not null then
    raise exception
      'This line came from a transactions import. Undo that import instead — it owns the entry.';
  end if;

  -- The approved match is the one the line was posted with; a turned-down
  -- one points at an entry that belongs to something else.
  select e.id, e.source_type, e.source_id into v_entry, v_source, v_ref
    from acc_reconciliation r
    join acc_journal_line l on l.id = r.journal_line_id
    join acc_journal_entry e on e.id = l.journal_entry_id
   where r.bank_transaction_id = p_transaction_id
     and r.status = 'approved'
   limit 1;
  if v_entry is null then
    raise exception 'This line is not categorised';
  end if;
  if v_source <> 'bank' or v_ref is not null then
    raise exception
      'This line was matched by something that owns its entry (%), not by categorising it.',
      v_source;
  end if;
  -- Locked as a recode locks it, so the two never cross: one waits for the
  -- other, and the recode then finds the entry voided, or this finds its recode.
  perform 1 from acc_journal_entry where id = v_entry for update;

  -- A line ticked in a completed reconciliation belongs to a month somebody
  -- signed off. Voiding it would change that month without a word.
  select sr.statement_ending_date into v_signed
    from acc_reconciliation_line rl
    join acc_statement_reconciliation sr on sr.id = rl.reconciliation_id and sr.status = 'completed'
    join acc_journal_line l on l.id = rl.journal_line_id
   where l.journal_entry_id = v_entry
   order by sr.statement_ending_date
   limit 1;
  if v_signed is not null then
    select exists (
      select 1 from acc_journal_line l join acc_account a on a.id = l.account_id
       where l.journal_entry_id = v_entry
         and coalesce(a.detail_type, '') in ('uncategorized_income', 'uncategorized_expense')
    ) into v_holding;
    if exists (select 1 from acc_journal_entry where source_type = 'bank' and source_id = v_entry and status = 'posted') then
      raise exception 'This line is reconciled to %, so its entry is not voided: its date, amount and bank account stay as reconciled. To move it to another account, use Recode, which posts the change beside it.',
        to_char(v_signed, 'Mon FMDD, YYYY');
    end if;
    if v_holding then
      raise exception 'This line is reconciled to %, so its entry is not voided: its date, amount and bank account stay as reconciled. To move it to another account, use Recode, which posts the change beside it.',
        to_char(v_signed, 'Mon FMDD, YYYY');
    end if;
    raise exception 'This line is reconciled to %, so its entry is not voided: its date, amount and bank account stay as reconciled. To move it to another account, use Recode, which posts the change beside it.',
      to_char(v_signed, 'Mon FMDD, YYYY');
  end if;

  update acc_journal_entry set status = 'void', voided_at = now()
   where id = v_entry and status = 'posted';
  get diagnostics v_voided = row_count;
  -- Its recode, if it has one, goes with it: left alone it would move money
  -- off an Uncategorized account that no longer holds any.
  update acc_journal_entry set status = 'void', voided_at = now()
   where source_type = 'bank' and source_id = v_entry and status = 'posted';

  -- Every line this entry answered for goes back to waiting: a transfer is one
  -- entry reconciled to two bank lines, and taking it back releases both.
  with released as (
    delete from acc_reconciliation r
     using acc_journal_line l
     where r.journal_line_id = l.id and l.journal_entry_id = v_entry
    returning r.bank_transaction_id
  )
  update acc_bank_transaction set status = 'unmatched'
   where id in (select bank_transaction_id from released) or id = p_transaction_id;
  delete from acc_reconciliation where bank_transaction_id = p_transaction_id;

  insert into acc_audit_log (table_name, record_id, action, actor_id, before_json)
  values ('acc_bank_transaction', p_transaction_id, 'uncategorise', auth.uid(),
          jsonb_build_object('journal_entry_id', v_entry,
                             'reason', nullif(btrim(coalesce(p_reason, '')), '')));

  return v_voided;
end;
$$;

revoke all on function acc_uncategorise_bank_transaction(uuid, text) from public, anon;
grant execute on function acc_uncategorise_bank_transaction(uuid, text)
  to authenticated, service_role;
