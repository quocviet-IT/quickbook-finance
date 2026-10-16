-- ============================================================================
-- 0149  A statement imported out of balance stays in sight (2.11)
--
--   acc_import_bank_statement_proved  as in 0143, plus one assertion: an opening
--                                     whose basis is 'prior' must equal the
--                                     closing of the account's newest completed
--                                     reconciliation. Nothing else changes; the
--                                     new lines sit between the two "0149"
--                                     markers inside the function.
--   acc_statement_overrides()         one row per import that was made out of
--                                     balance (overridden_by is set) and has not
--                                     been undone (status = 'active'), with the
--                                     completed reconciliation that settled it,
--                                     if any. Read only.
--
-- Settled. An override is settled by the earliest completed reconciliation of
-- the same bank account whose statement ending date is on or after the date of
-- the import's last line. Until there is one it is open. A voided import is not
-- returned. The rows are ordered by imported_at, then batch id, so a caller can
-- page through them.
--
-- The money in the prior refusal is formatted as 0132 formats it:
-- to_char(x / 100.0, 'FM999,999,999,990.00').
--
-- Security definer with the search path pinned; staff or a viewer may read,
-- anyone else is refused; executable by signed-in users and the service role
-- only. Additive; no table or column changes.
-- ============================================================================

set search_path = public;

-- ----------------------------------------------------------------------------
-- 1. The import, with the prior opening checked.
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
  -- 0149: begin prior opening check
  if v_opening_basis = 'prior' then
    declare
      v_prior_found boolean;
      v_prior_close bigint;
    begin
      select true, r.statement_ending_balance_minor
        into v_prior_found, v_prior_close
        from acc_statement_reconciliation r
       where r.bank_account_id = p_bank_account_id and r.status = 'completed'
       order by r.statement_ending_date desc, r.completed_at desc nulls last, r.id desc
       limit 1;
      if v_prior_found is null then
        raise exception 'The opening cannot be the closing of the last reconciliation: this account has none.';
      end if;
      if v_opening <> v_prior_close then
        raise exception 'The opening must be the closing of the last reconciliation, %.',
          to_char(v_prior_close / 100.0, 'FM999,999,999,990.00');
      end if;
    end;
  end if;
  -- 0149: end prior opening check
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
-- 2. The imports made out of balance, and whether a reconciliation settled them.
-- ----------------------------------------------------------------------------
create or replace function acc_statement_overrides()
returns table (
  batch_id uuid,
  bank_account_id uuid,
  filename text,
  imported_at timestamptz,
  overridden_by uuid,
  override_reason text,
  out_by_minor bigint,
  statement_opening_minor bigint,
  statement_closing_minor bigint,
  first_line_date date,
  last_line_date date,
  settled_by_reconciliation_id uuid,
  settled_through date
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (acc_is_staff() or coalesce(acc_current_role() = 'viewer', false)) then
    raise exception 'Not authorized to read statements imported out of balance';
  end if;
  return query
  select b.id, b.bank_account_id, b.filename, b.imported_at, b.overridden_by, b.override_reason,
         b.out_by_minor, b.statement_opening_minor, b.statement_closing_minor,
         d.first_date, d.last_date,
         s.id, s.statement_ending_date
    from acc_bank_import_batch b
    left join lateral (
      select min(t.txn_date) as first_date, max(t.txn_date) as last_date
        from acc_bank_transaction t
       where t.import_batch_id = b.id
    ) d on true
    left join lateral (
      select r.id, r.statement_ending_date
        from acc_statement_reconciliation r
       where r.bank_account_id = b.bank_account_id
         and r.status = 'completed'
         and d.last_date is not null
         and r.statement_ending_date >= d.last_date
       order by r.statement_ending_date, r.completed_at nulls last, r.id
       limit 1
    ) s on true
   where b.status = 'active'
     and b.overridden_by is not null
   order by b.imported_at, b.id;
end;
$$;
revoke all on function acc_statement_overrides() from public, anon;
grant execute on function acc_statement_overrides() to authenticated, service_role;
