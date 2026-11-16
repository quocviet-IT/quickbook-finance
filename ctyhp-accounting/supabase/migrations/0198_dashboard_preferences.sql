-- ============================================================================
-- 0198  The dashboard keeps each person's own choices
--
-- The dashboard (3.0.39) lets each person choose the cards on its Overview
-- tab, hide every amount with Privacy, and keep a watchlist of accounts. Those
-- choices belong to the person, in one company: two people in the same books
-- keep their own, and one person keeps a different set in each company.
--
-- 1. onebook.dashboard_preference (global): one row per person per company,
--    with the Overview layout (null for the Standard layout), the watchlist's
--    account ids in the person's order, and whether Privacy is on.
-- 2. Row-level security: a person reads only their own row. Nothing can
--    insert, change or delete a row directly; the browser never supplies the
--    person or the company.
-- 3. onebook.save_dashboard_preference writes the row: it checks that the
--    person is signed in and belongs to the company, checks the layout's shape
--    and the watchlist's length, and changes only what it is given.
-- ============================================================================
set search_path = public;

-- ----------------------------------------------------------------------------
-- 1. Preferences.
-- ----------------------------------------------------------------------------
create table if not exists onebook.dashboard_preference (
  user_id    uuid not null references auth.users (id) on delete cascade,
  company_id uuid not null references onebook.company (id) on delete cascade,
  overview   jsonb,                         -- null: the Standard layout
  watchlist  uuid[] not null default '{}',  -- account ids in the company's chart, in the person's order
  privacy    boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, company_id),
  constraint dashboard_preference_overview_shape
    check (overview is null or (jsonb_typeof(overview) = 'object' and pg_column_size(overview) <= 4096)),
  constraint dashboard_preference_watchlist_size check (cardinality(watchlist) <= 10)
);

-- ----------------------------------------------------------------------------
-- 2. Row-level security.
-- ----------------------------------------------------------------------------
alter table onebook.dashboard_preference enable row level security;

revoke all on onebook.dashboard_preference from public, anon, authenticated;
grant select on onebook.dashboard_preference to authenticated;
grant all on onebook.dashboard_preference to service_role;

drop policy if exists dashboard_preference_select on onebook.dashboard_preference;
create policy dashboard_preference_select on onebook.dashboard_preference
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- 3. Saving.
-- ----------------------------------------------------------------------------
-- Saves the signed-in person's choices in a company they belong to. A null
-- argument keeps what is stored, except that p_reset_overview = true puts the
-- Overview back to the Standard layout (null). The layout is stored with its
-- three lists only: order, shown and wide, each at most 20 card keys of at
-- most 40 characters. The watchlist holds at most 10 accounts.
create or replace function onebook.save_dashboard_preference(
  p_company uuid,
  p_overview jsonb,
  p_reset_overview boolean,
  p_watchlist uuid[],
  p_privacy boolean
)
returns void
language plpgsql security definer set search_path = onebook, public as $$
declare
  v_user uuid := auth.uid();
  v_reset boolean := coalesce(p_reset_overview, false);
  v_overview jsonb;
  v_key text;
  v_list jsonb;
begin
  if v_user is null then
    raise exception 'Sign in to save your dashboard' using errcode = '42501';
  end if;
  if not exists (
    select 1 from onebook.company_member
    where company_id = p_company and user_id = v_user
  ) then
    raise exception 'Not a member of this company' using errcode = '42501';
  end if;

  if p_overview is not null and not v_reset then
    if jsonb_typeof(p_overview) <> 'object' then
      raise exception 'A dashboard layout must be an object' using errcode = '22023';
    end if;
    foreach v_key in array array['order', 'shown', 'wide'] loop
      v_list := p_overview -> v_key;
      if v_list is null or jsonb_typeof(v_list) <> 'array' then
        raise exception 'A dashboard layout needs a list called %', v_key using errcode = '22023';
      end if;
      if jsonb_array_length(v_list) > 20 then
        raise exception 'A dashboard layout list holds at most 20 cards' using errcode = '22023';
      end if;
      if exists (
        select 1 from jsonb_array_elements(v_list) as e(item)
        where jsonb_typeof(e.item) <> 'string' or length(e.item #>> '{}') > 40
      ) then
        raise exception 'A dashboard layout lists cards by short names' using errcode = '22023';
      end if;
    end loop;
    v_overview := jsonb_build_object(
      'order', p_overview -> 'order',
      'shown', p_overview -> 'shown',
      'wide', p_overview -> 'wide'
    );
  end if;

  if p_watchlist is not null then
    if cardinality(p_watchlist) > 10 then
      raise exception 'A watchlist holds at most 10 accounts' using errcode = '22023';
    end if;
    if array_position(p_watchlist, null) is not null then
      raise exception 'A watchlist lists accounts by id' using errcode = '22023';
    end if;
  end if;

  insert into onebook.dashboard_preference as d (user_id, company_id, overview, watchlist, privacy, updated_at)
  values (
    v_user,
    p_company,
    case when v_reset then null else v_overview end,
    coalesce(p_watchlist, '{}'),
    coalesce(p_privacy, false),
    now()
  )
  on conflict (user_id, company_id) do update
     set overview = case
           when v_reset then null
           when v_overview is not null then v_overview
           else d.overview
         end,
         watchlist = coalesce(p_watchlist, d.watchlist),
         privacy = coalesce(p_privacy, d.privacy),
         updated_at = now();
end;
$$;

revoke all on function onebook.save_dashboard_preference(uuid, jsonb, boolean, uuid[], boolean) from public, anon;
grant execute on function onebook.save_dashboard_preference(uuid, jsonb, boolean, uuid[], boolean) to authenticated;

notify pgrst, 'reload schema';
