-- ============================================================================
-- 0103  Which of these account names does the chart not have?
--
-- 0102 refuses a ledger naming an account the chart does not have, but it
-- refuses on the first one it meets, after the click. The design said the
-- screen would block beforehand and list every missing name at once — the way
-- the transactions tab already does — and it did not.
--
-- This answers that question in one round trip, through the same resolver the
-- import uses, so the screen and the server can never disagree about what
-- counts as a match.
-- ============================================================================

set search_path = public;

create or replace function acc_unresolved_account_refs(p_refs text[])
returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(
    array_agg(distinct ref order by ref)
      filter (where acc_resolve_account_ref(ref) is null),
    array[]::text[])
    from unnest(coalesce(p_refs, array[]::text[])) as ref
   where btrim(coalesce(ref, '')) <> '';
$$;

revoke all on function acc_unresolved_account_refs(text[]) from public, anon;
grant execute on function acc_unresolved_account_refs(text[]) to authenticated, service_role;
