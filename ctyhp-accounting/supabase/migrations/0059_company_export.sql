-- Company data export: its own permission, and the only path that records one.

insert into acc_permission (key, label, category, description, is_enforced) values
  ('company.export', 'Export company data', 'Governance',
   'Download the full company data archive, including vendor tax identifiers', true)
on conflict (key) do nothing;

-- Every role carries a row for every permission, so the matrix stays complete.
-- Only an administrator starts with the archive; the rest can be granted it.
insert into acc_role_permission (role, permission_key, allowed)
select r.role, 'company.export', r.role = 'admin'
  from (select unnest(enum_range(null::acc_app_role)) as role) r
 where not exists (
   select 1 from acc_role_permission rp
    where rp.role = r.role and rp.permission_key = 'company.export'
 );

-- Records the shape of an export: row counts, checksum, whether the sensitive
-- file was included. Never the exported values, and never a tax identifier.
create or replace function acc_log_company_export(p_summary jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not acc_has_permission('company.export') then
    raise exception 'company.export permission is required to record an export';
  end if;

  if p_summary ? 'rows' or p_summary ? 'data' then
    raise exception 'The export audit summary must not carry exported data';
  end if;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values ('acc_company_export', gen_random_uuid(), 'export', auth.uid(),
          jsonb_build_object(
            'generated_at',      p_summary ->> 'generated_at',
            'schema_version',    p_summary ->> 'schema_version',
            'manifest_sha256',   p_summary ->> 'manifest_sha256',
            'table_count',       (p_summary ->> 'table_count')::int,
            'total_rows',        (p_summary ->> 'total_rows')::int,
            'included_sensitive', coalesce((p_summary ->> 'included_sensitive')::boolean, false)
          ))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function acc_log_company_export(jsonb) from public;
grant execute on function acc_log_company_export(jsonb) to authenticated;

-- Make the new RPC visible to PostgREST immediately.
notify pgrst, 'reload schema';
