-- ============================================================================
-- 0127 — Transfers and shareholder funding pairs.
--
-- Two bank lines that are one movement of money are posted together: a
-- transfer between two of the company's bank accounts as one entry that
-- matches both lines, a shareholder funding pair as two entries on the
-- account the company chose, each saying what answered it. Change on a line
-- now releases every line of the entry it voids, so a transfer comes back
-- whole. Nothing else that exists changes.
-- ============================================================================

set search_path = public;

-- One row per company. The key is a uuid like every other table, because the
-- audit trigger records rows by their id; `singleton` keeps it to one row.
create table if not exists acc_banking_preference (
  id                 uuid primary key default gen_random_uuid(),
  singleton          boolean not null default true unique check (singleton),
  funding_account_id uuid references acc_account (id),
  pair_window_days   int not null default 7 check (pair_window_days in (0, 1, 3, 7, 14, 30)),
  created_by         uuid references auth.users (id),
  created_at         timestamptz not null default now(),
  updated_by         uuid references auth.users (id),
  updated_at         timestamptz not null default now()
);

drop trigger if exists acc_banking_preference_actor_stamp on acc_banking_preference;
create trigger acc_banking_preference_actor_stamp
  before insert or update on acc_banking_preference
  for each row execute function acc_stamp_actor();

drop trigger if exists acc_banking_preference_atomic_audit on acc_banking_preference;
create trigger acc_banking_preference_atomic_audit
  after insert or update or delete on acc_banking_preference
  for each row execute function acc_audit_row_change();

alter table acc_banking_preference enable row level security;

drop policy if exists acc_banking_preference_sel on acc_banking_preference;
create policy acc_banking_preference_sel on acc_banking_preference
  for select using (acc_is_staff() or acc_current_role() = 'viewer');
drop policy if exists acc_banking_preference_ins on acc_banking_preference;
create policy acc_banking_preference_ins on acc_banking_preference
  for insert with check (acc_is_staff());
drop policy if exists acc_banking_preference_upd on acc_banking_preference;
create policy acc_banking_preference_upd on acc_banking_preference
  for update using (acc_is_staff()) with check (acc_is_staff());

revoke all on acc_banking_preference from public, anon;
grant select, insert, update on acc_banking_preference to authenticated;
grant all on acc_banking_preference to service_role;

