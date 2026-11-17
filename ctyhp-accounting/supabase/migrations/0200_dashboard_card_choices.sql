-- ============================================================================
-- 0200  The dashboard keeps each card's choice for each person
--
-- The dashboard (3.0.41) lets each card show another period, another number of
-- months, another horizon or another due window. Each person's choices are
-- kept per company, beside the Overview layout, Privacy and the watchlist that
-- 0198 keeps.
--
-- 1. onebook.dashboard_preference gains `cards`: the choices as one small
--    object, '{}' until the person changes one. The table bounds its kind and
--    size.
-- 2. onebook.save_dashboard_cards writes them: it checks that the person is
--    signed in and belongs to the company, checks the object's shape, and
--    changes `cards` alone. save_dashboard_preference is left exactly as it
--    is: the app calls it with its five named arguments, and a second
--    signature beside it would make those calls ambiguous.
-- ============================================================================
set search_path = public;

-- ----------------------------------------------------------------------------
-- 1. The choices.
-- ----------------------------------------------------------------------------
alter table onebook.dashboard_preference
  add column if not exists cards jsonb not null default '{}'::jsonb;

alter table onebook.dashboard_preference
  drop constraint if exists dashboard_preference_cards_shape;
alter table onebook.dashboard_preference
  add constraint dashboard_preference_cards_shape
  check (jsonb_typeof(cards) = 'object' and pg_column_size(cards) <= 2048);

-- ----------------------------------------------------------------------------
-- 2. Saving.
-- ----------------------------------------------------------------------------
-- Saves the signed-in person's card choices in a company they belong to. The
-- choices are an object of at most 16 keys, each at most 40 characters, whose
-- values are short strings (at most 20 characters) or numbers. A person with
-- no row yet gets one with the table's defaults for everything else.
create or replace function onebook.save_dashboard_cards(p_company uuid, p_cards jsonb)
returns void
language plpgsql security definer set search_path = onebook, public as $$
declare
  v_user uuid := auth.uid();
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

  if p_cards is null or jsonb_typeof(p_cards) <> 'object' then
    raise exception 'Card choices must be an object' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_object_keys(p_cards)) > 16 then
    raise exception 'Card choices hold at most 16 cards' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_each(p_cards) as e(key, value)
    where length(e.key) > 40
       or not (
         (jsonb_typeof(e.value) = 'string' and length(e.value #>> '{}') <= 20)
         or jsonb_typeof(e.value) = 'number'
       )
  ) then
    raise exception 'A card choice is a short name or a number' using errcode = '22023';
  end if;

  -- Only `cards` and `updated_at` are named: a new row takes the table's
  -- defaults for the rest, and an existing row keeps them as they are.
  insert into onebook.dashboard_preference (user_id, company_id, cards, updated_at)
  values (v_user, p_company, p_cards, now())
  on conflict (user_id, company_id) do update
     set cards = excluded.cards,
         updated_at = now();
end;
$$;

revoke all on function onebook.save_dashboard_cards(uuid, jsonb) from public, anon;
grant execute on function onebook.save_dashboard_cards(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
