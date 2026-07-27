-- ============================================================================
-- Documents & Attachments
-- Private supporting evidence linked to accounting records, with explicit
-- permissions, immutable access history, duplicate detection, and retention
-- controls. Files are archived rather than physically deleted after they have
-- been registered so the accounting evidence remains recoverable.
-- ============================================================================

create type acc_document_entity as enum (
  'invoice',
  'bill',
  'expense',
  'purchase_order',
  'payment',
  'bill_payment',
  'credit_memo',
  'vendor_credit',
  'journal_entry',
  'fixed_asset',
  'bank_transaction',
  'goods_receipt'
);

create type acc_document_kind as enum (
  'receipt',
  'vendor_bill',
  'customer_document',
  'purchase_order',
  'bank_statement',
  'contract',
  'tax_document',
  'other'
);

create type acc_document_scan_status as enum (
  'not_configured',
  'pending',
  'clean',
  'blocked',
  'error'
);

create type acc_document_status as enum ('active', 'archived');

create or replace function acc_document_entity_exists(
  p_entity_type acc_document_entity,
  p_entity_id uuid
) returns boolean
language plpgsql stable security definer set search_path = public as $$
begin
  case p_entity_type
    when 'invoice' then
      return exists (select 1 from acc_invoice where id = p_entity_id);
    when 'bill' then
      return exists (select 1 from acc_bill where id = p_entity_id);
    when 'expense' then
      return exists (select 1 from acc_expense where id = p_entity_id);
    when 'purchase_order' then
      return exists (select 1 from acc_purchase_order where id = p_entity_id);
    when 'payment' then
      return exists (select 1 from acc_payment where id = p_entity_id);
    when 'bill_payment' then
      return exists (select 1 from acc_bill_payment where id = p_entity_id);
    when 'credit_memo' then
      return exists (select 1 from acc_credit_memo where id = p_entity_id);
    when 'vendor_credit' then
      return exists (select 1 from acc_vendor_credit where id = p_entity_id);
    when 'journal_entry' then
      return exists (select 1 from acc_journal_entry where id = p_entity_id);
    when 'fixed_asset' then
      return exists (select 1 from acc_fixed_asset where id = p_entity_id);
    when 'bank_transaction' then
      return exists (select 1 from acc_bank_transaction where id = p_entity_id);
    when 'goods_receipt' then
      return exists (select 1 from acc_goods_receipt where id = p_entity_id);
  end case;
  return false;
end;
$$;

create or replace function acc_document_storage_path_allowed(p_name text)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_parts text[];
  v_entity_type acc_document_entity;
  v_entity_id uuid;
begin
  v_parts := string_to_array(p_name, '/');
  if array_length(v_parts, 1) <> 3 then
    return false;
  end if;
  if v_parts[3] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[a-z0-9]{1,10}$' then
    return false;
  end if;
  begin
    v_entity_type := v_parts[1]::acc_document_entity;
    v_entity_id := v_parts[2]::uuid;
  exception when others then
    return false;
  end;
  return acc_document_entity_exists(v_entity_type, v_entity_id);
end;
$$;

create table acc_document_attachment (
  id              uuid primary key default gen_random_uuid(),
  entity_type     acc_document_entity not null,
  entity_id       uuid not null,
  document_kind   acc_document_kind not null default 'other',
  file_name       text not null check (char_length(btrim(file_name)) between 1 and 255),
  storage_bucket  text not null default 'accounting-documents'
                  check (storage_bucket = 'accounting-documents'),
  storage_path    text not null unique check (position('..' in storage_path) = 0),
  mime_type       text not null check (mime_type in (
                    'application/pdf',
                    'image/jpeg',
                    'image/png',
                    'image/webp',
                    'text/csv',
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                  )),
  size_bytes      bigint not null check (size_bytes between 1 and 10485760),
  sha256          text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  description     text check (description is null or char_length(description) <= 500),
  scan_status     acc_document_scan_status not null default 'not_configured',
  retention_until date,
  legal_hold      boolean not null default false,
  status          acc_document_status not null default 'active',
  uploaded_by     uuid not null references auth.users (id),
  uploaded_at     timestamptz not null default now(),
  archived_by     uuid references auth.users (id),
  archived_at     timestamptz,
  archive_reason  text check (archive_reason is null or char_length(archive_reason) <= 500),
  check (
    (status = 'active' and archived_by is null and archived_at is null and archive_reason is null)
    or
    (status = 'archived' and archived_by is not null and archived_at is not null
      and char_length(btrim(archive_reason)) >= 3)
  )
);

create index acc_document_attachment_entity_idx
  on acc_document_attachment (entity_type, entity_id, status, uploaded_at desc);
create index acc_document_attachment_hash_idx on acc_document_attachment (sha256);
create unique index acc_document_attachment_active_hash_uq
  on acc_document_attachment (entity_type, entity_id, sha256)
  where status = 'active';

create table acc_document_access_log (
  id            uuid primary key default gen_random_uuid(),
  attachment_id uuid not null references acc_document_attachment (id),
  action        text not null check (action in ('preview', 'download')),
  actor_id      uuid not null references auth.users (id),
  accessed_at   timestamptz not null default now()
);

create index acc_document_access_log_attachment_idx
  on acc_document_access_log (attachment_id, accessed_at desc);
