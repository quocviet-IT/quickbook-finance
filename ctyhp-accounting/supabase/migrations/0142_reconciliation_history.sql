-- ============================================================================
-- 0142  Reconciliation history: bring it forward, discard a session, set a
--       statement line aside, and find a line the books may already hold (2.03)
--
-- A bank account whose books were loaded from another program starts its first
-- reconciliation at 0.00, with years of posted lines that no reconciliation
-- holds. Bringing the history forward signs those lines off as one completed
-- reconciliation, and only when the books prove it: the book balance through
-- the chosen date must equal, to the cent, the balance the bank's statement
-- shows on that date. Nothing is posted to make the figures agree; a mismatch
-- is refused with the amount it is out by.
--
--   acc_bring_history_forward        the rule itself. It also works while a
--                                    reconciliation is in progress, provided
--                                    that session ends after the date: its ticks
--                                    on the earlier lines move into the history,
--                                    and it then begins at the statement balance.
--   acc_bring_forward_reconciliation (0132) now calls it, so From statement
--                                    files follows the same rule. It keeps its
--                                    own extra condition: the account has no
--                                    reconciliation at all.
--   acc_discard_reconciliation       a session in progress, deleted with its
--                                    ticks and statement lines. The statement
--                                    file, the bank lines imported from it and
--                                    any entries added to the books from it all
--                                    stay. Refused while it holds an adjustment
--                                    entry that is not void, which would
--                                    otherwise point at a session that is gone.
--   acc_reconciliation_history       one row per bank account: its lines no
--                                    completed reconciliation holds, the last
--                                    completed ending date, the session in
--                                    progress. One row per account, so the API's
--                                    1,000-row cap never reaches it.
--   acc_set_statement_line_aside     marks a statement line as not a
--                                    transaction (a misread PDF row), or brings
--                                    it back. Whether a line is paired with the
--                                    books is worked out in the application
--                                    (statementStandings) and is not stored, so
--                                    the refusal of a paired line lives in the
--                                    reconcile service, not here.
--   acc_statement_line_duplicates    for statement lines about to be added to
--                                    the books, the posted lines on the account
--                                    with the same signed amount and either the
--                                    same cheque number or a date within 5 days.
--                                    A warning for the person, never a block:
--                                    two identical lines on one day can both be
--                                    real.
--
-- "Open" means what it means in acc_bank_open_lines (0133): a posted line on
-- the account's ledger account that no COMPLETED reconciliation holds. Amounts
-- are signed as the pairing signs them: a debit to the bank is money in.
--
-- Every function is security definer with its search path pinned, checks the
-- caller's role itself (staff to write, staff or viewer to read), and is
-- executable by signed-in users and the service role only. Nothing here posts
-- an entry. Additive: one column and five new functions; 0132's function is
-- replaced with the same signature and grants.
-- ============================================================================

set search_path = public;

-- ----------------------------------------------------------------------------
-- 1. A statement line set aside as not a transaction. Replacing a session's
--    statement (acc_recon_write_statement) writes new lines, so the marks on
--    the old ones go with them.
-- ----------------------------------------------------------------------------
alter table acc_reconciliation_statement_line
  add column if not exists set_aside boolean not null default false;

