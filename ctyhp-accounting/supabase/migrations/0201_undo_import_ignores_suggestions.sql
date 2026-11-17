-- ============================================================================
-- 0201  A suggested match no longer stops a statement import being undone (3.0.43)
--
-- Undo import refused while any line of the import had a row in
-- acc_reconciliation (0109, then 0166). Banking writes a suggested match for a
-- line as soon as it is imported, so the undo was refused almost at once, for
-- a guess nobody had decided, or one a person had already turned down. The
-- refusal itself says why it exists: a line the ledger points at must not be
-- removed. A suggestion is not pointed at by anything.
--
-- 1. acc_bank_import_batch_locked_lines counts a line as locked when it is
--    matched, coded or ignored, or has an approved match: the rule a bank-feed
--    sync's undo already uses (acc_bank_feed_sync_locked_lines, 0137), and the
--    one a single line's delete applies to approved matches
--    (acc_bank_line_delete_state, 0192). Suggested and rejected matches go
--    with their lines, as acc_reconciliation's foreign key has always said
--    (on delete cascade). The membership check of 0166 stays.
--
-- 2. acc_undo_bank_statement_import takes the matches and then the lines of
--    the import for update before it counts, in the order acc_decide_bank_match
--    takes them, as the sync's undo does: a person approving a suggestion at
--    the same moment waits for the undo, so an approved match is never removed
--    with its line. The audit row says how many suggestions went with the
--    lines. Everything else is as 0109 wrote it.
-- ============================================================================
set search_path = public;

-- ----------------------------------------------------------------------------
-- 1. Which lines of an import can no longer be removed.
-- ----------------------------------------------------------------------------
create or replace function acc_bank_import_batch_locked_lines(p_batch_id uuid)
returns int
language sql stable security definer set search_path = public as $$
  select acc_assert_member();
  select count(*)::int
    from acc_bank_transaction t
   where t.import_batch_id = p_batch_id
     and (t.status <> 'unmatched'
          or exists (select 1 from acc_reconciliation r
                      where r.bank_transaction_id = t.id and r.status = 'approved'));
$$;

-- ----------------------------------------------------------------------------
-- 2. Undo the whole import.
-- ----------------------------------------------------------------------------
create or replace function acc_undo_bank_statement_import(p_batch_id uuid, p_reason text)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_locked    int;
  v_removed   int;
  v_suggested int;
  v_batch     acc_bank_import_batch;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to undo a statement import';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Say why this import is being undone';
  end if;

  select * into v_batch from acc_bank_import_batch
   where id = p_batch_id and status = 'active'
     for update;
  if v_batch.id is null then
    raise exception 'Statement import not found, or already undone';
  end if;

  -- Matches first, then lines: a person deciding a match at the same moment
  -- waits for the undo, and the two cannot deadlock.
  perform 1 from acc_reconciliation
   where bank_transaction_id in (select id from acc_bank_transaction where import_batch_id = p_batch_id)
     for update;
  perform 1 from acc_bank_transaction where import_batch_id = p_batch_id for update;

  v_locked := acc_bank_import_batch_locked_lines(p_batch_id);
  if v_locked > 0 then
    raise exception
      '% line(s) of this import have already been matched to the ledger. '
      'Unmatch them first — removing a line an entry points at would leave the books short.',
      v_locked;
  end if;

  -- Suggestions nobody approved go with their lines (on delete cascade); counted for the record.
  select count(*)::int into v_suggested
    from acc_reconciliation
   where status = 'suggested'
     and bank_transaction_id in (select id from acc_bank_transaction where import_batch_id = p_batch_id);

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
                             'suggestions_withdrawn', v_suggested,
                             'reason', btrim(p_reason)));

  return v_removed;
end;
$$;

revoke all on function acc_undo_bank_statement_import(uuid, text) from public, anon;
grant execute on function acc_undo_bank_statement_import(uuid, text)
  to authenticated, service_role;
