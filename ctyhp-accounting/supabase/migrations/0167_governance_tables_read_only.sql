-- ============================================================================
-- 0167  Users, permissions, approval policies, periods, settings history and
--       the audit log are read-only to a signed-in session (2.57)
--
-- Phase 2 of the permission plan. Until now an administrator could write
-- eight governance tables straight through the API: reopen a closed period,
-- change a role or switch off an approval policy with no reason, no approval
-- and no audit row, and get round the "last active admin" guard; and any
-- staff member could insert audit-log rows with any content and any actor.
-- The screens never do either: every change goes through a function that
-- checks the permission, asks for the reason and writes the audit row.
--
-- Checked against the live database before this was written (2026-10-26):
--   * the 79 functions that write these tables all run as their owner, and
--     no function that runs as its caller writes any of them;
--   * the audit trigger (acc_audit_row_change) runs as its owner;
--   * the application wrote two of them directly: Add a user (acc_app_user),
--     which now calls acc_add_company_user below, and the nightly backup's
--     audit row, which runs as the service role and is unaffected;
--   * each table keeps its own read policy, so nothing that can be seen
--     today stops being visible.
--
-- New:
--   acc_add_company_user(user, name, role)   Add a user, after the server has
--                                           created the sign-in account
--   acc_add_existing_user(email, role)      gives a person who already has a
--                                           OneBook sign-in a place in this
--                                           company (it could not be done on
--                                           screen before)
-- Both need users.manage; the insert is audited by the table's own trigger.
-- ============================================================================
set search_path = public;

drop policy if exists acc_app_user_admin_write on acc_app_user;
drop policy if exists acc_role_permission_write on acc_role_permission;
drop policy if exists acc_permission_write on acc_permission;
drop policy if exists acc_approval_policy_write on acc_approval_policy;
drop policy if exists acc_period_write on acc_accounting_period;
drop policy if exists acc_period_event_ins on acc_period_event;
drop policy if exists acc_company_setting_ins on acc_company_setting_version;
drop policy if exists acc_audit_insert on acc_audit_log;

revoke insert, update, delete, truncate on
  acc_app_user, acc_role_permission, acc_permission, acc_approval_policy,
  acc_accounting_period, acc_period_event, acc_company_setting_version, acc_audit_log
from authenticated, anon;

grant select on
  acc_app_user, acc_role_permission, acc_permission, acc_approval_policy,
  acc_accounting_period, acc_period_event, acc_company_setting_version, acc_audit_log
to authenticated;

-- ----------------------------------------------------------------------------
-- A new person: the server has just created their sign-in account.
-- ----------------------------------------------------------------------------
create or replace function acc_add_company_user(p_user_id uuid, p_full_name text, p_role acc_app_role)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not acc_has_permission('users.manage') then
    raise exception 'You do not have permission to manage users';
  end if;
  if p_role is null then
    raise exception 'Choose a role';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'That sign-in account does not exist';
  end if;
  if exists (select 1 from acc_app_user a where a.id = p_user_id) then
    raise exception 'This person is already in this company';
  end if;
  insert into acc_app_user (id, full_name, role, status, invited_at)
  values (p_user_id, coalesce(btrim(p_full_name), ''), p_role, 'active', null);
end;
$$;

-- ----------------------------------------------------------------------------
-- A person who already signs in to OneBook, for another company.
-- ----------------------------------------------------------------------------
create or replace function acc_add_existing_user(p_email text, p_role acc_app_role)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_id     uuid;
  v_name   text;
  v_status text;
begin
  if not acc_has_permission('users.manage') then
    raise exception 'You do not have permission to manage users';
  end if;
  if v_email = '' then
    raise exception 'Enter the email address the person signs in with';
  end if;
  if p_role is null then
    raise exception 'Choose a role';
  end if;

  select u.id, coalesce(u.raw_user_meta_data ->> 'full_name', '')
    into v_id, v_name
    from auth.users u
   where lower(u.email) = v_email;
  if v_id is null then
    raise exception 'No OneBook sign-in uses %. Use Add user to create one.', v_email;
  end if;

  select a.status::text into v_status from acc_app_user a where a.id = v_id;
  if v_status is not null then
    raise exception 'This person is already in this company (%). Change their role or status in the list instead.', v_status;
  end if;

  insert into acc_app_user (id, full_name, role, status, invited_at)
  values (v_id, v_name, p_role, 'active', null);
  return v_id;
end;
$$;

revoke all on function acc_add_company_user(uuid, text, acc_app_role) from public, anon;
grant execute on function acc_add_company_user(uuid, text, acc_app_role) to authenticated;
revoke all on function acc_add_existing_user(text, acc_app_role) from public, anon;
grant execute on function acc_add_existing_user(text, acc_app_role) to authenticated;
