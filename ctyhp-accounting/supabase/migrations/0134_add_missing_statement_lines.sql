-- ============================================================================
-- 1.82 — the statement lines the books do not have, added in one click.
--
-- A month that does not agree because the bank shows a fee, interest or a
-- deposit nobody recorded used to send the person to Bank Transactions to code
-- each line. Now the reconciliation adds them all: each through the same
-- function that codes one line there, coded by its suggestion, or — when no
-- rule, history or register places it — to an Uncategorized account, to be
-- recoded later.
--
-- Recoding never touches the bank line. It posts a second entry that moves the
-- amount from Uncategorized to the account it belongs in, so a month already
-- signed off stays exactly as it was signed. The recode entry is a `bank` entry
-- whose source_id is the entry it recodes: every check that means "an entry
-- Bank Transactions coded" asks for source_id is null, so the two never mix.
--
-- And taking a coded line back (Change in Bank Transactions) now refuses a line
-- ticked in a completed reconciliation: voiding it would silently change a
-- month somebody signed off.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Two holding accounts in every chart, known by their detail type.
--
--    A chart that already has one keeps it. One already named "Uncategorized
--    Income" or "Uncategorized Expense" is given the detail type rather than a
--    twin. Otherwise the account is made at 4999 / 6999, or at the highest free
--    code below it.
-- ----------------------------------------------------------------------------
do $$
declare
  v_spec record;
  v_id   uuid;
  v_code text;
  v_try  int;
begin
  for v_spec in
    select * from (values
      ('uncategorized_income',  'income'::acc_account_type,  'Uncategorized Income',  4999, 4950),
      ('uncategorized_expense', 'expense'::acc_account_type, 'Uncategorized Expense', 6999, 6950)
    ) as s(detail, kind, label, top_code, bottom_code)
  loop
    if exists (select 1 from acc_account where detail_type = v_spec.detail and status = 'active') then
      continue;
    end if;

    select id into v_id
      from acc_account
     where account_type = v_spec.kind
       and status = 'active'
       and is_posting_account
       and lower(btrim(name)) = lower(v_spec.label)
     order by account_code
     limit 1;
    if v_id is not null then
      update acc_account set detail_type = v_spec.detail, updated_at = now() where id = v_id;
      continue;
    end if;

    v_code := null;
    for v_try in reverse v_spec.top_code .. v_spec.bottom_code loop
      if not exists (select 1 from acc_account where account_code = v_try::text) then
        v_code := v_try::text;
        exit;
      end if;
    end loop;
    if v_code is null then
      raise exception 'No free account code from % down to % for %', v_spec.top_code, v_spec.bottom_code, v_spec.label;
    end if;

    insert into acc_account (account_code, name, account_type, currency_code, is_posting_account, detail_type, cash_flow_role)
    values (v_code, v_spec.label, v_spec.kind, 'USD', true, v_spec.detail, 'operating');
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 2. Add the statement lines the books do not have: every one or none.
--
--    p_items: [{ "line_no": int, "bank_transaction_id": uuid, "account_id": uuid }]
--    Each statement line is paired with the bank line it was imported as, and
--    must agree with it on date and amount. Each is then coded by
--    acc_categorise_bank_transaction — the entry, the closed-period guard and
--    the bank match coding one line makes. One failure undoes them all, and
--    the message names the line.
-- ----------------------------------------------------------------------------
create or replace function acc_add_statement_lines_to_books(p_reconciliation_id uuid, p_items jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_rec    acc_statement_reconciliation;
  v_item   jsonb;
  v_line   acc_reconciliation_statement_line;
  v_txn    acc_bank_transaction;
  v_posted jsonb;
  v_out    jsonb := '[]'::jsonb;
  v_count  int;
  v_what   text;
  v_signed_through date;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to add statement lines to the books';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'There is nothing to add';
  end if;
  v_count := jsonb_array_length(p_items);
  if v_count > 500 then
    raise exception 'At most 500 lines can be added at a time';
  end if;

  select * into v_rec from acc_statement_reconciliation where id = p_reconciliation_id for update;
  if not found then raise exception 'Reconciliation not found'; end if;
  if v_rec.status <> 'in_progress' then
    raise exception 'This reconciliation is not in progress';
  end if;
  -- The newest month this account has signed off before this one: a line dated
  -- in it would change that month's books, so it is not added from here.
  select max(statement_ending_date) into v_signed_through
    from acc_statement_reconciliation
   where bank_account_id = v_rec.bank_account_id and status = 'completed'
     and statement_ending_date < v_rec.statement_ending_date;

  if exists (
    select 1 from jsonb_array_elements(p_items) x
     where x->>'line_no' is null or x->>'bank_transaction_id' is null or x->>'account_id' is null
  ) then
    raise exception 'Each line to add needs its line_no, bank_transaction_id and account_id';
  end if;
  if (select count(distinct x->>'line_no') from jsonb_array_elements(p_items) x) <> v_count
     or (select count(distinct x->>'bank_transaction_id') from jsonb_array_elements(p_items) x) <> v_count then
    raise exception 'A statement line or a bank line is listed twice';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_line
      from acc_reconciliation_statement_line
     where reconciliation_id = p_reconciliation_id and line_no = (v_item->>'line_no')::int;
    if not found then
      raise exception 'Statement line % is not part of this reconciliation', v_item->>'line_no';
    end if;
    v_what := format('%s %s %s', to_char(v_line.txn_date, 'Mon FMDD, YYYY'),
                     coalesce(nullif(btrim(v_line.description), ''), '(no description)'),
                     to_char(v_line.amount_minor::numeric / 100, 'FM999999999990.00'));
    if v_line.txn_date > v_rec.statement_ending_date then
      raise exception 'The line % is dated after the statement', v_what;
    end if;
    if v_signed_through is not null and v_line.txn_date <= v_signed_through then
      raise exception 'The line % is dated in a month already reconciled, to %', v_what,
        to_char(v_signed_through, 'Mon FMDD, YYYY');
    end if;

    select * into v_txn from acc_bank_transaction where id = (v_item->>'bank_transaction_id')::uuid for update;
    if not found or v_txn.bank_account_id <> v_rec.bank_account_id then
      raise exception 'The line % is not among this bank account''s transactions', v_what;
    end if;
    if v_txn.txn_date <> v_line.txn_date or v_txn.amount_minor <> v_line.amount_minor then
      raise exception 'The line % does not agree with its bank transaction', v_what;
    end if;

    begin
      v_posted := acc_categorise_bank_transaction(v_txn.id, (v_item->>'account_id')::uuid);
    exception when others then
      raise exception 'The line % could not be added: %', v_what, sqlerrm;
    end;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'line_no', v_line.line_no, 'entry_id', v_posted->'entry_id', 'entry_number', v_posted->'entry_number'));
  end loop;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values ('acc_statement_reconciliation', p_reconciliation_id, 'add_statement_lines', auth.uid(),
          jsonb_build_object('lines', v_count));
  return v_out;
