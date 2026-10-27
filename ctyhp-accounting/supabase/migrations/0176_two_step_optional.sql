-- ============================================================================
-- 0176  Two-step sign-in is optional again (2.68)
--
-- The owner decided on 27 October 2026, the day 2.66 shipped, that two-step
-- sign-in should not be required for now. Each company's deadline is removed:
-- 0175's rule requires nothing without a policy row, so admins and accountants
-- sign in with a password alone again, as sales and viewers do. The rule
-- itself stays: putting a row back makes it required again.
--
-- What 2.65 gave stays as it was: anyone may still set up a second step, and
-- once someone has, the database still refuses their password-only sessions.
--
-- acc_record_two_step_off writes the audit entry when someone turns their own
-- second step off from their account page (the factor itself is removed by the
-- Auth API, which asks for a session that has passed it).
-- ============================================================================
set search_path = public;

delete from acc_two_step_policy;

create or replace function acc_record_two_step_off(p_removed int)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if acc_current_role() is null then
    raise exception 'Not authorized: you are not a member of this company' using errcode = '42501';
  end if;
  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values ('acc_app_user', auth.uid(), 'mfa_off', auth.uid(),
          jsonb_build_object('factors_removed', coalesce(p_removed, 0)));
end;
$$;

revoke all on function acc_record_two_step_off(int) from public, anon;
grant execute on function acc_record_two_step_off(int) to authenticated;

-- Platform administrators, the same (global).
delete from onebook.two_step_policy;
