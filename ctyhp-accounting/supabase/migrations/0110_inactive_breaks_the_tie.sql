-- ============================================================================
-- Switching an account off settles which of two same-named accounts is meant.
--
-- 0107 stopped the resolver guessing between two accounts sharing a name, and
-- told the reader to write the account code in the file instead. That is sound
-- advice for a file you own, and no advice at all for the common case: the file
-- is a customer's export, they cannot edit it, and it arrives with bare names.
--
-- The remedy they reached for was the right one — they went to the chart of
-- accounts and made the duplicate inactive. Nothing happened, because the
-- resolver only ever excluded `archived`, so a deactivated account still stood
-- there as a candidate and the import stayed blocked. They were doing the
-- correct thing and being told it did not work.
--
-- So: where a name matches more than one account and exactly one of them is
-- active, that one is meant. The chart has answered the question. Two live
-- accounts of the same name is still a question, and still refused.
--
-- The single-match case is deliberately untouched. A file naming an account
-- that happens to be inactive still resolves to it, because deactivating an
-- account should not silently break an import that names it unambiguously —
-- and `acc_post_entry` is where posting to a closed account belongs, not here.
-- ============================================================================

create or replace function acc_account_ref_matches(p_refs text[])
returns table (ref text, account_id uuid, matched_by text, candidate_codes text[])
language plpgsql stable security definer set search_path = public as $$
declare
  v_raw   text;
  v_key   text;
  v_id    uuid;
  v_codes text[];
  v_live  text[];
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
    v_codes := coalesce(v_codes, array[]::text[]);

    -- Unless the chart has already answered it. One live account and one
    -- switched off is a decision somebody made on purpose, and honouring it is
    -- the only remedy open to a reader importing a file they cannot edit.
    if coalesce(array_length(v_codes, 1), 0) > 1 then
      select array_agg(a.account_code order by a.account_code)
        into v_live
        from acc_account a
       where acc_normalize_ref(a.name) = v_key
         and a.status = 'active';
      if coalesce(array_length(v_live, 1), 0) = 1 then
        v_codes := v_live;
      end if;
    end if;
    candidate_codes := v_codes;

    if coalesce(array_length(v_codes, 1), 0) = 1 then
      select a.id into account_id
        from acc_account a
       where acc_normalize_ref(a.name) = v_key
         and a.status <> 'archived'
         and a.account_code = v_codes[1]
       limit 1;
      matched_by := 'name';
    elsif coalesce(array_length(v_codes, 1), 0) > 1 then
      matched_by := 'ambiguous';
    end if;

    return next;
  end loop;
end;
$$;

revoke all on function acc_account_ref_matches(text[]) from public, anon;
grant execute on function acc_account_ref_matches(text[]) to authenticated, service_role;

-- The refusal now has two ways out, and naming only one of them is what sent
-- somebody to edit a file they are not allowed to edit.
create or replace function acc_resolve_account_ref(p_ref text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  m record;
begin
  select * into m from acc_account_ref_matches(array[p_ref]) limit 1;
  if not found then return null; end if;

  if m.matched_by = 'ambiguous' then
    raise exception
      'The name "%" belongs to % active accounts (%). Either write the account code in the '
      'file — "%" on its own, or "% - %" — or make the one you do not use inactive in the '
      'chart of accounts.',
      p_ref,
      array_length(m.candidate_codes, 1),
      array_to_string(m.candidate_codes, ', '),
      m.candidate_codes[1],
      m.candidate_codes[1],
      p_ref;
  end if;

  return m.account_id;
end;
$$;

revoke all on function acc_resolve_account_ref(text) from public, anon;
grant execute on function acc_resolve_account_ref(text) to authenticated, service_role;
