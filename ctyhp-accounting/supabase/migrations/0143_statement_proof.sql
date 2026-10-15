-- ============================================================================
-- 0143  Statement proof: a statement is imported only when it adds up, and an
--       account's bank lines are read with the source each came from (2.04)
--
-- A statement proves itself when its opening balance plus its lines comes to
-- its closing balance, to the cent. Until now only a PDF was checked, only on
-- the screen, and the person could still press "Import anyway". Now the
-- database checks again, from what it is sent, and refuses a statement that
-- does not add up unless an administrator imports it anyway with a reason. The
-- reason is kept on the import and in the audit log.
--
--   acc_import_bank_statement_proved  the rule, then the import. It is sent
--                                     every line of the statement except the
--                                     ones marked Not a transaction. A line
--                                     already in Bank Transactions from another
--                                     source comes with "skip": true: it counts
--                                     in the proof and is not imported. The
--                                     other lines go through
--                                     acc_import_bank_statement (0058) itself,
--                                     so the hashes, the duplicate rule, the
--                                     batch, the skipped count and the audit
--                                     row are the ones every import has. The
--                                     proof is then kept on that batch. When no
--                                     line is left to import, nothing is
--                                     written and no batch is made.
--   acc_bank_lines_on                 an account's bank lines between two
--                                     dates, each with the kind of source it
--                                     came from: the books (a ledger: hash), a
--                                     bank feed, an import (a statement or a
--                                     transactions file), or other. Read only;
--                                     the import dialog counts repeated lines
--                                     and warns of lines from another source
--                                     with it. Ordered by date and id, so a
--                                     caller can page past the API's 1,000-row
--                                     cap. A feed line the bank has since
--                                     withdrawn is not in Bank Transactions and
--                                     is left out.
--
-- The opening and closing are never worked out from the books. The screen
-- sends the figure printed on the statement, read from its running balance,
-- carried from the prior reconciliation, or typed, and says which: the basis.
-- A figure taken from the books would agree with the books whatever the truth
-- was. The amount out is opening + lines - closing, kept signed on the batch;
-- the refusal says it as a positive amount.
--
-- The proof columns are evidence, so only the import writes them: staff may
-- write import batches directly, and a guard refuses any other insert or
-- change of these columns, as 0135 guards the statement file. The import opens
-- the guard for its own write and closes it again.
--
-- acc_import_bank_statement stays as it was, so the running release keeps
-- working until this one is deployed. A later release revokes it.
--
-- Every function is security definer with its search path pinned, checks the
-- caller's role itself (staff to import, an administrator to import anyway,
-- staff or viewer to read), and is executable by signed-in users and the
-- service role only. Nothing here posts an entry. Additive: seven nullable
-- columns on acc_bank_import_batch, their guard, and two new functions.
-- ============================================================================

set search_path = public;

-- ----------------------------------------------------------------------------
-- 1. The proof, kept on the import batch. Null on every batch imported before
--    this release, and on any made through acc_import_bank_statement.
-- ----------------------------------------------------------------------------
alter table acc_bank_import_batch
  add column if not exists statement_opening_minor bigint,
  add column if not exists statement_closing_minor bigint,
  add column if not exists opening_basis text,
  add column if not exists closing_basis text,
  add column if not exists out_by_minor bigint,
  add column if not exists override_reason text,
  add column if not exists overridden_by uuid;

alter table acc_bank_import_batch drop constraint if exists acc_bank_import_batch_opening_basis_ck;
alter table acc_bank_import_batch add constraint acc_bank_import_batch_opening_basis_ck
  check (opening_basis in ('printed', 'running', 'prior', 'typed'));

alter table acc_bank_import_batch drop constraint if exists acc_bank_import_batch_closing_basis_ck;
alter table acc_bank_import_batch add constraint acc_bank_import_batch_closing_basis_ck
  check (closing_basis in ('printed', 'running', 'ledger', 'typed'));

alter table acc_bank_import_batch drop constraint if exists acc_bank_import_batch_override_reason_ck;
alter table acc_bank_import_batch add constraint acc_bank_import_batch_override_reason_ck
  check (char_length(override_reason) <= 500);

