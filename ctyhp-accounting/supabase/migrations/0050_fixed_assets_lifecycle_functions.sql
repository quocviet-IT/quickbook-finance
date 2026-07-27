-- ============================================================================
-- Fixed Asset lifecycle RPCs. All mutations are permission-gated, atomic,
-- period-lock aware, and journal through acc_post_entry.
-- ============================================================================

create or replace function acc_apply_asset_opening(
  p_asset_id                  uuid,
  p_opening_accumulated_minor bigint,
  p_opening_as_of             date,
  p_post_opening_entry        boolean
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_asset acc_fixed_asset;
  v_schedule acc_asset_depreciation_schedule;
  v_remaining bigint;
  v_applied bigint;
  v_opening_equity uuid;
  v_entry uuid;
  v_lines jsonb;
begin
  if not acc_has_permission('fixed_assets.import') then
    raise exception 'You do not have permission to import fixed assets';
  end if;
  select * into v_asset from acc_fixed_asset where id = p_asset_id for update;
  if not found then raise exception 'Fixed asset was not found'; end if;
  if coalesce(p_opening_accumulated_minor, 0) < 0 then
    raise exception 'Opening accumulated depreciation cannot be negative';
  end if;
  if coalesce(p_opening_accumulated_minor, 0) > v_asset.cost_minor - v_asset.salvage_value_minor then
    raise exception 'Opening accumulated depreciation exceeds depreciable basis';
  end if;
  if (coalesce(p_opening_accumulated_minor, 0) > 0 or p_post_opening_entry)
     and p_opening_as_of is null then
    raise exception 'Opening as-of date is required';
  end if;
  if p_opening_as_of is not null and p_opening_as_of < v_asset.in_service_date then
    raise exception 'Opening as-of date cannot precede the in-service date';
  end if;
  if v_asset.depreciation_method = 'none' and coalesce(p_opening_accumulated_minor, 0) <> 0 then
    raise exception 'A non-depreciable asset cannot have accumulated depreciation';
  end if;

  v_remaining := coalesce(p_opening_accumulated_minor, 0);
  for v_schedule in
    select *
      from acc_asset_depreciation_schedule
     where asset_id = p_asset_id
       and period_end <= p_opening_as_of
       and status = 'planned'
     order by sequence_number
     for update
  loop
    exit when v_remaining = 0;
    v_applied := least(v_schedule.planned_amount_minor, v_remaining);
    update acc_asset_depreciation_schedule
       set posted_amount_minor = v_applied,
           status = 'opening'
     where id = v_schedule.id;
    v_remaining := v_remaining - v_applied;
  end loop;
  if v_remaining > 0 then
    raise exception 'Opening accumulated depreciation exceeds the schedule through %', p_opening_as_of;
  end if;

  update acc_fixed_asset
     set opening_accumulated_depreciation_minor = coalesce(p_opening_accumulated_minor, 0),
         opening_as_of_date = p_opening_as_of,
         updated_at = now()
   where id = p_asset_id;

  if p_post_opening_entry then
    select id into v_opening_equity
      from acc_account
     where account_code = '3900' and status = 'active' and is_posting_account;
    if v_opening_equity is null then
      raise exception 'Opening Balance Equity account (3900) is missing';
    end if;

    v_lines := jsonb_build_array(jsonb_build_object(
      'account_id', v_asset.asset_account_id,
      'debit_minor', v_asset.cost_minor,
      'credit_minor', 0,
      'amount_base_minor', v_asset.cost_minor,
      'memo', 'Opening fixed asset cost - ' || v_asset.asset_number
    ));
    if coalesce(p_opening_accumulated_minor, 0) > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_id', v_asset.accumulated_depreciation_account_id,
        'debit_minor', 0,
        'credit_minor', p_opening_accumulated_minor,
        'amount_base_minor', p_opening_accumulated_minor,
        'memo', 'Opening accumulated depreciation - ' || v_asset.asset_number
      ));
    end if;
    if v_asset.cost_minor - coalesce(p_opening_accumulated_minor, 0) > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_id', v_opening_equity,
        'debit_minor', 0,
        'credit_minor', v_asset.cost_minor - coalesce(p_opening_accumulated_minor, 0),
        'amount_base_minor', v_asset.cost_minor - coalesce(p_opening_accumulated_minor, 0),
        'memo', 'Opening net book value - ' || v_asset.asset_number
      ));
    end if;

    v_entry := acc_post_entry(
      p_opening_as_of,
      'Opening fixed asset ' || v_asset.asset_number || ' - ' || v_asset.name,
      'opening_balance',
      v_asset.id,
      v_asset.currency_code,
      v_lines
    );
    update acc_fixed_asset set opening_journal_entry_id = v_entry where id = p_asset_id;
  end if;

  if not exists (
    select 1 from acc_asset_depreciation_schedule
     where asset_id = p_asset_id and posted_amount_minor < planned_amount_minor
  ) and v_asset.depreciation_method <> 'none' then
    update acc_fixed_asset set status = 'fully_depreciated' where id = p_asset_id;
  end if;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values ('acc_fixed_asset', p_asset_id, 'update', auth.uid(),
          jsonb_build_object(
            'opening_accumulated_depreciation_minor', coalesce(p_opening_accumulated_minor, 0),
            'opening_as_of_date', p_opening_as_of,
            'opening_journal_entry_id', v_entry
          ));
  return v_entry;
