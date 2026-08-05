-- ============================================================================
-- 0097  Asking for a company, and who may ask
--
-- Creating a company is not an accounting entry: it is a new Postgres schema
-- holding 75 tables, 196 functions and 135 row-level security policies, built
-- from 1053 statements. That is the system owner's act, not an accountant's,
-- and it takes long enough that the browser must not be holding it open.
--
-- So the register gains two things: a list of people who may ask, and a queue
-- of asks with their outcome. The work itself happens outside the database,
-- because rewriting `set search_path = public` per company lives in tested
-- TypeScript and a second copy in PL/pgSQL would be a silent cross-company
-- leak waiting to happen.
--
-- Everything here names `onebook.` or `public.` explicitly, so scopeOf() holds
-- the whole file back from company schemas and the register exists once. There
-- is deliberately no file-level `set search_path`: the runner sets one, and
-- 0081 — the migration this one extends — does not carry one either.
-- ============================================================================

-- --- Who may create a company ------------------------------------------------
create table if not exists onebook.platform_admin (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now(),
  added_by uuid references auth.users (id)
);

-- Seeded from the administrators of the first company's books. If that finds
-- nobody the table stays empty and nobody sees the button — which is correct,
-- not broken. To grant the first one by hand, with the service role:
--   insert into onebook.platform_admin (user_id)
--   select id from auth.users where lower(email) = lower('someone@example.com')
--   on conflict do nothing;
insert into onebook.platform_admin (user_id)
select u.id
  from public.acc_app_user u
 where u.role = 'admin' and u.status = 'active'
on conflict do nothing;

create or replace function onebook.is_platform_admin() returns boolean
language sql stable security definer set search_path = onebook, public as $$
  select exists (select 1 from onebook.platform_admin where user_id = auth.uid());
$$;

revoke all on function onebook.is_platform_admin() from public, anon;
grant execute on function onebook.is_platform_admin() to authenticated, service_role;

-- --- The queue ---------------------------------------------------------------
create table if not exists onebook.company_request (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null check (slug ~ '^[a-z][a-z0-9_]{1,40}$'),
  legal_name    text not null check (length(btrim(legal_name)) > 0),
  is_sample     boolean not null default false,
  display_order int not null default 100,
  requested_by  uuid references auth.users (id),
  status        text not null default 'pending'
                check (status in ('pending', 'running', 'ready', 'failed')),
  attempts      int not null default 0,
  error         text,
  company_id    uuid references onebook.company (id) on delete set null,
  created_at    timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz
);
create index if not exists onebook_company_request_status_idx
  on onebook.company_request (status, created_at);

alter table onebook.company_request enable row level security;
alter table onebook.platform_admin  enable row level security;

-- A platform administrator sees the queue; nobody else sees that it exists.
drop policy if exists onebook_company_request_sel on onebook.company_request;
create policy onebook_company_request_sel on onebook.company_request
  for select using (onebook.is_platform_admin());

drop policy if exists onebook_platform_admin_sel on onebook.platform_admin;
create policy onebook_platform_admin_sel on onebook.platform_admin
  for select using (onebook.is_platform_admin());

revoke all on onebook.company_request, onebook.platform_admin from public, anon;
grant select on onebook.company_request, onebook.platform_admin to authenticated;
grant all    on onebook.company_request, onebook.platform_admin to service_role;

-- --- Asking ------------------------------------------------------------------
create or replace function onebook.request_company(
  p_slug text,
  p_legal_name text,
  p_is_sample boolean default false,
  p_display_order int default 100
) returns uuid
language plpgsql security definer set search_path = onebook, public as $$
declare
  v_slug text := lower(btrim(coalesce(p_slug, '')));
  v_name text := btrim(coalesce(p_legal_name, ''));
  v_id   uuid;
begin
  if not onebook.is_platform_admin() then
    raise exception 'Not authorized to create a company';
  end if;
  if v_slug !~ '^[a-z][a-z0-9_]{1,40}$' then
    raise exception 'A company key is lower case letters, digits and underscores';
  end if;
  if length(v_name) = 0 then raise exception 'A legal name is required'; end if;
  if exists (select 1 from onebook.company where slug = v_slug) then
    raise exception 'A company already uses the key %', v_slug;
  end if;
  -- A second click while the first is still building must not queue a twin.
  if exists (
    select 1 from onebook.company_request
     where slug = v_slug and status in ('pending', 'running')
  ) then
    raise exception 'A company with the key % is already being created', v_slug;
  end if;

  insert into onebook.company_request (slug, legal_name, is_sample, display_order, requested_by)
  values (v_slug, v_name, coalesce(p_is_sample, false), coalesce(p_display_order, 100), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function onebook.request_company(text, text, boolean, int) from public, anon;
grant execute on function onebook.request_company(text, text, boolean, int)
  to authenticated, service_role;

-- --- Working the queue -------------------------------------------------------
-- `skip locked` is the whole point: the Server Action and the cron route can
-- both be running, and neither may take a request the other already holds.
create or replace function onebook.claim_company_request()
returns onebook.company_request
language plpgsql security definer set search_path = onebook, public as $$
declare
  v_row onebook.company_request;
begin
  select * into v_row
    from onebook.company_request
   where status = 'pending'
   order by created_at
   for update skip locked
   limit 1;
  if not found then return null; end if;

  update onebook.company_request
     set status = 'running', started_at = now(), attempts = attempts + 1, error = null
   where id = v_row.id
   returning * into v_row;
  return v_row;
end;
$$;

create or replace function onebook.complete_company_request(p_id uuid, p_company_id uuid)
returns void
language sql security definer set search_path = onebook, public as $$
  update onebook.company_request
     set status = 'ready', company_id = p_company_id, finished_at = now(), error = null
   where id = p_id;
$$;

create or replace function onebook.fail_company_request(p_id uuid, p_error text)
returns void
language sql security definer set search_path = onebook, public as $$
  update onebook.company_request
     set status = 'failed', finished_at = now(), error = left(coalesce(p_error, 'Unknown error'), 2000)
   where id = p_id;
$$;

create or replace function onebook.retry_company_request(p_id uuid) returns void
language plpgsql security definer set search_path = onebook, public as $$
begin
  if not onebook.is_platform_admin() then
    raise exception 'Not authorized to create a company';
  end if;
  update onebook.company_request
     set status = 'pending', error = null, started_at = null, finished_at = null
   where id = p_id and status = 'failed';
  if not found then raise exception 'Only a failed request can be retried'; end if;
end;
$$;

revoke all on function onebook.claim_company_request() from public, anon, authenticated;
revoke all on function onebook.complete_company_request(uuid, uuid) from public, anon, authenticated;
revoke all on function onebook.fail_company_request(uuid, text) from public, anon, authenticated;
grant execute on function onebook.claim_company_request() to service_role;
grant execute on function onebook.complete_company_request(uuid, uuid) to service_role;
grant execute on function onebook.fail_company_request(uuid, text) to service_role;

revoke all on function onebook.retry_company_request(uuid) from public, anon;
grant execute on function onebook.retry_company_request(uuid) to authenticated, service_role;
