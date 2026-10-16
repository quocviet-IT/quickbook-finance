-- ============================================================================
-- 0147  A retire that only touches the caller's own work items (2.09)
--
-- acc_retire_work_items(p_live_keys) (0118) marks as resolved every stored
-- state whose key is not in the caller's live list. Each overview page calls it
-- with only its own keys, so opening Sales resolved Banking's dismissals, and
-- the reverse. A dismissal, an assignment or a due date on one page was lost
-- whenever another page opened.
--
-- This adds an overload that also takes the key prefixes the calling page owns
-- (`bank-txn:`, `ar-draft:`, ...). A state is resolved only when its key starts
-- with one of those prefixes and is not among the live keys. Empty or null
-- prefixes resolve nothing.
--
-- The one-argument version is left exactly as it is, so the running app keeps
-- working between this migration and the deploy of the app that calls the new
-- one. Dropping it is later work, once 2.09 is live.
--
-- The prefix is matched literally (starts_with), never as a LIKE pattern, so an
-- underscore or percent sign in a prefix means itself.
-- ============================================================================

set search_path = public;

create or replace function acc_retire_work_items(p_live_keys text[], p_prefixes text[])
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  if acc_current_role() is null then
    raise exception 'Not authorized';
  end if;

  update acc_work_item_state s
     set lifecycle = 'resolved', resolved_at = now()
   where s.lifecycle <> 'resolved'
     and not (s.work_key = any (coalesce(p_live_keys, array[]::text[])))
     and exists (
       select 1
         from unnest(coalesce(p_prefixes, array[]::text[])) p
        where length(p) > 0 and starts_with(s.work_key, p)
     );
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function acc_retire_work_items(text[], text[]) from public, anon;
grant execute on function acc_retire_work_items(text[], text[]) to authenticated, service_role;