create index acc_document_access_log_actor_idx
  on acc_document_access_log (actor_id, accessed_at desc);

insert into acc_permission (key, label, category, description, is_enforced)
values
  ('documents.read', 'Read supporting documents', 'Documents',
   'List and open private attachments linked to accounting records', true),
  ('documents.manage', 'Manage supporting documents', 'Documents',
   'Upload and archive private attachments linked to accounting records', true)
on conflict (key) do update
set label = excluded.label,
    category = excluded.category,
    description = excluded.description,
    is_enforced = excluded.is_enforced;

insert into acc_role_permission (role, permission_key, allowed)
select role, 'documents.read', true
  from unnest(enum_range(null::acc_app_role)) as role
on conflict (role, permission_key) do update set allowed = excluded.allowed;

insert into acc_role_permission (role, permission_key, allowed)
select role, 'documents.manage',
       role in ('admin'::acc_app_role, 'accountant'::acc_app_role)
  from unnest(enum_range(null::acc_app_role)) as role
on conflict (role, permission_key) do update set allowed = excluded.allowed;

alter table acc_document_attachment enable row level security;
alter table acc_document_access_log enable row level security;

create policy acc_document_attachment_read on acc_document_attachment
  for select using (acc_has_permission('documents.read'));

create policy acc_document_attachment_insert on acc_document_attachment
  for insert with check (
    acc_has_permission('documents.manage')
    and uploaded_by = auth.uid()
    and status = 'active'
    and storage_path like entity_type::text || '/' || entity_id::text || '/%'
    and acc_document_storage_path_allowed(storage_path)
  );

create policy acc_document_access_log_read on acc_document_access_log
  for select using (acc_has_permission('audit.read'));

create or replace function acc_audit_document_attachment_insert()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values (
    'acc_document_attachment',
    new.id,
    'insert',
    auth.uid(),
    jsonb_build_object(
      'entity_type', new.entity_type,
      'entity_id', new.entity_id,
      'document_kind', new.document_kind,
      'file_name', new.file_name,
      'mime_type', new.mime_type,
      'size_bytes', new.size_bytes,
      'sha256', new.sha256,
      'scan_status', new.scan_status
    )
  );
  return new;
end;
$$;

create trigger acc_document_attachment_audit_insert
after insert on acc_document_attachment
for each row execute function acc_audit_document_attachment_insert();

create or replace function acc_archive_document_attachment(
  p_attachment_id uuid,
  p_reason text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_attachment acc_document_attachment%rowtype;
begin
  if not acc_has_permission('documents.manage') then
    raise exception 'You do not have permission to manage supporting documents';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'An archive reason is required';
  end if;

  select * into v_attachment
    from acc_document_attachment
   where id = p_attachment_id
   for update;
  if not found then
    raise exception 'Attachment not found';
  end if;
  if v_attachment.status <> 'active' then
    raise exception 'Attachment is already archived';
  end if;
  if v_attachment.legal_hold then
    raise exception 'Attachment is protected by legal hold';
  end if;
  if v_attachment.retention_until is not null
     and v_attachment.retention_until > current_date then
    raise exception 'Attachment is retained until %', v_attachment.retention_until;
  end if;

  update acc_document_attachment
     set status = 'archived',
         archived_by = auth.uid(),
         archived_at = now(),
         archive_reason = btrim(p_reason)
   where id = p_attachment_id;

  insert into acc_audit_log (table_name, record_id, action, actor_id, before_json, after_json)
  values (
    'acc_document_attachment',
    p_attachment_id,
    'archive',
    auth.uid(),
    jsonb_build_object('status', v_attachment.status, 'file_name', v_attachment.file_name),
    jsonb_build_object('status', 'archived', 'reason', btrim(p_reason))
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
    select 1 from acc_document_attachment
     where id = p_attachment_id and status = 'active'
  ) then
    raise exception 'Attachment not found';
  end if;

  insert into acc_document_access_log (attachment_id, action, actor_id)
  values (p_attachment_id, p_action, auth.uid());
end;
$$;

-- Private storage bucket. The database records are the authorization source;
-- a storage object is readable only after its metadata row has been registered.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'accounting-documents',
  'accounting-documents',
  false,
  10485760,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

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
    )
  );

create policy acc_document_object_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'accounting-documents'
    and public.acc_has_permission('documents.manage')
    and public.acc_document_storage_path_allowed(name)
  );

-- Allows the UI to clean up a failed upload before metadata registration.
-- Once a metadata row exists, no client policy permits physical deletion.
create policy acc_document_orphan_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'accounting-documents'
    and public.acc_has_permission('documents.manage')
    and not exists (
      select 1
        from public.acc_document_attachment attachment
       where attachment.storage_path = name
    )
  );

revoke all on function acc_archive_document_attachment(uuid, text) from public;
revoke all on function acc_log_document_access(uuid, text) from public;
revoke all on function acc_document_entity_exists(acc_document_entity, uuid) from public;
revoke all on function acc_document_storage_path_allowed(text) from public;
grant execute on function acc_archive_document_attachment(uuid, text) to authenticated;
grant execute on function acc_log_document_access(uuid, text) to authenticated;
grant execute on function acc_document_entity_exists(acc_document_entity, uuid) to authenticated;
grant execute on function acc_document_storage_path_allowed(text) to authenticated;
