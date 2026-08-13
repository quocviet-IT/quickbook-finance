-- ============================================================================
-- 0113 — Say out loud what the health probe runs as.
--
-- 0112 created onebook.health() and left two properties to their defaults:
-- `security invoker` and an unpinned search_path. Neither is exploitable in a
-- function that resolves no object and returns a constant — but this is the
-- only function in the database an unauthenticated caller may execute, and a
-- later edit that made it "check something real" under `security definer`
-- would be a privilege-escalation path with nothing in the way.
--
-- Stating both explicitly costs a line and removes that edit from the set of
-- things anyone can do by accident. It also settles the warning Supabase's own
-- linter raises for a mutable search_path on an anon-reachable function.
--
-- This is a separate migration rather than an edit to 0112 because 0112 has
-- already been applied: the runner records it by filename and would never
-- replay it, so a change made there would reach no database that already has
-- it — including the one production uses.
-- ============================================================================

create or replace function onebook.health() returns text
language sql stable security invoker set search_path = pg_catalog
as $$ select 'ok' $$;

-- `create or replace` keeps existing grants, but restating them costs nothing
-- and means this file describes the whole reachable surface on its own.
revoke all on function onebook.health() from public;
grant execute on function onebook.health() to anon, authenticated, service_role;
