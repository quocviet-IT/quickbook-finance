-- ============================================================================
-- 0140  Removing a group of bank entries that are a balance, not payments
--
-- Statement alerts (1.98) flag a run of entries on a bank account that track
-- the account's own balance: a Balance column read as amounts. Removing them is
-- the hard part, because the entries have different origins and OneBook already
-- has a careful way to take each kind back:
--
--   * manual / opening_balance  reversed, never deleted (acc_reverse_entry, 0018)
--   * bank (categorised line)   void the entry, delete the line (0114)
--   * anything else             belongs to a document; the document is voided
--
-- Two functions, in this order of use:
--
--   acc_balance_entry_blockers  read-only: which of these entries cannot be
--                               removed, and what to do instead.
--   acc_remove_balance_entries  all or nothing, in one transaction. It refuses
--                               the whole request when the first function finds
--                               anything, listing every blocked entry at once.
--
-- Nothing here deletes a journal entry or a journal line. A manual entry is
-- reversed on its own date so every report for that date comes out right; a
-- bank entry is voided (status = 'void'), as Delete line does today.
--
-- A line that came in with a transactions-import batch is voided and deleted
-- directly, for that line only. acc_uncategorise_bank_transaction refuses such
-- a line ("undo that import instead") because it would leave the batch's own
-- bookkeeping half-undone; here the rest of the batch is left alone by design.
-- ============================================================================

set search_path = public;

-- ----------------------------------------------------------------------------
-- 1. Which of these entries cannot be removed, and why. One row each, with the
--    first reason that applies, in the order a person would fix them.
-- ----------------------------------------------------------------------------
create or replace function acc_balance_entry_blockers(p_entry_ids uuid[])
returns table (entry_id uuid, entry_number text, reason text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to check entries for removal';
  end if;

  return query
  with ids as (
    select distinct u.id from unnest(coalesce(p_entry_ids, '{}'::uuid[])) as u(id)
  ),
  facts as (
    select i.id as entry_id,
           e.id as found_id,
           e.entry_number,
           e.status::text as status,
           e.source_type::text as source_type,
           e.source_id,
           e.entry_date,
           exists (select 1 from acc_journal_reversal_link k where k.original_entry_id = e.id) as is_reversed,
           exists (select 1 from acc_journal_reversal_link k where k.reversal_entry_id = e.id) as is_reversal,
           (select min(sr.statement_ending_date)
              from acc_reconciliation_line rl
              join acc_statement_reconciliation sr
                on sr.id = rl.reconciliation_id and sr.status = 'completed'
              join acc_journal_line l on l.id = rl.journal_line_id
             where l.journal_entry_id = e.id) as signed_on,
           acc_is_period_closed(e.entry_date) as is_closed,
           coalesce(inv.invoice_number, bl.bill_number, pay.payment_number, ex.expense_number) as doc_number,
           -- The bank lines this entry answers for: approved matches on its own lines.
           (select count(distinct r.bank_transaction_id)
              from acc_reconciliation r
              join acc_journal_line l on l.id = r.journal_line_id
             where l.journal_entry_id = e.id and r.status = 'approved') as bank_lines,
           exists (
             select 1
               from acc_reconciliation r
               join acc_journal_line l on l.id = r.journal_line_id
               join acc_reconciliation s on s.bank_transaction_id = r.bank_transaction_id
              where l.journal_entry_id = e.id and r.status = 'approved'
                and s.status = 'approved' and s.journal_line_id is null
           ) as is_settled
      from ids i
      left join acc_journal_entry e on e.id = i.id
      left join acc_invoice inv on inv.id = e.source_id and e.source_type::text = 'invoice'
      left join acc_bill bl on bl.id = e.source_id and e.source_type::text = 'bill'
      left join acc_payment pay on pay.id = e.source_id and e.source_type::text = 'payment'
      left join acc_expense ex on ex.id = e.source_id and e.source_type::text = 'expense'
  ),
  judged as (
    select f.entry_id,
           f.entry_number,
           case
             when f.found_id is null then
               'is not in the books'
             when f.status <> 'posted' then
               'is not posted, so there is nothing to remove'
             when f.is_reversed then
               'has already been reversed'
             when f.is_reversal then
               'is itself a reversal of another entry, so it cannot be reversed again'
             when f.signed_on is not null then
               'is ticked in the reconciliation for the statement dated '
               || to_char(f.signed_on, 'Mon FMDD, YYYY')
               || '; reopen that reconciliation first'
             when f.is_closed then
               'is dated ' || to_char(f.entry_date, 'Mon FMDD, YYYY')
               || ', in a closed period; reopen the period first'
             when f.source_type not in ('manual', 'opening_balance', 'bank') then
               'belongs to '
               || case f.source_type
                    when 'bill_payment' then 'bill payment'
                    when 'tax_payment' then 'tax payment'
                    when 'goods_receipt' then 'goods receipt'
                    when 'inventory_adjustment' then 'inventory adjustment'
                    when 'asset_disposal' then 'asset disposal'
                    when 'stock_count' then 'stock count'
                    when 'reconciliation' then 'reconciliation adjustment'
                    else f.source_type
                  end
               || coalesce(' ' || f.doc_number, '')
               || '; void the '
               || case f.source_type
                    when 'bill_payment' then 'bill payment'
                    when 'tax_payment' then 'tax payment'
                    when 'goods_receipt' then 'goods receipt'
                    when 'inventory_adjustment' then 'inventory adjustment'
                    when 'asset_disposal' then 'asset disposal'
                    when 'stock_count' then 'stock count'
                    when 'reconciliation' then 'reconciliation adjustment'
                    else f.source_type
                  end
               || ' instead'
             when f.source_type = 'bank' and f.source_id is not null then
               'is a recode of another bank entry; remove that bank line instead'
             when f.source_type = 'bank' and f.is_settled then
               'is a bank line settled against an invoice or bill; remove that payment first'
             when f.source_type = 'bank' and f.bank_lines = 0 then
               'has no bank line attached, so it cannot be removed here'
             when f.source_type = 'bank' and f.bank_lines > 1 then
               'answers for more than one bank line (a transfer); delete the lines from Banking instead'
             else null
           end as why
      from facts f
  )
  select j.entry_id, j.entry_number, j.why
    from judged j
   where j.why is not null
   order by j.entry_number nulls last, j.entry_id;
end;
$$;

revoke all on function acc_balance_entry_blockers(uuid[]) from public, anon;
grant execute on function acc_balance_entry_blockers(uuid[]) to authenticated, service_role;

comment on function acc_balance_entry_blockers(uuid[]) is
  'Read-only. One row per entry that cannot be removed as a posted balance, '
  'with the reason and what to do instead. Unknown ids are reported too.';

-- ----------------------------------------------------------------------------
-- 2. Remove them, all or nothing.
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

comment on function acc_remove_balance_entries(uuid, uuid[], text) is
  'Take a flagged group of entries off a bank account in one transaction: '
  'manual and opening-balance entries are reversed on their own date, bank '
  'lines are voided and deleted. Refuses the whole request when any entry is blocked.';
