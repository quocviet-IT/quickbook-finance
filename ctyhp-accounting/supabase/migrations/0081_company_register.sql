-- ============================================================================
-- 0081 — The company register: One Book holds more than one set of books.
--
-- The reviewer settled the shape of this: accountants must switch companies
-- "without leaving their current workflow", which rules out one installation
-- per company. One login, one application, many entities.
--
-- How the entities are kept apart is the decision that matters. Adding a
-- company_id column to 72 tables would put isolation in the hands of 121
-- row-level security policies, every one of which has to be right; miss one and
-- a company's invoices appear in another's ledger, which is the exact thing
-- this is meant to prevent.
--
-- Instead each company gets its own **schema**. The tables, functions and
-- policies are created once per schema and otherwise unchanged. A query running
-- in one company cannot see another's rows because they are not there — not
-- because a predicate forbade it. Document numbering, the chart of accounts,
-- period close and the control accounts all come out per-company for free.
--
-- This migration builds only the register — the list of entities and who may
-- see them. Provisioning a company's schema is scripts/provision-company.mjs.
-- ============================================================================

create schema if not exists onebook;
comment on schema onebook is
  'Control plane: which companies exist and who may see them. Holds no accounting data of its own.';

grant usage on schema onebook to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- The entities.
--
-- `schema_name` is the join to the data. The first company is the books that
-- already exist, which live in `public` — the register records that rather than
-- moving them, because renaming a live schema to make the layout tidy would
-- risk real books for no gain.
-- ----------------------------------------------------------------------------
create table if not exists onebook.company (
  id                      uuid primary key default gen_random_uuid(),
  slug                    text not null unique
    check (slug ~ '^[a-z][a-z0-9_]{1,40}$'),
  schema_name             text not null unique
    check (schema_name ~ '^[a-z][a-z0-9_]{1,60}$'),
  legal_name              text not null check (length(btrim(legal_name)) > 0),
  dba_name                text,
  ein_ref                 text,
  fiscal_year_start_month int not null default 1 check (fiscal_year_start_month between 1 and 12),
  base_currency_code      text not null default 'USD',
  -- Sample companies are for trying things out and for loading test data from
  -- QuickBooks or Wave. Marking them means nobody later mistakes one for real
  -- books, and the switcher can say so on the face of it.
  is_sample               boolean not null default false,
  status                  text not null default 'active' check (status in ('active', 'archived')),
  display_order           int not null default 100,
  created_at              timestamptz not null default now(),
  created_by              uuid references auth.users (id)
);

-- ----------------------------------------------------------------------------
-- Who may see which company.
--
-- Two different questions, kept apart on purpose:
--   * membership, here, answers "may this person open this company at all";
--   * `acc_app_user` inside each company schema answers "and what may they do
--     once they are in it".
-- A person can therefore be an administrator of one company and read-only in
-- another, and someone with no membership row cannot even see the company
-- exists.
-- ----------------------------------------------------------------------------
create table if not exists onebook.company_member (
  company_id uuid not null references onebook.company (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  added_at   timestamptz not null default now(),
  added_by   uuid references auth.users (id),
  primary key (company_id, user_id)
);
create index if not exists onebook_company_member_user_idx on onebook.company_member (user_id);

-- ----------------------------------------------------------------------------
-- Reading the register.
--
-- A session sees the companies it belongs to and nothing else. The check is
-- here rather than in the application because the application is not the only
-- thing that can ask.
-- ----------------------------------------------------------------------------
alter table onebook.company        enable row level security;
alter table onebook.company_member enable row level security;

drop policy if exists onebook_company_sel on onebook.company;
create policy onebook_company_sel on onebook.company
  for select using (
    exists (
      select 1 from onebook.company_member m
       where m.company_id = onebook.company.id
         and m.user_id = auth.uid()
    )
  );

drop policy if exists onebook_company_member_sel on onebook.company_member;
create policy onebook_company_member_sel on onebook.company_member
  for select using (user_id = auth.uid());

-- Writing the register is provisioning, which runs with the service role.
-- No insert, update or delete policy exists for an application session, so
-- none is permitted.
revoke all on onebook.company, onebook.company_member from public, anon;
grant select on onebook.company, onebook.company_member to authenticated;
grant all    on onebook.company, onebook.company_member to service_role;

alter default privileges in schema onebook revoke all on tables from public, anon;
alter default privileges in schema onebook revoke all on functions from public, anon;

/**
 * The companies this session may open, in display order.
 *
 * Returned as a function as well as a table so the application has one place to
 * ask, and so the answer can gain fields later without every caller changing.
 */
create or replace function onebook.my_companies()
returns table (
  id          uuid,
  slug        text,
  schema_name text,
  legal_name  text,
  dba_name    text,
  is_sample   boolean,
  status      text
)
language sql stable security invoker set search_path = onebook, public as $$
  select c.id, c.slug, c.schema_name, c.legal_name, c.dba_name, c.is_sample, c.status
    from onebook.company c
   where c.status = 'active'
   order by c.is_sample, c.display_order, c.legal_name;
$$;

revoke all on function onebook.my_companies() from public, anon;
grant execute on function onebook.my_companies() to authenticated, service_role;

/**
 * Resolve a company slug to the schema holding its books.
 *
 * Returns null when the caller is not a member, which is what makes this safe
 * to call with a slug that arrived in a cookie: an unknown or forbidden slug
 * resolves to nothing rather than to somebody else's data.
 */
create or replace function onebook.schema_for(p_slug text)
returns text
language sql stable security invoker set search_path = onebook, public as $$
  select c.schema_name
    from onebook.company c
   where c.slug = p_slug
     and c.status = 'active'
   limit 1;
$$;

revoke all on function onebook.schema_for(text) from public, anon;
grant execute on function onebook.schema_for(text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Register the books that already exist.
--
-- They stay exactly where they are. The register learns about them; nothing
-- moves, and the first company behaves today precisely as it did yesterday.
-- ----------------------------------------------------------------------------
insert into onebook.company
  (slug, schema_name, legal_name, dba_name, ein_ref, fiscal_year_start_month,
   base_currency_code, is_sample, display_order)
select 'ctyhp', 'public',
       coalesce(v.legal_name, 'CTYHP'), v.dba_name, v.ein_ref,
       coalesce(v.fiscal_year_start_month, 1),
       coalesce(v.base_currency_code, 'USD'),
       false, 1
  from acc_company_setting_version v
 order by v.version desc
 limit 1
on conflict (slug) do nothing;

-- Fallback if company settings were never filled in: the books still exist and
-- still need a register entry.
insert into onebook.company (slug, schema_name, legal_name, is_sample, display_order)
select 'ctyhp', 'public', 'CTYHP', false, 1
 where not exists (select 1 from onebook.company where slug = 'ctyhp');

-- Everyone who can already use the application keeps access to those books.
insert into onebook.company_member (company_id, user_id)
select c.id, u.id
  from onebook.company c
  cross join acc_app_user u
 where c.slug = 'ctyhp'
on conflict do nothing;
