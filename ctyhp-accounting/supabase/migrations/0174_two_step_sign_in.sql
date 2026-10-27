-- ============================================================================
-- 0174  Two-step sign-in, once set up, is needed for the books (2.65)
--
-- Release 2.65 lets anyone add a second sign-in step: a six-digit code from an
-- authenticator app (TOTP, built into Supabase Auth). It is not yet required;
-- 2.66 requires it for admins and accountants.
--
-- A second step only protects anyone if the database asks for it. The screens
-- can ask for the code, but a password alone still opens a session through
-- the public API, and that session must be worth nothing once its owner has
-- set up the second step. So:
--
-- 1. acc_current_role(), the one membership check every row policy and
--    function uses, counts someone only when they have no verified second
--    factor, or their session has passed it (aal2 in the session's token).
--    Someone who has not set one up is unaffected.
-- 2. Row policies call that check once per statement instead of once per row,
--    by wrapping it in a scalar subquery: (select acc_current_role()). The
--    meaning is unchanged, since the answer cannot differ between rows; a list
--    of twenty thousand journal lines was paying for twenty thousand calls,
--    and the factor check would have added a third to that.
-- 3. The same rule for platform administrators (global, run once).
-- 4. acc_mfa_reset_check and acc_record_mfa_reset, for Settings › Users ›
--    Reset two-step sign-in: someone holding Manage users removes another
--    member's second step (the factors themselves are removed through the Auth
--    admin API, which is the supported way), with a reason, in the audit log.
-- ============================================================================
set search_path = public;

-- ----------------------------------------------------------------------------
-- 1. Membership needs the second step once it exists.
-- ----------------------------------------------------------------------------
create or replace function acc_current_role() returns acc_app_role
language sql stable security definer set search_path = public as $$
  select u.role from acc_app_user u
   where u.id = auth.uid() and u.status in ('invited', 'active')
     and (coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
          or not exists (select 1 from auth.mfa_factors f
                          where f.user_id = u.id and f.status = 'verified'));
$$;

-- ----------------------------------------------------------------------------
-- 2. Row policies ask once per statement.
-- ----------------------------------------------------------------------------
do $$
declare
  v_policy record;
  v_using  text;
  v_check  text;
  -- A call not already inside a scalar subquery. Postgres prints a wrapped
  -- call back as "( SELECT acc_current_role() AS acc_current_role)".
  v_call constant text :=
    '(?<!SELECT )(acc_current_role\(\)|acc_is_staff\(\)|acc_is_admin\(\)|acc_has_permission\(''[a-z0-9_.]+''::text\))';
begin
  for v_policy in
    select tablename, policyname, qual, with_check
      from pg_policies
     where schemaname = 'public'
  loop
    v_using := regexp_replace(v_policy.qual, v_call, '(select \1)', 'g');
    v_check := regexp_replace(v_policy.with_check, v_call, '(select \1)', 'g');
    if v_using is distinct from v_policy.qual then
      execute format('alter policy %I on %I using (%s)', v_policy.policyname, v_policy.tablename, v_using);
    end if;
    if v_check is distinct from v_policy.with_check then
      execute format('alter policy %I on %I with check (%s)', v_policy.policyname, v_policy.tablename, v_check);
    end if;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Platform administrators, the same rule (global).
-- ----------------------------------------------------------------------------
create or replace function onebook.is_platform_admin() returns boolean
language sql stable security definer set search_path = onebook, public as $$
  select exists (select 1 from onebook.platform_admin where user_id = auth.uid())
     and (coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
          or not exists (select 1 from auth.mfa_factors f
                          where f.user_id = auth.uid() and f.status = 'verified'));
$$;

-- ----------------------------------------------------------------------------
-- 4. Resetting someone else's second step.
-- ----------------------------------------------------------------------------
create or replace function acc_mfa_reset_check(p_user_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not acc_has_permission('users.manage') then
    raise exception 'You do not have permission to manage users';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot reset your own two-step sign-in; ask another admin';
  end if;
  if not exists (select 1 from acc_app_user where id = p_user_id) then
    raise exception 'That person is not a user of this company';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'A reason is required';
  end if;
end;
$$;

create or replace function acc_record_mfa_reset(p_user_id uuid, p_reason text, p_removed int)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform acc_mfa_reset_check(p_user_id, p_reason);
  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values ('acc_app_user', p_user_id, 'mfa_reset', auth.uid(),
          jsonb_build_object('reason', btrim(p_reason), 'factors_removed', coalesce(p_removed, 0)));
end;
$$;

revoke all on function acc_mfa_reset_check(uuid, text) from public, anon;
revoke all on function acc_record_mfa_reset(uuid, text, int) from public, anon;
grant execute on function acc_mfa_reset_check(uuid, text) to authenticated;
grant execute on function acc_record_mfa_reset(uuid, text, int) to authenticated;
