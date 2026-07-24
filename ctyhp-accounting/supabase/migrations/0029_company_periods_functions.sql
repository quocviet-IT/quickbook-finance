-- supabase/migrations/0029_company_periods_functions.sql
-- ============================================================================
-- Closed-period guard + period/company-settings RPCs. The guard is enforced in
-- the database: acc_post_entry rejects a posting dated in a closed period, and a
-- trigger rejects voiding an entry dated in a closed period. A date with no
-- period row is NOT closed, so the guard is inert until periods are generated
-- and closed. Corrections to a closed period use a Module B reversal into an
-- open period.
-- ============================================================================

-- True iff a period row covers d and it is closed. No row -> not closed.
create or replace function acc_is_period_closed(d date) returns boolean
language sql stable as $$
  select exists (
    select 1 from acc_accounting_period
     where d between period_start and period_end and status = 'closed'
  );
$$;

-- Redefine the single posting function to add the closed-period guard. Body is
-- identical to migration 0001 plus the guard after the balance/empty checks.
create or replace function acc_post_entry(
  p_entry_date  date,
  p_description text,
  p_source_type acc_journal_source,
  p_source_id   uuid,
  p_currency    text,
  p_lines       jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_entry_id uuid;
  v_number   text;
  v_debit    bigint;
  v_credit   bigint;
  v_order    int := 0;
  v_line     jsonb;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to post journal entries';
  end if;

  select coalesce(sum((l->>'debit_minor')::bigint), 0),
         coalesce(sum((l->>'credit_minor')::bigint), 0)
    into v_debit, v_credit
    from jsonb_array_elements(p_lines) as l;

  if v_debit <> v_credit then
    raise exception 'Unbalanced posting: debit % <> credit %', v_debit, v_credit;
  end if;
  if v_debit = 0 then
    raise exception 'Refusing to post an empty/zero journal entry';
  end if;

  if acc_is_period_closed(p_entry_date) then
    raise exception 'Accounting period for % is closed', p_entry_date;
  end if;

  v_number := acc_next_number('journal_entry');

  insert into acc_journal_entry
    (entry_number, entry_date, description, source_type, source_id, currency_code, created_by)
  values
    (v_number, p_entry_date, p_description, p_source_type, p_source_id, p_currency, auth.uid())
  returning id into v_entry_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into acc_journal_line
      (journal_entry_id, account_id, debit_minor, credit_minor,
       amount_base_minor, tax_code_id, memo, line_order)
    values
      (v_entry_id,
       (v_line->>'account_id')::uuid,
       coalesce((v_line->>'debit_minor')::bigint, 0),
       coalesce((v_line->>'credit_minor')::bigint, 0),
       coalesce((v_line->>'amount_base_minor')::bigint, 0),
       nullif(v_line->>'tax_code_id', '')::uuid,
       v_line->>'memo',
       v_order);
    v_order := v_order + 1;
  end loop;

  return v_entry_id;
end;
$$;

-- Block voiding a journal entry dated in a closed period (all document void paths
-- do `update acc_journal_entry set status='void'`).
create or replace function acc_block_closed_period_void() returns trigger
language plpgsql as $$
begin
  if new.status = 'void' and old.status <> 'void' and acc_is_period_closed(old.entry_date) then
    raise exception 'Cannot void an entry in a closed period (%); reverse it into an open period', old.entry_date;
  end if;
  return new;
end;
$$;

create or replace trigger acc_journal_entry_closed_period_void
  before update on acc_journal_entry
  for each row execute function acc_block_closed_period_void();

-- Generate the 12 monthly periods for a fiscal year from the current settings'
-- fiscal_year_start_month. Idempotent. Returns the number of periods created.
create or replace function acc_generate_periods(p_fiscal_year int) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_start_month int;
  v_created int := 0;
  i int;
  v_cal_year int;
  v_cal_month int;
  v_start date;
  v_end date;
begin
  if not acc_is_admin() then raise exception 'Only an admin can generate periods'; end if;

  select fiscal_year_start_month into v_start_month
    from acc_company_setting_version order by effective_from desc, version desc limit 1;
  v_start_month := coalesce(v_start_month, 1);

  for i in 1..12 loop
    v_cal_month := ((v_start_month - 1 + (i - 1)) % 12) + 1;
    v_cal_year  := p_fiscal_year + ((v_start_month - 1 + (i - 1)) / 12);
    v_start := make_date(v_cal_year, v_cal_month, 1);
    v_end   := (v_start + interval '1 month' - interval '1 day')::date;
    insert into acc_accounting_period (fiscal_year, period_month, period_start, period_end, label, status)
      values (p_fiscal_year, i, v_start, v_end, to_char(v_start, 'YYYY-MM'), 'open')
      on conflict (fiscal_year, period_month) do nothing;
    if found then v_created := v_created + 1; end if;
  end loop;
  return v_created;
end;
$$;

create or replace function acc_close_period(p_period_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_p acc_accounting_period;
begin
  if not acc_is_admin() then raise exception 'Only an admin can close a period'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A close reason is required'; end if;
  select * into v_p from acc_accounting_period where id = p_period_id for update;
  if not found then raise exception 'Period not found'; end if;
  if v_p.status = 'closed' then raise exception 'Period is already closed'; end if;
  update acc_accounting_period
     set status = 'closed', closed_by = auth.uid(), closed_at = now(), close_reason = p_reason
   where id = p_period_id;
  insert into acc_period_event (period_id, event, reason, actor_id) values (p_period_id, 'close', p_reason, auth.uid());
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_accounting_period', p_period_id, 'close', auth.uid());
end;
$$;

create or replace function acc_reopen_period(p_period_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_p acc_accounting_period;
begin
  if not acc_is_admin() then raise exception 'Only an admin can reopen a period'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reopen reason is required'; end if;
  select * into v_p from acc_accounting_period where id = p_period_id for update;
  if not found then raise exception 'Period not found'; end if;
  if v_p.status = 'open' then raise exception 'Period is already open'; end if;
  update acc_accounting_period
     set status = 'open', reopened_by = auth.uid(), reopened_at = now(), reopen_reason = p_reason
   where id = p_period_id;
  insert into acc_period_event (period_id, event, reason, actor_id) values (p_period_id, 'reopen', p_reason, auth.uid());
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_accounting_period', p_period_id, 'reopen', auth.uid());
end;
$$;

-- Append a new company-settings version. EIN is stored but not written to the
-- audit payload (only the action + record id are audited).
create or replace function acc_save_company_settings(
  p_legal_name text, p_dba_name text, p_ein_ref text,
  p_address_line1 text, p_address_line2 text, p_city text, p_region text, p_postal_code text, p_country text,
  p_fiscal_year_start_month int, p_base_currency_code text, p_time_zone text,
  p_accounting_basis text, p_default_payment_terms_days int
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_version int; v_id uuid;
begin
  if not acc_is_admin() then raise exception 'Only an admin can change company settings'; end if;
  if coalesce(btrim(p_legal_name), '') = '' then raise exception 'Legal name is required'; end if;
  select coalesce(max(version), 0) + 1 into v_version from acc_company_setting_version;
  insert into acc_company_setting_version
    (version, legal_name, dba_name, ein_ref, address_line1, address_line2, city, region, postal_code, country,
     fiscal_year_start_month, base_currency_code, time_zone, accounting_basis, default_payment_terms_days, created_by)
  values
    (v_version, p_legal_name, p_dba_name, p_ein_ref, p_address_line1, p_address_line2, p_city, p_region, p_postal_code, p_country,
     coalesce(p_fiscal_year_start_month, 1), coalesce(p_base_currency_code, 'USD'), coalesce(p_time_zone, 'America/New_York'),
     coalesce(p_accounting_basis, 'accrual')::acc_accounting_basis, coalesce(p_default_payment_terms_days, 30), auth.uid())
  returning id into v_id;
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_company_setting_version', v_id, 'insert', auth.uid());
  return v_id;
end;
$$;