end;
$$;

-- Redefine monthly posting so an opening schedule row can carry prior
-- depreciation and later post only its remaining amount.
create or replace function acc_post_asset_depreciation(
  p_asset_id     uuid,
  p_through_date date
) returns table (posted_count int, posted_total_minor bigint)
language plpgsql security definer set search_path = public as $$
declare
  v_asset acc_fixed_asset;
  v_schedule acc_asset_depreciation_schedule;
  v_entry uuid;
  v_lines jsonb;
  v_amount bigint;
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
       and status in ('planned', 'opening')
       and posted_amount_minor < planned_amount_minor
       and period_end <= p_through_date
     order by sequence_number
     for update
  loop
    v_amount := v_schedule.planned_amount_minor - v_schedule.posted_amount_minor;
    v_lines := jsonb_build_array(
      jsonb_build_object(
        'account_id', v_asset.depreciation_expense_account_id,
        'debit_minor', v_amount,
        'credit_minor', 0,
        'amount_base_minor', v_amount,
        'memo', 'Monthly depreciation - ' || v_asset.asset_number
      ),
      jsonb_build_object(
        'account_id', v_asset.accumulated_depreciation_account_id,
        'debit_minor', 0,
        'credit_minor', v_amount,
        'amount_base_minor', v_amount,
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
                               'amount_minor', v_amount, 'period_end', v_schedule.period_end));
    posted_count := posted_count + 1;
    posted_total_minor := posted_total_minor + v_amount;
  end loop;

  if posted_count = 0 then
    raise exception 'No unposted depreciation is due through %', p_through_date;
  end if;
  if not exists (
    select 1 from acc_asset_depreciation_schedule
     where asset_id = p_asset_id
       and status <> 'cancelled'
       and posted_amount_minor < planned_amount_minor
  ) then
    update acc_fixed_asset set status = 'fully_depreciated', updated_at = now() where id = p_asset_id;
  else
    update acc_fixed_asset set updated_at = now() where id = p_asset_id;
  end if;
  return next;
end;
$$;

create or replace function acc_post_asset_depreciation_batch(
  p_asset_ids   uuid[],
  p_through_date date
) returns table (posted_asset_count int, posted_period_count int, posted_total_minor bigint)
language plpgsql security definer set search_path = public as $$
declare
  v_asset_id uuid;
  v_count int;
  v_total bigint;
begin
  if not acc_has_permission('fixed_assets.post') then
    raise exception 'You do not have permission to post asset depreciation';
  end if;
  if coalesce(array_length(p_asset_ids, 1), 0) = 0 then
    raise exception 'Select at least one fixed asset';
  end if;
  posted_asset_count := 0;
  posted_period_count := 0;
  posted_total_minor := 0;

  for v_asset_id in select distinct unnest(p_asset_ids) loop
    if exists (
      select 1 from acc_asset_depreciation_schedule
       where asset_id = v_asset_id
         and status in ('planned', 'opening')
         and posted_amount_minor < planned_amount_minor
         and period_end <= p_through_date
    ) then
      select p.posted_count, p.posted_total_minor
        into v_count, v_total
        from acc_post_asset_depreciation(v_asset_id, p_through_date) p;
      posted_asset_count := posted_asset_count + 1;
      posted_period_count := posted_period_count + v_count;
      posted_total_minor := posted_total_minor + v_total;
    end if;
  end loop;
  if posted_asset_count = 0 then
    raise exception 'No depreciation is due for the selected assets through %', p_through_date;
  end if;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values ('acc_fixed_asset', null, 'post', auth.uid(),
          jsonb_build_object('batch', true, 'asset_ids', p_asset_ids,
                             'through_date', p_through_date,
                             'posted_asset_count', posted_asset_count,
                             'posted_period_count', posted_period_count,
                             'posted_total_minor', posted_total_minor));
  return next;
end;
$$;

create or replace function acc_import_fixed_assets(
  p_rows                 jsonb,
  p_post_opening_entries boolean
) returns table (imported_count int, opening_journal_count int)
language plpgsql security definer set search_path = public as $$
declare
  v_row jsonb;
  v_id uuid;
  v_entry uuid;
  v_method text;