end;
$$;

revoke all on function acc_add_statement_lines_to_books(uuid, jsonb) from public, anon;
grant execute on function acc_add_statement_lines_to_books(uuid, jsonb) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. Recode a line from Uncategorized, and take a recode back.
--
--    The bank line's entry stays as it is. A second entry, dated the same day,
--    moves the amount off the Uncategorized account onto the one chosen:
--    money out — Dr the account, Cr Uncategorized Expense; money in — Dr
--    Uncategorized Income, Cr the account.
-- ----------------------------------------------------------------------------
create or replace function acc_recode_uncategorized(p_bank_transaction_id uuid, p_account_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_txn    acc_bank_transaction;
  v_gl     uuid;
  v_entry  acc_journal_entry;
  v_other  acc_journal_line;
  v_hold   acc_account;
  v_target acc_account;
  v_lines  int;
  v_amount bigint;
  v_recode uuid;
  v_number text;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to recode a bank transaction';
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
  if v_entry.status <> 'posted' or v_entry.source_type <> 'bank' or v_entry.source_id is not null then
    raise exception 'Only a line coded in Bank Transactions can be recoded';
  end if;
  -- One recode at a time, and never against an entry taken back meanwhile: a
  -- second click, or Change in another tab, waits here — then the entry is
  -- read again, as whatever finished first left it.
  select * into v_entry from acc_journal_entry where id = v_entry.id for update;
  if v_entry.status <> 'posted' then
    raise exception 'This line''s entry was taken back meanwhile, so there is nothing to recode';
  end if;

  select count(*) into v_lines from acc_journal_line where journal_entry_id = v_entry.id;
  select * into v_other from acc_journal_line where journal_entry_id = v_entry.id and account_id <> v_gl limit 1;
  select * into v_hold from acc_account where id = v_other.account_id;
  if v_lines <> 2 or v_hold.id is null
     or coalesce(v_hold.detail_type, '') not in ('uncategorized_income', 'uncategorized_expense') then
    raise exception 'This line is coded to %, not to Uncategorized', coalesce(v_hold.name, 'more than one account');
  end if;
  if exists (select 1 from acc_journal_entry where source_type = 'bank' and source_id = v_entry.id and status = 'posted') then
    raise exception 'This line is already recoded';
  end if;

  select * into v_target from acc_account where id = p_account_id;
  if v_target.id is null then raise exception 'Account not found'; end if;
  if v_target.status <> 'active' or not v_target.is_posting_account then
    raise exception 'Money cannot be posted to % — it is not an active posting account', v_target.name;
  end if;
  if coalesce(v_target.detail_type, '') in ('uncategorized_income', 'uncategorized_expense') then
    raise exception 'Choose the account the line belongs in, not an Uncategorized one';
  end if;
  if v_target.account_type = 'bank' then
    raise exception 'A bank account is not a category: record a transfer instead';
  end if;

  v_amount := v_other.debit_minor + v_other.credit_minor;
  v_recode := acc_post_entry(
    v_entry.entry_date,
    left('Recode: ' || coalesce(nullif(btrim(v_entry.description), ''), 'bank line'), 500),
    'bank', v_entry.id, v_entry.currency_code,
    case when v_other.debit_minor > 0 then
      jsonb_build_array(
        jsonb_build_object('account_id', v_target.id, 'debit_minor', v_amount, 'credit_minor', 0,
          'amount_base_minor', v_other.amount_base_minor, 'memo', v_other.memo),
        jsonb_build_object('account_id', v_hold.id, 'debit_minor', 0, 'credit_minor', v_amount,
          'amount_base_minor', v_other.amount_base_minor, 'memo', v_other.memo)
      )
    else
      jsonb_build_array(
        jsonb_build_object('account_id', v_hold.id, 'debit_minor', v_amount, 'credit_minor', 0,
          'amount_base_minor', v_other.amount_base_minor, 'memo', v_other.memo),
        jsonb_build_object('account_id', v_target.id, 'debit_minor', 0, 'credit_minor', v_amount,
          'amount_base_minor', v_other.amount_base_minor, 'memo', v_other.memo)
      )
    end);

  insert into acc_audit_log (table_name, record_id, action, actor_id, before_json, after_json)
  values ('acc_bank_transaction', p_bank_transaction_id, 'recode', auth.uid(),
          jsonb_build_object('journal_entry_id', v_entry.id, 'account_id', v_hold.id),
          jsonb_build_object('journal_entry_id', v_recode, 'account_id', v_target.id));

  select entry_number into v_number from acc_journal_entry where id = v_recode;
  return jsonb_build_object('entry_id', v_recode, 'entry_number', v_number,
                            'account_code', v_target.account_code, 'account_name', v_target.name);
end;
$$;

create or replace function acc_undo_recode(p_bank_transaction_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_entry  uuid;
  v_recode acc_journal_entry;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to change a bank transaction';
  end if;

  select e.id into v_entry
    from acc_reconciliation r
    join acc_journal_line l on l.id = r.journal_line_id
    join acc_journal_entry e on e.id = l.journal_entry_id
   where r.bank_transaction_id = p_bank_transaction_id and r.status = 'approved'
   limit 1;
  select * into v_recode
    from acc_journal_entry
   where v_entry is not null and source_type = 'bank' and source_id = v_entry and status = 'posted'
   for update;
  if v_recode.id is null then raise exception 'This line has no recode to take back'; end if;

  update acc_journal_entry set status = 'void', voided_at = now() where id = v_recode.id;

  insert into acc_audit_log (table_name, record_id, action, actor_id, before_json)
  values ('acc_bank_transaction', p_bank_transaction_id, 'undo_recode', auth.uid(),
          jsonb_build_object('journal_entry_id', v_recode.id));
  return jsonb_build_object('entry_id', v_recode.id, 'entry_number', v_recode.entry_number);
end;
$$;

revoke all on function acc_recode_uncategorized(uuid, uuid) from public, anon;
grant execute on function acc_recode_uncategorized(uuid, uuid) to authenticated, service_role;
revoke all on function acc_undo_recode(uuid) from public, anon;
grant execute on function acc_undo_recode(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. Which coded lines have been recoded, and to what — for Bank Transactions.
--    Security invoker: what a reader may see is what the ledger's own policies
--    let them read.
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
    join acc_journal_entry re on re.source_type = 'bank' and re.source_id = e.id and re.status = 'posted'
    join acc_journal_line rl on rl.journal_entry_id = re.id
    join acc_account a on a.id = rl.account_id
                      and coalesce(a.detail_type, '') not in ('uncategorized_income', 'uncategorized_expense')
   where r.status = 'approved'
     and (p_bank_account_id is null or t.bank_account_id = p_bank_account_id)
   order by r.bank_transaction_id;
$$;

revoke all on function acc_bank_recodes(uuid) from public, anon;
grant execute on function acc_bank_recodes(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. Taking a coded line back refuses a line in a signed-off month, and takes
--    its recode with it. Otherwise as 0127 left it.
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

  select e.id, e.source_type, e.source_id into v_entry, v_source, v_ref
    from acc_reconciliation r
    join acc_journal_line l on l.id = r.journal_line_id
    join acc_journal_entry e on e.id = l.journal_entry_id
   where r.bank_transaction_id = p_transaction_id
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
      raise exception 'This line is reconciled to %. To move it to another account, Undo recode and recode it again — or reopen that reconciliation.',
        to_char(v_signed, 'Mon FMDD, YYYY');
    end if;
    if v_holding then
      raise exception 'This line is reconciled to %. Recode it instead, or reopen that reconciliation.',
        to_char(v_signed, 'Mon FMDD, YYYY');
    end if;
    raise exception 'This line is reconciled to %. Reopen that reconciliation to change it.',
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
grant execute on function acc_uncategorise_bank_transaction(uuid, text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. Coding history learns through recodes. A line still sitting in
--    Uncategorized teaches nothing; a recoded one teaches the account it was
--    recoded to — so a fee moved to Bank Charges once is suggested there next
--    month. Otherwise as 0126 left it.
-- ----------------------------------------------------------------------------
create or replace function acc_coding_history()
returns table (
  entry_id          uuid,
  entry_date        date,
  direction         text,
  account_id        uuid,
  entry_description text,
  other_memo        text,
  bank_description  text
)
language sql stable set search_path = public as $$
  with lines as (
    select l.id, l.journal_entry_id, l.account_id, l.memo,
           l.debit_minor - l.credit_minor as net,
           a.account_type = 'bank' as is_bank,
           coalesce(a.detail_type, '') in ('uncategorized_income', 'uncategorized_expense') as is_holding
      from acc_journal_line l
      join acc_journal_entry e on e.id = l.journal_entry_id and e.status = 'posted'
      join acc_account a on a.id = l.account_id
  ),
  shaped as (
    select journal_entry_id
      from lines
     group by journal_entry_id
    having count(*) filter (where is_bank) = 1
       and count(*) filter (where not is_bank) = 1
  )
  select e.id,
         e.entry_date,
         case when b.net >= 0 then 'in' else 'out' end,
         coalesce(rc.account_id, o.account_id),
         e.description,
         o.memo,
         (select t.description
            from acc_reconciliation r
            join acc_bank_transaction t on t.id = r.bank_transaction_id
           where r.journal_line_id = b.id and r.status = 'approved'
           limit 1)
    from shaped s
    join acc_journal_entry e on e.id = s.journal_entry_id
    join lines b on b.journal_entry_id = s.journal_entry_id and b.is_bank
    join lines o on o.journal_entry_id = s.journal_entry_id and not o.is_bank
    left join lateral (
      select rl.account_id
        from acc_journal_entry re
        join acc_journal_line rl on rl.journal_entry_id = re.id and rl.account_id <> o.account_id
       where re.source_type = 'bank' and re.source_id = e.id and re.status = 'posted'
       limit 1
    ) rc on o.is_holding
   where not o.is_holding or rc.account_id is not null
   order by e.id;
$$;

revoke all on function acc_coding_history() from public, anon;
grant execute on function acc_coding_history() to authenticated, service_role;
