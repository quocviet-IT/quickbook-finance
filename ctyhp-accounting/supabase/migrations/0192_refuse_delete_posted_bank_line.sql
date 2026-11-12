-- ============================================================================
-- 0192  A posted, matched or reconciled bank line is not deleted (3.0.23)
--
-- Item C of the defect report of 11 Nov 2026. Any line under Bank Transactions
-- could be deleted through a warning: Delete on a line Banking had coded
-- voided its entry and removed the line in one click (0114). A warning a
-- person can click through is not a control, and it contradicts what the
-- system says elsewhere: a wrong entry is reversed, and both records stay.
--
-- 1. banking.delete_line, a permission of its own. Deleting a bank line asked
--    only for the admin or accountant role. It now also asks for this
--    permission, given to both roles so that nothing changes on the day, and
--    an administrator can take it away from a role in Settings > Permissions.
--
-- 2. acc_bank_line_delete_state(id): how one line stands with deletion, in one
--    place. The screen reads it to say why a line is not deleted and what to
--    do instead; the delete enforces it. Read only.
--
-- 3. acc_delete_bank_transaction deletes a line only when it is unposted,
--    unmatched and unreconciled, and keeps the whole row in the audit log, not
--    five of its columns: enough to put the line back by hand.
--    acc_delete_bank_transaction_with_void keeps its name for a screen opened
--    before this release, and no longer voids anything: it is the same delete.
--
-- 4. acc_unmatch_bank_transaction takes back an approved match to an entry
--    posted elsewhere. Until now an approved match could not be undone at all
--    (acc_decide_bank_match decides a suggested one only), so the refusal that
--    said "undo that match first" pointed at nothing. The entry stays posted;
--    the line goes back to waiting; the audit log keeps what was matched.
--
-- 5. Remove these N entries (acc_remove_balance_entries, 0140), for a statement's
--    Balance column read as payments, also takes a bank line out after voiding
--    its entry. It now asks for banking.delete_line as well, so withholding
--    the permission withholds every way to delete a single line, and keeps
--    each line whole in the audit log. Undoing a whole import or a whole bank
--    feed sync is a different act and is unchanged.
--
-- What takes a posted line back is unchanged: acc_uncategorise_bank_transaction
-- (0177) voids the entry Banking posted and keeps it in the journal, and still
-- refuses a line of a reconciled month. The report asks for a posted line to
-- be "reversed, both records staying visible"; in OneBook a line coded here is
-- taken back by voiding its entry, which stays in the journal marked Void, so
-- that is the way out the refusal names.
-- ============================================================================
set search_path = public;

-- ----------------------------------------------------------------------------
-- 1. The permission.
-- ----------------------------------------------------------------------------
insert into acc_permission (key, label, category, description, is_enforced, min_role)
values ('banking.delete_line', 'Delete bank lines', 'Banking',
        'Delete a bank line that is not posted, matched or reconciled, such as a duplicate import', true, 'staff')
on conflict (key) do update
set label = excluded.label,
    category = excluded.category,
    description = excluded.description,
    is_enforced = excluded.is_enforced,
    min_role = excluded.min_role;

insert into acc_role_permission (role, permission_key, allowed)
select role, 'banking.delete_line', role in ('admin'::acc_app_role, 'accountant'::acc_app_role)
  from unnest(enum_range(null::acc_app_role)) as role
on conflict (role, permission_key) do nothing;

