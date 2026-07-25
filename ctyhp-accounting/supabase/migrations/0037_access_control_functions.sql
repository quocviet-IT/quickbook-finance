-- ============================================================================
-- Module C — access control, maker-checker approval, audit search.
--
-- Enforcement model:
--   * a PERMISSION decides whether a role may attempt an action;
--   * an APPROVAL POLICY decides whether someone else must authorize it.
--
-- The approval gate is airtight rather than advisory: a controlled function
-- refuses to run when its policy applies unless acc_in_approval_dispatch() is
-- true, and only acc_approve_request sets that transaction-local flag. So the
-- approver's path is the only way through, and calling the underlying RPC
-- directly cannot bypass the policy.
--
-- Note on actor identity: the dispatched call runs as the APPROVER, so the
-- created_by / actor columns of the resulting document name them. The request
-- row records who asked. Both halves are needed to reconstruct the control.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Suspension takes effect everywhere at once: every RLS policy and RPC in the
-- application derives from this function.
-- ----------------------------------------------------------------------------
create or replace function acc_current_role() returns acc_app_role
language sql stable security definer set search_path = public as $$
  select role from acc_app_user
   where id = auth.uid() and status in ('invited', 'active');
$$;

/** Fail-closed permission check for the caller's role. */
create or replace function acc_has_permission(p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select rp.allowed
       from acc_role_permission rp
      where rp.role = acc_current_role() and rp.permission_key = p_key),
    false);
$$;

/** Does this action, at this amount, need someone else's approval? */
create or replace function acc_approval_required(p_action_key text, p_amount_minor bigint)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.enabled and abs(coalesce(p_amount_minor, 0)) >= p.threshold_minor
       from acc_approval_policy p where p.action_key = p_action_key),
    false);
$$;

/**
 * True only inside acc_approve_request's dispatch. The flag is transaction-local
 * (set_config(..., true)), so it cannot leak to another statement or session.
 */
create or replace function acc_in_approval_dispatch() returns boolean
language sql stable as $$
  select coalesce(current_setting('acc.approval_dispatch', true), 'off') = 'on';
$$;

/** Total debits of a manual-journal line payload — the amount a policy compares. */
create or replace function acc_jsonb_debit_total(p_lines jsonb) returns bigint
language sql immutable as $$
  select coalesce(sum(coalesce((l ->> 'debit_minor')::bigint, 0)), 0)::bigint
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) as l;
$$;

/**
 * The value an inventory adjustment will move, decided the same way
 * acc_adjust_inventory decides it, so the threshold sees the real amount.
 */
