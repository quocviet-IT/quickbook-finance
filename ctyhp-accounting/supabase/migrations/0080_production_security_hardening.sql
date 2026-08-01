-- Lock the accounting RPC boundary down to authenticated application users and
-- the service role. Function bodies and accounting behavior are unchanged.

do $$
declare
  v_function regprocedure;
  v_authenticated boolean;
begin
  for v_function, v_authenticated in
    select
      p.oid::regprocedure,
      has_function_privilege('authenticated', p.oid, 'EXECUTE')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'acc\_%' escape '\'
  loop
    execute format(
      'revoke execute on function %s from public, anon',
      v_function
    );
    if v_authenticated then
      execute format(
        'grant execute on function %s to authenticated',
        v_function
      );
    end if;
    execute format(
      'grant execute on function %s to service_role',
      v_function
    );
  end loop;
end;
$$;

-- These are implementation helpers invoked by trusted SECURITY DEFINER
-- wrappers and must not be callable directly by an application session.
revoke execute on function public.acc_add_inventory_txn(
  uuid,
  date,
  public.acc_inventory_source,
  uuid,
  numeric,
  bigint,
  uuid,
  uuid,
  text
) from authenticated;
revoke execute on function public.acc_reverse_inventory_for_entry(
  uuid,
  date,
  text
) from authenticated;
revoke execute on function public.acc_recompute_po_status(uuid)
  from authenticated;

-- Migration history is an owner-only deployment concern, not application data.
alter table public.acc_schema_migrations enable row level security;
revoke all on table public.acc_schema_migrations
  from public, anon, authenticated;

do $$
declare
  v_sequence regclass;
begin
  for v_sequence in
    select sequence_relation.oid::regclass
    from pg_class sequence_relation
    join pg_depend dependency on dependency.objid = sequence_relation.oid
    where sequence_relation.relkind = 'S'
      and dependency.refobjid = 'public.acc_schema_migrations'::regclass
  loop
    execute format(
      'revoke all on sequence %s from public, anon, authenticated',
      v_sequence
    );
  end loop;
end;
$$;

-- Future objects fail closed until their migration grants an intended role.
alter default privileges in schema public
  revoke execute on functions from public;
alter default privileges in schema public
  revoke execute on functions from anon;
alter default privileges in schema public
  revoke all on tables from public;
alter default privileges in schema public
  revoke all on tables from anon;
alter default privileges in schema public
  revoke all on sequences from public;
alter default privileges in schema public
  revoke all on sequences from anon;
