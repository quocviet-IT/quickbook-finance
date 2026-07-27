-- ============================================================================
-- Fixed Asset Register RPCs.
-- Kept in a migration after the enum extension so the new journal source value
-- is committed before acc_post_entry uses it.
-- ============================================================================

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

  if v_method = 'straight_line' then
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

create or replace function acc_post_asset_depreciation(
  p_asset_id    uuid,
  p_through_date date
) returns table (posted_count int, posted_total_minor bigint)
language plpgsql security definer set search_path = public as $$
declare
  v_asset acc_fixed_asset;
  v_schedule acc_asset_depreciation_schedule;
  v_entry uuid;
  v_lines jsonb;
begin
  if not acc_has_permission('fixed_assets.post') then
    raise exception 'You do not have permission to post asset depreciation';
  end if;
  if p_through_date is null then raise exception 'Posting-through date is required'; end if;
  if p_through_date > current_date then raise exception 'Depreciation cannot be posted into the future'; end if;

  select * into v_asset from acc_fixed_asset where id = p_asset_id for update;
  if not found then raise exception 'Fixed asset was not found'; end if;
  if v_asset.status = 'disposed' then raise exception 'Disposed assets cannot be depreciated'; end if;
  if v_asset.depreciation_method = 'none' then raise exception 'This asset is not depreciable'; end if;

  posted_count := 0;
  posted_total_minor := 0;

  for v_schedule in
    select *
      from acc_asset_depreciation_schedule
     where asset_id = p_asset_id
       and status = 'planned'
       and period_end <= p_through_date
     order by sequence_number
     for update
  loop
    v_lines := jsonb_build_array(
      jsonb_build_object(
        'account_id', v_asset.depreciation_expense_account_id,
        'debit_minor', v_schedule.planned_amount_minor,
        'credit_minor', 0,
        'amount_base_minor', v_schedule.planned_amount_minor,
        'memo', 'Monthly depreciation - ' || v_asset.asset_number
      ),
      jsonb_build_object(
        'account_id', v_asset.accumulated_depreciation_account_id,
        'debit_minor', 0,
        'credit_minor', v_schedule.planned_amount_minor,
        'amount_base_minor', v_schedule.planned_amount_minor,
        'memo', 'Accumulated depreciation - ' || v_asset.asset_number
      )
    );

    v_entry := acc_post_entry(
      v_schedule.period_end,
      'Depreciation ' || v_asset.asset_number || ' - ' || to_char(v_schedule.period_end, 'Mon YYYY'),
      'depreciation',
      v_asset.id,
      v_asset.currency_code,
      v_lines
    );

    update acc_asset_depreciation_schedule
       set status = 'posted',
           posted_amount_minor = planned_amount_minor,
           journal_entry_id = v_entry,
           posted_by = auth.uid(),
           posted_at = now()
     where id = v_schedule.id;

    insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
    values ('acc_asset_depreciation_schedule', v_schedule.id, 'post', auth.uid(),
            jsonb_build_object('asset_id', v_asset.id, 'journal_entry_id', v_entry,
                               'amount_minor', v_schedule.planned_amount_minor,
                               'period_end', v_schedule.period_end));

    posted_count := posted_count + 1;
    posted_total_minor := posted_total_minor + v_schedule.planned_amount_minor;
  end loop;

  if posted_count = 0 then
    raise exception 'No unposted depreciation is due through %', p_through_date;
  end if;

  if not exists (
    select 1 from acc_asset_depreciation_schedule
     where asset_id = p_asset_id and status = 'planned'
  ) then
    update acc_fixed_asset set status = 'fully_depreciated', updated_at = now() where id = p_asset_id;
  else
    update acc_fixed_asset set updated_at = now() where id = p_asset_id;
  end if;

  return next;
end;
$$;

revoke all on function acc_register_fixed_asset(
  text, text, text, text, text, date, date, text, bigint, bigint, int, text,
  uuid, uuid, uuid, uuid, uuid, text
) from public, anon;
revoke all on function acc_post_asset_depreciation(uuid, date) from public, anon;

grant execute on function acc_register_fixed_asset(
  text, text, text, text, text, date, date, text, bigint, bigint, int, text,
  uuid, uuid, uuid, uuid, uuid, text
) to authenticated;
grant execute on function acc_post_asset_depreciation(uuid, date) to authenticated;
