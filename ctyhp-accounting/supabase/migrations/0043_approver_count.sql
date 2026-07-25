-- ============================================================================
-- How many people could actually approve a request.
--
-- Enabling a policy with segregation of duties while only one person holds
-- `approval.decide` deadlocks the guarded action: the requester may not approve
-- their own request and nobody else can. The UI needs this count to warn before
-- that happens. (Observed live: four policies were enabled with a single active
-- user, which would have blocked manual journals, inventory adjustments, period
-- reopens, and write-offs.)
--
-- SECURITY DEFINER because acc_app_user is self-read only under RLS, and the
-- count is the only thing this exposes — no identity, no email, no role list.
-- ============================================================================

create or replace function acc_approver_count() returns int
language sql stable security definer set search_path = public as $$
  select case
           when acc_current_role() is null then 0
           else (
             select count(*)::int
               from acc_app_user u
               join acc_role_permission rp
                 on rp.role = u.role and rp.permission_key = 'approval.decide'
              where u.status in ('invited', 'active') and rp.allowed
           )
         end;
$$;
