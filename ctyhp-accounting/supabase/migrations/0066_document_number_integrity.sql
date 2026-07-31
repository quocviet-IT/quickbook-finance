-- ============================================================================
-- Document number integrity: numbers the system owns, and gaps it can explain.
--
-- Numbers already come from `acc_sequence` inside SECURITY DEFINER RPCs, but
-- RLS lets staff write the document tables directly, so a number could be
-- edited and a numbered document could be deleted — the two ways a sale
-- disappears without trace. A missing number was also invisible: nothing
-- compared what the sequence had handed out against what the ledger still
-- holds (AICPA AS 1301 risk assessment; IRS Rev. Proc. 86-19 recordkeeping).
--
-- Three parts: a guard that makes numbers write-once and numbered documents
-- undeletable from a client session; a registry saying where each sequence's
-- numbers live; and a note table so a break someone can account for is
-- documented rather than left to be rediscovered every month.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Guard. TG_ARGV[0] is the number column of the table it protects.
--
-- SECURITY DEFINER RPCs run as the table owner; a client arrives through
-- PostgREST as `authenticated`. The owner and `service_role` keep their hands
-- free — migrations, seeds, and maintenance scripts must still be able to
-- correct data — and every one of those paths is outside the application.
-- ----------------------------------------------------------------------------
create or replace function acc_guard_document_number() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_column text := tg_argv[0];
  v_old    text := to_jsonb(old) ->> v_column;
  v_new    text;
begin
  if current_user not in ('authenticated', 'anon') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    if v_old is not null then
      raise exception
        'Document % has been numbered and cannot be deleted. Void it instead.', v_old
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  v_new := to_jsonb(new) ->> v_column;
  if v_old is distinct from v_new then
    raise exception
      'A document number is assigned by the system and cannot be changed (% to %).',
      coalesce(v_old, 'unnumbered'), coalesce(v_new, 'unnumbered')
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function acc_guard_document_number() from public;

-- ----------------------------------------------------------------------------
-- 2. Registry: which table and columns a sequence's numbers live in. A row
-- here is what puts a document type into the integrity report, so adding a
-- numbered document later is one insert rather than a code change.
-- ----------------------------------------------------------------------------
create table if not exists acc_number_source (
  sequence_key   text primary key references acc_sequence (key) on delete cascade,
  label          text not null,
  table_name     text not null,
  number_column  text not null,
  date_column    text not null,
  status_column  text not null
);

alter table acc_number_source enable row level security;
create policy acc_number_source_read on acc_number_source
  for select using (acc_current_role() is not null);

insert into acc_number_source
  (sequence_key, label, table_name, number_column, date_column, status_column)
values
  ('invoice',         'Invoices',          'acc_invoice',         'invoice_number',       'issue_date',     'status'),
  ('payment',         'Customer payments', 'acc_payment',         'payment_number',       'payment_date',   'status'),
  ('credit_memo',     'Credit memos',      'acc_credit_memo',     'credit_memo_number',   'memo_date',      'status'),
  ('customer_refund', 'Customer refunds',  'acc_customer_refund', 'refund_number',        'refund_date',    'status'),
  ('write_off',       'Write-offs',        'acc_write_off',       'write_off_number',     'write_off_date', 'status'),
  ('bill',            'Vendor bills',      'acc_bill',            'bill_number',          'bill_date',      'status'),
  ('bill_payment',    'Bill payments',     'acc_bill_payment',    'payment_number',       'payment_date',   'status'),
  ('vendor_credit',   'Vendor credits',    'acc_vendor_credit',   'vendor_credit_number', 'credit_date',    'status'),
  ('expense',         'Expenses',          'acc_expense',         'expense_number',       'expense_date',   'status'),
  ('tax_payment',     'Sales tax payments','acc_tax_payment',     'payment_number',       'payment_date',   'status'),
  ('purchase_order',  'Purchase orders',   'acc_purchase_order',  'po_number',            'order_date',     'status'),
  ('goods_receipt',   'Goods receipts',    'acc_goods_receipt',   'receipt_number',       'receipt_date',   'status'),
  ('journal_entry',   'Journal entries',   'acc_journal_entry',   'entry_number',         'entry_date',     'status'),
  ('opening_balance', 'Opening balances',  'acc_journal_entry',   'entry_number',         'entry_date',     'status')
on conflict (sequence_key) do update
  set label = excluded.label,
      table_name = excluded.table_name,
      number_column = excluded.number_column,
      date_column = excluded.date_column,
      status_column = excluded.status_column;

-- Attach the guard to every registered table (each table once, even where two
-- sequences share it).
do $$
declare
  v_table  text;
  v_column text;
