-- ============================================================================
-- 0101  Keeping a report that came from somewhere else
--
-- Asked for on the import screen, 2026-08-05: "Boss Alex want to save outside
-- report in One Book, so every time he pull it."
--
-- Importing a file posts it. This is the opposite: a report produced by another
-- product is kept exactly as it arrived and read again later. Nothing here
-- calls acc_post_entry, writes a journal line, or records a bank transaction,
-- and tests assert that rather than trusting this comment.
--
-- The bucket has no storage.objects policy for an application session, so a
-- browser cannot reach an object at all. Every transfer is authorised in the
-- application, against the company schema the request resolved, and carried by
-- a short-lived signed URL minted with the service role. That is deliberate:
-- the policies on 'accounting-documents' are global objects pinned to public.,
-- so outside the first company they consult the wrong table — a gap this
-- migration steps around rather than inherits.
-- ============================================================================

set search_path = public;

create table if not exists acc_saved_report (
  id             uuid primary key default gen_random_uuid(),
  title          text not null check (length(btrim(title)) > 0),
  source         text not null
                 check (source in ('quickbooks', 'wave', 'bank', 'spreadsheet', 'other')),
  period_start   date,
  period_end     date,
  notes          text,
  file_name      text not null check (length(btrim(file_name)) > 0),
  storage_bucket text not null default 'onebook-reports'
                 check (storage_bucket = 'onebook-reports'),
  storage_path   text not null unique check (storage_path !~ '\.\.'),
  mime_type      text not null check (mime_type in (
                   'text/csv',
                   'application/pdf',
                   'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                   'image/png',
                   'image/jpeg'
                 )),
  size_bytes     int not null check (size_bytes between 1 and 10485760),
  sha256         text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  status         text not null default 'active' check (status in ('active', 'archived')),
  uploaded_by    uuid references auth.users (id),
  uploaded_at    timestamptz not null default now(),
  archived_by    uuid references auth.users (id),
  archived_at    timestamptz,
  archive_reason text,
  check (period_end is null or period_start is null or period_end >= period_start)
);

-- The same file cannot be saved twice while a live copy is here. Archiving one
-- frees its hash, so a corrected re-issue of the same report can be saved after
-- the old copy is retired.
create unique index if not exists acc_saved_report_sha_idx
  on acc_saved_report (sha256) where status = 'active';

create index if not exists acc_saved_report_listing_idx
  on acc_saved_report (status, uploaded_at desc);

alter table acc_saved_report enable row level security;

drop policy if exists acc_saved_report_sel on acc_saved_report;
create policy acc_saved_report_sel on acc_saved_report
  for select using (acc_has_permission('documents.read'));

-- No insert, update or delete policy exists, so an application session can only
-- write this table through the two functions below.
revoke all on table acc_saved_report from public, anon;
grant select on table acc_saved_report to authenticated;
grant all    on table acc_saved_report to service_role;

/**
 * Record a report that has already been uploaded to the bucket.
 *
 * The upload was authorised when its signed URL was minted; this is where the
 * row that makes it findable is written, and where a second copy of the same
 * file is refused.
 */
create or replace function acc_register_saved_report(
  p_title        text,
  p_source       text,
  p_period_start date,
  p_period_end   date,
  p_notes        text,
  p_file_name    text,
  p_storage_path text,
  p_mime_type    text,
  p_size_bytes   int,
  p_sha256       text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not acc_has_permission('documents.manage') then
    raise exception 'Not authorized to save a report';
  end if;

  if exists (select 1 from acc_saved_report
              where sha256 = p_sha256 and status = 'active') then
    raise exception 'This report is already saved (%)',
      (select title from acc_saved_report
        where sha256 = p_sha256 and status = 'active' limit 1);
  end if;

  insert into acc_saved_report (
    title, source, period_start, period_end, notes,
    file_name, storage_path, mime_type, size_bytes, sha256, uploaded_by
  ) values (
    btrim(p_title), p_source, p_period_start, p_period_end,
    nullif(btrim(coalesce(p_notes, '')), ''),
    btrim(p_file_name), p_storage_path, p_mime_type, p_size_bytes, p_sha256, auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

/**
 * Retire a saved report.
 *
 * There is no delete. A report somebody relied on last quarter should still be
 * explicable next quarter, so it keeps its row, its reason and its actor.
 */
create or replace function acc_archive_saved_report(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not acc_has_permission('documents.manage') then
    raise exception 'Not authorized to archive a report';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Say why this report is being archived';
  end if;

  update acc_saved_report
     set status = 'archived',
         archived_by = auth.uid(),
         archived_at = now(),
         archive_reason = btrim(p_reason)
   where id = p_id and status = 'active';

  if not found then
    raise exception 'Report not found, or already archived';
  end if;
end;
$$;

revoke all on function acc_register_saved_report(text, text, date, date, text, text, text, text, int, text)
  from public, anon;
grant execute on function acc_register_saved_report(text, text, date, date, text, text, text, text, int, text)
  to authenticated, service_role;

revoke all on function acc_archive_saved_report(uuid, text) from public, anon;
grant execute on function acc_archive_saved_report(uuid, text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- The bucket. Global: one copy for the whole deployment, held back from company
-- schemas by scopeOf(). Private, and with no policy for `authenticated`, so RLS
-- denies every direct read and write from a browser session.
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'onebook-reports',
  'onebook-reports',
  false,
  10485760,
  array[
    'text/csv',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/png',
    'image/jpeg'
  ]::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
