-- ============================================================================
-- 0188  OCR jobs: a scanned statement read by the company's own OCR server (3.02)
--
-- A scanned statement PDF holds no text, so Import statement refused it. The
-- company now runs an OCR model on a GPU machine inside its own network. That
-- machine cannot be reached from the internet, so it asks OneBook for work: it
-- claims a job, downloads the kept file through a short-lived signed URL, reads
-- each page and sends the text back. OneBook turns the text into statement
-- lines, and the user reviews them in the same dialog as any other PDF.
--
-- One queue for every company, in `onebook`, as company_request (0097) is: the
-- worker asks one place, never a list of schemas. A job names the company's
-- schema and the kept statement file it reads (acc_saved_report, source
-- 'bank', kept by acc_keep_statement_file in 0135).
--
--   request_ocr_job      a member holding documents.manage asks for a kept
--                        file to be read; at most three open jobs per company
--   ocr_job_status       the person who asked reads where the job is and,
--                        once it is done, the text of every page
--   ocr_worker_online    whether the OCR server has asked for work lately
--   claim_ocr_job        service role: the oldest waiting job, or one whose
--                        worker stopped before its lease ran out
--   report_ocr_progress  service role: pages read so far; extends the lease
--   complete_ocr_job     service role: the text of every page
--   fail_ocr_job         service role: why the file could not be read
--
-- Nothing existing is changed. Every statement names `onebook.`, so the runner
-- applies this file once and never replays it into a company schema.
-- ============================================================================

create table if not exists onebook.ocr_job (
  id               uuid primary key default gen_random_uuid(),
  schema_name      text not null references onebook.company (schema_name),
  saved_report_id  uuid not null,
  storage_path     text not null,
  mime_type        text not null
                   check (mime_type in ('application/pdf', 'image/png', 'image/jpeg')),
  purpose          text not null default 'bank_statement'
                   check (purpose in ('bank_statement')),
  status           text not null default 'pending'
                   check (status in ('pending', 'running', 'done', 'failed')),
  attempts         int  not null default 0,
  pages_total      int  check (pages_total between 1 and 20),
  pages_done       int  not null default 0 check (pages_done >= 0),
  result           jsonb check (result is null or octet_length(result::text) <= 5000000),
  error            text,
  requested_by     uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  started_at       timestamptz,
  lease_until      timestamptz,
  finished_at      timestamptz,
  -- The file always sits in the folder of the company that asked.
  check (storage_path !~ '\.\.' and starts_with(storage_path, schema_name || '/')),
  check (status <> 'done' or result is not null)
);

create index if not exists onebook_ocr_job_queue_idx
  on onebook.ocr_job (status, created_at);
create index if not exists onebook_ocr_job_file_idx
  on onebook.ocr_job (schema_name, saved_report_id);

-- One row: when the OCR server last asked for work, and which version it runs.
create table if not exists onebook.ocr_worker (
  id            boolean primary key default true check (id),
  last_seen_at  timestamptz not null default now(),
  version       text check (length(version) <= 100)
);

-- No policy: an application session reaches these tables only through the
-- functions below, and the worker only through the service role.
alter table onebook.ocr_job    enable row level security;
alter table onebook.ocr_worker enable row level security;
revoke all on onebook.ocr_job, onebook.ocr_worker from public, anon, authenticated;
grant  all on onebook.ocr_job, onebook.ocr_worker to service_role;

/**
 * Ask for a kept statement file to be read.
 *
 * The caller must be a member of the company and hold documents.manage there,
 * the permission that kept the file in the first place. Asking twice for the
 * same file returns your own job, already waiting, running or done, so a second
 * click never reads the file twice. Another member asking for the same file
 * gets a job of their own, since only the person who asked can read a job. A
 * failed job can be asked for again.
 */
create or replace function onebook.request_ocr_job(p_schema text, p_saved_report_id uuid)
returns uuid
language plpgsql security definer set search_path = onebook, public as $$
declare
  v_user    uuid := auth.uid();
  v_allowed boolean;
  v_path    text;
  v_mime    text;
  v_id      uuid;
