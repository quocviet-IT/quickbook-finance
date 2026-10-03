-- ============================================================================
-- 0132 — Reconcile a statement from its file (1.79).
--
-- A reconciliation can now hold the statement it is reconciled against: the
-- file's name, the opening and closing balances it prints, and its lines. The
-- lines are paired with the books in the application (the client's prototype's
-- rule) and the pairs are ticked through acc_set_cleared_many, which makes the
-- same checks as acc_set_cleared for many lines in one call.
--
-- The first reconciliation of a bank account can be brought forward: when the
-- book balance on the day before the first statement's period equals the
-- opening balance that statement prints, every earlier posted line is signed off
-- as one completed reconciliation. A person asks for it; nothing here runs by
-- itself, and nothing here posts to the ledger.
--
-- acc_reconciliation_lines gains the book line's reference (the cheque number a
-- statement pairs on): the entry's own reference, else the reference of the
-- payment or bill payment it came from.
-- ============================================================================

set search_path = public;

alter table acc_statement_reconciliation
  add column if not exists statement_opening_minor bigint,
  add column if not exists statement_closing_minor bigint,
  add column if not exists note text,
  add column if not exists brought_forward boolean not null default false;
alter table acc_statement_reconciliation drop constraint if exists acc_stmt_recon_note_ck;
alter table acc_statement_reconciliation
  add constraint acc_stmt_recon_note_ck check (note is null or length(note) <= 500);
alter table acc_statement_reconciliation drop constraint if exists acc_stmt_recon_ref_ck;
alter table acc_statement_reconciliation
  add constraint acc_stmt_recon_ref_ck check (statement_ref is null or length(statement_ref) <= 255);

create table if not exists acc_reconciliation_statement_line (
  id                uuid primary key default gen_random_uuid(),
  reconciliation_id uuid not null references acc_statement_reconciliation (id) on delete cascade,
  line_no           integer not null check (line_no >= 0),
  txn_date          date not null,
  description       text not null default '' check (length(description) <= 500),
  reference         text check (reference is null or length(reference) <= 80),
  amount_minor      bigint not null check (amount_minor <> 0),
  balance_minor     bigint,
  unique (reconciliation_id, line_no)
);

alter table acc_reconciliation_statement_line enable row level security;
drop policy if exists acc_recon_stmt_line_sel on acc_reconciliation_statement_line;
create policy acc_recon_stmt_line_sel on acc_reconciliation_statement_line
  for select using (acc_is_staff() or acc_current_role() = 'viewer');
revoke all on acc_reconciliation_statement_line from public, anon;
grant select on acc_reconciliation_statement_line to authenticated;
grant all on acc_reconciliation_statement_line to service_role;