-- ----------------------------------------------------------------------------
-- 2. How a bank line stands with deletion.
--
--    kind        what it means                                   instead
--    deletable   unposted, unmatched, unreconciled               (delete it)
--    suggested   a match is on offer and not yet decided         reject the match
--    ignored     a bank feed took the line back                  nothing to delete
--    settled     settled against an invoice or a bill            remove that payment
--    reconciled  its entry is ticked on a completed month        reopen the reconciliation
--    import_batch posted by a transactions import                undo that import
--    posted      posted by coding it in Bank Transactions        void that entry (it stays, marked Void)
--    matched     matched to an entry posted elsewhere            unmatch it
--
--    A reconciled line says so first, whatever posted it: that month was
--    signed off, and reopening it is the only way to it.
-- ----------------------------------------------------------------------------
create or replace function acc_bank_line_delete_state(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_row       acc_bank_transaction;
  v_rec       acc_reconciliation;
  v_entry     acc_journal_entry;
  v_signed_id uuid;
  v_signed_to date;
  v_number    text;
begin
  if not (acc_is_staff() or coalesce(acc_current_role() = 'viewer', false)) then
    raise exception 'Not authorized to read bank lines';
  end if;
  select * into v_row from acc_bank_transaction where id = p_id;
  if v_row.id is null then
    raise exception 'Bank transaction not found';
  end if;

  if v_row.status = 'ignored' then
    return jsonb_build_object('kind', 'ignored', 'message',
      'This line was taken back by the bank feed and is not part of the register, so there is nothing to delete.');
  end if;

  select * into v_rec
    from acc_reconciliation
   where bank_transaction_id = p_id and status = 'approved'
   order by created_at, id
   limit 1;

  if v_rec.id is null then
    if v_row.status <> 'unmatched' then
      return jsonb_build_object('kind', 'matched', 'message',
        'This line is matched, so it is not deleted. Unmatch it first: the entry and the line both stay.');
    end if;
    if exists (select 1 from acc_reconciliation where bank_transaction_id = p_id and status = 'suggested') then
      return jsonb_build_object('kind', 'suggested', 'message',
        'This line has a match suggested for it. Reject the match first, then delete the line.');
    end if;
    return jsonb_build_object('kind', 'deletable');
  end if;

  if v_rec.journal_line_id is null then
    return jsonb_build_object('kind', 'settled', 'message',
      'This line was settled against an invoice or a bill, so it is not deleted. Remove that payment to take the settlement back.');
  end if;

  select e.* into v_entry
    from acc_journal_line l
    join acc_journal_entry e on e.id = l.journal_entry_id
   where l.id = v_rec.journal_line_id;
  v_number := coalesce(v_entry.entry_number, 'a journal entry');

  select sr.id, sr.statement_ending_date into v_signed_id, v_signed_to
    from acc_reconciliation_line rl
    join acc_statement_reconciliation sr on sr.id = rl.reconciliation_id and sr.status = 'completed'
    join acc_journal_line l on l.id = rl.journal_line_id
   where l.journal_entry_id = v_entry.id
   order by sr.statement_ending_date, sr.id
   limit 1;
  if v_signed_id is not null then
    return jsonb_build_object(
      'kind', 'reconciled',
      'entry_id', v_entry.id,
      'entry_number', v_entry.entry_number,
      'reconciliation_id', v_signed_id,
      'reconciled_to', v_signed_to,
      'message', format('This line is reconciled to %s, so it is not deleted. Reopen that reconciliation to change it.',
                        to_char(v_signed_to, 'Mon FMDD, YYYY')));
  end if;

  if v_row.transaction_batch_id is not null then
    return jsonb_build_object(
      'kind', 'import_batch',
      'entry_id', v_entry.id,
      'entry_number', v_entry.entry_number,
      'message', format('This line was posted as %s by a transactions import, so it is not deleted. Undo that import to take its entries back.', v_number));
  end if;

  if v_entry.source_type = 'bank' and v_entry.source_id is null then
    return jsonb_build_object(
      'kind', 'posted',
      'entry_id', v_entry.id,
      'entry_number', v_entry.entry_number,
      'message', format('This line is posted to the ledger as %s, so it is not deleted. Void that entry first: it stays in the journal, marked Void, and the line goes back to For review.', v_number));
  end if;

  return jsonb_build_object(
    'kind', 'matched',
    'entry_id', v_entry.id,
    'entry_number', v_entry.entry_number,
    'source_type', v_entry.source_type::text,
    'message', format('This line is matched to %s, an entry posted elsewhere, so it is not deleted. Unmatch it first: the entry and the line both stay.', v_number));
end;
$$;

revoke all on function acc_bank_line_delete_state(uuid) from public, anon;
grant execute on function acc_bank_line_delete_state(uuid) to authenticated, service_role;

comment on function acc_bank_line_delete_state(uuid) is
  'How one bank line stands with deletion: deletable, or why not and what to do instead. Read only.';

-- ----------------------------------------------------------------------------
-- 3. Delete one line: only an unposted, unmatched, unreconciled one.
-- ----------------------------------------------------------------------------
create or replace function acc_delete_bank_transaction(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_row   acc_bank_transaction;
  v_state jsonb;
begin
  if not acc_is_staff() or not acc_has_permission('banking.delete_line') then
    raise exception 'You do not have permission to delete bank lines' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Say why this line is being deleted, in a sentence';
  end if;

  -- Held to the end: coding the line, matching it or settling from it waits
  -- for this rather than racing the answer read below.
  select * into v_row from acc_bank_transaction where id = p_id for update;
  if v_row.id is null then
    raise exception 'Bank transaction not found';
  end if;

  v_state := acc_bank_line_delete_state(p_id);
  if v_state ->> 'kind' <> 'deletable' then
    raise exception '%', v_state ->> 'message';
  end if;

  -- A match a person turned down goes with the line it was turned down for.
  delete from acc_bank_transaction where id = p_id;

  -- The whole row, so the line can be put back by hand from the audit log.
  insert into acc_audit_log (table_name, record_id, action, actor_id, before_json)
  values ('acc_bank_transaction', p_id, 'delete', auth.uid(),
          to_jsonb(v_row) || jsonb_build_object('reason', btrim(p_reason)));
end;
$$;

revoke all on function acc_delete_bank_transaction(uuid, text) from public, anon;
grant execute on function acc_delete_bank_transaction(uuid, text) to authenticated, service_role;

-- Kept under its name for a screen opened before 3.0.23. It no longer voids
-- an entry on the way: a posted line is refused, in the delete's own words.
create or replace function acc_delete_bank_transaction_with_void(
  p_id     uuid,
  p_reason text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not acc_is_staff() then
    raise exception 'You do not have permission to delete bank lines' using errcode = '42501';
  end if;
  perform acc_delete_bank_transaction(p_id, p_reason);
end;
$$;

revoke all on function acc_delete_bank_transaction_with_void(uuid, text) from public, anon;
grant execute on function acc_delete_bank_transaction_with_void(uuid, text)
  to authenticated, service_role;

comment on function acc_delete_bank_transaction_with_void(uuid, text) is
  'Since 0192 the same as acc_delete_bank_transaction: a posted, matched or reconciled line is refused, never voided on the way.';

-- ----------------------------------------------------------------------------
-- 4. Unmatch: take back an approved match to an entry posted elsewhere.
-- ----------------------------------------------------------------------------
create or replace function acc_unmatch_bank_transaction(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_row   acc_bank_transaction;
  v_rec   acc_reconciliation;
  v_state jsonb;
  v_kind  text;
begin
  if not acc_is_staff() or not acc_has_permission('banking.match') then
    raise exception 'You do not have permission to review bank matches' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Say why this line is being unmatched, in a sentence';
  end if;

  select * into v_row from acc_bank_transaction where id = p_id for update;
  if v_row.id is null then
    raise exception 'Bank transaction not found';
  end if;

  v_state := acc_bank_line_delete_state(p_id);
  v_kind := v_state ->> 'kind';
  if v_kind = 'reconciled' then
    raise exception 'This line is reconciled to %, so it is not unmatched. Reopen that reconciliation to change it.',
      to_char((v_state ->> 'reconciled_to')::date, 'Mon FMDD, YYYY');
  elsif v_kind = 'posted' then
    raise exception 'This line was posted here as %, not matched to an entry posted elsewhere. Void that entry instead.',
      coalesce(v_state ->> 'entry_number', 'a journal entry');
  elsif v_kind = 'settled' then
    raise exception 'This line was settled against an invoice or a bill. Remove that payment instead.';
  elsif v_kind = 'import_batch' then
    raise exception 'This line was posted by a transactions import. Undo that import instead.';
  elsif v_kind = 'suggested' then
    raise exception 'This line''s match is only suggested. Reject it instead.';
  elsif v_kind <> 'matched' then
    raise exception 'This line is not matched to an entry.';
  end if;

  select * into v_rec
    from acc_reconciliation
   where bank_transaction_id = p_id and status = 'approved' and journal_line_id is not null
   order by created_at, id
   limit 1
     for update;
  if v_rec.id is null then
    raise exception 'This line is not matched to an entry.';
  end if;

  delete from acc_reconciliation where id = v_rec.id;
  update acc_bank_transaction set status = 'unmatched', updated_at = now() where id = p_id;

  insert into acc_audit_log (table_name, record_id, action, actor_id, before_json)
  values ('acc_bank_transaction', p_id, 'unmatch', auth.uid(),
          jsonb_build_object('reconciliation_id', v_rec.id,
                             'journal_line_id', v_rec.journal_line_id,
                             'journal_entry_id', v_state -> 'entry_id',
                             'entry_number', v_state -> 'entry_number',
                             'rule_applied', v_rec.rule_applied,
                             'approved_by', v_rec.approved_by,
                             'reason', btrim(p_reason)));
end;
$$;

revoke all on function acc_unmatch_bank_transaction(uuid, text) from public, anon;
grant execute on function acc_unmatch_bank_transaction(uuid, text) to authenticated, service_role;

comment on function acc_unmatch_bank_transaction(uuid, text) is
  'Take back an approved match to an entry posted elsewhere. The entry stays posted; the line waits for review again.';


-- ----------------------------------------------------------------------------
-- 5. Remove these N entries (0140) deletes the bank line of an entry coded in
--    Bank Transactions after voiding the entry. That is the one other place a
--    single bank line leaves the register, so it now asks for
--    banking.delete_line too, and keeps each line whole in the audit log.
--    The body is 0140's, copied from the file, with only those two additions.
-- ----------------------------------------------------------------------------
create or replace function acc_remove_balance_entries(
  p_bank_account_id uuid,
  p_entry_ids       uuid[],
  p_reason          text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ledger    uuid;
  v_ledger_nm text;
  v_reason    text := btrim(coalesce(p_reason, ''));
  v_count     int;
  v_off       int;
  v_blocked   int;
  v_list      text;
  v_entry     acc_journal_entry;
  v_lines     jsonb;
  v_rev       uuid;
  v_txn       uuid;
  v_total     bigint;
  v_reversed  int := 0;
  v_voided    int := 0;
  v_payee     text;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to remove entries';
  end if;
  if not acc_has_permission('journal.post') then
    raise exception 'You do not have permission to post journal entries';
  end if;
  if v_reason = '' then
    raise exception 'A reason is required to remove these entries';
  end if;
  if p_entry_ids is null or cardinality(p_entry_ids) = 0 then
    raise exception 'Choose at least one entry to remove';
  end if;
  if exists (select 1 from unnest(p_entry_ids) as u(id) where u.id is null) then
    raise exception 'The list of entries holds an empty id';
  end if;
  select count(distinct u.id) into v_count from unnest(p_entry_ids) as u(id);
  if v_count <> cardinality(p_entry_ids) then
    raise exception 'The list of entries names the same entry more than once';
  end if;

  select b.account_id, a.name into v_ledger, v_ledger_nm
    from acc_bank_account b join acc_account a on a.id = b.account_id
   where b.id = p_bank_account_id;
  if v_ledger is null then
    raise exception 'Bank account not found';
  end if;

  -- Held to the end of the transaction, in id order so two removals that
  -- overlap wait for each other instead of deadlocking. Whoever comes second
  -- then finds the entries reversed or void and is refused by name.
  perform 1 from acc_journal_entry where id = any (p_entry_ids) order by id for update;

  -- Every entry that exists must sit on this bank account. An id that does not
  -- exist at all is reported by the blockers below, with the others.
  select count(*) into v_off
    from acc_journal_entry e
   where e.id = any (p_entry_ids)
     and not exists (select 1 from acc_journal_line l
                      where l.journal_entry_id = e.id and l.account_id = v_ledger);
  if v_off > 0 then
    raise exception '% of these entries have no line on %, so they are not part of this account',
      v_off, v_ledger_nm;
  end if;

  select count(*), string_agg(coalesce(b.entry_number, 'an unknown entry') || ' (' || b.reason || ')',
                              '; ' order by b.entry_number nulls last, b.entry_id)
    into v_blocked, v_list
    from acc_balance_entry_blockers(p_entry_ids) b;
  if v_blocked > 0 then
    raise exception '% of these entries cannot be removed: %', v_blocked, v_list;
  end if;

  -- What is being taken off the account, and what the entries were called.
  select coalesce(sum(case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end), 0)
    into v_total
    from acc_journal_line l
   where l.journal_entry_id = any (p_entry_ids) and l.account_id = v_ledger;

  select case when count(*) = count(nullif(btrim(e.description), ''))
               and count(distinct lower(btrim(e.description))) = 1
              then min(btrim(e.description)) end
    into v_payee
    from acc_journal_entry e
   where e.id = any (p_entry_ids);

  for v_entry in
    select * from acc_journal_entry where id = any (p_entry_ids) order by entry_date, entry_number
  loop
    -- A line ticked in a session still in progress is let go, so the session
    -- does not carry a tick for an entry that is no longer standing.
    delete from acc_reconciliation_line rl
     using acc_journal_line l, acc_statement_reconciliation sr
     where rl.journal_line_id = l.id and l.journal_entry_id = v_entry.id
       and sr.id = rl.reconciliation_id and sr.status <> 'completed';

    if v_entry.source_type::text in ('manual', 'opening_balance') then
      -- Marked exactly as acc_reverse_entry marks one: same source type, source
      -- id pointing at the original, a link row, an audit row.
      select jsonb_agg(jsonb_build_object(
               'account_id', l.account_id,
               'debit_minor', l.credit_minor,          -- swap
               'credit_minor', l.debit_minor,          -- swap
               'amount_base_minor', l.amount_base_minor,
               'tax_code_id', l.tax_code_id,
               'memo', 'Reversal: ' || coalesce(l.memo, '')
             ) order by l.line_order)
        into v_lines
        from acc_journal_line l
       where l.journal_entry_id = v_entry.id;

      v_rev := acc_post_entry(v_entry.entry_date,
                 'Reversal of ' || v_entry.entry_number || ' — ' || v_reason,
                 v_entry.source_type, v_entry.id, v_entry.currency_code, v_lines);

      insert into acc_journal_reversal_link (original_entry_id, reversal_entry_id, reason, created_by)
        values (v_entry.id, v_rev, v_reason, auth.uid());
      insert into acc_audit_log (table_name, record_id, action, actor_id)
        values ('acc_journal_entry', v_entry.id, 'reverse', auth.uid());
      v_reversed := v_reversed + 1;
    else
      -- A categorised bank line: void its entry (and any recode of it) and take
      -- the line out, the way Delete line does. The blockers guaranteed exactly
      -- one bank line, not settled against a document.
      select r.bank_transaction_id into v_txn
        from acc_reconciliation r
        join acc_journal_line l on l.id = r.journal_line_id
       where l.journal_entry_id = v_entry.id and r.status = 'approved'
       limit 1;
      perform 1 from acc_bank_transaction where id = v_txn for update;
      -- 0192: taking a bank line out of the register asks for banking.delete_line
      -- wherever it is done from, and keeps the whole line in the audit log.
      if not acc_has_permission('banking.delete_line') then
        raise exception 'You do not have permission to delete bank lines, and % is coded from a bank line',
          v_entry.entry_number;
      end if;
      insert into acc_audit_log (table_name, record_id, action, actor_id, before_json)
      select 'acc_bank_transaction', t.id, 'delete', auth.uid(),
             to_jsonb(t) || jsonb_build_object('reason', v_reason,
                                               'removed_with', 'balance entries',
                                               'journal_entry_id', v_entry.id)
        from acc_bank_transaction t
       where t.id = v_txn;

      update acc_journal_entry set status = 'void', voided_at = now()
       where (id = v_entry.id or (source_type = 'bank' and source_id = v_entry.id))
         and status = 'posted';
      delete from acc_reconciliation where bank_transaction_id = v_txn;
      delete from acc_bank_transaction where id = v_txn;
      v_voided := v_voided + 1;
    end if;
  end loop;

  insert into acc_audit_log (table_name, record_id, action, actor_id, before_json)
  values ('acc_bank_account', p_bank_account_id, 'remove_balance_entries', auth.uid(),
          jsonb_build_object('account', v_ledger_nm,
                             'payee', v_payee,
                             'count', v_count,
                             'reversed', v_reversed,
                             'voided', v_voided,
                             'total_minor', v_total,
                             'reason', v_reason));

  return jsonb_build_object('removed', v_count, 'reversed', v_reversed,
                            'voided', v_voided, 'total_minor', v_total);
end;
$$;

revoke all on function acc_remove_balance_entries(uuid, uuid[], text) from public, anon;
grant execute on function acc_remove_balance_entries(uuid, uuid[], text) to authenticated, service_role;
