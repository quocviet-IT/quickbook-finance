-- 0156_balance_comparison_external_group.sql
--
-- Keep the group of an account only the other system has.
--
-- 0155 kept no group for such a line, so a reloaded comparison had to guess
-- where the row belonged and could put it in another group than the one chosen
-- when it was typed. The group is now kept with the line. The user approved
-- changing acc_save_balance_comparison for this.
--
-- Additive: one nullable column, one check, and the save function replaced with
-- the same signature. The line table is empty on every company when this runs.
set search_path = public;

alter table acc_balance_comparison_line add column if not exists external_group text;

alter table acc_balance_comparison_line drop constraint if exists acc_balance_comparison_line_group_ck;
alter table acc_balance_comparison_line add constraint acc_balance_comparison_line_group_ck
  -- "is not null" first: a null group would make the "in" test null, and a
  -- check that comes out null passes.
  check (
    (account_id is null and external_group is not null
      and external_group in ('asset', 'liability', 'equity', 'income', 'expense'))
    or (account_id is not null and external_group is null)
  );

-- ----------------------------------------------------------------------------
-- acc_save_balance_comparison — as in 0155, and an external line carries its group.
--
-- p_lines is a JSON array. Each element is either
--   {"account_id": "<uuid>", "other_balance_minor": <integer>}   or
--   {"external_code": "...", "external_name": "...", "external_group": "asset|liability|equity|income|expense",
--    "other_balance_minor": <integer>}.
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
  v_group  text;
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

    v_acct  := nullif(v_line ->> 'account_id', '')::uuid;
    v_code  := nullif(btrim(coalesce(v_line ->> 'external_code', '')), '');
    v_name  := nullif(btrim(coalesce(v_line ->> 'external_name', '')), '');
    v_group := nullif(btrim(coalesce(v_line ->> 'external_group', '')), '');

    if v_acct is not null then
      if v_code is not null or v_name is not null then
        raise exception 'A figure is for an account here or one only the other system has, not both';
      end if;
      if v_group is not null then
        raise exception 'A figure for an account here takes no group';
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
      if v_group is null or v_group not in ('asset', 'liability', 'equity', 'income', 'expense') then
        raise exception 'Choose a group for an account only the other system has';
      end if;
      if length(v_code) > 40 then raise exception 'An account code is too long (40 characters at most)'; end if;
      if length(v_name) > 200 then raise exception 'An account name is too long (200 characters at most)'; end if;
      if lower(v_code) = any (v_seen_c) then raise exception 'An account code appears twice'; end if;
      v_seen_c := v_seen_c || lower(v_code);
    end if;

    insert into acc_balance_comparison_line
      (as_of, account_id, external_code, external_name, external_group, other_balance_minor)
    values (p_as_of, v_acct,
            case when v_acct is null then v_code end,
            case when v_acct is null then v_name end,
            case when v_acct is null then v_group end,
            v_minor);
    v_kept := v_kept + 1;
  end loop;

  return v_kept;
end;
$$;

revoke all on function acc_save_balance_comparison(date, text, text, jsonb) from public, anon;
grant execute on function acc_save_balance_comparison(date, text, text, jsonb) to authenticated, service_role;
