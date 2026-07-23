-- supabase/migrations/0018_manual_journal_functions.sql
-- ============================================================================
-- Module B RPCs: post a manual journal, reverse a posted entry (linked, keeping
-- the original visible), and post a controlled opening-balance batch. All are
-- atomic, staff-gated, and append acc_audit_log.
-- ============================================================================

-- Helper: validate that all account_ids in p_lines are active posting accounts.
create or replace function acc_assert_postable(p_lines jsonb) returns void
language plpgsql as $$
declare
  v_bad int;
begin
  select count(*) into v_bad
    from jsonb_array_elements(p_lines) as l
    left join acc_account a on a.id = (l->>'account_id')::uuid
   where a.id is null or a.is_posting_account = false or a.status <> 'active';
  if v_bad > 0 then
    raise exception 'All journal lines must reference active posting accounts (% invalid)', v_bad;
  end if;
end;
$$;

-- Manual journal: caller supplies base-currency lines; we compute amount_base_minor
-- = debit/credit (already base) and delegate to acc_post_entry, then set source_ref.
create or replace function acc_post_manual_journal(
  p_entry_date  date,
  p_description text,
  p_source_ref  text,
  p_currency    text,
  p_lines       jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_entry uuid;
  v_lines jsonb;
  v_count int;
begin
  if not acc_is_staff() then raise exception 'Not authorized to post journal entries'; end if;

  v_count := jsonb_array_length(p_lines);
  if v_count is null or v_count < 2 then
    raise exception 'A manual journal needs at least two lines';
  end if;
  perform acc_assert_postable(p_lines);

  -- Carry each line's minor amount into amount_base_minor (lines are in base ccy).
  select jsonb_agg(
           l || jsonb_build_object(
             'amount_base_minor',
             coalesce((l->>'debit_minor')::bigint, 0) + coalesce((l->>'credit_minor')::bigint, 0)
           ))
    into v_lines
    from jsonb_array_elements(p_lines) as l;

  v_entry := acc_post_entry(p_entry_date, coalesce(p_description, 'Manual journal'),
                            'manual', null, p_currency, v_lines);
  update acc_journal_entry set source_ref = nullif(btrim(coalesce(p_source_ref, '')), '')
   where id = v_entry;

  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_journal_entry', v_entry, 'post', auth.uid());
  return v_entry;
end;
$$;

-- Reverse a posted entry: post a new balanced entry with debit/credit swapped and
-- amount_base_minor preserved, link it, and audit. The original stays 'posted'.
create or replace function acc_reverse_entry(
  p_entry_id     uuid,
  p_reason       text,
  p_reversal_date date
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_src   acc_journal_entry;
  v_lines jsonb;
  v_rev   uuid;
begin
  if not acc_is_staff() then raise exception 'Not authorized to reverse entries'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reversal reason is required'; end if;

  select * into v_src from acc_journal_entry where id = p_entry_id for update;
  if not found then raise exception 'Journal entry not found'; end if;
  if v_src.status <> 'posted' then raise exception 'Only a posted entry can be reversed'; end if;
  if v_src.source_type not in ('manual', 'opening_balance') then
    raise exception 'Only manual journals and opening balances can be reversed';
  end if;
  if exists (select 1 from acc_journal_reversal_link where original_entry_id = p_entry_id) then
    raise exception 'Entry has already been reversed';
  end if;
  if exists (select 1 from acc_journal_reversal_link where reversal_entry_id = p_entry_id) then
    raise exception 'A reversal entry cannot itself be reversed';
  end if;

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
   where l.journal_entry_id = p_entry_id;

  v_rev := acc_post_entry(p_reversal_date,
             'Reversal of ' || v_src.entry_number || ' — ' || p_reason,
             v_src.source_type, v_src.id, v_src.currency_code, v_lines);

  insert into acc_journal_reversal_link (original_entry_id, reversal_entry_id, reason, created_by)
    values (p_entry_id, v_rev, p_reason, auth.uid());
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_journal_entry', p_entry_id, 'reverse', auth.uid());
  return v_rev;
end;
$$;

-- Controlled opening balances: caller supplies per-account base-currency lines;
-- we book the net difference to Opening Balance Equity (code '3900') so the entry
-- balances. Refuse a second non-reversed opening batch for the same as-of date.
create or replace function acc_post_opening_balances(
  p_as_of    date,
  p_currency text,
  p_lines    jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_equity  uuid;
  v_debit   bigint;
  v_credit  bigint;
  v_net     bigint;
  v_lines   jsonb;
  v_entry   uuid;
  v_count   int;
begin
  if not acc_is_staff() then raise exception 'Not authorized to post opening balances'; end if;

  v_count := jsonb_array_length(p_lines);
  if v_count is null or v_count < 1 then raise exception 'Enter at least one opening balance'; end if;
  perform acc_assert_postable(p_lines);

  if exists (
    select 1 from acc_journal_entry e
     where e.source_type = 'opening_balance' and e.status = 'posted' and e.entry_date = p_as_of
       and not exists (select 1 from acc_journal_reversal_link where original_entry_id = e.id)
  ) then
    raise exception 'Opening balances for % already exist', p_as_of;
  end if;

  select id into v_equity from acc_account where account_code = '3900';
  if v_equity is null then raise exception 'Opening Balance Equity account (3900) is missing'; end if;

  select coalesce(sum((l->>'debit_minor')::bigint), 0),
         coalesce(sum((l->>'credit_minor')::bigint), 0)
    into v_debit, v_credit
    from jsonb_array_elements(p_lines) as l;
  v_net := v_debit - v_credit;

  -- Base-currency lines: amount_base_minor mirrors the minor amount.
  select jsonb_agg(
           l || jsonb_build_object(
             'amount_base_minor',
             coalesce((l->>'debit_minor')::bigint, 0) + coalesce((l->>'credit_minor')::bigint, 0)))
    into v_lines
    from jsonb_array_elements(p_lines) as l;

  -- Balancing line to Opening Balance Equity (only if there is a net difference).
  if v_net <> 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', v_equity,
      'debit_minor',  case when v_net < 0 then -v_net else 0 end,
      'credit_minor', case when v_net > 0 then  v_net else 0 end,
      'amount_base_minor', abs(v_net),
      'memo', 'Opening balance equity'));
  end if;

  v_entry := acc_post_entry(p_as_of, 'Opening balances as of ' || p_as_of,
                            'opening_balance', null, p_currency, v_lines);
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_journal_entry', v_entry, 'post', auth.uid());
  return v_entry;
end;
$$;
