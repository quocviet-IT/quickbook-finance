-- ============================================================================
-- 0185  Add existing account finds colleagues, not any account (2.96)
--
-- acc_add_existing_user (0167) took any email address. It answered "No OneBook
-- sign-in uses ..." for one nobody uses and added the person for one somebody
-- does, so an administrator of one company could learn, address by address,
-- who signs in to OneBook for any company at all, and could add such a person
-- to their own company without either side having met.
--
-- The lookup now lives in onebook.find_colleague, below, and finds only a
-- person who already works in a company the caller works in, or who is
-- already on this company's list. Anyone else gets the same empty answer
-- whether or not they have a sign-in, so the answer says nothing about them.
-- The screen then adds the person with acc_add_company_user (0167), which
-- checks users.manage again and refuses one who is already here.
--
-- The email form of acc_add_existing_user is dropped, so it cannot be called
-- through the API either.
-- ============================================================================
set search_path = public;

drop function if exists acc_add_existing_user(text, acc_app_role);

/**
 * The account behind `p_email`, if the caller may add it to company
 * `p_company_id`: the caller holds users.manage there, and the person either
 * is already on that company's list or holds access in another company where
 * the caller holds access too. No row otherwise, the same for an address
 * nobody uses as for one used only elsewhere.
 */
create or replace function onebook.find_colleague(p_company_id uuid, p_email text)
returns table (colleague_id uuid, colleague_name text)
language plpgsql stable security definer set search_path = onebook, public as $$
declare
  v_schema  text;
  v_allowed boolean;
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_target  uuid;
  v_name    text;
  v_other   text;
  v_shared  boolean;
begin
  select c.schema_name into v_schema from onebook.company c where c.id = p_company_id and c.status = 'active';
  if v_schema is not null then
    execute format('select %I.acc_has_permission(%L)', v_schema, 'users.manage') into v_allowed;
  end if;
  if not coalesce(v_allowed, false) then
    raise exception 'You do not have permission to manage users' using errcode = '42501';
  end if;
  if v_email = '' then
    raise exception 'Enter the email address the person signs in with';
  end if;

  select u.id, coalesce(u.raw_user_meta_data ->> 'full_name', '')
    into v_target, v_name
    from auth.users u
   where lower(u.email) = v_email;
  if v_target is null then return; end if;

  -- Already on this company's list, in any status: the caller sees that list.
  execute format('select exists (select 1 from %I.acc_app_user a where a.id = $1)', v_schema)
    into v_shared using v_target;
  if not v_shared then
    for v_other in
      select c.schema_name from onebook.company c where c.status = 'active' and c.id <> p_company_id
    loop
      begin
        execute format(
          'select exists (select 1 from %1$I.acc_app_user t where t.id = $1 and t.status in (''invited'', ''active''))
              and exists (select 1 from %1$I.acc_app_user me where me.id = $2 and me.status in (''invited'', ''active''))',
          v_other)
          into v_shared using v_target, auth.uid();
      exception when undefined_table then
        v_shared := false;  -- on the register, not yet provisioned
      end;
      exit when v_shared;
    end loop;
  end if;

  if v_shared then
    colleague_id := v_target;
    colleague_name := v_name;
    return next;
  end if;
end $$;

revoke all on function onebook.find_colleague(uuid, text) from public, anon;
grant execute on function onebook.find_colleague(uuid, text) to authenticated;

notify pgrst, 'reload schema';
