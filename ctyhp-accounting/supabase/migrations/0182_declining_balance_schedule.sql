-- ============================================================================
-- 0182  Declining balance depreciation (2.85)
--
-- A fixed asset could be depreciated on a straight line or not at all. The
-- design offers "Reducing balance (200%)": each month, twice the straight-line
-- rate (2 / months of useful life) on what is left of the cost. Left at that,
-- an asset is never fully depreciated: each month takes a share of a shrinking
-- amount. The owner chose (30 October 2026) the usual American practice: switch
-- to the straight line over the months left once it gives more, so the asset
-- reaches its salvage value exactly at the end of its life.
--
-- 1. The check on acc_fixed_asset treats declining_balance as it treats
--    straight_line: a useful life, both accounts, salvage below cost. The old
--    check is found by what it says, not by the name Postgres gave it.
-- 2. acc_register_fixed_asset validates a declining-balance asset as it does a
--    straight-line one and builds its schedule month by month as above.
--    Everything else in it is as 0047 left it, which is what runs in every
--    company. Posting, opening balances, disposal and the import read the
--    schedule and never the method, so they need nothing new.
-- ============================================================================
set search_path = public;

do $$
declare v_name text;
begin
  for v_name in
    select c.conname from pg_constraint c
     where c.conrelid = 'acc_fixed_asset'::regclass and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%depreciation_method%'
  loop
    execute format('alter table acc_fixed_asset drop constraint %I', v_name);
  end loop;
end $$;

alter table acc_fixed_asset add constraint acc_fixed_asset_method_fields check (
  (depreciation_method = 'none' and useful_life_months is null
    and accumulated_depreciation_account_id is null
    and depreciation_expense_account_id is null)
  or
  (depreciation_method in ('straight_line', 'declining_balance') and useful_life_months is not null
    and accumulated_depreciation_account_id is not null
    and depreciation_expense_account_id is not null
    and salvage_value_minor < cost_minor)
);

