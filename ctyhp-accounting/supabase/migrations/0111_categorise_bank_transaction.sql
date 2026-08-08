-- ============================================================================
-- Categorising a bank line means posting it.
--
-- The Category column on Banking held a free-form label: a word somebody had to
-- invent first, saved beside the line and posted nowhere. Nobody ever invented
-- one — every company had zero — so the control was an empty dropdown, and the
-- reader's complaint was exact: "I can't categorize a transaction".
--
-- What they meant by categorising is what the word means everywhere else in
-- bookkeeping: say which account the other side of this money belongs to, and
-- have the books say it too. That is this.
--
-- One line in, one entry out: the bank's own ledger account on one side, the
-- account chosen on the other, signed by the amount. The line becomes matched
-- and carries a reconciliation to the entry, so the bank register and the
-- ledger agree — the same shape `acc_import_transactions` posts, because it is
-- the same act done one row at a time.
--
-- Undoing it voids the entry rather than deleting it. A posted entry that
-- disappears is a hole; one marked void drops out of every report and stays
-- readable to anyone asking what happened.
-- ============================================================================

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
  if exists (select 1 from acc_reconciliation where bank_transaction_id = p_transaction_id) then
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
-- 2. Take it back.
--
--    Only an entry this function could have made. A line matched by settling an
--    invoice carries a payment behind it, and a line brought in by the
--    transactions import belongs to a batch with its own Undo — reversing
--    either from here would leave the thing that owns it pointing at nothing.
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

  update acc_journal_entry set status = 'void', voided_at = now()
   where id = v_entry and status = 'posted';
  get diagnostics v_voided = row_count;

  delete from acc_reconciliation where bank_transaction_id = p_transaction_id;
  update acc_bank_transaction set status = 'unmatched' where id = p_transaction_id;

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

-- ----------------------------------------------------------------------------
-- 3. What a matched line was posted to, for the screen to show instead of
--    asking a question the books have already answered.
--
--    The account reported is the one that is *not* the bank: the bank side is
--    the line itself, and repeating it would say nothing.
--
--    Only approved matches, and only those that point at a journal line. A line
--    settled against an invoice points at a payment instead — it is posted, but
--    not by this column and not to one account, so it has nothing to report
--    here and the screen says "matched elsewhere" rather than inventing one.
-- ----------------------------------------------------------------------------
create or replace function acc_bank_transaction_postings(p_bank_account_id uuid default null)
returns table (
  bank_transaction_id uuid,
  journal_entry_id uuid,
  entry_number text,
  account_id uuid,
  account_code text,
  account_name text,
  source_type text,
  own_entry boolean
)
language sql stable security definer set search_path = public as $$
  select r.bank_transaction_id,
         e.id,
         e.entry_number,
         a.id,
         a.account_code,
         a.name,
         e.source_type::text,
         -- Whether this screen may take it back: an entry nothing else owns,
         -- on a line no import batch claims.
         (e.source_type = 'bank' and e.source_id is null and t.transaction_batch_id is null)
    from acc_reconciliation r
    join acc_bank_transaction t on t.id = r.bank_transaction_id
    join acc_journal_line bank_line on bank_line.id = r.journal_line_id
    join acc_journal_entry e on e.id = bank_line.journal_entry_id
    join acc_journal_line other on other.journal_entry_id = e.id
                               and other.account_id <> bank_line.account_id
    join acc_account a on a.id = other.account_id
   where e.status = 'posted'
     -- Approved only. A *suggested* reconciliation is the matcher's opinion
     -- that this line might already be in the books; treating it as a posting
     -- hid the control on every line that had one, which is exactly the ten
     -- lines a reader could not categorise.
     and r.status = 'approved'
     and (p_bank_account_id is null or t.bank_account_id = p_bank_account_id);
$$;

revoke all on function acc_bank_transaction_postings(uuid) from public, anon;
grant execute on function acc_bank_transaction_postings(uuid) to authenticated, service_role;
