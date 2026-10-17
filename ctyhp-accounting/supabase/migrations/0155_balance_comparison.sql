-- ============================================================================
-- 0155 — Balance comparison: another ledger's balances, typed in and kept by date.
--
-- One company's books can exist in two systems. To compare them, a person types
-- the other system's balance for each account as at one date. What is typed is
-- kept under that date, so a check at one date never overwrites a check at
-- another, and the report can say which date and which system it compares.
--
--   acc_balance_comparison       one row per comparison date: the other system's
--                                name ("compared with") and an optional note.
--   acc_balance_comparison_line  one row per account with a typed figure, in
--                                natural sign: as the other system prints it, so
--                                liabilities, equity and income are positive.
--                                An account only the other system has carries
--                                its code and name instead of an account id.
--
-- Additive: two new tables and one new function. Nothing existing changes.
--
-- Writes go only through acc_save_balance_comparison: both tables have a read
-- policy and no write policy, as acc_stock_count and acc_cash_count do
-- (0139, 0154). The actor stamps and the audit trail sit on the header. The
-- line rows are replaced wholesale by every save and carry no actor columns, so
-- the header's audit row is the record of who changed that date's figures.
-- ============================================================================

set search_path = public;

-- ----------------------------------------------------------------------------
-- The header: one row per comparison date
-- ----------------------------------------------------------------------------
create table if not exists acc_balance_comparison (
  id             uuid primary key default gen_random_uuid(),
  -- the lines point at the date; the id is what the audit trail records
  as_of          date not null unique,
  compared_with  text not null check (length(compared_with) between 1 and 80),
  note           text check (note is null or length(note) <= 500),
  created_by     uuid references auth.users (id),
  created_at     timestamptz not null default now(),
  updated_by     uuid references auth.users (id),
  updated_at     timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- The lines: one row per account with a typed figure
-- ----------------------------------------------------------------------------
create table if not exists acc_balance_comparison_line (
  id                   uuid primary key default gen_random_uuid(),
  as_of                date not null references acc_balance_comparison (as_of) on delete cascade,
  -- null for an account only the other system has
  account_id           uuid references acc_account (id),
  -- for an account only the other system has
  external_code        text check (external_code is null or length(external_code) between 1 and 40),
  external_name        text check (external_name is null or length(external_name) between 1 and 200),
  -- natural sign: as the other system prints it
  other_balance_minor  bigint not null,
  constraint acc_balance_comparison_line_who_ck
    check (account_id is not null or (external_code is not null and external_name is not null))
);

create unique index if not exists acc_balance_comparison_line_account_uq
  on acc_balance_comparison_line (as_of, account_id)
  where account_id is not null;

create unique index if not exists acc_balance_comparison_line_external_uq
  on acc_balance_comparison_line (as_of, lower(external_code))
  where account_id is null;

-- ----------------------------------------------------------------------------
-- Actor stamps and audit trail, on the header only
-- ----------------------------------------------------------------------------
drop trigger if exists acc_balance_comparison_actor_stamp on acc_balance_comparison;
create trigger acc_balance_comparison_actor_stamp
  before insert or update on acc_balance_comparison
  for each row execute function acc_stamp_actor();

drop trigger if exists acc_balance_comparison_atomic_audit on acc_balance_comparison;
create trigger acc_balance_comparison_atomic_audit
  after insert or update or delete on acc_balance_comparison
  for each row execute function acc_audit_row_change();

-- ----------------------------------------------------------------------------
-- Row-level security: staff and viewers read; nobody else does
-- ----------------------------------------------------------------------------
alter table acc_balance_comparison enable row level security;
alter table acc_balance_comparison_line enable row level security;

drop policy if exists acc_balance_comparison_read on acc_balance_comparison;
create policy acc_balance_comparison_read on acc_balance_comparison
  for select using (acc_is_staff() or coalesce(acc_current_role() = 'viewer', false));

drop policy if exists acc_balance_comparison_line_read on acc_balance_comparison_line;
create policy acc_balance_comparison_line_read on acc_balance_comparison_line
  for select using (acc_is_staff() or coalesce(acc_current_role() = 'viewer', false));

-- No insert, update or delete policy: an application session writes these
-- tables only through the function below.
revoke all on acc_balance_comparison from public, anon;
revoke all on acc_balance_comparison_line from public, anon;
-- Schema public hands authenticated write rights on every new table through
-- Supabase's default privileges. These tables are written only by the security
-- definer function below, so take those rights back.
revoke insert, update, delete, truncate on acc_balance_comparison from authenticated;
revoke insert, update, delete, truncate on acc_balance_comparison_line from authenticated;
grant select on acc_balance_comparison to authenticated;
grant select on acc_balance_comparison_line to authenticated;
grant all on acc_balance_comparison to service_role;
grant all on acc_balance_comparison_line to service_role;

-- ----------------------------------------------------------------------------
-- acc_save_balance_comparison — keep the figures typed for one date.
--
-- p_lines is a JSON array. Each element is either
--   {"account_id": "<uuid>", "other_balance_minor": <integer>}   or
--   {"external_code": "...", "external_name": "...", "other_balance_minor": <integer>}.
-- A line whose figure is missing or null is not stored. The header for the date
-- is created or updated, and the lines kept for that date are replaced by
-- p_lines, in this one transaction; other dates are never touched.
-- Returns the number of lines kept.
-- ----------------------------------------------------------------------------
create or replace function acc_save_balance_comparison(
  p_as_of         date,
  p_compared_with text,
  p_note          text,
  p_lines         jsonb
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_with   text := btrim(coalesce(p_compared_with, ''));
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_lines  jsonb := coalesce(p_lines, '[]'::jsonb);
  v_line   jsonb;
  v_figure jsonb;
  v_acct   uuid;
  v_code   text;
  v_name   text;
  v_minor  bigint;
  v_kept   integer := 0;
  v_seen_a uuid[] := '{}';
  v_seen_c text[] := '{}';
begin
  if not acc_is_staff() then raise exception 'Not authorized to save a balance comparison'; end if;
  if p_as_of is null then raise exception 'Choose the date to compare at'; end if;
  if v_with = '' then raise exception 'Enter the name of the other system'; end if;
  if length(v_with) > 80 then raise exception 'The name of the other system is too long (80 characters at most)'; end if;
  if v_note is not null and length(v_note) > 500 then
    raise exception 'The note is too long (500 characters at most)';
  end if;
  if jsonb_typeof(v_lines) <> 'array' then raise exception 'The figures must be a list'; end if;

  -- Serialises two saves of one date. The header carries the date's name and note.
  insert into acc_balance_comparison (as_of, compared_with, note)
  values (p_as_of, v_with, v_note)
  on conflict (as_of) do update
    set compared_with = excluded.compared_with, note = excluded.note;

  delete from acc_balance_comparison_line where as_of = p_as_of;

  for v_line in select value from jsonb_array_elements(v_lines) loop
    if jsonb_typeof(v_line) <> 'object' then raise exception 'Each figure must be an object'; end if;

    v_figure := v_line -> 'other_balance_minor';
    -- no figure: not stored
    continue when v_figure is null or jsonb_typeof(v_figure) = 'null';
    if jsonb_typeof(v_figure) <> 'number' or v_figure::text !~ '^-?[0-9]+$' then
      raise exception 'A figure must be a whole number of cents';
    end if;
    begin
      v_minor := (v_figure #>> '{}')::bigint;
    exception when numeric_value_out_of_range then
      raise exception 'A figure is too large';
    end;

    v_acct := nullif(v_line ->> 'account_id', '')::uuid;
    v_code := nullif(btrim(coalesce(v_line ->> 'external_code', '')), '');
    v_name := nullif(btrim(coalesce(v_line ->> 'external_name', '')), '');

    if v_acct is not null then
      if v_code is not null or v_name is not null then
        raise exception 'A figure is for an account here or one only the other system has, not both';
      end if;
      if not exists (select 1 from acc_account a where a.id = v_acct and a.status = 'active') then
        raise exception 'Choose an active account for each figure';
      end if;
      if v_acct = any (v_seen_a) then raise exception 'An account appears twice'; end if;
      v_seen_a := v_seen_a || v_acct;
    else
      if v_code is null or v_name is null then
        raise exception 'An account only the other system has needs a code and a name';
      end if;
      if length(v_code) > 40 then raise exception 'An account code is too long (40 characters at most)'; end if;
      if length(v_name) > 200 then raise exception 'An account name is too long (200 characters at most)'; end if;
      if lower(v_code) = any (v_seen_c) then raise exception 'An account code appears twice'; end if;
      v_seen_c := v_seen_c || lower(v_code);
    end if;

    insert into acc_balance_comparison_line (as_of, account_id, external_code, external_name, other_balance_minor)
    values (p_as_of, v_acct,
            case when v_acct is null then v_code end,
            case when v_acct is null then v_name end,
            v_minor);
    v_kept := v_kept + 1;
  end loop;

  return v_kept;
end;
$$;

-- ----------------------------------------------------------------------------
-- Who may call it. Role checks are inside the function; signed-in users and the
-- service role may call it, anon and the public may not.
-- ----------------------------------------------------------------------------
revoke all on function acc_save_balance_comparison(date, text, text, jsonb) from public, anon;
grant execute on function acc_save_balance_comparison(date, text, text, jsonb) to authenticated, service_role;