-- Replaces the statement lines a reconciliation holds. Internal: callers check
-- who may write and that the reconciliation is in progress.
create or replace function acc_recon_write_statement(p_reconciliation_id uuid, p_lines jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_lines jsonb := coalesce(p_lines, '[]'::jsonb); v_count integer;
begin
  if jsonb_typeof(v_lines) <> 'array' then raise exception 'The statement lines must be a list'; end if;
  if jsonb_array_length(v_lines) > 5000 then raise exception 'A statement can hold at most 5,000 lines'; end if;
  delete from acc_reconciliation_statement_line where reconciliation_id = p_reconciliation_id;
  insert into acc_reconciliation_statement_line
    (reconciliation_id, line_no, txn_date, description, reference, amount_minor, balance_minor)
  select p_reconciliation_id, (x.ord - 1)::integer, (x.e ->> 'txn_date')::date,
         left(coalesce(x.e ->> 'description', ''), 500),
         nullif(left(btrim(coalesce(x.e ->> 'reference', '')), 80), ''),
         (x.e ->> 'amount_minor')::bigint, (x.e ->> 'balance_minor')::bigint
    from jsonb_array_elements(v_lines) with ordinality as x (e, ord);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function acc_recon_write_statement(uuid, jsonb) from public, anon, authenticated;

-- A reconciliation started from a statement: acc_create_reconciliation plus the
-- statement it is reconciled against, in one transaction.
create or replace function acc_create_reconciliation_from_statement(
  p_bank_account_id uuid, p_ending_date date, p_ending_minor bigint,
  p_file_name text, p_opening_minor bigint, p_lines jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  v_id := acc_create_reconciliation(p_bank_account_id, p_ending_date, p_ending_minor);
  update acc_statement_reconciliation
     set statement_ref = nullif(left(btrim(coalesce(p_file_name, '')), 255), ''),
         statement_opening_minor = p_opening_minor,
         statement_closing_minor = p_ending_minor,
         updated_at = now()
   where id = v_id;
  perform acc_recon_write_statement(v_id, p_lines);
  return v_id;
end;
$$;
revoke all on function acc_create_reconciliation_from_statement(uuid, date, bigint, text, bigint, jsonb) from public, anon;
grant execute on function acc_create_reconciliation_from_statement(uuid, date, bigint, text, bigint, jsonb)
  to authenticated, service_role;

-- The statement a reconciliation in progress is reconciled against, replaced.
create or replace function acc_set_reconciliation_statement(
  p_reconciliation_id uuid, p_file_name text, p_opening_minor bigint, p_closing_minor bigint, p_lines jsonb
) returns integer
language plpgsql security definer set search_path = public as $$
declare v_rec acc_statement_reconciliation;
begin
  if not acc_is_staff() then raise exception 'Not authorized'; end if;
  select * into v_rec from acc_statement_reconciliation where id = p_reconciliation_id for update;
  if not found then raise exception 'Reconciliation not found'; end if;
  if v_rec.status <> 'in_progress' then raise exception 'Reconciliation is not in progress'; end if;
  update acc_statement_reconciliation
     set statement_ref = nullif(left(btrim(coalesce(p_file_name, '')), 255), ''),
         statement_opening_minor = p_opening_minor,
         statement_closing_minor = p_closing_minor,
         updated_at = now()
   where id = p_reconciliation_id;
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_statement_reconciliation', p_reconciliation_id, 'update', auth.uid());
  return acc_recon_write_statement(p_reconciliation_id, p_lines);
end;
$$;
revoke all on function acc_set_reconciliation_statement(uuid, text, bigint, bigint, jsonb) from public, anon;
grant execute on function acc_set_reconciliation_statement(uuid, text, bigint, bigint, jsonb) to authenticated, service_role;

-- Take the statement's closing balance as the reconciliation's ending balance.
create or replace function acc_set_statement_ending(p_reconciliation_id uuid, p_ending_minor bigint)
returns void
language plpgsql security definer set search_path = public as $$
declare v_rec acc_statement_reconciliation;
begin
  if not acc_is_staff() then raise exception 'Not authorized'; end if;
  select * into v_rec from acc_statement_reconciliation where id = p_reconciliation_id for update;
  if not found then raise exception 'Reconciliation not found'; end if;
  if v_rec.status <> 'in_progress' then raise exception 'Reconciliation is not in progress'; end if;
  update acc_statement_reconciliation
     set statement_ending_balance_minor = p_ending_minor, updated_at = now()
   where id = p_reconciliation_id;
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_statement_reconciliation', p_reconciliation_id, 'update', auth.uid());
end;
$$;
revoke all on function acc_set_statement_ending(uuid, bigint) from public, anon;
grant execute on function acc_set_statement_ending(uuid, bigint) to authenticated, service_role;

-- acc_set_cleared for many lines in one call: every line passes its checks or
-- none is changed.
create or replace function acc_set_cleared_many(
  p_reconciliation_id uuid, p_journal_line_ids uuid[], p_cleared boolean
) returns integer
language plpgsql security definer set search_path = public as $$
declare v_line uuid; v_count integer := 0;
begin
  if coalesce(array_length(p_journal_line_ids, 1), 0) > 5000 then
    raise exception 'At most 5,000 lines can be ticked at once';
  end if;
  foreach v_line in array coalesce(p_journal_line_ids, '{}'::uuid[]) loop
    perform acc_set_cleared(p_reconciliation_id, v_line, p_cleared);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function acc_set_cleared_many(uuid, uuid[], boolean) from public, anon;
grant execute on function acc_set_cleared_many(uuid, uuid[], boolean) to authenticated, service_role;

-- What bringing an account forward through a date would sign off. Read only.
create or replace function acc_brought_forward_preview(p_bank_account_id uuid, p_through date)
returns table (has_reconciliations boolean, book_balance_minor bigint, open_lines integer)
language sql stable as $$
  select exists (select 1 from acc_statement_reconciliation where bank_account_id = p_bank_account_id),
         coalesce(sum(case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end), 0)::bigint,
         count(l.id)::integer
    from acc_journal_line l
    join acc_journal_entry e on e.id = l.journal_entry_id
   where l.account_id = (select account_id from acc_bank_account where id = p_bank_account_id)
     and e.status = 'posted'
     and e.entry_date <= p_through;
$$;
revoke all on function acc_brought_forward_preview(uuid, date) from public, anon;
grant execute on function acc_brought_forward_preview(uuid, date) to authenticated, service_role;

-- The first reconciliation of a bank account, brought forward: every posted
-- line up to p_through signed off as one completed reconciliation, proved by
-- the opening balance the first statement prints.
create or replace function acc_bring_forward_reconciliation(
  p_bank_account_id uuid, p_through date, p_opening_minor bigint, p_note text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_gl uuid; v_balance bigint; v_id uuid;
begin
  if not acc_is_staff() then raise exception 'Not authorized to bring a bank account forward'; end if;
  select account_id into v_gl from acc_bank_account where id = p_bank_account_id for update;
  if v_gl is null then raise exception 'Bank account not found'; end if;
  if exists (select 1 from acc_statement_reconciliation where bank_account_id = p_bank_account_id) then
    raise exception 'This bank account already has a reconciliation; only the first one can be brought forward';
  end if;
  select coalesce(sum(case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end), 0)::bigint
    into v_balance
    from acc_journal_line l
    join acc_journal_entry e on e.id = l.journal_entry_id
   where l.account_id = v_gl and e.status = 'posted' and e.entry_date <= p_through;
  if v_balance <> p_opening_minor then
    raise exception 'The books hold % on %, and the statement opens at %',
      to_char(v_balance / 100.0, 'FM999,999,999,990.00'), p_through,
      to_char(p_opening_minor / 100.0, 'FM999,999,999,990.00');
  end if;

  insert into acc_statement_reconciliation
    (bank_account_id, statement_ending_date, beginning_balance_minor, statement_ending_balance_minor,
     status, prepared_by, completed_by, completed_at, note, brought_forward)
  values (p_bank_account_id, p_through, 0, p_opening_minor,
          'completed', auth.uid(), auth.uid(), now(), nullif(left(btrim(coalesce(p_note, '')), 500), ''), true)
  returning id into v_id;
  insert into acc_reconciliation_line (reconciliation_id, journal_line_id)
  select v_id, l.id
    from acc_journal_line l
    join acc_journal_entry e on e.id = l.journal_entry_id
   where l.account_id = v_gl and e.status = 'posted' and e.entry_date <= p_through;
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_statement_reconciliation', v_id, 'insert', auth.uid()),
           ('acc_statement_reconciliation', v_id, 'post', auth.uid());
  return v_id;
end;
$$;
revoke all on function acc_bring_forward_reconciliation(uuid, date, bigint, text) from public, anon;
grant execute on function acc_bring_forward_reconciliation(uuid, date, bigint, text) to authenticated, service_role;

-- The lines a reconciliation offers, now with the reference a statement pairs
-- on. Its result columns change, so it is dropped and created again.
drop function if exists acc_reconciliation_lines(uuid);
create function acc_reconciliation_lines(p_reconciliation_id uuid)
returns table (journal_line_id uuid, entry_id uuid, entry_number text, entry_date date,
               source_type acc_journal_source, memo text, signed_minor bigint, cleared boolean,
               reference text)
language sql stable as $$
  with rec as (select * from acc_statement_reconciliation where id = p_reconciliation_id),
       gl as (select account_id from acc_bank_account where id = (select bank_account_id from rec))
  select l.id, e.id, e.entry_number, e.entry_date, e.source_type, l.memo,
         (case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end)::bigint,
         exists (select 1 from acc_reconciliation_line rl
                  where rl.reconciliation_id = p_reconciliation_id and rl.journal_line_id = l.id),
         coalesce(nullif(btrim(e.source_ref), ''), p.reference, bp.reference)
    from acc_journal_line l
    join acc_journal_entry e on e.id = l.journal_entry_id
    left join acc_payment p on e.source_type = 'payment' and p.id = e.source_id
    left join acc_bill_payment bp on e.source_type = 'bill_payment' and bp.id = e.source_id
   where l.account_id = (select account_id from gl)
     and e.status = 'posted'
     and e.entry_date <= (select statement_ending_date from rec)
     and not exists (
       select 1 from acc_reconciliation_line rl2
       join acc_statement_reconciliation r2 on r2.id = rl2.reconciliation_id
       where rl2.journal_line_id = l.id and r2.status = 'completed' and r2.id <> p_reconciliation_id)
   order by e.entry_date, e.entry_number;
$$;
revoke all on function acc_reconciliation_lines(uuid) from public, anon;
grant execute on function acc_reconciliation_lines(uuid) to authenticated, service_role;
