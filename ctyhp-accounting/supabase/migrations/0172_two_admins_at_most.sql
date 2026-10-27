-- ============================================================================
-- 0172  At most two admins in a company, and at most two platform admins (2.63)
--
-- The access audit of 27 October 2026 found six admin accounts on one company:
-- the role for which every permission is on, held by people whose work needs
-- far less. The owner set the rule: a company has at most two admins holding
-- access, and at most two people may create or restore companies.
--
-- 1. In each company, a statement-level trigger on acc_app_user refuses any
--    change that leaves more than two admins invited or active, whichever way
--    it arrives: adding a user, adding an existing account, changing a role,
--    reactivating a suspended admin, or company creation. A suspended or
--    offboarded admin holds no access and does not count. The last-admin rule
--    still keeps at least one.
-- 2. The same for onebook.platform_admin, which only a database owner writes.
--
-- Every company already had at most two active admins when this was written.
-- The platform list is brought down to its keepers by hand, before this runs,
-- so that no one's address is written into the repository; each check below
-- stops the migration rather than leave a list over the limit unnoticed.
-- ============================================================================
set search_path = public;

create or replace function acc_enforce_admin_cap()
returns trigger
language plpgsql set search_path = public as $$
begin
  if (select count(*) from acc_app_user where role = 'admin' and status in ('invited', 'active')) > 2 then
    raise exception 'A company can have at most two admins. Make one of them an accountant first.'
      using errcode = '23514';
  end if;
  return null;
end;
$$;

drop trigger if exists acc_app_user_admin_cap on acc_app_user;
create trigger acc_app_user_admin_cap
  after insert or update of role, status on acc_app_user
  for each statement execute function acc_enforce_admin_cap();

do $$
begin
  if (select count(*) from acc_app_user where role = 'admin' and status in ('invited', 'active')) > 2 then
    raise exception 'This company has more than two active admins; make the others accountants before applying 0172';
  end if;
end;
$$;

-- Platform administrators: one list for the whole database.
create or replace function onebook.enforce_platform_admin_cap()
returns trigger
language plpgsql set search_path = onebook, public as $$
begin
  if (select count(*) from onebook.platform_admin) > 2 then
    raise exception 'At most two people can be platform administrators.' using errcode = '23514';
  end if;
  return null;
end;
$$;

drop trigger if exists platform_admin_cap on onebook.platform_admin;
create trigger platform_admin_cap
  after insert or update on onebook.platform_admin
  for each statement execute function onebook.enforce_platform_admin_cap();

do $$
begin
  if (select count(*) from onebook.platform_admin) > 2 then
    raise exception 'There are more than two platform administrators; remove the others before applying 0172';
  end if;
end;
$$;
