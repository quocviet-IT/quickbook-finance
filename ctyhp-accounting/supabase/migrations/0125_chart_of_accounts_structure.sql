-- ============================================================================
-- 0125 — The chart of accounts: non-current liabilities, contra accounts,
-- sub-accounts that share their parent's type, and the chart a new company
-- starts from.
--
-- Metadata only. No amount, code, name, parent or type of an existing account
-- changes: the type added is new, the contra flag and the Undeposited Funds
-- detail type are filled in for system accounts only, and the parent-type rule
-- is checked only when a parent or a type is written.
-- ============================================================================

-- 1. Non-current liabilities. Nothing in this file uses the new value: a value
--    added to an existing enum cannot be used until its transaction commits.
--    (A company being provisioned creates the type in the same transaction,
--    and there Postgres allows it — verified on 17.6.)
alter type acc_account_type add value if not exists 'long_term_liability' after 'current_liability';

-- 2. Contra accounts, said rather than guessed from a detail type's wording.
alter table acc_account add column if not exists is_contra boolean not null default false;

update acc_account
   set is_contra = true
 where is_contra = false
   and (
     detail_type ~* '^\s*contra\M'
     or (account_code = '1190' and name ilike 'allowance%')
   );

-- 3. The system Undeposited Funds account, so the chart can show it with the
--    bank accounts. Its type stays current_asset.
update acc_account
   set detail_type = 'undeposited_funds'
 where account_code = '1210'
   and name ilike '%undeposited%'
   and detail_type is null;

-- 4. A sub-account has its parent's type. Checked when a parent or a type is
--    written, so rows written before this migration are not re-judged.
create or replace function acc_account_parent_type() returns trigger
language plpgsql as $$
begin
  if new.parent_account_id is not null and exists (
    select 1 from acc_account p
     where p.id = new.parent_account_id and p.account_type <> new.account_type
  ) then
    raise exception 'A sub-account must have the same type as its parent';
  end if;
  if tg_op = 'UPDATE' and new.account_type is distinct from old.account_type and exists (
    select 1 from acc_account c
     where c.parent_account_id = new.id and c.account_type <> new.account_type
  ) then
    raise exception 'A sub-account must have the same type as its parent';
  end if;
  return new;
end;
$$;

drop trigger if exists acc_account_parent_type_trg on acc_account;
create trigger acc_account_parent_type_trg
  before insert or update of parent_account_id, account_type on acc_account
  for each row execute function acc_account_parent_type();

-- 5. The chart a new company starts from.
alter table onebook.company_request
  add column if not exists chart_template text not null default 'standard';
alter table onebook.company_request
  drop constraint if exists company_request_chart_template_ck;
alter table onebook.company_request
  add constraint company_request_chart_template_ck
  check (chart_template in ('standard', 'retail_jewelry'));

-- A four-argument call must not be ambiguous between two signatures.
drop function if exists onebook.request_company(text, text, boolean, int);

create or replace function onebook.request_company(
  p_slug text,
  p_legal_name text,
  p_is_sample boolean default false,
  p_display_order int default 100,
  p_chart_template text default 'standard'
) returns uuid
language plpgsql security definer set search_path = onebook, public as $$
declare
  v_slug     text := lower(btrim(coalesce(p_slug, '')));
  v_name     text := btrim(coalesce(p_legal_name, ''));
  v_template text := coalesce(nullif(btrim(p_chart_template), ''), 'standard');
  v_id       uuid;
begin
  if not onebook.is_platform_admin() then
    raise exception 'Not authorized to create a company';
  end if;
  if v_slug !~ '^[a-z][a-z0-9_]{1,40}$' then
    raise exception 'A company key is lower case letters, digits and underscores';
  end if;
  if length(v_name) = 0 then raise exception 'A legal name is required'; end if;
  if v_template not in ('standard', 'retail_jewelry') then
    raise exception 'Unknown chart of accounts template %', v_template;
  end if;
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

  insert into onebook.company_request (slug, legal_name, is_sample, display_order, requested_by, chart_template)
  values (v_slug, v_name, coalesce(p_is_sample, false), coalesce(p_display_order, 100), auth.uid(), v_template)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function onebook.request_company(text, text, boolean, int, text) from public, anon;
grant execute on function onebook.request_company(text, text, boolean, int, text)
  to authenticated, service_role;
