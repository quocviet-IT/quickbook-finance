-- ============================================================================
-- 0170  Master data is saved through functions; the matrix knows who can use
--       each permission (2.60)
--
-- Phase 3, second part, of the permission plan, and the last open point of
-- phase 4. Nothing here takes anything away yet.
--
-- 1. Functions for every write the screens make to master data. Until now the
--    screens wrote eleven tables directly: accounts, bank accounts, bank rules,
--    the banking preference, customers, products and services, recurring
--    schedules, related companies, cards and loans, tax codes and vendors. Each
--    function below checks the same thing the table's write policy checks today
--    (staff; items.manage for products; recurring.manage for schedules; admin
--    for tax codes) and saves only the columns its screen saves - so the system
--    columns (ids, timestamps, who created a row, an account's code once set, a
--    customer's currency once set, a schedule's status and run history) can no
--    longer be written around the screen. The audit and guard triggers on these
--    tables run as before.
--
--    The application moves to these functions in the same release. The tables
--    are locked by the next migration, once no deployed screen writes them
--    directly; locking them here would break the screens between this
--    migration and that deployment.
--
-- 2. Who can use each permission. Most bookkeeping functions ask for the admin
--    or accountant role as well as the permission, and reopening a period or a
--    reconciliation asks for an admin, so giving those permissions to another
--    role changed nothing. acc_permission.min_role now says so, the matrix
--    refuses such a grant, and the Permissions screen greys those switches out.
--    No company holds such a grant today (checked 26 October 2026); any that did
--    would be cleared below, since it never had an effect.
-- ============================================================================
set search_path = public;

-- ----------------------------------------------------------------------------
-- The one writer behind the save functions. The API may not call it: each
-- caller below decides who may write and which columns.
-- ----------------------------------------------------------------------------
create or replace function acc_write_master(p_table text, p_id uuid, p_values jsonb, p_allowed text[])
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_values jsonb := coalesce(p_values, '{}'::jsonb);
  v_keys   text[];
  v_bad    text;
  v_cols   text;
  v_touch  text := '';
  v_row    jsonb;
begin
  if jsonb_typeof(v_values) <> 'object' then
    raise exception 'The fields to save must be an object';
  end if;
  select array_agg(k order by k) into v_keys from jsonb_object_keys(v_values) as k;
  select string_agg(k, ', ' order by k) into v_bad
    from unnest(coalesce(v_keys, '{}'::text[])) as k
   where not (k = any (p_allowed));
  if v_bad is not null then
    raise exception 'These fields cannot be saved here: %', v_bad using errcode = '42501';
  end if;
  if v_keys is null then
    raise exception 'Nothing to save';
  end if;
  select string_agg(format('%I', k), ', ' order by k) into v_cols from unnest(v_keys) as k;

  if p_id is null then
    execute format(
      'insert into %I (%s) select %s from jsonb_populate_record(null::%I, $1) returning to_jsonb(%I.*)',
      p_table, v_cols, v_cols, p_table, p_table)
      into v_row
      using v_values;
  else
    if exists (select 1 from pg_attribute a
                where a.attrelid = to_regclass(p_table) and a.attname = 'updated_at' and not a.attisdropped) then
      v_touch := ', updated_at = now()';
    end if;
    execute format(
      'update %I t set (%s) = (select %s from jsonb_populate_record(null::%I, $1))%s where t.id = $2 returning to_jsonb(t.*)',
      p_table, v_cols, v_cols, p_table, v_touch)
      into v_row
      using v_values, p_id;
    if v_row is null then
      raise exception 'This record is no longer here' using errcode = 'P0002';
    end if;
  end if;
  return v_row;
end;
$$;