-- --- Posting a pair ----------------------------------------------------------
create or replace function acc_post_bank_pair(p_first uuid, p_second uuid, p_kind text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_a        acc_bank_transaction;
  v_b        acc_bank_transaction;
  v_out      acc_bank_transaction;
  v_in       acc_bank_transaction;
  v_pref     acc_banking_preference;
  v_window   int;
  v_currency text;
  v_out_gl   uuid;
  v_in_gl    uuid;
  v_out_lbl  text;
  v_in_lbl   text;
  v_out_desc text;
  v_in_desc  text;
  v_abs      bigint;
  v_fund_id  uuid;
  v_fund     acc_account;
  v_entry    uuid;
  v_entry2   uuid;
  v_line     uuid;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to post bank lines';
  end if;
  if p_kind is null or p_kind not in ('transfer', 'funding') then
    raise exception 'Unknown pair kind %', p_kind;
  end if;
  if p_first is null or p_second is null or p_first = p_second then
    raise exception 'A pair needs two different lines';
  end if;

  select * into v_a from acc_bank_transaction where id = p_first for update;
  select * into v_b from acc_bank_transaction where id = p_second for update;
  if v_a.id is null or v_b.id is null then
    raise exception 'Bank transaction not found';
  end if;
  if v_a.status <> 'unmatched' or v_b.status <> 'unmatched' or v_a.pending or v_b.pending then
    raise exception 'Both lines must still be waiting to be posted';
  end if;
  if exists (select 1 from acc_reconciliation where bank_transaction_id in (p_first, p_second)) then
    raise exception 'One of these lines is already matched to the ledger';
  end if;
  if coalesce(v_a.amount_minor, 0) = 0 or v_a.amount_minor <> -v_b.amount_minor then
    raise exception 'A pair is money in and money out of the same amount';
  end if;

  select * into v_pref from acc_banking_preference where singleton;
  v_window := coalesce(v_pref.pair_window_days, 7);
  if abs(v_a.txn_date - v_b.txn_date) > v_window then
    raise exception 'These lines are % days apart; pairs are within % days', abs(v_a.txn_date - v_b.txn_date), v_window;
  end if;

  if v_a.amount_minor < 0 then v_out := v_a; v_in := v_b; else v_out := v_b; v_in := v_a; end if;

  select code into v_currency from acc_currency where is_base limit 1;
  if v_currency is null then raise exception 'No base currency is configured'; end if;
  if exists (select 1 from acc_bank_account
              where id in (v_out.bank_account_id, v_in.bank_account_id) and currency_code <> v_currency) then
    raise exception 'Pairs are posted only between bank accounts in %', v_currency;
  end if;

  select ba.account_id, coalesce(nullif(btrim(ba.bank_name), ''), a.name) || ' · ' || a.account_code
    into v_out_gl, v_out_lbl
    from acc_bank_account ba join acc_account a on a.id = ba.account_id where ba.id = v_out.bank_account_id;
  select ba.account_id, coalesce(nullif(btrim(ba.bank_name), ''), a.name) || ' · ' || a.account_code
    into v_in_gl, v_in_lbl
    from acc_bank_account ba join acc_account a on a.id = ba.account_id where ba.id = v_in.bank_account_id;
  if v_out_gl is null or v_in_gl is null then
    raise exception 'A bank line has no ledger account behind its bank account';
  end if;

  v_abs := abs(v_out.amount_minor);
  v_out_desc := coalesce(nullif(btrim(v_out.description), ''), 'Bank line');
  v_in_desc  := coalesce(nullif(btrim(v_in.description), ''), 'Bank line');

  if p_kind = 'transfer' then
    if v_out.bank_account_id = v_in.bank_account_id or v_out_gl = v_in_gl then
      raise exception 'A transfer moves money between two different bank accounts';
    end if;
    v_entry := acc_post_entry(
      v_out.txn_date, format('Transfer from %s to %s', v_out_lbl, v_in_lbl), 'bank', null, v_currency,
      jsonb_build_array(
        jsonb_build_object('account_id', v_in_gl, 'debit_minor', v_abs, 'credit_minor', 0,
          'amount_base_minor', acc_to_base_minor(v_abs, v_currency, v_out.txn_date), 'memo', v_in.description),
        jsonb_build_object('account_id', v_out_gl, 'debit_minor', 0, 'credit_minor', v_abs,
          'amount_base_minor', acc_to_base_minor(v_abs, v_currency, v_out.txn_date), 'memo', v_out.description)));
    select id into v_line from acc_journal_line where journal_entry_id = v_entry and account_id = v_out_gl limit 1;
    insert into acc_reconciliation (bank_transaction_id, journal_line_id, status, confidence)
    values (v_out.id, v_line, 'approved', 1.000);
    select id into v_line from acc_journal_line where journal_entry_id = v_entry and account_id = v_in_gl limit 1;
    insert into acc_reconciliation (bank_transaction_id, journal_line_id, status, confidence)
    values (v_in.id, v_line, 'approved', 1.000);
    update acc_bank_transaction set status = 'matched' where id in (v_out.id, v_in.id);
    return jsonb_build_object('entries',
      (select jsonb_agg(entry_number) from acc_journal_entry where id = v_entry));
  end if;

  -- Funding: the account is the company's choice, never the caller's.
  v_fund_id := v_pref.funding_account_id;
  select * into v_fund from acc_account where id = v_fund_id;
  if v_fund.id is null then
    raise exception 'Choose the account funding pairs post to, on Banking › Rules, first';
  end if;
  if v_fund.status <> 'active' or not v_fund.is_posting_account then
    raise exception 'Funding pairs cannot post to % — it is not an active posting account', v_fund.name;
  end if;

  v_entry := acc_post_entry(
    v_in.txn_date, format('%s, answered by %s on %s', v_in_desc, v_out_desc, v_out.txn_date), 'bank', null, v_currency,
    jsonb_build_array(
      jsonb_build_object('account_id', v_in_gl, 'debit_minor', v_abs, 'credit_minor', 0,
        'amount_base_minor', acc_to_base_minor(v_abs, v_currency, v_in.txn_date), 'memo', v_in.description),
      jsonb_build_object('account_id', v_fund.id, 'debit_minor', 0, 'credit_minor', v_abs,
        'amount_base_minor', acc_to_base_minor(v_abs, v_currency, v_in.txn_date), 'memo', v_in.description)));
  select id into v_line from acc_journal_line where journal_entry_id = v_entry and account_id = v_in_gl limit 1;
  insert into acc_reconciliation (bank_transaction_id, journal_line_id, status, confidence)
  values (v_in.id, v_line, 'approved', 1.000);

  v_entry2 := acc_post_entry(
    v_out.txn_date, format('%s, answered by %s on %s', v_out_desc, v_in_desc, v_in.txn_date), 'bank', null, v_currency,
    jsonb_build_array(
      jsonb_build_object('account_id', v_fund.id, 'debit_minor', v_abs, 'credit_minor', 0,
        'amount_base_minor', acc_to_base_minor(v_abs, v_currency, v_out.txn_date), 'memo', v_out.description),
      jsonb_build_object('account_id', v_out_gl, 'debit_minor', 0, 'credit_minor', v_abs,
        'amount_base_minor', acc_to_base_minor(v_abs, v_currency, v_out.txn_date), 'memo', v_out.description)));
  select id into v_line from acc_journal_line where journal_entry_id = v_entry2 and account_id = v_out_gl limit 1;
  insert into acc_reconciliation (bank_transaction_id, journal_line_id, status, confidence)
  values (v_out.id, v_line, 'approved', 1.000);

  update acc_bank_transaction set status = 'matched' where id in (v_out.id, v_in.id);
  return jsonb_build_object('entries',
    (select jsonb_agg(entry_number order by entry_date, entry_number) from acc_journal_entry where id in (v_entry, v_entry2)));
end;
$$;

revoke all on function acc_post_bank_pair(uuid, uuid, text) from public, anon;
grant execute on function acc_post_bank_pair(uuid, uuid, text) to authenticated, service_role;

-- --- Change takes back every line of the entry it voids ------------------------
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