-- ----------------------------------------------------------------------------
-- 2. Only the import writes the proof. A batch inserted without one, and a
--    change that leaves it as it was, pass.
-- ----------------------------------------------------------------------------
create or replace function acc_statement_proof_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('acc.statement_proof_change', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.statement_opening_minor is null and new.statement_closing_minor is null
       and new.opening_basis is null and new.closing_basis is null and new.out_by_minor is null
       and new.override_reason is null and new.overridden_by is null then
      return new;
    end if;
  elsif (new.statement_opening_minor, new.statement_closing_minor, new.opening_basis, new.closing_basis,
         new.out_by_minor, new.override_reason, new.overridden_by)
        is not distinct from
        (old.statement_opening_minor, old.statement_closing_minor, old.opening_basis, old.closing_basis,
         old.out_by_minor, old.override_reason, old.overridden_by) then
    return new;
  end if;
  raise exception 'A statement''s proof is kept with its import only through OneBook''s own steps';
end;
$$;
revoke all on function acc_statement_proof_guard() from public, anon;
grant execute on function acc_statement_proof_guard() to authenticated, service_role;

drop trigger if exists acc_bank_import_batch_proof_guard on acc_bank_import_batch;
create trigger acc_bank_import_batch_proof_guard
  before insert or update of statement_opening_minor, statement_closing_minor, opening_basis, closing_basis,
                             out_by_minor, override_reason, overridden_by
  on acc_bank_import_batch
  for each row execute function acc_statement_proof_guard();

-- ----------------------------------------------------------------------------
-- 3. Import a statement only when it adds up.
--
--    p_rows   every line of the statement except those marked Not a
--             transaction, each shaped as acc_import_bank_statement takes it,
--             plus "skip": true on a line already in Bank Transactions from
--             another source.
--    p_proof  { "opening_minor", "closing_minor", "opening_basis",
--               "closing_basis", "set_aside": the number of lines marked Not a
--               transaction, "override": { "reason" } or null }
--
--    Returns acc_import_bank_statement's answer for the lines not marked skip:
--    inserted, skipped (already here from this statement, by hash) and the
--    batch. The lines marked skip are the caller's own count. When no line is
--    left to import: 0, 0 and no batch. An override is used only when the
--    statement does not add up; otherwise it is ignored.
-- ----------------------------------------------------------------------------
create or replace function acc_import_bank_statement_proved(
  p_bank_account_id uuid, p_filename text, p_rows jsonb, p_proof jsonb
) returns table (inserted int, skipped int, batch_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_proof         jsonb := coalesce(p_proof, '{}'::jsonb);
  v_filename      text := nullif(btrim(coalesce(p_filename, '')), '');
  v_account       text;
  v_lines         integer;
  v_lines_minor   bigint;
  v_marked        integer;
  v_no_amount     integer;
  v_import        jsonb;
  v_opening       bigint;
  v_closing       bigint;
  v_opening_basis text;
  v_closing_basis text;
  v_set_aside     integer;
  v_out           bigint;
  v_override      jsonb;
  v_reason        text;
  v_inserted      integer := 0;
  v_skipped       integer := 0;
  v_batch         uuid;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to import bank statements';
  end if;
  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' then
    raise exception 'A bank statement import needs its lines';
  end if;

  select a.name into v_account
    from acc_bank_account b join acc_account a on a.id = b.account_id
   where b.id = p_bank_account_id;
  if not found then
    raise exception 'Bank account not found';
  end if;

  -- Every line counts in the proof, the ones marked skip included: the proof
  -- is about the statement, not about what is new.
  select count(*)::integer,
         coalesce(sum((e.r ->> 'amount_minor')::bigint), 0)::bigint,
         (count(*) filter (where coalesce(e.r -> 'skip' = 'true'::jsonb, false)))::integer,
         (count(*) filter (where e.r ->> 'amount_minor' is null))::integer
    into v_lines, v_lines_minor, v_marked, v_no_amount
    from jsonb_array_elements(p_rows) as e(r);
  if v_no_amount > 0 then
    raise exception 'Every statement line needs an amount';
  end if;

  v_opening := (v_proof ->> 'opening_minor')::bigint;
  v_closing := (v_proof ->> 'closing_minor')::bigint;
  if v_opening is null then
    raise exception 'The statement has no opening balance; enter the one printed on the statement';
  end if;
  if v_closing is null then
    raise exception 'The statement has no closing balance; enter the one printed on the statement';
  end if;
  v_opening_basis := v_proof ->> 'opening_basis';
  if v_opening_basis is null or v_opening_basis not in ('printed', 'running', 'prior', 'typed') then
    raise exception 'Say where the opening balance came from: printed, running, prior or typed';
  end if;
  v_closing_basis := v_proof ->> 'closing_basis';
  if v_closing_basis is null or v_closing_basis not in ('printed', 'running', 'ledger', 'typed') then
    raise exception 'Say where the closing balance came from: printed, running, ledger or typed';
  end if;
  v_set_aside := coalesce((v_proof ->> 'set_aside')::integer, 0);
  if v_set_aside < 0 then
    raise exception 'The number of lines marked Not a transaction cannot be negative';
  end if;

  v_out := v_opening + v_lines_minor - v_closing;
  if v_out <> 0 then
    v_override := v_proof -> 'override';
    if v_override is null or jsonb_typeof(v_override) = 'null' then
      raise exception 'The statement does not add up: out by %. Only an administrator can import it anyway, with a reason.',
        to_char(abs(v_out) / 100.0, 'FM999,999,999,990.00');
    end if;
    if not acc_is_admin() then
      raise exception 'Only an administrator can import a statement that does not add up';
    end if;
    v_reason := btrim(coalesce(v_override ->> 'reason', ''));
    if v_reason = '' then
      raise exception 'Give a reason for importing a statement that does not add up';
    end if;
    if char_length(v_reason) > 500 then
      raise exception 'Keep the reason to 500 characters or fewer';
    end if;
  end if;

  -- The lines to import, in the statement's order, without those marked skip.
  select coalesce(jsonb_agg(e.r order by e.n), '[]'::jsonb)
    into v_import
    from jsonb_array_elements(p_rows) with ordinality as e(r, n)
   where not coalesce(e.r -> 'skip' = 'true'::jsonb, false);

  if jsonb_array_length(v_import) > 0 then
    select x.inserted, x.skipped, x.batch_id
      into v_inserted, v_skipped, v_batch
      from acc_import_bank_statement(p_bank_account_id, p_filename, v_import) as x;

    perform set_config('acc.statement_proof_change', 'on', true);
    update acc_bank_import_batch
       set statement_opening_minor = v_opening,
           statement_closing_minor = v_closing,
           opening_basis = v_opening_basis,
           closing_basis = v_closing_basis,
           out_by_minor = v_out,
           override_reason = case when v_out <> 0 then v_reason end,
           overridden_by = case when v_out <> 0 then auth.uid() end
     where id = v_batch;
    perform set_config('acc.statement_proof_change', '', true);

    if v_out <> 0 then
      insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
      values ('acc_bank_import_batch', v_batch, 'override', auth.uid(),
              jsonb_build_object('bank_account_id', p_bank_account_id,
                                 'account', v_account,
                                 'filename', v_filename,
                                 'reason', v_reason,
                                 'out_by_minor', v_out,
                                 'opening_minor', v_opening,
                                 'closing_minor', v_closing,
                                 'lines_minor', v_lines_minor,
                                 'lines', v_lines,
                                 'already_present', v_marked,
                                 'set_aside', v_set_aside));
    end if;
  end if;

  return query select v_inserted, v_skipped, v_batch;
end;
$$;
revoke all on function acc_import_bank_statement_proved(uuid, text, jsonb, jsonb) from public, anon;
grant execute on function acc_import_bank_statement_proved(uuid, text, jsonb, jsonb) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. An account's bank lines from one day to another, with their source.
--    Read only.
-- ----------------------------------------------------------------------------
create or replace function acc_bank_lines_on(p_bank_account_id uuid, p_from date, p_to date)
returns table (id uuid, txn_date date, amount_minor bigint, raw_hash text, source_kind text, import_batch_id uuid)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (acc_is_staff() or coalesce(acc_current_role() = 'viewer', false)) then
    raise exception 'Not authorized to read bank lines';
  end if;
  if p_from is null or p_to is null then
    raise exception 'Choose the dates to read bank lines between';
  end if;
  return query
  select t.id, t.txn_date, t.amount_minor, t.raw_hash,
         case
           when t.raw_hash like 'ledger:%' then 'books'
           when t.source = 'bank_feed' then 'feed'
           when t.import_batch_id is not null or t.transaction_batch_id is not null then 'import'
           else 'other'
         end,
         t.import_batch_id
    from acc_bank_transaction t
   where t.bank_account_id = p_bank_account_id
     and t.provider_removed_at is null
     and t.txn_date between p_from and p_to
   order by t.txn_date, t.id;
end;
$$;
revoke all on function acc_bank_lines_on(uuid, date, date) from public, anon;
grant execute on function acc_bank_lines_on(uuid, date, date) to authenticated, service_role;
