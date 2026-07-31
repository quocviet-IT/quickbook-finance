-- ============================================================================
-- Attachments on a feedback report.
--
-- The dialog captures a screenshot of the page, which is what the *reporter*
-- was looking at. It cannot capture the vendor's PDF that disagrees with the
-- bill, the photo of the printed invoice, or the spreadsheet the numbers came
-- from — and those are what a report usually needs to be actionable.
--
-- Same evidence rule as the report itself: attachments are added while filing
-- and cannot be swapped afterwards. Only the person who filed the report may
-- attach to it, and only staff with feedback.read may open one.
-- ============================================================================

create table if not exists acc_feedback_attachment (
  id           uuid primary key default gen_random_uuid(),
  report_id    uuid not null references acc_feedback_report (id) on delete cascade,
  storage_path text not null unique,
  file_name    text not null check (length(btrim(file_name)) between 1 and 200),
  mime_type    text not null,
  size_bytes   bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_by  uuid references auth.users (id),
  created_at   timestamptz not null default now()
);
create index if not exists acc_feedback_attachment_report_idx
  on acc_feedback_attachment (report_id, created_at);

alter table acc_feedback_attachment enable row level security;

-- Only onto your own report: an attachment is part of what the reporter is
-- saying, not something a third party adds to their statement later.
drop policy if exists acc_feedback_attachment_insert on acc_feedback_attachment;
create policy acc_feedback_attachment_insert on acc_feedback_attachment
  for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and exists (
      select 1 from acc_feedback_report report
       where report.id = report_id and report.reporter_id = auth.uid()
    )
  );

drop policy if exists acc_feedback_attachment_read on acc_feedback_attachment;
create policy acc_feedback_attachment_read on acc_feedback_attachment
  for select to authenticated
  using (
    acc_has_permission('feedback.read')
    or exists (
      select 1 from acc_feedback_report report
       where report.id = report_id and report.reporter_id = auth.uid()
    )
  );

-- No update or delete policy: what a report shows cannot change after filing.

drop trigger if exists acc_feedback_attachment_atomic_audit on acc_feedback_attachment;
create trigger acc_feedback_attachment_atomic_audit
  after insert or update or delete on acc_feedback_attachment
  for each row execute function acc_audit_row_change();

-- ----------------------------------------------------------------------------
-- Private bucket. Path is <report id>/<uuid>.<ext>, and the report has to be
-- the caller's own — the same shape as the screenshot bucket, with the file
-- types a reporter actually has to hand.
-- ----------------------------------------------------------------------------
create or replace function acc_feedback_attachment_path_allowed(p_name text)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_parts text[];
begin
  v_parts := string_to_array(p_name, '/');
  if array_length(v_parts, 1) <> 2 then return false; end if;
  if v_parts[1] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  if v_parts[2] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[a-z0-9]{2,5}$' then
    return false;
  end if;
  return exists (
    select 1 from acc_feedback_report
     where id = v_parts[1]::uuid and reporter_id = auth.uid()
  );
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback-attachments', 'feedback-attachments', false, 10485760,
        array[
          'image/png', 'image/jpeg', 'image/gif', 'image/webp',
          'application/pdf', 'text/plain', 'text/csv',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ]::text[])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists acc_feedback_attachment_object_insert on storage.objects;
create policy acc_feedback_attachment_object_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'feedback-attachments'
    and public.acc_feedback_attachment_path_allowed(name)
  );

-- An attachment can hold the same customer names and amounts a screenshot can,
-- so opening one needs the permission that governs the queue.
drop policy if exists acc_feedback_attachment_object_read on storage.objects;
create policy acc_feedback_attachment_object_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'feedback-attachments'
    and (
      public.acc_has_permission('feedback.read')
      or exists (
        select 1
          from public.acc_feedback_attachment attachment
          join public.acc_feedback_report report on report.id = attachment.report_id
         where attachment.storage_path = storage.objects.name
           and report.reporter_id = auth.uid()
      )
    )
  );

notify pgrst, 'reload schema';