begin
  for v_table, v_column in
    select distinct table_name, number_column from acc_number_source
  loop
    execute format('drop trigger if exists %I on %I', v_table || '_number_guard', v_table);
    execute format(
      'create trigger %I before update or delete on %I
         for each row execute function acc_guard_document_number(%L)',
      v_table || '_number_guard', v_table, v_column);
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Explained gaps. A number the sequence issued that no document holds is an
-- exception until somebody accounts for it in writing; the note is what turns
-- it from an open question into a closed one, and it is itself audited.
-- ----------------------------------------------------------------------------
create table if not exists acc_number_gap_note (
  sequence_key text not null references acc_sequence (key) on delete cascade,
  number_value bigint not null check (number_value > 0),
  reason       text not null check (length(btrim(reason)) >= 10),
  noted_by     uuid references auth.users (id),
  noted_at     timestamptz not null default now(),
  primary key (sequence_key, number_value)
);

alter table acc_number_gap_note enable row level security;
create policy acc_number_gap_note_read on acc_number_gap_note
  for select using (acc_current_role() is not null);

drop trigger if exists acc_number_gap_note_atomic_audit on acc_number_gap_note;
create trigger acc_number_gap_note_atomic_audit
  after insert or update or delete on acc_number_gap_note
  for each row execute function acc_audit_row_change();

/**
 * Record why a number is missing. Writing is governance, not bookkeeping: the
 * note is the control's escape hatch, so it needs the permission that governs
 * the company's settings, and it names its author.
 */
create or replace function acc_record_number_gap_note(
  p_sequence_key text,
  p_number_value bigint,
  p_reason       text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not acc_has_permission('settings.manage') then
    raise exception 'You do not have permission to document a numbering gap';
  end if;
  if not exists (select 1 from acc_sequence where key = p_sequence_key) then
    raise exception 'Unknown sequence: %', p_sequence_key;
  end if;

  insert into acc_number_gap_note (sequence_key, number_value, reason, noted_by)
  values (p_sequence_key, p_number_value, btrim(p_reason), auth.uid())
  on conflict (sequence_key, number_value) do update
    set reason = excluded.reason, noted_by = excluded.noted_by, noted_at = now();
end;
$$;

revoke all on function acc_record_number_gap_note(text, bigint, text) from public;
grant execute on function acc_record_number_gap_note(text, bigint, text)
  to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. Reading the sequence. The database reports what it holds — every issued
-- number and how far the sequence has run — and the application works out
-- which numbers are missing, so that rule has one implementation and unit
-- tests can hold it to account.
-- ----------------------------------------------------------------------------
create or replace function acc_sequence_catalog()
returns table (
  sequence_key text,
  label        text,
  prefix       text,
  next_value   bigint
)
language plpgsql stable security definer set search_path = public as $$
begin
  if acc_current_role() is null then
    raise exception 'Not authorized to read document sequences';
  end if;
  return query
    select s.key, n.label, s.prefix, s.next_value
      from acc_sequence s
      join acc_number_source n on n.sequence_key = s.key
     order by n.label;
end;
$$;

revoke all on function acc_sequence_catalog() from public;
grant execute on function acc_sequence_catalog() to authenticated, service_role;

/**
 * Every document a sequence's numbers are attached to. Numbers that do not
 * carry the sequence's prefix belong to another sequence sharing the table
 * (journal entries hold both JE- and OB- numbers) and are left to it.
 */
create or replace function acc_sequence_documents(p_sequence_key text)
returns table (
  number_value bigint,
  document_id  uuid,
  document_date date,
  document_status text
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_src    acc_number_source;
  v_prefix text;
begin
  if acc_current_role() is null then
    raise exception 'Not authorized to read document sequences';
  end if;

  select * into v_src from acc_number_source where sequence_key = p_sequence_key;
  if not found then
    raise exception 'Unknown sequence: %', p_sequence_key;
  end if;
  select prefix into v_prefix from acc_sequence where key = p_sequence_key;

  return query execute format($q$
    select substring(t.%I from %s)::bigint,
           t.id,
           t.%I::date,
           t.%I::text
      from %I t
     where t.%I like %L
       and substring(t.%I from %s) ~ '^[0-9]+$'
     order by 1
  $q$,
    v_src.number_column, length(v_prefix) + 1,
    v_src.date_column,
    v_src.status_column,
    v_src.table_name,
    v_src.number_column, v_prefix || '%',
    v_src.number_column, length(v_prefix) + 1);
end;
$$;

revoke all on function acc_sequence_documents(text) from public;
grant execute on function acc_sequence_documents(text) to authenticated, service_role;
