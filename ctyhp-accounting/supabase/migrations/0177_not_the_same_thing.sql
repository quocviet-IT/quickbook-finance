-- ============================================================================
-- 0177  "Not the same thing, add it" on Review import (2.79)
--
-- Review import proposes "Already in the books" for a line whose amount the
-- matcher found already posted to the bank account. When the bookkeeper knows
-- better (two payments of the same amount, a week apart), the line has to go
-- in as a new entry instead. Choosing an account for it was refused: the
-- matcher's suggestion is a row in acc_reconciliation, and categorising
-- refused any line with such a row, whatever it said.
--
-- 1. acc_categorise_bank_transaction no longer counts a match a person turned
--    down. A rejected row is the matcher's opinion, refused; it stays as the
--    record of that decision, and it matches nothing. A suggested
--    match still blocks: posting over it would leave two answers for one line.
--    The body is otherwise the one 0111 installed, as it runs in every company.
--
-- 2. acc_categorise_instead_of_match turns down every match still on offer for
--    the line, through acc_decide_bank_match (its permission and its audit
--    entry each), then categorises the line, in one transaction: either the
--    match is turned down and the entry posted, or nothing changes. It takes
--    the match the person was shown, and refuses if that one was decided in the
--    meantime, so a page left open cannot turn down a match nobody saw.
--
-- 3. acc_uncategorise_bank_transaction finds the entry to void through the
--    approved match only. With 1., a line can carry a turned-down match beside
--    the entry it was posted with; reading the first match of any status could
--    void the entry the matcher had pointed at, which belongs to another line.
--    Otherwise the body is the one 0134 installed, as it runs in every company.
-- ============================================================================
set search_path = public;

-- ----------------------------------------------------------------------------
-- 1. Post one bank line to the account it belongs in.
-- ----------------------------------------------------------------------------
create or replace function acc_categorise_bank_transaction(
  p_transaction_id uuid,
  p_account_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_txn      acc_bank_transaction;
  v_bank     uuid;
  v_account  acc_account;
  v_currency text;
  v_abs      bigint;
  v_base     bigint;
  v_entry    uuid;
  v_line     uuid;
  v_number   text;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to categorise a bank transaction';
  end if;

  select * into v_txn from acc_bank_transaction where id = p_transaction_id;
  if v_txn.id is null then
    raise exception 'Bank transaction not found';
  end if;
  if v_txn.status <> 'unmatched' then
    raise exception
      'This line is already %. Only a line still awaiting review can be categorised.',
      v_txn.status;
  end if;
  -- A match a person turned down matches nothing.
  if exists (select 1 from acc_reconciliation
              where bank_transaction_id = p_transaction_id and status <> 'rejected') then
    raise exception 'This line is already matched to the ledger';
  end if;
  if coalesce(v_txn.amount_minor, 0) = 0 then
    raise exception 'A transaction of zero cannot be posted';
  end if;

  select account_id into v_bank from acc_bank_account where id = v_txn.bank_account_id;
  if v_bank is null then
    raise exception 'This line has no ledger account behind its bank account';
  end if;

  select * into v_account from acc_account where id = p_account_id;
  if v_account.id is null then
    raise exception 'Account not found';
  end if;
  if v_account.status <> 'active' or not v_account.is_posting_account then
    raise exception 'Money cannot be posted to % — it is % and %', v_account.name,
      v_account.status, case when v_account.is_posting_account then 'a posting account'
                             else 'a heading, not a posting account' end;
  end if;
  -- The bank on both sides is not a categorisation, it is a no-op that would
  -- read as one: two lines cancelling on the same account, and a line marked
  -- matched against nothing that explains it.
  if v_account.id = v_bank then
    raise exception 'A line cannot be categorised to the bank account it already sits in';
  end if;

  select code into v_currency from acc_currency where is_base limit 1;
  if v_currency is null then raise exception 'No base currency is configured'; end if;

  v_abs  := abs(v_txn.amount_minor);
  v_base := acc_to_base_minor(v_abs, v_currency, v_txn.txn_date);

  v_entry := acc_post_entry(
    v_txn.txn_date,
    case when btrim(coalesce(v_txn.description, '')) = ''
         then 'Categorised bank transaction'
         else btrim(v_txn.description) end,
    'bank', null, v_currency,
    case when v_txn.amount_minor > 0 then
      jsonb_build_array(
        jsonb_build_object('account_id', v_bank, 'debit_minor', v_abs, 'credit_minor', 0,
          'amount_base_minor', v_base, 'memo', v_txn.description),
        jsonb_build_object('account_id', p_account_id, 'debit_minor', 0, 'credit_minor', v_abs,
          'amount_base_minor', v_base, 'memo', v_txn.description)
      )
    else
      jsonb_build_array(
        jsonb_build_object('account_id', p_account_id, 'debit_minor', v_abs, 'credit_minor', 0,
          'amount_base_minor', v_base, 'memo', v_txn.description),
        jsonb_build_object('account_id', v_bank, 'debit_minor', 0, 'credit_minor', v_abs,
          'amount_base_minor', v_base, 'memo', v_txn.description)
      )
    end);

  -- The reconciliation points at the *bank* side, which is what ties the line
  -- in the register to the entry in the ledger.
  select id into v_line from acc_journal_line
   where journal_entry_id = v_entry and account_id = v_bank limit 1;
  insert into acc_reconciliation (bank_transaction_id, journal_line_id, status, confidence)
  values (p_transaction_id, v_line, 'approved', 1.000);

  update acc_bank_transaction set status = 'matched' where id = p_transaction_id;

  select entry_number into v_number from acc_journal_entry where id = v_entry;
  return jsonb_build_object('entry_id', v_entry, 'entry_number', v_number,
                            'account_code', v_account.account_code, 'account_name', v_account.name);
end;
$$;

revoke all on function acc_categorise_bank_transaction(uuid, uuid) from public, anon;
grant execute on function acc_categorise_bank_transaction(uuid, uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. Not the same thing: turn the match down and post the line as a new entry.
-- ----------------------------------------------------------------------------
create or replace function acc_categorise_instead_of_match(
  p_transaction_id uuid,
  p_reconciliation_id uuid,
  p_account_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_rec   acc_reconciliation;
  v_offer uuid;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to categorise a bank transaction';
  end if;

  select * into v_rec from acc_reconciliation where id = p_reconciliation_id for update;
  if v_rec.id is null or v_rec.bank_transaction_id is distinct from p_transaction_id then
    raise exception 'That ledger match is not on this line';
  end if;
  if v_rec.status <> 'suggested' then
    raise exception 'That ledger match was already decided, so nothing was posted. Reload the page to see the line as it stands.';
  end if;

  -- Every match still on offer goes, not only the one shown: the line is new
  -- money, so none of them is it, and one left suggested would block the post.
  for v_offer in
    select id from acc_reconciliation
     where bank_transaction_id = p_transaction_id and status = 'suggested'
     order by id
  loop
    perform acc_decide_bank_match(v_offer, 'rejected');
  end loop;

  return acc_categorise_bank_transaction(p_transaction_id, p_account_id);
end;
$$;

revoke all on function acc_categorise_instead_of_match(uuid, uuid, uuid) from public, anon;
grant execute on function acc_categorise_instead_of_match(uuid, uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Take a categorised line back: through its approved match only.
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
grant execute on function acc_uncategorise_bank_transaction(uuid, text)
  to authenticated, service_role;