-- ----------------------------------------------------------------------------
-- 2. Bring the history forward through a date, proved by the statement's
--    balance on that date. Returns the new session, the lines it holds, how
--    many of them were moved out of the session in progress, and that
--    session's id when there is one.
-- ----------------------------------------------------------------------------
create or replace function acc_bring_history_forward(
  p_bank_account_id uuid, p_through date, p_balance_minor bigint, p_note text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_gl      uuid;
  v_account text;
  v_today   date;
  v_open    acc_statement_reconciliation;
  v_balance bigint;
  v_id      uuid;
  v_moved   integer := 0;
  v_added   integer := 0;
  v_note    text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to bring a bank account forward';
  end if;
  if p_through is null then
    raise exception 'Choose the date the history is brought forward through';
  end if;
  if p_balance_minor is null then
    raise exception 'Enter the statement balance on that date';
  end if;
  -- Today in the company's own time zone, as the screens count it.
  v_today := coalesce(
    (select (now() at time zone s.time_zone)::date
       from acc_company_setting_version s order by s.version desc limit 1),
    current_date);
  if p_through > v_today then
    raise exception 'A bank account cannot be brought forward past today';
  end if;

  -- The row lock serialises this with any reconciliation being created for the
  -- account, as in 0132: an insert into acc_statement_reconciliation holds FOR
  -- KEY SHARE on this row through its foreign key until it commits, which FOR
  -- UPDATE waits for; the checks below then see that reconciliation.
  select b.account_id, a.name into v_gl, v_account
    from acc_bank_account b join acc_account a on a.id = b.account_id
   where b.id = p_bank_account_id
     for update of b;
  if v_gl is null then
    raise exception 'Bank account not found';
  end if;
  if exists (select 1 from acc_statement_reconciliation
              where bank_account_id = p_bank_account_id and status = 'completed') then
    raise exception 'This account already has a completed reconciliation.';
  end if;

  -- The session in progress, if any, locked so no tick lands in it meanwhile.
  select * into v_open from acc_statement_reconciliation
   where bank_account_id = p_bank_account_id and status = 'in_progress'
     for update;
  if v_open.id is not null and v_open.statement_ending_date <= p_through then
    raise exception 'Finish or discard the reconciliation in progress first.';
  end if;

  select coalesce(sum(case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end), 0)::bigint
    into v_balance
    from acc_journal_line l
    join acc_journal_entry e on e.id = l.journal_entry_id
   where l.account_id = v_gl and e.status = 'posted' and e.entry_date <= p_through;
  if v_balance <> p_balance_minor then
    raise exception 'The books hold % on %; the statement shows %. Out by %.',
      to_char(v_balance / 100.0, 'FM999,999,999,990.00'),
      to_char(p_through, 'Mon FMDD, YYYY'),
      to_char(p_balance_minor / 100.0, 'FM999,999,999,990.00'),
      to_char(abs(v_balance - p_balance_minor) / 100.0, 'FM999,999,999,990.00');
  end if;

  insert into acc_statement_reconciliation
    (bank_account_id, statement_ending_date, beginning_balance_minor, statement_ending_balance_minor,
     status, prepared_by, completed_by, completed_at, note, brought_forward)
  values (p_bank_account_id, p_through, 0, p_balance_minor,
          'completed', auth.uid(), auth.uid(), now(), v_note, true)
  returning id into v_id;

  -- The session in progress gives up its ticks on the earlier lines, keeping
  -- when each was ticked. A tick on an entry voided since is left where it is:
  -- it counts for nothing there, and in a completed session it would read as
  -- a discrepancy.
  if v_open.id is not null then
    with moved as (
      delete from acc_reconciliation_line rl
       using acc_journal_line l, acc_journal_entry e
       where rl.reconciliation_id = v_open.id
         and l.id = rl.journal_line_id
         and e.id = l.journal_entry_id
         and e.status = 'posted'
         and e.entry_date <= p_through
      returning rl.journal_line_id, rl.cleared_at
    )
    insert into acc_reconciliation_line (reconciliation_id, journal_line_id, cleared_at)
    select v_id, m.journal_line_id, m.cleared_at from moved m;
    get diagnostics v_moved = row_count;
  end if;

  -- Every other posted line through the date. No completed reconciliation
  -- exists for the account, so none of them is held elsewhere.
  insert into acc_reconciliation_line (reconciliation_id, journal_line_id)
  select v_id, l.id
    from acc_journal_line l
    join acc_journal_entry e on e.id = l.journal_entry_id
   where l.account_id = v_gl and e.status = 'posted' and e.entry_date <= p_through
     and not exists (select 1 from acc_reconciliation_line x
                      where x.reconciliation_id = v_id and x.journal_line_id = l.id);
  get diagnostics v_added = row_count;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values ('acc_statement_reconciliation', v_id, 'insert', auth.uid(),
          jsonb_build_object('bank_account_id', p_bank_account_id,
                             'account', v_account,
                             'brought_forward', true,
                             'through', p_through,
                             'balance_minor', p_balance_minor,
                             'lines', v_moved + v_added,
                             'moved', v_moved)),
         ('acc_statement_reconciliation', v_id, 'post', auth.uid(), null);

  if v_open.id is not null then
    update acc_statement_reconciliation
       set beginning_balance_minor = p_balance_minor, updated_at = now()
     where id = v_open.id;
    insert into acc_audit_log (table_name, record_id, action, actor_id, before_json, after_json)
    values ('acc_statement_reconciliation', v_open.id, 'update', auth.uid(),
            jsonb_build_object('beginning_balance_minor', v_open.beginning_balance_minor),
            jsonb_build_object('bank_account_id', p_bank_account_id,
                               'account', v_account,
                               'through', p_through,
                               'beginning_balance_minor', p_balance_minor,
                               'lines', v_moved,
                               'brought_forward_id', v_id));
  end if;

  return jsonb_build_object('reconciliation_id', v_id,
                            'lines', v_moved + v_added,
                            'moved', v_moved,
                            'rebased_reconciliation_id', v_open.id);
end;
$$;
revoke all on function acc_bring_history_forward(uuid, date, bigint, text) from public, anon;
grant execute on function acc_bring_history_forward(uuid, date, bigint, text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. 0132's bring-forward, on the shared rule. Same signature and grants; it
--    keeps its own condition that the account has no reconciliation at all.
-- ----------------------------------------------------------------------------
create or replace function acc_bring_forward_reconciliation(
  p_bank_account_id uuid, p_through date, p_opening_minor bigint, p_note text
) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to bring a bank account forward';
  end if;
  perform 1 from acc_bank_account where id = p_bank_account_id for update;
  if not found then
    raise exception 'Bank account not found';
  end if;
  if exists (select 1 from acc_statement_reconciliation where bank_account_id = p_bank_account_id) then
    raise exception 'This bank account already has a reconciliation; only the first one can be brought forward';
  end if;
  return (acc_bring_history_forward(p_bank_account_id, p_through, p_opening_minor, p_note)
            ->> 'reconciliation_id')::uuid;
end;
$$;
revoke all on function acc_bring_forward_reconciliation(uuid, date, bigint, text) from public, anon;
grant execute on function acc_bring_forward_reconciliation(uuid, date, bigint, text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. Discard a reconciliation in progress. Returns the number of ticks removed.
-- ----------------------------------------------------------------------------
create or replace function acc_discard_reconciliation(p_reconciliation_id uuid, p_reason text)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_rec     acc_statement_reconciliation;
  v_adj     acc_journal_entry;
  v_account text;
  v_ticks   integer;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to discard a reconciliation';
  end if;
  if v_reason = '' then
    raise exception 'A reason is required to discard a reconciliation';
  end if;
  select * into v_rec from acc_statement_reconciliation where id = p_reconciliation_id for update;
  if not found then
    raise exception 'Reconciliation not found';
  end if;
  if v_rec.status <> 'in_progress' then
    raise exception 'Only a reconciliation in progress can be discarded';
  end if;
  if v_rec.adjustment_entry_id is not null then
    select * into v_adj from acc_journal_entry where id = v_rec.adjustment_entry_id;
    if found and v_adj.status <> 'void' then
      raise exception 'This reconciliation posted an adjustment (%), so it cannot be discarded.', v_adj.entry_number;
    end if;
  end if;

  select a.name into v_account
    from acc_bank_account b join acc_account a on a.id = b.account_id
   where b.id = v_rec.bank_account_id;
  select count(*)::integer into v_ticks
    from acc_reconciliation_line where reconciliation_id = p_reconciliation_id;

  -- Its ticks and its statement lines go with it (on delete cascade).
  delete from acc_statement_reconciliation where id = p_reconciliation_id;

  insert into acc_audit_log (table_name, record_id, action, actor_id, before_json)
  values ('acc_statement_reconciliation', p_reconciliation_id, 'delete', auth.uid(),
          jsonb_build_object('bank_account_id', v_rec.bank_account_id,
                             'account', v_account,
                             'statement_ending_date', v_rec.statement_ending_date,
                             'ticks', v_ticks,
                             'reason', v_reason));
  return v_ticks;
end;
$$;
revoke all on function acc_discard_reconciliation(uuid, text) from public, anon;
grant execute on function acc_discard_reconciliation(uuid, text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. Every bank account's reconciliation history, one row each. Read only.
-- ----------------------------------------------------------------------------
create or replace function acc_reconciliation_history()
returns table (bank_account_id uuid, open_lines integer, first_open_date date, last_open_date date,
               last_reconciled_date date, in_progress_id uuid, in_progress_ending_date date)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (acc_is_staff() or coalesce(acc_current_role() = 'viewer', false)) then
    raise exception 'Not authorized to read reconciliation history';
  end if;
  return query
  with held as (
    select rl.journal_line_id as line_id
      from acc_reconciliation_line rl
      join acc_statement_reconciliation r on r.id = rl.reconciliation_id
     where r.status = 'completed'
  ),
  unheld as (
    select l.account_id as gl_id, count(*)::integer as n,
           min(e.entry_date) as first_on, max(e.entry_date) as last_on
      from acc_journal_line l
      join acc_journal_entry e on e.id = l.journal_entry_id
     where e.status = 'posted'
       and l.account_id in (select b.account_id from acc_bank_account b)
       and not exists (select 1 from held h where h.line_id = l.id)
     group by l.account_id
  ),
  last_done as (
    select r.bank_account_id as bank_id, max(r.statement_ending_date) as last_on
      from acc_statement_reconciliation r
     where r.status = 'completed'
     group by r.bank_account_id
  )
  select b.id, coalesce(u.n, 0), u.first_on, u.last_on, d.last_on, ip.id, ip.statement_ending_date
    from acc_bank_account b
    left join unheld u on u.gl_id = b.account_id
    left join last_done d on d.bank_id = b.id
    left join acc_statement_reconciliation ip on ip.bank_account_id = b.id and ip.status = 'in_progress'
   order by b.created_at, b.id;
end;
$$;
revoke all on function acc_reconciliation_history() from public, anon;
grant execute on function acc_reconciliation_history() to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. Set a statement line aside as not a transaction (p_aside true), or bring
--    it back (false). Setting it to what it already is changes nothing.
-- ----------------------------------------------------------------------------
create or replace function acc_set_statement_line_aside(
  p_reconciliation_id uuid, p_line_no integer, p_aside boolean
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_rec  acc_statement_reconciliation;
  v_line acc_reconciliation_statement_line;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to set a statement line aside';
  end if;
  if p_aside is null then
    raise exception 'Say whether the line is set aside or brought back';
  end if;
  select * into v_rec from acc_statement_reconciliation where id = p_reconciliation_id for update;
  if not found then
    raise exception 'Reconciliation not found';
  end if;
  if v_rec.status <> 'in_progress' then
    raise exception 'Reconciliation is not in progress';
  end if;
  select * into v_line from acc_reconciliation_statement_line
   where reconciliation_id = p_reconciliation_id and line_no = p_line_no
     for update;
  if not found then
    raise exception 'Statement line not found';
  end if;
  if v_line.set_aside = p_aside then
    return;
  end if;

  update acc_reconciliation_statement_line set set_aside = p_aside where id = v_line.id;
  insert into acc_audit_log (table_name, record_id, action, actor_id, before_json, after_json)
  values ('acc_statement_reconciliation', p_reconciliation_id, 'update', auth.uid(),
          jsonb_build_object('line_no', v_line.line_no, 'set_aside', v_line.set_aside),
          jsonb_build_object('line_no', v_line.line_no, 'txn_date', v_line.txn_date,
                             'amount_minor', v_line.amount_minor, 'set_aside', p_aside));
end;
$$;
revoke all on function acc_set_statement_line_aside(uuid, integer, boolean) from public, anon;
grant execute on function acc_set_statement_line_aside(uuid, integer, boolean) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 7. Lines the books may already hold. For each statement line asked about,
--    the posted lines on the session's bank ledger account with the same
--    signed amount and either an equal cheque number or a date within 5 days.
--    Cheque numbers are cleaned as the pairing cleans them (cleanReference in
--    lib/domain/statement-pairing.ts: letters, digits and hyphens only), on
--    both sides; an empty one never matches. The book line's reference is the
--    one acc_reconciliation_lines gives it. Read only.
-- ----------------------------------------------------------------------------
create or replace function acc_statement_line_duplicates(p_reconciliation_id uuid, p_line_nos integer[])
returns table (line_no integer, journal_line_id uuid, entry_id uuid, entry_number text, entry_date date)
language plpgsql stable security definer set search_path = public as $$
declare
  v_gl uuid;
begin
  if not (acc_is_staff() or coalesce(acc_current_role() = 'viewer', false)) then
    raise exception 'Not authorized to look for duplicate lines';
  end if;
  if coalesce(cardinality(p_line_nos), 0) > 500 then
    raise exception 'At most 500 statement lines can be checked at once';
  end if;
  select b.account_id into v_gl
    from acc_statement_reconciliation r join acc_bank_account b on b.id = r.bank_account_id
   where r.id = p_reconciliation_id;
  if v_gl is null then
    raise exception 'Reconciliation not found';
  end if;

  return query
  with asked as (
    select s.line_no as ask_no, s.txn_date as ask_on, s.amount_minor as ask_minor,
           regexp_replace(coalesce(s.reference, ''), '[^0-9A-Za-z-]', '', 'g') as ask_ref
      from acc_reconciliation_statement_line s
     where s.reconciliation_id = p_reconciliation_id
       and s.line_no = any (p_line_nos)
  ),
  book as (
    select l.id as line_id, e.id as e_id, e.entry_number as e_number, e.entry_date as e_on,
           (case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end)::bigint as b_minor,
           regexp_replace(coalesce(nullif(btrim(e.source_ref), ''), p.reference, bp.reference, ''),
                          '[^0-9A-Za-z-]', '', 'g') as b_ref
      from acc_journal_line l
      join acc_journal_entry e on e.id = l.journal_entry_id
      left join acc_payment p on e.source_type = 'payment' and p.id = e.source_id
      left join acc_bill_payment bp on e.source_type = 'bill_payment' and bp.id = e.source_id
     where l.account_id = v_gl
       and e.status = 'posted'
  )
  select a.ask_no, k.line_id, k.e_id, k.e_number, k.e_on
    from asked a
    join book k on k.b_minor = a.ask_minor
   where (a.ask_ref <> '' and k.b_ref = a.ask_ref)
      or abs(k.e_on - a.ask_on) <= 5
   order by a.ask_no, k.e_on, k.e_number, k.line_id;
end;
$$;
revoke all on function acc_statement_line_duplicates(uuid, integer[]) from public, anon;
grant execute on function acc_statement_line_duplicates(uuid, integer[]) to authenticated, service_role;