create or replace function acc_inventory_adjust_amount(
  p_item_id           uuid,
  p_qty_delta         numeric,
  p_unit_cost_minor   bigint,
  p_value_delta_minor bigint
) returns bigint
language plpgsql stable as $$
begin
  if p_qty_delta > 0 then
    return round(p_qty_delta * coalesce(p_unit_cost_minor, 0))::bigint;
  elsif p_qty_delta < 0 then
    return acc_cost_of_sale_minor(p_item_id, -p_qty_delta);
  else
    return abs(coalesce(p_value_delta_minor, 0));
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- The request queue.
-- ----------------------------------------------------------------------------
create or replace function acc_submit_for_approval(
  p_action_key   text,
  p_title        text,
  p_amount_minor bigint,
  p_payload      jsonb,
  p_reason       text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_policy acc_approval_policy;
  v_id     uuid;
begin
  if not acc_is_staff() then raise exception 'Not authorized to submit approval requests'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required'; end if;

  select * into v_policy from acc_approval_policy where action_key = p_action_key;
  if not found then raise exception 'Unknown controlled action %', p_action_key; end if;
  if not v_policy.enabled then
    raise exception 'Approval is not enabled for %; perform the action directly', v_policy.label;
  end if;
  if p_payload is null then raise exception 'An approval request needs its intended call'; end if;

  insert into acc_approval_request
    (action_key, title, amount_minor, payload, reason, requested_by)
  values (p_action_key, coalesce(nullif(btrim(p_title), ''), v_policy.label),
          coalesce(p_amount_minor, 0), p_payload, p_reason, auth.uid())
  returning id into v_id;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
    values ('acc_approval_request', v_id, 'insert', auth.uid(),
            jsonb_build_object('action_key', p_action_key, 'amount_minor', p_amount_minor, 'reason', p_reason));
  return v_id;
end;
$$;

/**
 * Approve and execute. Segregation of duties is checked here, not in the UI:
 * with it on, the requester can never be the approver.
 */
create or replace function acc_approve_request(p_request_id uuid, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_req    acc_approval_request;
  v_policy acc_approval_policy;
  v_p      jsonb;
  v_result uuid;
begin
  if not acc_has_permission('approval.decide') then
    raise exception 'You do not have permission to decide approval requests';
  end if;

  select * into v_req from acc_approval_request where id = p_request_id for update;
  if not found then raise exception 'Approval request not found'; end if;
  if v_req.status <> 'pending' then raise exception 'Request is already %', v_req.status; end if;

  select * into v_policy from acc_approval_policy where action_key = v_req.action_key;
  if v_policy.require_segregation and v_req.requested_by = auth.uid() then
    raise exception 'You cannot approve your own request while segregation of duties is enabled';
  end if;

  v_p := v_req.payload;
  perform set_config('acc.approval_dispatch', 'on', true);

  if v_req.action_key = 'manual_journal' then
    v_result := acc_post_manual_journal(
      (v_p ->> 'entry_date')::date, v_p ->> 'description', v_p ->> 'source_ref',
      v_p ->> 'currency', v_p -> 'lines');
  elsif v_req.action_key = 'write_off' then
    v_result := acc_write_off(
      v_p ->> 'side', (v_p ->> 'target_id')::uuid, (v_p ->> 'offset_account_id')::uuid,
      (v_p ->> 'amount_minor')::bigint, (v_p ->> 'date')::date, v_req.reason);
  elsif v_req.action_key = 'inventory_adjustment' then
    v_result := acc_adjust_inventory(
      (v_p ->> 'item_id')::uuid, (v_p ->> 'date')::date, (v_p ->> 'qty_delta')::numeric,
      (v_p ->> 'unit_cost_minor')::bigint, (v_p ->> 'value_delta_minor')::bigint,
      (v_p ->> 'offset_account_id')::uuid, v_req.reason);
  elsif v_req.action_key = 'period_reopen' then
    perform acc_reopen_period((v_p ->> 'period_id')::uuid, v_req.reason);
    v_result := (v_p ->> 'period_id')::uuid;
  elsif v_req.action_key = 'reconciliation_reopen' then
    perform acc_reopen_reconciliation((v_p ->> 'reconciliation_id')::uuid, v_req.reason);
    v_result := (v_p ->> 'reconciliation_id')::uuid;
  else
    raise exception 'No dispatch defined for %', v_req.action_key;
  end if;

  perform set_config('acc.approval_dispatch', 'off', true);

  update acc_approval_request
     set status = 'approved', decided_by = auth.uid(), decided_at = now(),
         decision_note = p_note, result_id = v_result
   where id = p_request_id;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
    values ('acc_approval_request', p_request_id, 'post', auth.uid(),
            jsonb_build_object('status', 'approved', 'result_id', v_result, 'note', p_note));
  return v_result;
end;
$$;

create or replace function acc_reject_request(p_request_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_status acc_approval_status;
begin
  if not acc_has_permission('approval.decide') then
    raise exception 'You do not have permission to decide approval requests';
  end if;
  if coalesce(btrim(p_note), '') = '' then raise exception 'A rejection note is required'; end if;

  select status into v_status from acc_approval_request where id = p_request_id for update;
  if not found then raise exception 'Approval request not found'; end if;
  if v_status <> 'pending' then raise exception 'Request is already %', v_status; end if;

  update acc_approval_request
     set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = p_note
   where id = p_request_id;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
    values ('acc_approval_request', p_request_id, 'void', auth.uid(),
            jsonb_build_object('status', 'rejected', 'note', p_note));
end;
$$;

create or replace function acc_cancel_request(p_request_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_req acc_approval_request;
begin
  select * into v_req from acc_approval_request where id = p_request_id for update;
  if not found then raise exception 'Approval request not found'; end if;
  if v_req.status <> 'pending' then raise exception 'Request is already %', v_req.status; end if;
  if v_req.requested_by <> auth.uid() and not acc_is_admin() then
    raise exception 'Only the requester or an admin can cancel a request';
  end if;

  update acc_approval_request
     set status = 'cancelled', decided_by = auth.uid(), decided_at = now()
   where id = p_request_id;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
    values ('acc_approval_request', p_request_id, 'void', auth.uid(),
            jsonb_build_object('status', 'cancelled'));
end;
$$;

-- ----------------------------------------------------------------------------
-- Users. The only path to auth data, and it returns nothing else from `auth`.
-- ----------------------------------------------------------------------------
create or replace function acc_list_users()
returns table (
  id            uuid,
  email         text,
  full_name     text,
  role          acc_app_role,
  status        acc_user_status,
  mfa_enrolled  boolean,
  last_sign_in  timestamptz,
  invited_at    timestamptz,
  status_reason text
)
language plpgsql security definer set search_path = public as $$
begin
  if not acc_has_permission('users.manage') then
    raise exception 'You do not have permission to manage users';
  end if;
  return query
    select u.id, au.email::text, u.full_name, u.role, u.status,
           exists (select 1 from auth.mfa_factors f
                    where f.user_id = u.id and f.status = 'verified'),
           au.last_sign_in_at, u.invited_at, u.status_reason
      from acc_app_user u
      join auth.users au on au.id = u.id
     order by u.role, au.email;
end;
$$;

/** Count of active admins — the lock-out guard both SQL and the UI use. */
create or replace function acc_active_admin_count() returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from acc_app_user
   where role = 'admin' and status in ('invited', 'active');
$$;

create or replace function acc_set_user_role(p_user_id uuid, p_role acc_app_role, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_before acc_app_user;
begin
  if not acc_has_permission('users.manage') then
    raise exception 'You do not have permission to manage users';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required'; end if;

  select * into v_before from acc_app_user where id = p_user_id for update;
  if not found then raise exception 'User not found'; end if;
  if p_user_id = auth.uid() and p_role <> 'admin' then
    raise exception 'You cannot remove your own admin role; ask another admin';
  end if;
  if v_before.role = 'admin' and p_role <> 'admin'
     and v_before.status in ('invited', 'active') and acc_active_admin_count() <= 1 then
    raise exception 'This is the last active admin; promote another admin first';
  end if;

  update acc_app_user set role = p_role where id = p_user_id;
  insert into acc_audit_log (table_name, record_id, action, actor_id, before_json, after_json)
    values ('acc_app_user', p_user_id, 'update', auth.uid(),
            jsonb_build_object('role', v_before.role),
            jsonb_build_object('role', p_role, 'reason', p_reason));
end;
$$;

create or replace function acc_set_user_status(p_user_id uuid, p_status acc_user_status, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_before acc_app_user;
begin
  if not acc_has_permission('users.manage') then
    raise exception 'You do not have permission to manage users';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required'; end if;

  select * into v_before from acc_app_user where id = p_user_id for update;
  if not found then raise exception 'User not found'; end if;
  if p_user_id = auth.uid() and p_status <> 'active' then
    raise exception 'You cannot suspend or offboard yourself; ask another admin';
  end if;
  if v_before.role = 'admin' and p_status not in ('invited', 'active')
     and acc_active_admin_count() <= 1 then
    raise exception 'This is the last active admin; promote another admin first';
  end if;

  update acc_app_user
     set status = p_status, status_changed_at = now(), status_reason = p_reason
   where id = p_user_id;
  insert into acc_audit_log (table_name, record_id, action, actor_id, before_json, after_json)
    values ('acc_app_user', p_user_id, 'update', auth.uid(),
            jsonb_build_object('status', v_before.status),
            jsonb_build_object('status', p_status, 'reason', p_reason));
end;
$$;

create or replace function acc_set_role_permission(p_role acc_app_role, p_key text, p_allowed boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not acc_has_permission('permissions.manage') then
    raise exception 'You do not have permission to change the permission matrix';
  end if;
  if p_role = 'admin' and p_key in ('permissions.manage', 'users.manage') and not p_allowed then
    raise exception 'An admin must keep % or the installation locks itself out', p_key;
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

create or replace function acc_set_approval_policy(
  p_action_key          text,
  p_enabled             boolean,
  p_threshold_minor     bigint,
  p_require_segregation boolean
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not acc_has_permission('settings.manage') then
    raise exception 'You do not have permission to change approval policies';
  end if;
  if coalesce(p_threshold_minor, 0) < 0 then raise exception 'Threshold cannot be negative'; end if;

  update acc_approval_policy
     set enabled = p_enabled, threshold_minor = coalesce(p_threshold_minor, 0),
         require_segregation = p_require_segregation, updated_by = auth.uid(), updated_at = now()
   where action_key = p_action_key;
  if not found then raise exception 'Unknown controlled action %', p_action_key; end if;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
    values ('acc_approval_policy', null, 'update', auth.uid(),
            jsonb_build_object('action_key', p_action_key, 'enabled', p_enabled,
                               'threshold_minor', p_threshold_minor,
                               'require_segregation', p_require_segregation));
end;
$$;

-- ----------------------------------------------------------------------------
-- Audit history with filters (US-FR-014). Resolves the actor's email, which is
-- why this is a function rather than a plain select.
-- ----------------------------------------------------------------------------
create or replace function acc_audit_search(
  p_table     text,
  p_record_id uuid,
  p_actor_id  uuid,
  p_action    text,
  p_from      date,
  p_to        date,
  p_limit     int
)
returns table (
  id          uuid,
  table_name  text,
  record_id   uuid,
  action      text,
  actor_id    uuid,
  actor_email text,
  before_json jsonb,
  after_json  jsonb,
  created_at  timestamptz
)
language plpgsql security definer set search_path = public as $$
begin
  if not acc_has_permission('audit.read') then
    raise exception 'You do not have permission to read the audit log';
  end if;
  return query
    select a.id, a.table_name, a.record_id, a.action::text, a.actor_id, au.email::text,
           a.before_json, a.after_json, a.created_at
      from acc_audit_log a
      left join auth.users au on au.id = a.actor_id
     where (p_table is null or a.table_name = p_table)
       and (p_record_id is null or a.record_id = p_record_id)
       and (p_actor_id is null or a.actor_id = p_actor_id)
       and (p_action is null or a.action::text = p_action)
       and (p_from is null or a.created_at >= p_from::timestamptz)
       and (p_to is null or a.created_at < (p_to + 1)::timestamptz)
     order by a.created_at desc
     limit least(coalesce(p_limit, 200), 1000);
end;
$$;

-- ----------------------------------------------------------------------------
-- The five controlled actions, redefined with a permission check and the
-- approval gate. Each body below is copied verbatim from the migration named in
-- its comment; only the guard is new. Nothing else about their behaviour
-- changes, and with every policy seeded disabled they behave exactly as before
-- until an admin enables one.
-- ----------------------------------------------------------------------------

-- acc_post_manual_journal — body from 0018_manual_journal_functions.sql, guard added here.
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
  if not acc_has_permission('journal.post') then
    raise exception 'You do not have permission to post journal entries';
  end if;
  if acc_approval_required('manual_journal', acc_jsonb_debit_total(p_lines))
     and not acc_in_approval_dispatch() then
    raise exception 'A manual journal of this size requires approval; submit it for approval instead';
  end if;

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

-- acc_write_off — body from 0023_fix_credit_status_casts.sql, guard added here.
create or replace function acc_write_off(
  p_side text, p_target_id uuid, p_offset_account_id uuid, p_amount_minor bigint, p_date date, p_reason text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_number text; v_entry uuid; v_base bigint; v_id uuid; v_offtype acc_account_type;
  v_ar uuid; v_ap uuid; v_inv acc_invoice; v_bill acc_bill; v_ccy text;
begin
  if not acc_is_staff() then raise exception 'Not authorized to write off balances'; end if;
  if not acc_has_permission('writeoff.create') then
    raise exception 'You do not have permission to write off balances';
  end if;
  if acc_approval_required('write_off', p_amount_minor) and not acc_in_approval_dispatch() then
    raise exception 'A write-off of this size requires approval; submit it for approval instead';
  end if;
  if p_amount_minor <= 0 then raise exception 'Write-off amount must be positive'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'A write-off reason is required'; end if;
  select account_type into v_offtype from acc_account where id = p_offset_account_id;
  if v_offtype is null then raise exception 'Offset account not found'; end if;

  if p_side = 'ar' then
    if v_offtype not in ('expense','cost_of_goods_sold','other_expense') then
      raise exception 'AR write-off offset must be an expense account';
    end if;
    select * into v_inv from acc_invoice where id = p_target_id for update;
    if not found then raise exception 'Invoice not found'; end if;
    if v_inv.status not in ('issued','partial') then raise exception 'Invoice is not open'; end if;
    if p_amount_minor > v_inv.balance_due_minor then raise exception 'Write-off % exceeds invoice balance %', p_amount_minor, v_inv.balance_due_minor; end if;
    v_ccy := v_inv.currency_code;
    v_ar := acc_active_ar_account();
    if v_ar is null then raise exception 'No active Accounts Receivable account configured'; end if;
    v_base := acc_to_base_minor(p_amount_minor, v_ccy, p_date);
    v_number := acc_next_number('write_off');
    v_entry := acc_post_entry(p_date, 'Write-off ' || v_number, 'manual', p_target_id, v_ccy,
      jsonb_build_array(
        jsonb_build_object('account_id', p_offset_account_id, 'debit_minor', p_amount_minor, 'credit_minor', 0, 'amount_base_minor', v_base, 'memo', 'Bad debt write-off'),
        jsonb_build_object('account_id', v_ar, 'debit_minor', 0, 'credit_minor', p_amount_minor, 'amount_base_minor', v_base, 'memo', 'Write off receivable')
      ));
    update acc_invoice set balance_due_minor = balance_due_minor - p_amount_minor,
        status = (case when balance_due_minor - p_amount_minor = 0 then 'paid' else 'partial' end)::acc_invoice_status, updated_at=now()
     where id = p_target_id;
    insert into acc_write_off (write_off_number, side, invoice_id, write_off_date, currency_code, amount_minor, offset_account_id, reason, status, journal_entry_id, created_by)
      values (v_number, 'ar', p_target_id, p_date, v_ccy, p_amount_minor, p_offset_account_id, p_reason, 'posted', v_entry, auth.uid())
      returning id into v_id;
  elsif p_side = 'ap' then
    if v_offtype not in ('income','other_income') then
      raise exception 'AP write-off offset must be an income account';
    end if;
    select * into v_bill from acc_bill where id = p_target_id for update;
    if not found then raise exception 'Bill not found'; end if;
    if v_bill.status not in ('open','partial') then raise exception 'Bill is not open'; end if;
    if p_amount_minor > v_bill.balance_due_minor then raise exception 'Write-off % exceeds bill balance %', p_amount_minor, v_bill.balance_due_minor; end if;
    v_ccy := v_bill.currency_code;
    v_ap := coalesce((select ap_account_id from acc_vendor where id = v_bill.vendor_id), acc_active_ap_account());
    if v_ap is null then raise exception 'No active Accounts Payable account configured'; end if;
    v_base := acc_to_base_minor(p_amount_minor, v_ccy, p_date);
    v_number := acc_next_number('write_off');
    v_entry := acc_post_entry(p_date, 'Write-off ' || v_number, 'manual', p_target_id, v_ccy,
      jsonb_build_array(
        jsonb_build_object('account_id', v_ap, 'debit_minor', p_amount_minor, 'credit_minor', 0, 'amount_base_minor', v_base, 'memo', 'Write off payable'),
        jsonb_build_object('account_id', p_offset_account_id, 'debit_minor', 0, 'credit_minor', p_amount_minor, 'amount_base_minor', v_base, 'memo', 'Payable write-off income')
      ));
    update acc_bill set balance_due_minor = balance_due_minor - p_amount_minor,
        status = (case when balance_due_minor - p_amount_minor = 0 then 'paid' else 'partial' end)::acc_bill_status, updated_at=now()
     where id = p_target_id;
    insert into acc_write_off (write_off_number, side, bill_id, write_off_date, currency_code, amount_minor, offset_account_id, reason, status, journal_entry_id, created_by)
      values (v_number, 'ap', p_target_id, p_date, v_ccy, p_amount_minor, p_offset_account_id, p_reason, 'posted', v_entry, auth.uid())
      returning id into v_id;
  else
    raise exception 'Invalid write-off side %', p_side;
  end if;

  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_write_off', v_id, 'post', auth.uid());
  return v_id;
end;
$$;

-- acc_adjust_inventory — body from 0034_inventory_functions.sql, guard added here.
create or replace function acc_adjust_inventory(
  p_item_id           uuid,
  p_date              date,
  p_qty_delta         numeric,
  p_unit_cost_minor   bigint,
  p_value_delta_minor bigint,
  p_offset_account_id uuid,
  p_reason            text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_item  acc_item;
  v_cost  bigint;
  v_lines jsonb;
  v_entry uuid;
  v_base  text;
begin
  if not acc_is_staff() then raise exception 'Not authorized to adjust inventory'; end if;
  if not acc_has_permission('inventory.adjust') then
    raise exception 'You do not have permission to adjust inventory';
  end if;
  if acc_approval_required('inventory_adjustment',
       acc_inventory_adjust_amount(p_item_id, p_qty_delta, p_unit_cost_minor, p_value_delta_minor))
     and not acc_in_approval_dispatch() then
    raise exception 'An inventory adjustment of this size requires approval; submit it for approval instead';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'An adjustment reason is required'; end if;

  select * into v_item from acc_item where id = p_item_id for update;
  if not found then raise exception 'Item not found'; end if;
  if not v_item.is_inventory then raise exception 'Item % is not an inventory item', v_item.name; end if;
  if v_item.inventory_account_id is null then
    raise exception 'Item % has no inventory account configured', v_item.name;
  end if;
  select code into v_base from acc_currency where is_base;

  if p_qty_delta > 0 then
    if coalesce(p_unit_cost_minor, 0) <= 0 then
      raise exception 'A unit cost is required when adding quantity';
    end if;
    v_cost := round(p_qty_delta * p_unit_cost_minor)::bigint;
  elsif p_qty_delta < 0 then
    v_cost := -acc_cost_of_sale_minor(p_item_id, -p_qty_delta);
  else
    v_cost := coalesce(p_value_delta_minor, 0);
    if v_cost = 0 then raise exception 'An adjustment must change quantity or value'; end if;
  end if;

  if v_cost > 0 then
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_item.inventory_account_id, 'debit_minor', v_cost,
                         'credit_minor', 0, 'amount_base_minor', v_cost, 'memo', 'Inventory adjustment'),
      jsonb_build_object('account_id', p_offset_account_id, 'debit_minor', 0,
                         'credit_minor', v_cost, 'amount_base_minor', v_cost, 'memo', p_reason));
  else
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', p_offset_account_id, 'debit_minor', -v_cost,
                         'credit_minor', 0, 'amount_base_minor', -v_cost, 'memo', p_reason),
      jsonb_build_object('account_id', v_item.inventory_account_id, 'debit_minor', 0,
                         'credit_minor', -v_cost, 'amount_base_minor', -v_cost, 'memo', 'Inventory adjustment'));
  end if;

  v_entry := acc_post_entry(p_date, 'Inventory adjustment: ' || v_item.name,
                            'inventory_adjustment', p_item_id, v_base, v_lines);

  return acc_add_inventory_txn(p_item_id, p_date, 'adjustment', v_entry,
                               p_qty_delta, v_cost, v_entry, null, p_reason);
end;
$$;

-- acc_reopen_period — body from 0029_company_periods_functions.sql, guard added here.
create or replace function acc_reopen_period(p_period_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_p acc_accounting_period;
begin
  if not acc_is_admin() then raise exception 'Only an admin can reopen a period'; end if;
  if not acc_has_permission('period.reopen') then
    raise exception 'You do not have permission to reopen a period';
  end if;
  if acc_approval_required('period_reopen', 0) and not acc_in_approval_dispatch() then
    raise exception 'Reopening a period requires approval; submit it for approval instead';
  end if;
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

-- acc_reopen_reconciliation — body from 0026_bank_reconciliation_functions.sql, guard added here.
create or replace function acc_reopen_reconciliation(p_reconciliation_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_rec acc_statement_reconciliation;
begin
  if not acc_is_admin() then raise exception 'Only an admin can reopen a reconciliation'; end if;
  if not acc_has_permission('reconciliation.reopen') then
    raise exception 'You do not have permission to reopen a reconciliation';
  end if;
  if acc_approval_required('reconciliation_reopen', 0) and not acc_in_approval_dispatch() then
    raise exception 'Reopening a reconciliation requires approval; submit it for approval instead';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reopen reason is required'; end if;
  select * into v_rec from acc_statement_reconciliation where id = p_reconciliation_id for update;
  if not found then raise exception 'Reconciliation not found'; end if;
  if v_rec.status <> 'completed' then raise exception 'Only a completed reconciliation can be reopened'; end if;
  -- Block reopen if a later completed session exists for the account (would break the beginning-balance chain).
  if exists (
    select 1 from acc_statement_reconciliation
     where bank_account_id = v_rec.bank_account_id and status = 'completed'
       and statement_ending_date > v_rec.statement_ending_date
  ) then
    raise exception 'A later completed reconciliation exists; reopen it first';
  end if;

  update acc_statement_reconciliation
     set status = 'in_progress', reopened_by = auth.uid(), reopen_reason = p_reason, completed_by = null, completed_at = null, updated_at = now()
   where id = p_reconciliation_id;
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_statement_reconciliation', p_reconciliation_id, 'void', auth.uid());
end;
$$;
