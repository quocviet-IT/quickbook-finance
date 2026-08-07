-- ============================================================================
-- One resolver, and the screen asks it.
--
-- An import file names accounts in prose, and two pieces of code turned that
-- prose into an account: this one, and a lookup table the preview screen built
-- for itself in TypeScript. They were written to agree and did not. The screen
-- flattened code, name, and "code - name" into a single map where a later row
-- could overwrite an earlier one; this function has always preferred the code,
-- then the pair, then the bare name. On a chart holding two accounts called
-- "Cash on Hand" they picked different ones — so the preview showed a green
-- button, and the import then failed on the account the preview had never
-- considered. A warning the reader was told to ignore became a dead end.
--
-- The cure is not to make the copy more faithful. It is to delete the copy.
-- `acc_account_ref_matches` answers the whole question for a batch of
-- references without choosing anything the caller has not earned, and both the
-- preview and the import now read that one answer.
--
-- It also settles what used to be settled by luck. A bare name is the only
-- form two live accounts can share, because the code carries a unique index.
-- Where two share it, nothing is resolved: which account the money belongs in
-- is a question only the person holding the file can answer, and picking one
-- with `limit 1` answered it for them, differently on different days.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. What a reference matches, and how.
--
--    `matched_by` is the rule that fired: 'code', 'code_and_name', 'name', or
--    'ambiguous' when the name belongs to more than one account. 'ambiguous'
--    carries every candidate's code so the reader is told what to write
--    instead, rather than merely that something is wrong.
-- ----------------------------------------------------------------------------
create or replace function acc_account_ref_matches(p_refs text[])
returns table (ref text, account_id uuid, matched_by text, candidate_codes text[])
language plpgsql stable security definer set search_path = public as $$
declare
  v_raw   text;
  v_key   text;
  v_id    uuid;
  v_codes text[];
begin
  for v_raw in
    select distinct btrim(x)
      from unnest(coalesce(p_refs, array[]::text[])) as x
     where btrim(coalesce(x, '')) <> ''
  loop
    v_key          := acc_normalize_ref(v_raw);
    ref            := v_raw;
    account_id     := null;
    matched_by     := null;
    candidate_codes := array[]::text[];

    -- The account code. Unique by construction, so this can only ever name one
    -- account, which is why it is offered as the way out of every ambiguity.
    select a.id into v_id
      from acc_account a
     where acc_normalize_ref(a.account_code) = v_key
       and a.status <> 'archived'
     limit 1;
    if v_id is not null then
      account_id := v_id;
      matched_by := 'code';
      return next;
      continue;
    end if;

    -- The code and the name together, which inherits the code's uniqueness.
    select a.id into v_id
      from acc_account a
     where acc_normalize_ref(a.account_code || ' - ' || a.name) = v_key
       and a.status <> 'archived'
     limit 1;
    if v_id is not null then
      account_id := v_id;
      matched_by := 'code_and_name';
      return next;
      continue;
    end if;

    -- The bare name. Collect every account that answers to it before deciding,
    -- because the count is the whole answer: one is a match, two is a question.
    select array_agg(a.account_code order by a.account_code)
      into v_codes
      from acc_account a
     where acc_normalize_ref(a.name) = v_key
       and a.status <> 'archived';
    candidate_codes := coalesce(v_codes, array[]::text[]);

    if coalesce(array_length(candidate_codes, 1), 0) = 1 then
      select a.id into account_id
        from acc_account a
       where acc_normalize_ref(a.name) = v_key
         and a.status <> 'archived'
       limit 1;
      matched_by := 'name';
    elsif coalesce(array_length(candidate_codes, 1), 0) > 1 then
      matched_by := 'ambiguous';
    end if;

    return next;
  end loop;
end;
$$;

revoke all on function acc_account_ref_matches(text[]) from public, anon;
grant execute on function acc_account_ref_matches(text[]) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. The single-reference form every import already calls, now reading the
--    same answer rather than repeating the search.
--
--    An ambiguous name raises instead of returning null. Null means "the chart
--    does not have this", and the screens say so by telling the reader to
--    import the chart first — advice that would send someone to create a third
--    account called "Cash on Hand" when the trouble is that two already exist.
-- ----------------------------------------------------------------------------
create or replace function acc_resolve_account_ref(p_ref text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  m record;
begin
  select * into m from acc_account_ref_matches(array[p_ref]) limit 1;
  if not found then return null; end if;

  if m.matched_by = 'ambiguous' then
    raise exception
      'The name "%" belongs to % accounts (%). Write the account code in the file instead, '
      'either on its own or as "% - %".',
      p_ref,
      array_length(m.candidate_codes, 1),
      array_to_string(m.candidate_codes, ', '),
      m.candidate_codes[1],
      p_ref;
  end if;

  return m.account_id;
end;
$$;

revoke all on function acc_resolve_account_ref(text) from public, anon;
grant execute on function acc_resolve_account_ref(text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. The list the ledger screen shows before the button is pressed.
--
--    Rewritten onto the batch form because the old body called the single
--    reference inside a filter, and that call can now raise. An ambiguous name
--    belongs on this list: it is a reference the import will not resolve.
-- ----------------------------------------------------------------------------
create or replace function acc_unresolved_account_refs(p_refs text[])
returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(
    array_agg(distinct ref order by ref) filter (where account_id is null),
    array[]::text[])
    from acc_account_ref_matches(p_refs);
$$;

revoke all on function acc_unresolved_account_refs(text[]) from public, anon;
grant execute on function acc_unresolved_account_refs(text[]) to authenticated, service_role;
