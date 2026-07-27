-- ============================================================================
-- Document security hardening
-- Adds malware-scan lifecycle, fail-closed access for pending/blocked files,
-- and administrator-controlled retention and legal-hold governance.
-- ============================================================================

alter table acc_document_attachment
  add column scan_attempts integer not null default 0 check (scan_attempts >= 0),
  add column scan_started_at timestamptz,
  add column scan_completed_at timestamptz,
  add column scan_engine text check (scan_engine is null or char_length(scan_engine) <= 100),
  add column threat_name text check (threat_name is null or char_length(threat_name) <= 255),
  add column scan_error text check (scan_error is null or char_length(scan_error) <= 500);

insert into acc_permission (key, label, category, description, is_enforced)
values (
  'documents.govern',
  'Govern document retention',
  'Documents',
  'Set retention dates and legal holds for accounting evidence',
  true
)
on conflict (key) do update
set label = excluded.label,
    category = excluded.category,
    description = excluded.description,
    is_enforced = excluded.is_enforced;

insert into acc_role_permission (role, permission_key, allowed)
select role, 'documents.govern', role = 'admin'::acc_app_role
  from unnest(enum_range(null::acc_app_role)) as role
on conflict (role, permission_key) do update set allowed = excluded.allowed;

-- Metadata cannot claim that a client-uploaded file was already scanned.
drop policy acc_document_attachment_insert on acc_document_attachment;
create policy acc_document_attachment_insert on acc_document_attachment
  for insert with check (
    acc_has_permission('documents.manage')
    and uploaded_by = auth.uid()
    and status = 'active'
    and scan_status in ('pending', 'not_configured')
    and storage_path like entity_type::text || '/' || entity_id::text || '/%'
    and acc_document_storage_path_allowed(storage_path)
  );

-- Pending, failed, and blocked objects remain private and cannot receive a
-- user-session signed URL. The service role can still download them to scan.
drop policy acc_document_object_read on storage.objects;
create policy acc_document_object_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'accounting-documents'
    and public.acc_has_permission('documents.read')
    and exists (
      select 1
        from public.acc_document_attachment attachment
       where attachment.storage_path = name
         and attachment.status = 'active'
         and attachment.scan_status in ('clean', 'not_configured')
    )
  );