revoke all on function acc_write_master(text, uuid, jsonb, text[]) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- Chart of accounts. The code is fixed once the account exists.
-- ----------------------------------------------------------------------------
create or replace function acc_save_account(p_id uuid, p_values jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to change the chart of accounts' using errcode = '42501';
  end if;
  return acc_write_master('acc_account', p_id, p_values,
    case when p_id is null then array['account_code'] else array[]::text[] end
    || array['name', 'account_type', 'cash_flow_role', 'detail_type', 'is_contra', 'is_clearing',
             'parent_account_id', 'description', 'default_tax_code_id', 'currency_code',
             'is_posting_account', 'status']);
end;
$$;

/**
 * Fill in what the chart leaves blank: a cash flow role where it is still
 * 'unclassified', a detail type where there is none. Never overwrites.
 */
create or replace function acc_classify_accounts(p_ids uuid[], p_cash_flow_role text, p_detail_type text)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_changed integer := 0;
  v_n       integer;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to change the chart of accounts' using errcode = '42501';
  end if;
  if p_cash_flow_role is not null then
    update acc_account set cash_flow_role = p_cash_flow_role
     where id = any (p_ids) and cash_flow_role = 'unclassified';
    get diagnostics v_n = row_count;
    v_changed := v_changed + v_n;
  end if;
  if p_detail_type is not null then
    update acc_account set detail_type = p_detail_type
     where id = any (p_ids) and detail_type is null;
    get diagnostics v_n = row_count;
    v_changed := v_changed + v_n;
  end if;
  return v_changed;
end;
$$;

-- ----------------------------------------------------------------------------
-- Banking set-up.
-- ----------------------------------------------------------------------------
create or replace function acc_save_bank_account(p_values jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to add a bank account' using errcode = '42501';
  end if;
  return acc_write_master('acc_bank_account', null, p_values,
    array['account_id', 'bank_name', 'account_number_masked', 'currency_code']);
end;
$$;

/** A new rule goes last; acc_reorder_bank_rules moves it. */
create or replace function acc_save_bank_rule(p_id uuid, p_values jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_fields text[] := array['match_kind', 'match_text', 'direction', 'min_minor', 'max_minor', 'account_id', 'is_active'];
  v_values jsonb := coalesce(p_values, '{}'::jsonb);
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to change bank rules' using errcode = '42501';
  end if;
  if p_id is null then
    v_values := v_values || jsonb_build_object(
      'position', coalesce((select max(position) from acc_bank_rule), 0) + 1);
    v_fields := v_fields || 'position'::text;
  end if;
  return (acc_write_master('acc_bank_rule', p_id, v_values, v_fields) ->> 'id')::uuid;
end;
$$;

create or replace function acc_delete_bank_rule(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to change bank rules' using errcode = '42501';
  end if;
  delete from acc_bank_rule where id = p_id;
end;
$$;

create or replace function acc_save_banking_preference(p_funding_account_id uuid, p_pair_window_days integer)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to change the banking preferences' using errcode = '42501';
  end if;
  insert into acc_banking_preference (singleton, funding_account_id, pair_window_days)
  values (true, p_funding_account_id, p_pair_window_days)
  on conflict (singleton) do update
    set funding_account_id = excluded.funding_account_id,
        pair_window_days = excluded.pair_window_days,
        updated_at = now();
end;
$$;

create or replace function acc_save_related_company(p_id uuid, p_values jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to change related companies' using errcode = '42501';
  end if;
  return (acc_write_master('acc_related_company', p_id, p_values,
    array['name', 'account_id', 'match_words', 'is_active']) ->> 'id')::uuid;
end;
$$;

create or replace function acc_delete_related_company(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to change related companies' using errcode = '42501';
  end if;
  delete from acc_related_company where id = p_id;
end;
$$;

create or replace function acc_save_repayment_account(p_id uuid, p_values jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to change cards and loans' using errcode = '42501';
  end if;
  return (acc_write_master('acc_repayment_account', p_id, p_values,
    array['kind', 'account_id', 'match_words', 'match_digits', 'interest_account_id', 'interest_method',
          'annual_rate', 'fixed_interest_minor', 'is_active']) ->> 'id')::uuid;
end;
$$;

create or replace function acc_delete_repayment_account(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to change cards and loans' using errcode = '42501';
  end if;
  delete from acc_repayment_account where id = p_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Customers and vendors. A customer's currency is fixed once set: it is in
-- every document already issued to them.
-- ----------------------------------------------------------------------------
create or replace function acc_save_customer(p_id uuid, p_values jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to change customers' using errcode = '42501';
  end if;
  return acc_write_master('acc_customer', p_id, p_values,
    case when p_id is null then array['currency_code'] else array[]::text[] end
    || array['name', 'email', 'contact_name', 'phone', 'address_line1', 'address_line2', 'city', 'region',
             'postal_code', 'country', 'credit_limit_minor', 'credit_terms_days', 'credit_hold',
             'credit_review_note', 'credit_reviewed_at']);
end;
$$;

create or replace function acc_save_vendor(p_values jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to add vendors' using errcode = '42501';
  end if;
  return acc_write_master('acc_vendor', null, p_values,
    array['name', 'email', 'phone', 'currency_code', 'ap_account_id', 'default_expense_account_id', 'payment_terms']);
end;
$$;

-- ----------------------------------------------------------------------------
-- Products and services, tax codes and recurring schedules: the permission or
-- role their write policies ask for today.
-- ----------------------------------------------------------------------------
create or replace function acc_save_item(p_id uuid, p_values jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not acc_has_permission('items.manage') then
    raise exception 'You do not have permission to manage products and services' using errcode = '42501';
  end if;
  return acc_write_master('acc_item', p_id, p_values,
    array['item_code', 'name', 'description', 'is_sold', 'sales_price_minor', 'income_account_id',
          'sales_tax_code_id', 'is_purchased', 'purchase_cost_minor', 'expense_account_id', 'is_inventory',
          'inventory_account_id', 'cogs_account_id', 'is_active']);
end;
$$;

create or replace function acc_save_tax_code(p_id uuid, p_values jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not acc_is_admin() then
    raise exception 'Only an admin can change tax codes' using errcode = '42501';
  end if;
  return acc_write_master('acc_tax_code', p_id, p_values,
    array['code', 'name', 'rate_percent', 'direction', 'tax_account_id', 'is_active', 'state_code']);
end;
$$;

/** A new schedule, stamped with who made it. Its runs are the runner's to record. */
create or replace function acc_save_recurring_template(p_values jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not acc_has_permission('recurring.manage') then
    raise exception 'You do not have permission to manage recurring transactions' using errcode = '42501';
  end if;
  return acc_write_master('acc_recurring_template', null,
    (coalesce(p_values, '{}'::jsonb) - 'created_by' - 'updated_by')
      || jsonb_build_object('created_by', auth.uid(), 'updated_by', auth.uid()),
    array['name', 'document_type', 'frequency', 'interval_count', 'start_date', 'next_run_date', 'end_date',
          'payload', 'total_minor', 'created_by', 'updated_by']);
end;
$$;

/** Pause or resume. An ended schedule stays ended. */
create or replace function acc_set_recurring_template_status(p_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_status text;
begin
  if not acc_has_permission('recurring.manage') then
    raise exception 'You do not have permission to manage recurring transactions' using errcode = '42501';
  end if;
  if p_status not in ('active', 'paused') then
    raise exception 'A schedule can only be paused or resumed here';
  end if;
  select status::text into v_status from acc_recurring_template where id = p_id for update;
  if not found then
    raise exception 'This schedule is no longer here' using errcode = 'P0002';
  end if;
  if v_status = 'ended' then
    raise exception 'An ended schedule cannot be resumed';
  end if;
  perform acc_write_master('acc_recurring_template', p_id,
    jsonb_build_object('status', p_status, 'updated_by', auth.uid()), array['status', 'updated_by']);
end;
$$;

revoke all on function acc_save_account(uuid, jsonb) from public, anon;
revoke all on function acc_classify_accounts(uuid[], text, text) from public, anon;
revoke all on function acc_save_bank_account(jsonb) from public, anon;
revoke all on function acc_save_bank_rule(uuid, jsonb) from public, anon;
revoke all on function acc_delete_bank_rule(uuid) from public, anon;
revoke all on function acc_save_banking_preference(uuid, integer) from public, anon;
revoke all on function acc_save_related_company(uuid, jsonb) from public, anon;
revoke all on function acc_delete_related_company(uuid) from public, anon;
revoke all on function acc_save_repayment_account(uuid, jsonb) from public, anon;
revoke all on function acc_delete_repayment_account(uuid) from public, anon;
revoke all on function acc_save_customer(uuid, jsonb) from public, anon;
revoke all on function acc_save_vendor(jsonb) from public, anon;
revoke all on function acc_save_item(uuid, jsonb) from public, anon;
revoke all on function acc_save_tax_code(uuid, jsonb) from public, anon;
revoke all on function acc_save_recurring_template(jsonb) from public, anon;
revoke all on function acc_set_recurring_template_status(uuid, text) from public, anon;
grant execute on function acc_save_account(uuid, jsonb) to authenticated;
grant execute on function acc_classify_accounts(uuid[], text, text) to authenticated;
grant execute on function acc_save_bank_account(jsonb) to authenticated;
grant execute on function acc_save_bank_rule(uuid, jsonb) to authenticated;
grant execute on function acc_delete_bank_rule(uuid) to authenticated;
grant execute on function acc_save_banking_preference(uuid, integer) to authenticated;
grant execute on function acc_save_related_company(uuid, jsonb) to authenticated;
grant execute on function acc_delete_related_company(uuid) to authenticated;
grant execute on function acc_save_repayment_account(uuid, jsonb) to authenticated;
grant execute on function acc_delete_repayment_account(uuid) to authenticated;
grant execute on function acc_save_customer(uuid, jsonb) to authenticated;
grant execute on function acc_save_vendor(jsonb) to authenticated;
grant execute on function acc_save_item(uuid, jsonb) to authenticated;
grant execute on function acc_save_tax_code(uuid, jsonb) to authenticated;
grant execute on function acc_save_recurring_template(jsonb) to authenticated;
grant execute on function acc_set_recurring_template_status(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Who can use each permission.
-- ----------------------------------------------------------------------------
alter table acc_permission
  add column min_role text not null default 'any' check (min_role in ('any', 'staff', 'admin'));

comment on column acc_permission.min_role is
  'The least role whose holding this permission has an effect: any, staff (admin or accountant) or admin. '
  'It follows the role check each function using the permission makes, and the matrix refuses a grant below it.';

/** Whether a role is at or above a permission's least role. */
create or replace function acc_role_meets(p_role acc_app_role, p_min_role text)
returns boolean
language sql immutable set search_path = public as $$
  select case p_min_role
           when 'admin' then p_role = 'admin'
           when 'staff' then p_role in ('admin', 'accountant')
           else true
         end;
$$;

update acc_permission set min_role = 'staff'
 where key in ('bill.post', 'bill.void', 'credit.override', 'inventory.adjust', 'invoice.issue', 'invoice.void',
               'journal.void', 'period.close', 'po.approve', 'po.variance_approve', 'reconciliation.complete',
               'writeoff.create');
update acc_permission set min_role = 'admin'
 where key in ('period.reopen', 'reconciliation.reopen');

-- A grant below the least role never had an effect; the matrix stops showing one.
update acc_role_permission rp
   set allowed = false, updated_at = now()
  from acc_permission p
 where p.key = rp.permission_key and rp.allowed and not acc_role_meets(rp.role, p.min_role);

create or replace function acc_set_role_permission(p_role acc_app_role, p_key text, p_allowed boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_permission acc_permission;
begin
  if not acc_has_permission('permissions.manage') then
    raise exception 'You do not have permission to change the permission matrix';
  end if;
  if p_role = 'admin' and p_key in ('permissions.manage', 'users.manage') and not p_allowed then
    raise exception 'An admin must keep % or the installation locks itself out', p_key;
  end if;
  select * into v_permission from acc_permission where key = p_key;
  if not found then
    raise exception 'There is no permission %', p_key;
  end if;
  if p_allowed and not acc_role_meets(p_role, v_permission.min_role) then
    raise exception '% works only for %, so it cannot be given to the % role',
      v_permission.label,
      case v_permission.min_role when 'admin' then 'admins' else 'admins and accountants' end,
      p_role;
  end if;

  insert into acc_role_permission (role, permission_key, allowed, updated_by, updated_at)
  values (p_role, p_key, p_allowed, auth.uid(), now())
  on conflict (role, permission_key)
    do update set allowed = p_allowed, updated_by = auth.uid(), updated_at = now();

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
    values ('acc_role_permission', null, 'update', auth.uid(),
            jsonb_build_object('role', p_role, 'permission_key', p_key, 'allowed', p_allowed));
end;
$$;