begin
  if not acc_has_permission('fixed_assets.import') then
    raise exception 'You do not have permission to import fixed assets';
  end if;
  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) < 1 then
    raise exception 'Import contains no fixed assets';
  end if;
  if jsonb_array_length(p_rows) > 500 then
    raise exception 'Import is limited to 500 fixed assets per batch';
  end if;

  imported_count := 0;
  opening_journal_count := 0;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_method := coalesce(nullif(v_row->>'depreciation_method', ''), 'straight_line');
    v_id := acc_register_fixed_asset(
      v_row->>'name',
      nullif(v_row->>'description', ''),
      v_row->>'category',
      nullif(v_row->>'serial_number', ''),
      nullif(v_row->>'location', ''),
      (v_row->>'acquisition_date')::date,
      (v_row->>'in_service_date')::date,
      v_row->>'currency_code',
      (v_row->>'cost_minor')::bigint,
      coalesce(nullif(v_row->>'salvage_value_minor', '')::bigint, 0),
      nullif(v_row->>'useful_life_months', '')::int,
      v_method,
      (v_row->>'asset_account_id')::uuid,
      nullif(v_row->>'accumulated_depreciation_account_id', '')::uuid,
      nullif(v_row->>'depreciation_expense_account_id', '')::uuid,
      nullif(v_row->>'vendor_id', '')::uuid,
      null,
      nullif(v_row->>'notes', '')
    );
    if coalesce(nullif(v_row->>'opening_accumulated_depreciation_minor', '')::bigint, 0) > 0
       or p_post_opening_entries then
      v_entry := acc_apply_asset_opening(
        v_id,
        coalesce(nullif(v_row->>'opening_accumulated_depreciation_minor', '')::bigint, 0),
        nullif(v_row->>'opening_as_of_date', '')::date,
        p_post_opening_entries
      );
      if v_entry is not null then opening_journal_count := opening_journal_count + 1; end if;
    end if;
    imported_count := imported_count + 1;
  end loop;
  return next;
end;
$$;

create or replace function acc_dispose_fixed_asset(
  p_asset_id           uuid,
  p_disposal_date      date,
  p_sale_price_minor   bigint,
  p_disposal_cost_minor bigint,
  p_proceeds_account_id uuid,
  p_gain_account_id    uuid,
  p_loss_account_id    uuid,
  p_reason             text
) returns table (
  journal_entry_id uuid,
  net_book_value_minor bigint,
  net_proceeds_minor bigint,
  gain_loss_minor bigint
)
language plpgsql security definer set search_path = public as $$
declare
  v_asset acc_fixed_asset;
  v_accumulated bigint;
  v_account_type acc_account_type;
  v_lines jsonb;
  v_net bigint;
  v_gain_loss bigint;
