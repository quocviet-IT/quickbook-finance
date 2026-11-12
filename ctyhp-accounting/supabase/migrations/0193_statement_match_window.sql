-- ============================================================================
-- 0193  The statement matching window is the company's to set (3.0.24)
--
-- Item E of the defect report of 11 Nov 2026 asks to say what counts as a
-- match: the same account, the same amount, and a date within a tolerance
-- window the company can set. The window was 5 days, written into the pairing
-- (lib/domain/statement-pairing.ts) and into acc_statement_line_duplicates
-- (0142), which holds back from Add all a line the books seem to have.
--
-- 1. acc_banking_preference.match_window_days, 0 to 31, 5 by default: every
--    company keeps the 5 days it had until someone changes it.
-- 2. acc_statement_match_window(): the window, read in one place. Any member
--    may read it; it is a setting, not a figure.
-- 3. acc_save_statement_match_window(days): staff, as the other banking
--    preferences are. The row's audit trigger (0127) keeps the old and the
--    new value.
-- 4. acc_statement_line_duplicates reads the window instead of 5. Its body is
--    0142's, copied from the file, with only that change.
--
-- Additive for data: one column with a default. No row changes.
-- ============================================================================
set search_path = public;

alter table acc_banking_preference
  add column if not exists match_window_days integer not null default 5;
alter table acc_banking_preference
  drop constraint if exists acc_banking_preference_match_window_ck;
alter table acc_banking_preference
  add constraint acc_banking_preference_match_window_ck check (match_window_days between 0 and 31);

comment on column acc_banking_preference.match_window_days is
  'How many days apart a statement line and a book entry of the same amount may be dated and still pair (3.0.24).';

-- ----------------------------------------------------------------------------
-- The window, read in one place.
-- ----------------------------------------------------------------------------
create or replace function acc_statement_match_window() returns integer
language sql stable security definer set search_path = public as $$
  select acc_assert_member();
  select coalesce((select match_window_days from acc_banking_preference where singleton), 5);
$$;

revoke all on function acc_statement_match_window() from public, anon;
grant execute on function acc_statement_match_window() to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Saving it.
-- ----------------------------------------------------------------------------
create or replace function acc_save_statement_match_window(p_days integer) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to change the banking preferences' using errcode = '42501';
  end if;
  if p_days is null or p_days < 0 or p_days > 31 then
    raise exception 'Choose a window from 0 to 31 days';
  end if;
  insert into acc_banking_preference (singleton, match_window_days)
  values (true, p_days)
  on conflict (singleton) do update
    set match_window_days = excluded.match_window_days,
        updated_at = now();
end;
$$;

revoke all on function acc_save_statement_match_window(integer) from public, anon;
grant execute on function acc_save_statement_match_window(integer) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Lines the books may already hold, within the company's window (0142's body).
-- ----------------------------------------------------------------------------
create or replace function acc_statement_line_duplicates(p_reconciliation_id uuid, p_line_nos integer[])
returns table (line_no integer, journal_line_id uuid, entry_id uuid, entry_number text, entry_date date)
language plpgsql stable security definer set search_path = public as $$
declare
  v_gl uuid;
  v_window integer := acc_statement_match_window();
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
      or abs(k.e_on - a.ask_on) <= v_window
   order by a.ask_no, k.e_on, k.e_number, k.line_id;
end;
$$;
revoke all on function acc_statement_line_duplicates(uuid, integer[]) from public, anon;
grant execute on function acc_statement_line_duplicates(uuid, integer[]) to authenticated, service_role;