begin
  if v_user is null then
    raise exception 'Sign in to read a scanned statement';
  end if;

  -- One request per company at a time, so two clicks cannot duplicate a job or pass the cap of three.
  perform pg_advisory_xact_lock(hashtext('onebook.ocr_job:' || p_schema));

  if not exists (
    select 1
      from onebook.company c
      join onebook.company_member m on m.company_id = c.id
     where c.schema_name = p_schema and c.status = 'active' and m.user_id = v_user
  ) then
    raise exception 'You are not a member of this company';
  end if;

  -- p_schema is now a registered company's schema, and %I quotes it anyway.
  execute format('select %I.acc_has_permission($1)', p_schema)
     into v_allowed using 'documents.manage';
  if not coalesce(v_allowed, false) then
    raise exception 'You do not have permission to keep statement files';
  end if;

  execute format(
    'select storage_path, mime_type from %I.acc_saved_report
      where id = $1 and status = ''active'' and source = ''bank''', p_schema)
     into v_path, v_mime using p_saved_report_id;
  if v_path is null then
    raise exception 'That statement file is not kept in this company';
  end if;
  if v_mime not in ('application/pdf', 'image/png', 'image/jpeg') then
    raise exception 'Only a PDF or an image can be read by OCR';
  end if;

  select j.id into v_id
    from onebook.ocr_job j
   where j.schema_name = p_schema and j.saved_report_id = p_saved_report_id
     and j.requested_by = v_user
     and j.status in ('pending', 'running', 'done')
   order by j.created_at desc
   limit 1;
  if v_id is not null then
    return v_id;
  end if;

  if (select count(*) from onebook.ocr_job j
       where j.schema_name = p_schema and j.status in ('pending', 'running')) >= 3 then
    raise exception 'This company already has three files waiting to be read; try again when one is done';
  end if;

  insert into onebook.ocr_job (schema_name, saved_report_id, storage_path, mime_type, requested_by)
  values (p_schema, p_saved_report_id, v_path, v_mime, v_user)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function onebook.request_ocr_job(text, uuid) from public, anon;
grant execute on function onebook.request_ocr_job(text, uuid) to authenticated;

/**
 * Where a job is. Only the person who asked sees it, and only while still a
 * member of the company; the text comes back only once the job is done.
 */
create or replace function onebook.ocr_job_status(p_id uuid)
returns table (
  id          uuid,
  status      text,
  pages_done  int,
  pages_total int,
  result      jsonb,
  error       text,
  created_at  timestamptz,
  finished_at timestamptz
)
language sql stable security definer set search_path = onebook, public as $$
  select j.id, j.status, j.pages_done, j.pages_total,
         case when j.status = 'done' then j.result end,
         j.error, j.created_at, j.finished_at
    from onebook.ocr_job j
    join onebook.company c        on c.schema_name = j.schema_name and c.status = 'active'
    join onebook.company_member m on m.company_id = c.id and m.user_id = auth.uid()
   where j.id = p_id
     and j.requested_by = auth.uid();
$$;

revoke all on function onebook.ocr_job_status(uuid) from public, anon;
grant execute on function onebook.ocr_job_status(uuid) to authenticated;

/** Whether the OCR server has asked for work in the last two minutes. */
create or replace function onebook.ocr_worker_online()
returns boolean
language sql stable security definer set search_path = onebook, public as $$
  select coalesce(
    (select w.last_seen_at > now() - interval '2 minutes' from onebook.ocr_worker w),
    false);
$$;

revoke all on function onebook.ocr_worker_online() from public, anon;
grant execute on function onebook.ocr_worker_online() to authenticated, service_role;

/**
 * The next job for the worker, oldest first.
 *
 * Asking is also the worker's heartbeat. A job whose lease ran out (the worker
 * stopped mid-file) is handed out again, up to three attempts; after the third
 * it fails with a reason the person who asked can read. `skip locked` keeps two
 * workers from taking the same job.
 */
create or replace function onebook.claim_ocr_job(p_worker_version text)
returns table (
  id           uuid,
  schema_name  text,
  storage_path text,
  mime_type    text,
  attempts     int
)
language plpgsql security definer set search_path = onebook, public as $$
#variable_conflict use_column
declare
  v_id uuid;
begin
  insert into onebook.ocr_worker (id, last_seen_at, version)
  values (true, now(), left(p_worker_version, 100))
  on conflict on constraint ocr_worker_pkey
  do update set last_seen_at = now(), version = excluded.version;

  update onebook.ocr_job j
     set status = 'failed', finished_at = now(), lease_until = null,
         error = 'The OCR server stopped three times while reading this file.'
   where j.status = 'running' and j.lease_until < now() and j.attempts >= 3;

  select j.id into v_id
    from onebook.ocr_job j
   where j.status = 'pending'
      or (j.status = 'running' and j.lease_until < now())
   order by j.created_at
   for update skip locked
   limit 1;
  if v_id is null then
    return;
  end if;

  update onebook.ocr_job j
     set status = 'running', started_at = now(), lease_until = now() + interval '10 minutes',
         attempts = j.attempts + 1, pages_done = 0, error = null
   where j.id = v_id
  returning j.id, j.schema_name, j.storage_path, j.mime_type, j.attempts
       into id, schema_name, storage_path, mime_type, attempts;
  return next;
end;
$$;

/** Pages read so far. Each report gives the worker another ten minutes. */
create or replace function onebook.report_ocr_progress(p_id uuid, p_pages_done int, p_pages_total int)
returns boolean
language sql security definer set search_path = onebook, public as $$
  with u as (
    update onebook.ocr_job
       set pages_done = greatest(0, p_pages_done), pages_total = p_pages_total,
           lease_until = now() + interval '10 minutes'
     where id = p_id and status = 'running'
    returning 1)
  select exists (select 1 from u);
$$;

/** The text of every page, as the worker read it. */
create or replace function onebook.complete_ocr_job(p_id uuid, p_result jsonb)
returns boolean
language sql security definer set search_path = onebook, public as $$
  with u as (
    update onebook.ocr_job
       set status = 'done', result = p_result, finished_at = now(), lease_until = null, error = null
     where id = p_id and status = 'running'
    returning 1)
  select exists (select 1 from u);
$$;

/** Why the file could not be read, in words the person who asked can act on. */
create or replace function onebook.fail_ocr_job(p_id uuid, p_error text)
returns boolean
language sql security definer set search_path = onebook, public as $$
  with u as (
    update onebook.ocr_job
       set status = 'failed', finished_at = now(), lease_until = null,
           error = left(coalesce(nullif(btrim(p_error), ''), 'The OCR server could not read this file.'), 2000)
     where id = p_id and status = 'running'
    returning 1)
  select exists (select 1 from u);
$$;

revoke all on function onebook.claim_ocr_job(text)                    from public, anon, authenticated;
revoke all on function onebook.report_ocr_progress(uuid, int, int)    from public, anon, authenticated;
revoke all on function onebook.complete_ocr_job(uuid, jsonb)          from public, anon, authenticated;
revoke all on function onebook.fail_ocr_job(uuid, text)               from public, anon, authenticated;
grant execute on function onebook.claim_ocr_job(text)                 to service_role;
grant execute on function onebook.report_ocr_progress(uuid, int, int) to service_role;
grant execute on function onebook.complete_ocr_job(uuid, jsonb)       to service_role;
grant execute on function onebook.fail_ocr_job(uuid, text)            to service_role;
