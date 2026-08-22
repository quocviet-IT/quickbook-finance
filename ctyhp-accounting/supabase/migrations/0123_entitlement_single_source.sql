-- ============================================================================
-- 0123  One source of truth for "which company may this person open"
--
-- Two stores answered that question and nothing kept them in step:
--
--   * `onebook.company_member` — a row per (company, user)
--   * `<schema>.acc_app_user`  — the role, inside each company's own books
--
-- Measured on the live database before this change: three accounts held an
-- active role in `public` with no membership row, and one held a membership row
-- with no active role. Four rows of disagreement across nine users.
--
-- ## Why that was dangerous rather than merely untidy
--
-- `activeSchema()` fell back to `public` whenever the register returned nothing.
-- So an account with a role in `public` and no membership resolved to Aurora's
-- books anyway. Reproduced exactly, as that user, before this migration:
--
--     my_companies()                  -> (nothing)
--     acc_current_role() in public     -> accountant
--     rows of public.acc_invoice read  -> 14
--
-- The company switcher showed no company while the queries read a real
-- customer's ledger with an accountant's rights. The application half of that
-- fix is in `lib/db/company.ts`; this is the database half.
--
-- ## The decision
--
-- **`acc_app_user` becomes the only source of entitlement.** It already was, at
-- the layer that matters: every RLS policy and every RPC inside a company schema
-- derives from `acc_current_role()`, which reads `acc_app_user` and nothing else.
-- A direct PostgREST call with `Accept-Profile: co_pc` is decided there too.
-- `company_member` was a second answer to a question that already had one.
--
-- So the register now asks each company's books who belongs to it, rather than
-- keeping its own list. Membership becomes a consequence of having a role, which
-- is what the original design comment said it was.
--
-- Three things follow, and all three are wanted:
--
--   * suspending or offboarding somebody removes the company from their switcher
--     immediately — one column, one effect, no second row to remember;
--   * the three drifted accounts regain the access their role always said they
--     had, without anybody guessing which of the two stores was right;
--   * the offboarded account with a lingering membership row loses it.
--
-- `company_member` is kept, and still written, as the record of who granted whom
-- and when. It is no longer consulted for authorisation. Anything that reads it
-- to decide access is a bug; `onebook.entitlement_drift()` below exists to find
-- exactly that.
--
-- ## Note for whoever changes this next
--
-- Every statement here names `onebook.`, so `scopeOf()` holds all of them back
-- from company schemas and only the copy in the register is built. That is
-- deliberate — see 0104 and 0122, where the same rule was learned twice.
-- ============================================================================

set search_path = public;

/**
 * The caller's role in one company's books, or null.
 *
 * The register does not store this and must not: the books do. `%I` quotes the
 * schema, and `schema_name` is constrained by the register to a plain identifier
 * besides — the same pattern 0104 and 0122 use to reach across companies safely.
 *
 * `invited` and `active` are the statuses that hold access, matching
 * `acc_current_role()` exactly. A suspended or offboarded person has a row and
 * no entitlement, which is the whole point of those two states.
 */
create or replace function onebook.company_role_in(p_schema text)
returns text
language plpgsql stable security definer set search_path = onebook, public as $$
declare
  v_role text;
begin
  if auth.uid() is null or p_schema is null then return null; end if;
  -- Only a schema the register knows, and only one that is still active.
  if not exists (
    select 1 from onebook.company
     where schema_name = p_schema and status = 'active'
  ) then
    return null;
  end if;
  execute format(
    'select role::text from %I.acc_app_user
      where id = $1 and status in (''invited'', ''active'')', p_schema)
    into v_role using auth.uid();
  return v_role;
exception when undefined_table then
  -- A company on the register whose schema has not finished provisioning. No
  -- books means no entitlement; it must not mean an error that hides the
  -- companies a person legitimately holds.
  return null;
end $$;

revoke all on function onebook.company_role_in(text) from public, anon;
grant execute on function onebook.company_role_in(text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- The policy that decides what `onebook.my_companies()` returns.
--
-- `my_companies` is `security invoker` and selects from `onebook.company`, so
-- this policy *is* the entitlement rule. Changing it here changes the switcher,
-- `resolveActiveCompany`, and `activeSchema` together — one edit, one meaning.
-- ----------------------------------------------------------------------------
drop policy if exists onebook_company_sel on onebook.company;
create policy onebook_company_sel on onebook.company
  for select using (onebook.company_role_in(schema_name) is not null);

/**
 * Where the two stores disagree — the check that did not exist when they were
 * allowed to drift.
 *
 * Reports one row per disagreement, in both directions:
 *
 *   has_role = true,  has_membership = false — entitled, and the register never
 *     knew. Harmless now that entitlement is derived, but it means somebody was
 *     created outside the normal flow.
 *   has_role = false, has_membership = true — the register still carries a grant
 *     for somebody whose access has been withdrawn. No longer confers anything;
 *     still worth clearing so the record does not mislead a reader.
 *
 * Platform admins only: it names who belongs to which company across the whole
 * installation, which is not an ordinary user's business.
 */
create or replace function onebook.entitlement_drift()
returns table (
  schema_name    text,
  user_id        uuid,
  has_role       boolean,
  has_membership boolean,
  app_user_status text
)
language plpgsql stable security definer set search_path = onebook, public as $$
declare
  v_company record;
begin
  if not onebook.is_platform_admin() then
    raise exception 'Only a platform administrator may read entitlement drift';
  end if;

  for v_company in
    select c.id, c.schema_name as name from onebook.company c where c.status = 'active'
  loop
    begin
      return query execute format($q$
        select %L::text,
               coalesce(a.id, m.user_id),
               a.id is not null,
               m.user_id is not null,
               a.status::text
          from %I.acc_app_user a
          full outer join (
            select user_id from onebook.company_member where company_id = %L
          ) m on m.user_id = a.id
         where (a.id is null) <> (m.user_id is null)
            or (a.id is not null and a.status not in ('invited','active') and m.user_id is not null)
      $q$, v_company.name, v_company.name, v_company.id);
    exception when undefined_table then
      -- Not yet provisioned. Nothing to compare; not a drift.
      null;
    end;
  end loop;
end $$;

revoke all on function onebook.entitlement_drift() from public, anon;
grant execute on function onebook.entitlement_drift() to authenticated, service_role;

notify pgrst, 'reload schema';
