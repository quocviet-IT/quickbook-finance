-- ============================================================================
-- A statement import can be taken back, and a stray bank line can be removed.
--
-- Importing a statement is the one way into the bank register with no way out.
-- It posts nothing to the ledger — the lines arrive `unmatched` and wait — so
-- there is nothing to void, and voiding is all this system had. An accountant
-- put a 1,566-row file through it, realised the tab imports into *one* bank
-- account while the file covered eight, and had no button of any kind. The
-- lines had to be deleted through a database connection by somebody else.
--
-- Two ways out, because the two mistakes are different sizes:
--   * undo the whole import, which is what a wrong bank account calls for;
--   * delete one line, for the stray that does not belong.
--
-- Both refuse the moment a line has been matched. A bank line with a
-- reconciliation behind it is cited by a journal entry, and deleting it would
-- leave that entry pointing at nothing — which is a hole in the books, not a
-- tidy-up. The refusal names how many, so the reader knows to unmatch first.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The batch remembers being undone.
--
--    Deleting the batch row too would erase the fact that somebody imported
--    this file at all, which is exactly what a reader looking for "why are
--    these lines gone" needs to find.
-- ----------------------------------------------------------------------------
alter table acc_bank_import_batch
  add column if not exists status text not null default 'active',
  add column if not exists voided_by uuid references auth.users (id),
  add column if not exists voided_at timestamptz,
  add column if not exists void_reason text;

alter table acc_bank_import_batch drop constraint if exists acc_bank_import_batch_status_ck;
alter table acc_bank_import_batch add constraint acc_bank_import_batch_status_ck
  check (status in ('active', 'voided'));

-- ----------------------------------------------------------------------------
-- 2. How many lines of a batch can no longer be removed, and why.
--
--    One place, so the undo and the screen that offers it cannot disagree about
--    whether the button will work.
-- ----------------------------------------------------------------------------
create or replace function acc_bank_import_batch_locked_lines(p_batch_id uuid)
returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int
    from acc_bank_transaction t
   where t.import_batch_id = p_batch_id
     and (t.status <> 'unmatched'
          or exists (select 1 from acc_reconciliation r where r.bank_transaction_id = t.id));
$$;

revoke all on function acc_bank_import_batch_locked_lines(uuid) from public, anon;
grant execute on function acc_bank_import_batch_locked_lines(uuid)
  to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. The list the screen shows, with the same count the undo will check.
--
--    Offering an Undo that is going to refuse is worse than not offering it, so
--    the button reads `locked_lines` from here rather than guessing.
-- ----------------------------------------------------------------------------
create or replace function acc_bank_statement_imports(p_bank_account_id uuid default null)
returns table (
  id uuid, bank_account_id uuid, account_code text, account_name text,
  filename text, row_count int, lines_here int, locked_lines int,
  imported_at timestamptz, status text, voided_at timestamptz, void_reason text
)
language sql stable security definer set search_path = public as $$
  select b.id, b.bank_account_id, a.account_code, a.name,
         b.filename, b.row_count,
         (select count(*)::int from acc_bank_transaction t where t.import_batch_id = b.id),
         acc_bank_import_batch_locked_lines(b.id),
         b.imported_at, b.status, b.voided_at, b.void_reason
    from acc_bank_import_batch b
    join acc_bank_account ba on ba.id = b.bank_account_id
    join acc_account a on a.id = ba.account_id
   where p_bank_account_id is null or b.bank_account_id = p_bank_account_id
   order by b.imported_at desc
   limit 20;
$$;

revoke all on function acc_bank_statement_imports(uuid) from public, anon;
grant execute on function acc_bank_statement_imports(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. Undo the whole import.
-- ----------------------------------------------------------------------------
create or replace function acc_undo_bank_statement_import(p_batch_id uuid, p_reason text)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_locked  int;
  v_removed int;
  v_batch   acc_bank_import_batch;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to undo a statement import';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Say why this import is being undone';
  end if;

  select * into v_batch from acc_bank_import_batch
   where id = p_batch_id and status = 'active';
  if v_batch.id is null then
    raise exception 'Statement import not found, or already undone';
  end if;

  v_locked := acc_bank_import_batch_locked_lines(p_batch_id);
  if v_locked > 0 then
    raise exception
      '% line(s) of this import have already been matched to the ledger. '
      'Unmatch them first — removing a line an entry points at would leave the books short.',
      v_locked;
  end if;

  delete from acc_bank_transaction where import_batch_id = p_batch_id;
  get diagnostics v_removed = row_count;

  update acc_bank_import_batch
     set status = 'voided', voided_by = auth.uid(), voided_at = now(),
         void_reason = btrim(p_reason)
   where id = p_batch_id;

  insert into acc_audit_log (table_name, record_id, action, actor_id, before_json)
  values ('acc_bank_import_batch', p_batch_id, 'undo', auth.uid(),
          jsonb_build_object('filename', v_batch.filename,
                             'lines_removed', v_removed,
                             'reason', btrim(p_reason)));

  return v_removed;
end;
$$;

revoke all on function acc_undo_bank_statement_import(uuid, text) from public, anon;
grant execute on function acc_undo_bank_statement_import(uuid, text)
  to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. Delete one line.
--
--    Kept apart from the undo above rather than folded into it: removing one
--    stray line and taking back a whole import are different decisions, and a
--    single function taking an optional batch would let the wrong one happen by
--    leaving an argument out.
-- ----------------------------------------------------------------------------
create or replace function acc_delete_bank_transaction(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_row acc_bank_transaction;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to delete a bank transaction';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Say why this line is being deleted, in a sentence';
  end if;

  select * into v_row from acc_bank_transaction where id = p_id;
  if v_row.id is null then
    raise exception 'Bank transaction not found';
  end if;
  if v_row.status <> 'unmatched' then
    raise exception
      'This line is % — unmatch it first. Removing a line the ledger points at '
      'would leave an entry citing a transaction that no longer exists.', v_row.status;
  end if;
  if exists (select 1 from acc_reconciliation where bank_transaction_id = p_id) then
    raise exception
      'This line has a match against it. Reject the match first, then delete the line.';
  end if;

  delete from acc_bank_transaction where id = p_id;

  insert into acc_audit_log (table_name, record_id, action, actor_id, before_json)
  values ('acc_bank_transaction', p_id, 'delete', auth.uid(),
          jsonb_build_object('txn_date', v_row.txn_date,
                             'description', v_row.description,
                             'amount_minor', v_row.amount_minor,
                             'source', v_row.source,
                             'reason', btrim(p_reason)));
end;
$$;

revoke all on function acc_delete_bank_transaction(uuid, text) from public, anon;
grant execute on function acc_delete_bank_transaction(uuid, text) to authenticated, service_role;
