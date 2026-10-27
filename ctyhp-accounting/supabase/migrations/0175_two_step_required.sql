-- ============================================================================
-- 0175  Two-step sign-in is required for admins and accountants (2.66)
--
-- 2.65 let anyone add a second sign-in step and made the database ask for it
-- once it existed. The owner decided it becomes required for admins and
-- accountants, with seven days to set it up from the release.
--
-- 1. acc_two_step_policy, one row per company: which roles need it, and from
--    when. Set here to seven days after this runs, so a company created later
--    from the same migrations also gets seven days from its creation. Read by
--    anyone signed in (the screens count the days down); changed only by a
--    migration.
-- 2. acc_current_role() then counts an admin or accountant only in a session
--    that has passed the second step, from that moment, whether or not they
--    have set one up. Before it, and for sales and viewers, as in 2.65. Without
--    a policy row nothing is required: a missing row must not lock anyone out.
-- 3. Platform administrators, the same, from seven days after this runs.
--
-- Nobody is locked out by this: a password still signs in, and the screens send
-- an admin or accountant who owes the second step to set it up first.
-- ============================================================================
set search_path = public;

-- ----------------------------------------------------------------------------
-- 1. When it becomes required.
-- ----------------------------------------------------------------------------
create table if not exists acc_two_step_policy (
  id            boolean primary key default true check (id),
  roles         acc_app_role[] not null default '{admin,accountant}',
  required_from timestamptz not null,
  created_at    timestamptz not null default now()
);

insert into acc_two_step_policy (required_from)
values (now() + interval '7 days')
on conflict (id) do nothing;

alter table acc_two_step_policy enable row level security;
drop policy if exists acc_two_step_policy_read on acc_two_step_policy;
create policy acc_two_step_policy_read on acc_two_step_policy
  for select using (auth.uid() is not null);
revoke all on acc_two_step_policy from anon, authenticated;
grant select on acc_two_step_policy to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Membership needs the second step: always once it exists, and for the
--    required roles from required_from.
-- ----------------------------------------------------------------------------
create or replace function acc_current_role() returns acc_app_role
language sql stable security definer set search_path = public as $$
  select u.role from acc_app_user u
   where u.id = auth.uid() and u.status in ('invited', 'active')
     and (coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
          or (not exists (select 1 from auth.mfa_factors f
                           where f.user_id = u.id and f.status = 'verified')
              and not (u.role = any (coalesce((select p.roles from acc_two_step_policy p), '{}'))
                       and now() >= coalesce((select p.required_from from acc_two_step_policy p), 'infinity'))));
$$;

-- ----------------------------------------------------------------------------
-- 3. Platform administrators (global).
-- ----------------------------------------------------------------------------
create table if not exists onebook.two_step_policy (
  id            boolean primary key default true check (id),
  required_from timestamptz not null
);
insert into onebook.two_step_policy (required_from)
values (now() + interval '7 days')
on conflict (id) do nothing;
alter table onebook.two_step_policy enable row level security;
revoke all on onebook.two_step_policy from anon, authenticated;

create or replace function onebook.is_platform_admin() returns boolean
language sql stable security definer set search_path = onebook, public as $$
  select exists (select 1 from onebook.platform_admin where user_id = auth.uid())
     and (coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
          or (not exists (select 1 from auth.mfa_factors f
                           where f.user_id = auth.uid() and f.status = 'verified')
              and now() < coalesce((select p.required_from from onebook.two_step_policy p), 'infinity')));
$$;
