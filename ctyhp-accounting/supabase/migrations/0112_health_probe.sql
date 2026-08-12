-- ============================================================================
-- 0112 — Something an outside monitor can ask, that only Postgres can answer.
--
-- Nothing in this application reported whether it was working. The first anyone
-- knew of an outage was a member of staff picking up the phone.
--
-- A check that only proves the web server answered would report 200 while the
-- database was unreachable and nobody could do a thing — worse than no check,
-- because it manufactures confidence. So the check has to reach Postgres, and
-- reaching Postgres from an unauthenticated request needs something anon may
-- call.
--
-- This is that something, and it is deliberately the least it can be: no
-- argument to parameterise, no table to read, a constant to return. It proves
-- one fact — Postgres executed a statement — and can prove nothing else.
--
-- It lives in onebook because it answers a question about the system rather
-- than about any one company's books, and because scopeOf() holds anything
-- naming onebook. back from being replayed into every company schema.
-- ============================================================================

-- Migration 0081 granted schema usage to authenticated and service_role only.
-- Without usage, a call fails with "permission denied for schema onebook"
-- before it ever reaches the function, however the function is granted.
grant usage on schema onebook to anon;

create or replace function onebook.health() returns text
language sql stable as $$ select 'ok' $$;

-- Postgres grants execute on a new function to public by default. Revoking
-- first and granting explicitly keeps the list of who may call it readable.
revoke all on function onebook.health() from public;
grant execute on function onebook.health() to anon, authenticated, service_role;