begin
  if not acc_has_permission('fixed_assets.dispose') then
    raise exception 'You do not have permission to dispose fixed assets';
  end if;
  if not acc_has_permission('fixed_assets.post') then
    raise exception 'Disposal also requires depreciation posting permission';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Disposal reason is required'; end if;
  if p_disposal_date is null or p_disposal_date > current_date then
    raise exception 'Disposal date must be today or earlier';
  end if;
  if coalesce(p_sale_price_minor, 0) < 0 or coalesce(p_disposal_cost_minor, 0) < 0 then
    raise exception 'Sale price and disposal cost cannot be negative';
  end if;

  select * into v_asset from acc_fixed_asset where id = p_asset_id for update;
  if not found then raise exception 'Fixed asset was not found'; end if;
  if v_asset.status = 'disposed' then raise exception 'This fixed asset is already disposed'; end if;
  if p_disposal_date < v_asset.in_service_date then
    raise exception 'Disposal date cannot precede the in-service date';
  end if;

  -- Post all completed monthly periods through the disposal date first.
  if exists (
    select 1 from acc_asset_depreciation_schedule
     where asset_id = p_asset_id
       and status in ('planned', 'opening')
       and posted_amount_minor < planned_amount_minor
       and period_end <= p_disposal_date
  ) then
    perform * from acc_post_asset_depreciation(p_asset_id, p_disposal_date);
  end if;

  select coalesce(sum(posted_amount_minor), 0) into v_accumulated
    from acc_asset_depreciation_schedule
   where asset_id = p_asset_id;
  net_book_value_minor := v_asset.cost_minor - v_accumulated;
  v_net := coalesce(p_sale_price_minor, 0) - coalesce(p_disposal_cost_minor, 0);
  net_proceeds_minor := v_net;
  v_gain_loss := v_net - net_book_value_minor;
  gain_loss_minor := v_gain_loss;

  if v_net <> 0 then
    select account_type into v_account_type
      from acc_account
     where id = p_proceeds_account_id and status = 'active' and is_posting_account;
    if v_account_type not in (
      'bank'::acc_account_type, 'current_asset'::acc_account_type,
      'accounts_receivable'::acc_account_type
    ) then
      raise exception 'Proceeds account must be an active Bank, Current Asset, or Accounts Receivable account';
    end if;
  end if;
  select account_type into v_account_type
    from acc_account where id = p_gain_account_id and status = 'active' and is_posting_account;
  if v_account_type not in ('income'::acc_account_type, 'other_income'::acc_account_type) then
    raise exception 'Gain account must be an active Income account';
  end if;
  select account_type into v_account_type
    from acc_account where id = p_loss_account_id and status = 'active' and is_posting_account;
  if v_account_type not in ('expense'::acc_account_type, 'other_expense'::acc_account_type) then
    raise exception 'Loss account must be an active Expense account';
  end if;

  v_lines := jsonb_build_array(
    jsonb_build_object(
      'account_id', v_asset.asset_account_id,
      'debit_minor', 0,
      'credit_minor', v_asset.cost_minor,
      'amount_base_minor', v_asset.cost_minor,
      'memo', 'Remove fixed asset cost - ' || v_asset.asset_number
    )
  );
  if v_accumulated > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', v_asset.accumulated_depreciation_account_id,
      'debit_minor', v_accumulated,
      'credit_minor', 0,
      'amount_base_minor', v_accumulated,
      'memo', 'Remove accumulated depreciation - ' || v_asset.asset_number
    ));
  end if;
  if v_net > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', p_proceeds_account_id,
      'debit_minor', v_net,
      'credit_minor', 0,
      'amount_base_minor', v_net,
      'memo', 'Net disposal proceeds - ' || v_asset.asset_number
    ));
  elsif v_net < 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', p_proceeds_account_id,
      'debit_minor', 0,
      'credit_minor', -v_net,
      'amount_base_minor', -v_net,
      'memo', 'Net disposal cash cost - ' || v_asset.asset_number
    ));
  end if;
  if v_gain_loss > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', p_gain_account_id,
      'debit_minor', 0,
      'credit_minor', v_gain_loss,
      'amount_base_minor', v_gain_loss,
      'memo', 'Gain on disposal - ' || v_asset.asset_number
    ));
  elsif v_gain_loss < 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', p_loss_account_id,
      'debit_minor', -v_gain_loss,
      'credit_minor', 0,
      'amount_base_minor', -v_gain_loss,
      'memo', 'Loss on disposal - ' || v_asset.asset_number
    ));
  end if;

  journal_entry_id := acc_post_entry(
    p_disposal_date,
    'Dispose ' || v_asset.asset_number || ' - ' || v_asset.name,
    'asset_disposal',
    v_asset.id,
    v_asset.currency_code,
    v_lines
  );

  update acc_asset_depreciation_schedule
     set status = 'cancelled'
   where asset_id = p_asset_id
     and status in ('planned', 'opening')
     and posted_amount_minor < planned_amount_minor;

  update acc_fixed_asset
     set status = 'disposed',
         disposed_at = p_disposal_date,
         disposal_sale_price_minor = coalesce(p_sale_price_minor, 0),
         disposal_cost_minor = coalesce(p_disposal_cost_minor, 0),
         disposal_net_proceeds_minor = v_net,
         disposal_gain_loss_minor = v_gain_loss,
         disposal_proceeds_account_id = p_proceeds_account_id,
         disposal_gain_account_id = p_gain_account_id,
         disposal_loss_account_id = p_loss_account_id,
         disposal_journal_entry_id = journal_entry_id,
         disposal_reason = btrim(p_reason),
         updated_at = now()
   where id = p_asset_id;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values ('acc_fixed_asset', p_asset_id, 'update', auth.uid(),
          jsonb_build_object(
            'status', 'disposed',
            'disposal_date', p_disposal_date,
            'sale_price_minor', p_sale_price_minor,
            'disposal_cost_minor', p_disposal_cost_minor,
            'net_book_value_minor', net_book_value_minor,
            'net_proceeds_minor', v_net,
            'gain_loss_minor', v_gain_loss,
            'journal_entry_id', journal_entry_id,
            'reason', p_reason
          ));
  return next;
end;
$$;

revoke all on function acc_apply_asset_opening(uuid, bigint, date, boolean) from public, anon, authenticated;
revoke all on function acc_post_asset_depreciation_batch(uuid[], date) from public, anon;
revoke all on function acc_import_fixed_assets(jsonb, boolean) from public, anon;
revoke all on function acc_dispose_fixed_asset(uuid, date, bigint, bigint, uuid, uuid, uuid, text) from public, anon;

grant execute on function acc_post_asset_depreciation_batch(uuid[], date) to authenticated;
grant execute on function acc_import_fixed_assets(jsonb, boolean) to authenticated;
grant execute on function acc_dispose_fixed_asset(uuid, date, bigint, bigint, uuid, uuid, uuid, text) to authenticated;