create or replace function acc_update_document_governance(
  p_attachment_id uuid,
  p_retention_until date,
  p_legal_hold boolean,
  p_reason text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_attachment acc_document_attachment%rowtype;
begin
  if not acc_has_permission('documents.govern') then
    raise exception 'You do not have permission to govern document retention';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'A governance change reason is required';
  end if;
  if p_retention_until is not null and p_retention_until < current_date then
    raise exception 'Retention date cannot be in the past';
  end if;

  select * into v_attachment
    from acc_document_attachment
   where id = p_attachment_id
   for update;
  if not found then
    raise exception 'Attachment not found';
  end if;
  if v_attachment.status <> 'active' then
    raise exception 'Archived attachment governance cannot be changed';
  end if;

  update acc_document_attachment
     set retention_until = p_retention_until,
         legal_hold = coalesce(p_legal_hold, false)
   where id = p_attachment_id;

  insert into acc_audit_log (
    table_name, record_id, action, actor_id, before_json, after_json
  )
  values (
    'acc_document_attachment',
    p_attachment_id,
    'governance_update',
    auth.uid(),
    jsonb_build_object(
      'retention_until', v_attachment.retention_until,
      'legal_hold', v_attachment.legal_hold
    ),
    jsonb_build_object(
      'retention_until', p_retention_until,
      'legal_hold', coalesce(p_legal_hold, false),
      'reason', btrim(p_reason)
    )
  );
end;
$$;

create or replace function acc_queue_document_scan(
  p_attachment_id uuid
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_attachment acc_document_attachment%rowtype;
begin
  if not acc_has_permission('documents.manage') then
    raise exception 'You do not have permission to manage supporting documents';
  end if;

  select * into v_attachment
    from acc_document_attachment
   where id = p_attachment_id
   for update;
  if not found or v_attachment.status <> 'active' then
    raise exception 'Active attachment not found';
  end if;
  if v_attachment.scan_status = 'pending' then
    raise exception 'Attachment is already queued for scanning';
  end if;

  update acc_document_attachment
     set scan_status = 'pending',
         scan_started_at = null,
         scan_completed_at = null,
         scan_engine = null,
         threat_name = null,
         scan_error = null
   where id = p_attachment_id;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values (
    'acc_document_attachment',
    p_attachment_id,
    'scan_queued',
    auth.uid(),
    jsonb_build_object('previous_status', v_attachment.scan_status)
  );
end;
$$;

create or replace function acc_begin_document_scan(
  p_attachment_id uuid
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'Document scanning is restricted to background automation';
  end if;

  update acc_document_attachment
     set scan_status = 'pending',
         scan_attempts = scan_attempts + 1,
         scan_started_at = now(),
         scan_completed_at = null,
         scan_engine = null,
         threat_name = null,
         scan_error = null
   where id = p_attachment_id
     and status = 'active';
  if not found then
    raise exception 'Active attachment not found';
  end if;
end;
$$;

create or replace function acc_complete_document_scan(
  p_attachment_id uuid,
  p_status acc_document_scan_status,
  p_engine text,
  p_threat_name text default null,
  p_error text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_attachment acc_document_attachment%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Document scanning is restricted to background automation';
  end if;
  if p_status not in ('clean', 'blocked', 'error') then
    raise exception 'Invalid completed scan status';
  end if;
  if p_status = 'blocked' and char_length(btrim(coalesce(p_threat_name, ''))) < 1 then
    raise exception 'Blocked documents require a threat name';
  end if;
  if p_status = 'error' and char_length(btrim(coalesce(p_error, ''))) < 1 then
    raise exception 'Failed scans require an error message';
  end if;

  select * into v_attachment
    from acc_document_attachment
   where id = p_attachment_id
     and status = 'active'
   for update;
  if not found then
    raise exception 'Active attachment not found';
  end if;

  update acc_document_attachment
     set scan_status = p_status,
         scan_completed_at = now(),
         scan_engine = left(nullif(btrim(p_engine), ''), 100),
         threat_name = case
           when p_status = 'blocked' then left(btrim(p_threat_name), 255)
           else null
         end,
         scan_error = case
           when p_status = 'error' then left(btrim(p_error), 500)
           else null
         end
   where id = p_attachment_id;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values (
    'acc_document_attachment',
    p_attachment_id,
    'scan_completed',
    null,
    jsonb_build_object(
      'status', p_status,
      'engine', left(nullif(btrim(p_engine), ''), 100),
      'threat_name', case when p_status = 'blocked' then left(btrim(p_threat_name), 255) end,
      'error', case when p_status = 'error' then left(btrim(p_error), 500) end
    )
  );
end;
$$;

create or replace function acc_log_document_access(
  p_attachment_id uuid,
  p_action text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not acc_has_permission('documents.read') then
    raise exception 'You do not have permission to read supporting documents';
  end if;
  if p_action not in ('preview', 'download') then
    raise exception 'Invalid document access action';
  end if;
  if not exists (
    select 1
      from acc_document_attachment
     where id = p_attachment_id
       and status = 'active'
       and scan_status in ('clean', 'not_configured')
  ) then
    raise exception 'Attachment is unavailable until it passes security scanning';
  end if;

  insert into acc_document_access_log (attachment_id, action, actor_id)
  values (p_attachment_id, p_action, auth.uid());
end;
$$;

revoke all on function acc_update_document_governance(uuid, date, boolean, text) from public;
revoke all on function acc_queue_document_scan(uuid) from public;
revoke all on function acc_begin_document_scan(uuid) from public;
revoke all on function acc_complete_document_scan(
  uuid, acc_document_scan_status, text, text, text
) from public;
grant execute on function acc_update_document_governance(uuid, date, boolean, text)
  to authenticated;
grant execute on function acc_queue_document_scan(uuid) to authenticated;
grant execute on function acc_begin_document_scan(uuid) to service_role;
grant execute on function acc_complete_document_scan(
  uuid, acc_document_scan_status, text, text, text
) to service_role;