create or replace function acc_register_fixed_asset(
  p_name                                text,
  p_description                         text,
  p_category                            text,
  p_serial_number                       text,
  p_location                            text,
  p_acquisition_date                    date,
  p_in_service_date                     date,
  p_currency_code                       text,
  p_cost_minor                          bigint,
  p_salvage_value_minor                 bigint,
  p_useful_life_months                  int,
  p_depreciation_method                 text,
  p_asset_account_id                    uuid,
  p_accumulated_depreciation_account_id uuid,
  p_depreciation_expense_account_id     uuid,
  p_vendor_id                           uuid,
  p_source_bill_id                      uuid,
  p_notes                               text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_number text;
  v_base_currency text;
  v_method acc_fixed_asset_method;
  v_account_type acc_account_type;
  v_depreciable bigint;
  v_regular bigint;
  v_remainder bigint;
  v_period_start date;
  v_period_end date;
  v_amount bigint;
  v_salvage bigint;
  v_book bigint;
  v_left int;
  v_doubled bigint;
  v_level bigint;
  i int;
begin
  if not acc_has_permission('fixed_assets.manage') then
    raise exception 'You do not have permission to manage fixed assets';
  end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'Asset name is required'; end if;
  if coalesce(btrim(p_category), '') = '' then raise exception 'Asset category is required'; end if;
  if p_acquisition_date is null or p_in_service_date is null then
    raise exception 'Acquisition and in-service dates are required';
  end if;
  if p_in_service_date < p_acquisition_date then
    raise exception 'In-service date cannot precede acquisition date';
  end if;
  if coalesce(p_cost_minor, 0) <= 0 then raise exception 'Asset cost must be positive'; end if;
  if coalesce(p_salvage_value_minor, 0) < 0 or p_salvage_value_minor > p_cost_minor then
    raise exception 'Salvage value must be between zero and cost';
  end if;

  begin
    v_method := p_depreciation_method::acc_fixed_asset_method;
  exception when invalid_text_representation then
    raise exception 'Unsupported depreciation method';
  end;

  select code into v_base_currency from acc_currency where is_base;
  if upper(p_currency_code) <> v_base_currency then
    raise exception 'Fixed asset register currently requires base currency %', v_base_currency;
  end if;

  select account_type into v_account_type
    from acc_account
   where id = p_asset_account_id and status = 'active' and is_posting_account;
  if v_account_type is distinct from 'fixed_asset'::acc_account_type then
    raise exception 'Asset account must be an active Fixed Asset posting account';
  end if;

  if v_method in ('straight_line', 'declining_balance') then
    if coalesce(p_useful_life_months, 0) <= 0 then raise exception 'Useful life is required'; end if;
    if p_salvage_value_minor >= p_cost_minor then
      raise exception 'A depreciable asset must have salvage value below cost';
    end if;
    if p_asset_account_id = p_accumulated_depreciation_account_id then
      raise exception 'Asset cost and accumulated depreciation must use different accounts';
    end if;
    if (p_cost_minor - p_salvage_value_minor) < p_useful_life_months then
      raise exception 'Depreciable basis is too small for a % month schedule', p_useful_life_months;
    end if;

    select account_type into v_account_type
      from acc_account
     where id = p_accumulated_depreciation_account_id and status = 'active' and is_posting_account;
    if v_account_type is distinct from 'fixed_asset'::acc_account_type then
      raise exception 'Accumulated depreciation must be an active Fixed Asset posting account';
    end if;

    select account_type into v_account_type
      from acc_account
     where id = p_depreciation_expense_account_id and status = 'active' and is_posting_account;
    if v_account_type not in ('expense'::acc_account_type, 'other_expense'::acc_account_type) then
      raise exception 'Depreciation expense must be an active Expense posting account';
    end if;
  else
    p_useful_life_months := null;
    p_accumulated_depreciation_account_id := null;
    p_depreciation_expense_account_id := null;
  end if;

  if p_vendor_id is not null and not exists (select 1 from acc_vendor where id = p_vendor_id) then
    raise exception 'Vendor was not found';
  end if;
  if p_source_bill_id is not null and not exists (select 1 from acc_bill where id = p_source_bill_id) then
    raise exception 'Source bill was not found';
  end if;

  v_number := acc_next_number('fixed_asset');
  insert into acc_fixed_asset
    (asset_number, name, description, category, serial_number, location,
     acquisition_date, in_service_date, currency_code, cost_minor,
     salvage_value_minor, useful_life_months, depreciation_method,
     asset_account_id, accumulated_depreciation_account_id,
     depreciation_expense_account_id, vendor_id, source_bill_id, notes, created_by)
  values
    (v_number, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''),
     btrim(p_category), nullif(btrim(coalesce(p_serial_number, '')), ''),
     nullif(btrim(coalesce(p_location, '')), ''), p_acquisition_date,
     p_in_service_date, upper(p_currency_code), p_cost_minor,
     coalesce(p_salvage_value_minor, 0), p_useful_life_months, v_method,
     p_asset_account_id, p_accumulated_depreciation_account_id,
     p_depreciation_expense_account_id, p_vendor_id, p_source_bill_id,
     nullif(btrim(coalesce(p_notes, '')), ''), auth.uid())
  returning id into v_id;

  if v_method = 'straight_line' then
    v_depreciable := p_cost_minor - coalesce(p_salvage_value_minor, 0);
    v_regular := v_depreciable / p_useful_life_months;
    v_remainder := v_depreciable - (v_regular * p_useful_life_months);
    v_period_start := date_trunc('month', p_in_service_date)::date;

    for i in 1..p_useful_life_months loop
      v_period_end := (v_period_start + interval '1 month' - interval '1 day')::date;
      v_amount := v_regular + case when i = p_useful_life_months then v_remainder else 0 end;
      insert into acc_asset_depreciation_schedule
        (asset_id, sequence_number, period_start, period_end, planned_amount_minor)
      values (v_id, i, v_period_start, v_period_end, v_amount);
      v_period_start := (v_period_start + interval '1 month')::date;
    end loop;
  elsif v_method = 'declining_balance' then
    -- Twice the straight-line rate, 2/n a month on what is left of the cost,
    -- until the straight line over the months left gives more; from then on the
    -- straight line. The last month takes the asset to its salvage value exactly,
    -- and never below it.
    v_salvage := coalesce(p_salvage_value_minor, 0);
    v_book := p_cost_minor;
    v_period_start := date_trunc('month', p_in_service_date)::date;

    for i in 1..p_useful_life_months loop
      exit when v_book <= v_salvage;
      v_left := p_useful_life_months - i + 1;
      v_doubled := round(v_book * 2.0 / p_useful_life_months)::bigint;
      v_level := round((v_book - v_salvage)::numeric / v_left)::bigint;
      v_amount := case when i = p_useful_life_months then v_book - v_salvage
                       else least(greatest(v_doubled, v_level), v_book - v_salvage) end;
      v_period_end := (v_period_start + interval '1 month' - interval '1 day')::date;
      insert into acc_asset_depreciation_schedule
        (asset_id, sequence_number, period_start, period_end, planned_amount_minor)
      values (v_id, i, v_period_start, v_period_end, v_amount);
      v_book := v_book - v_amount;
      v_period_start := (v_period_start + interval '1 month')::date;
    end loop;
  end if;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values ('acc_fixed_asset', v_id, 'insert', auth.uid(),
          jsonb_build_object('asset_number', v_number, 'name', p_name,
                             'cost_minor', p_cost_minor,
                             'depreciation_method', v_method,
                             'useful_life_months', p_useful_life_months));
  return v_id;
end;
$$;

