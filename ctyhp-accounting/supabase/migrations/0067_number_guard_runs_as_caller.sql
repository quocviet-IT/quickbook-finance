-- ============================================================================
-- The number guard has to run as the caller.
--
-- Migration 0066 defined acc_guard_document_number() as SECURITY DEFINER, so
-- `current_user` inside it was always the function's owner — the guard let
-- every statement through, including the client updates it exists to refuse.
-- SECURITY INVOKER is what makes the distinction real: a PostgREST session
-- arrives as `authenticated`, while the issue/post RPCs are themselves
-- SECURITY DEFINER and reach the trigger as the table owner.
--
-- The function needs no privileges of its own; it only reads OLD and NEW.
-- ============================================================================

create or replace function acc_guard_document_number() returns trigger
language plpgsql security invoker set search_path = public as $$
declare
  v_column text := tg_argv[0];
  v_old    text := to_jsonb(old) ->> v_column;
  v_new    text;
begin
  if current_user not in ('authenticated', 'anon') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'DELETE' then
    if v_old is not null then
      raise exception
        'Document % has been numbered and cannot be deleted. Void it instead.', v_old
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  v_new := to_jsonb(new) ->> v_column;
  if v_old is distinct from v_new then
    raise exception
      'A document number is assigned by the system and cannot be changed (% to %).',
      coalesce(v_old, 'unnumbered'), coalesce(v_new, 'unnumbered')
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function acc_guard_document_number() from public;
grant execute on function acc_guard_document_number() to authenticated, anon, service_role;
