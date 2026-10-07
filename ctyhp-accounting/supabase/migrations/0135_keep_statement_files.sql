-- ============================================================================
-- 1.83 — the statement file kept as evidence beside what was read from it.
--
-- OneBook read a bank's statement and kept what it read — the lines, the
-- balances, the file's name — but not the file, which stayed in the browser. A
-- reconciliation could not show the bank's own document it was reconciled
-- against. Now every statement read is kept in the Reports › Saved store
-- (migration 0101, source "Bank"), once per file, and the reconciliation or the
-- import read from it points at it.
--
-- The store is not virus-scanned (0101 says so); the app never hands a kept file
-- to the browser to open — a PDF is drawn as images, text is shown as text.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. A bank's own download (OFX, QFX, QBO, QIF) is text; it is kept as text/plain.
-- ----------------------------------------------------------------------------
alter table acc_saved_report drop constraint if exists acc_saved_report_mime_type_check;
alter table acc_saved_report add constraint acc_saved_report_mime_type_check check (mime_type in (
  'text/csv',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'text/plain'
));

update storage.buckets
   set allowed_mime_types = array[
     'text/csv',
     'application/pdf',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
     'image/png',
     'image/jpeg',
     'text/plain'
   ]::text[]
 where id = 'onebook-reports';

-- ----------------------------------------------------------------------------
-- 2. What points at a kept statement file. Only the functions below set it:
--    staff may write these rows directly, and evidence must not be set or
--    swapped without the checks and the audit line those functions make. Each
--    of them opens the trigger's gate for its own write and closes it again.
-- ----------------------------------------------------------------------------
alter table acc_statement_reconciliation
  add column if not exists statement_file_id uuid references acc_saved_report (id);
alter table acc_bank_import_batch
  add column if not exists statement_file_id uuid references acc_saved_report (id);

create index if not exists acc_statement_reconciliation_file_idx
  on acc_statement_reconciliation (statement_file_id) where statement_file_id is not null;
create index if not exists acc_bank_import_batch_file_idx
  on acc_bank_import_batch (statement_file_id) where statement_file_id is not null;

create or replace function acc_statement_file_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('acc.statement_file_change', true), '') = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.statement_file_id is null then return new; end if;
  elsif new.statement_file_id is not distinct from old.statement_file_id then
    return new;
  end if;
  raise exception 'A statement file is kept with a record only through OneBook''s own steps';
end;
$$;

drop trigger if exists acc_statement_reconciliation_file_guard on acc_statement_reconciliation;
create trigger acc_statement_reconciliation_file_guard
  before insert or update of statement_file_id on acc_statement_reconciliation
  for each row execute function acc_statement_file_guard();

drop trigger if exists acc_bank_import_batch_file_guard on acc_bank_import_batch;
create trigger acc_bank_import_batch_file_guard
  before insert or update of statement_file_id on acc_bank_import_batch
  for each row execute function acc_statement_file_guard();

-- ----------------------------------------------------------------------------
-- 3. A kept file lives in this company's own folder: '<schema>/<uuid>.<ext>'.
--    The schema is the folder because a company's functions cannot read the
--    company register, but always know which schema they run in.
-- ----------------------------------------------------------------------------
create or replace function acc_saved_report_path_is_ours(p_path text) returns boolean
language sql stable set search_path = public as $$
  select coalesce(
    p_path ~ '^[a-z0-9_]+/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z]{2,5}$'
      and split_part(p_path, '/', 1) = current_schema(),
    false);
$$;

revoke all on function acc_saved_report_path_is_ours(text) from public, anon;
grant execute on function acc_saved_report_path_is_ours(text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. Registering a saved report now refuses a path outside this company's
--    folder. Otherwise as 0101 left it.
-- ----------------------------------------------------------------------------
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
  if not acc_saved_report_path_is_ours(p_storage_path) then
    raise exception 'A report must be saved in this company''s own folder';
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

-- ----------------------------------------------------------------------------
-- 5. Keep a statement file — or find it kept already. The same file (same
--    SHA-256) is kept once; a CSV year read into twelve reconciliations is one
--    file. Two people keeping the same file at once still give one row.
-- ----------------------------------------------------------------------------
create or replace function acc_keep_statement_file(
  p_title        text,
  p_period_start date,
  p_period_end   date,
  p_file_name    text,
  p_storage_path text,
  p_mime_type    text,
  p_size_bytes   int,
  p_sha256       text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not acc_has_permission('documents.manage') then
    raise exception 'Not authorized to keep a statement file';
  end if;
  if p_mime_type not in ('application/pdf', 'text/csv', 'text/plain') then
    raise exception 'A statement file is a PDF, a CSV or a bank download';
  end if;

  select id into v_id from acc_saved_report where sha256 = p_sha256 and status = 'active';
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'reused', true);
  end if;
  if not acc_saved_report_path_is_ours(p_storage_path) then
    raise exception 'A statement file must be kept in this company''s own folder';
  end if;

  begin
    insert into acc_saved_report (
      title, source, period_start, period_end, notes,
      file_name, storage_path, mime_type, size_bytes, sha256, uploaded_by
    ) values (
      left(btrim(p_title), 200), 'bank', p_period_start, p_period_end,
      'Kept as the statement OneBook read it from.',
      btrim(p_file_name), p_storage_path, p_mime_type, p_size_bytes, p_sha256, auth.uid()
    )
    returning id into v_id;
  exception when unique_violation then
    -- Another session kept the same file a moment ago.
    select id into v_id from acc_saved_report where sha256 = p_sha256 and status = 'active';
    if v_id is null then raise; end if;
    return jsonb_build_object('id', v_id, 'reused', true);
  end;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values ('acc_saved_report', v_id, 'keep_statement_file', auth.uid(),
          jsonb_build_object('file_name', btrim(p_file_name), 'sha256', p_sha256));
  return jsonb_build_object('id', v_id, 'reused', false);
end;
$$;

revoke all on function acc_keep_statement_file(text, date, date, text, text, text, int, text) from public, anon;
grant execute on function acc_keep_statement_file(text, date, date, text, text, text, int, text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 6. A reconciliation's file goes with its statement lines.
--
--    Started from a statement (1.79, 1.81), it is made with its file. Importing
--    another statement into one in progress replaces its kept lines and its file
--    together — with no file when the new one could not be kept, so the file it
--    shows is always the one its lines were read from. Both functions gain a
--    last argument; the old shapes go first so a call cannot match two.
-- ----------------------------------------------------------------------------
create or replace function acc_statement_file_is_kept(p_file_id uuid) returns void
language plpgsql set search_path = public as $$
begin
  -- Not stable: it takes the file row FOR SHARE, so archiving the file (which
  -- takes the same row FOR UPDATE) waits for a link in progress, and a link
  -- that starts after the archive sees the file as no longer active.
  if p_file_id is not null then
    perform 1 from acc_saved_report where id = p_file_id and status = 'active' for share;
    if not found then
      raise exception 'That statement file is not kept here';
    end if;
  end if;
end;
$$;
revoke all on function acc_statement_file_is_kept(uuid) from public, anon, authenticated;

drop function if exists acc_create_reconciliation_from_statement(uuid, date, bigint, text, bigint, jsonb);
create or replace function acc_create_reconciliation_from_statement(
  p_bank_account_id uuid, p_ending_date date, p_ending_minor bigint,
  p_file_name text, p_opening_minor bigint, p_lines jsonb,
  p_statement_file_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  v_id := acc_create_reconciliation(p_bank_account_id, p_ending_date, p_ending_minor);
  perform acc_statement_file_is_kept(p_statement_file_id);
  perform set_config('acc.statement_file_change', 'on', true);
  update acc_statement_reconciliation
     set statement_ref = nullif(left(btrim(coalesce(p_file_name, '')), 255), ''),
         statement_opening_minor = p_opening_minor,
         statement_closing_minor = p_ending_minor,
         statement_file_id = p_statement_file_id,
         updated_at = now()
   where id = v_id;
  perform set_config('acc.statement_file_change', '', true);
  perform acc_recon_write_statement(v_id, p_lines);
  if p_statement_file_id is not null then
    insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
    values ('acc_statement_reconciliation', v_id, 'statement_file', auth.uid(),
            jsonb_build_object('statement_file_id', p_statement_file_id));
  end if;
  return v_id;
end;
$$;
revoke all on function acc_create_reconciliation_from_statement(uuid, date, bigint, text, bigint, jsonb, uuid) from public, anon;
grant execute on function acc_create_reconciliation_from_statement(uuid, date, bigint, text, bigint, jsonb, uuid)
  to authenticated, service_role;

drop function if exists acc_set_reconciliation_statement(uuid, text, bigint, bigint, jsonb);
create or replace function acc_set_reconciliation_statement(
  p_reconciliation_id uuid, p_file_name text, p_opening_minor bigint, p_closing_minor bigint, p_lines jsonb,
  p_statement_file_id uuid default null
) returns integer
language plpgsql security definer set search_path = public as $$
declare v_rec acc_statement_reconciliation;
begin
  if not acc_is_staff() then raise exception 'Not authorized'; end if;
  perform acc_statement_file_is_kept(p_statement_file_id);
  select * into v_rec from acc_statement_reconciliation where id = p_reconciliation_id for update;
  if not found then raise exception 'Reconciliation not found'; end if;
  if v_rec.status <> 'in_progress' then raise exception 'Reconciliation is not in progress'; end if;
  perform set_config('acc.statement_file_change', 'on', true);
  update acc_statement_reconciliation
     set statement_ref = nullif(left(btrim(coalesce(p_file_name, '')), 255), ''),
         statement_opening_minor = p_opening_minor,
         statement_closing_minor = p_closing_minor,
         statement_file_id = p_statement_file_id,
         updated_at = now()
   where id = p_reconciliation_id;
  perform set_config('acc.statement_file_change', '', true);
  insert into acc_audit_log (table_name, record_id, action, actor_id, before_json, after_json)
    values ('acc_statement_reconciliation', p_reconciliation_id, 'update', auth.uid(),
            jsonb_build_object('statement_file_id', v_rec.statement_file_id),
            jsonb_build_object('statement_file_id', p_statement_file_id));
  return acc_recon_write_statement(p_reconciliation_id, p_lines);
end;
$$;
revoke all on function acc_set_reconciliation_statement(uuid, text, bigint, bigint, jsonb, uuid) from public, anon;
grant execute on function acc_set_reconciliation_statement(uuid, text, bigint, bigint, jsonb, uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 7. Attach the statement later — to a reconciliation that has none, in
--    progress or completed: attaching evidence changes none of its figures.
--    The app checks first that the file reads to this reconciliation's
--    statement; this function sets a file only where there is none.
--    And an import's file, set once.
-- ----------------------------------------------------------------------------
create or replace function acc_link_reconciliation_statement_file(p_reconciliation_id uuid, p_file_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_rec acc_statement_reconciliation;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to change a reconciliation';
  end if;
  if p_file_id is null then raise exception 'Choose the statement file'; end if;
  perform acc_statement_file_is_kept(p_file_id);
  select * into v_rec from acc_statement_reconciliation where id = p_reconciliation_id for update;
  if not found then raise exception 'Reconciliation not found'; end if;
  if v_rec.statement_file_id = p_file_id then return; end if;
  if v_rec.statement_file_id is not null then
    raise exception 'This reconciliation already has its statement file';
  end if;

  perform set_config('acc.statement_file_change', 'on', true);
  update acc_statement_reconciliation
     set statement_file_id = p_file_id, updated_at = now()
   where id = p_reconciliation_id;
  perform set_config('acc.statement_file_change', '', true);

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values ('acc_statement_reconciliation', p_reconciliation_id, 'statement_file', auth.uid(),
          jsonb_build_object('statement_file_id', p_file_id));
end;
$$;

create or replace function acc_link_import_batch_statement_file(p_batch_id uuid, p_file_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_batch acc_bank_import_batch;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to change a statement import';
  end if;
  if p_file_id is null then raise exception 'Choose the statement file'; end if;
  perform acc_statement_file_is_kept(p_file_id);
  select * into v_batch from acc_bank_import_batch where id = p_batch_id for update;
  if not found then raise exception 'Statement import not found'; end if;
  if v_batch.statement_file_id = p_file_id then return; end if;
  if v_batch.statement_file_id is not null then
    raise exception 'This import already has its statement file';
  end if;

  perform set_config('acc.statement_file_change', 'on', true);
  update acc_bank_import_batch set statement_file_id = p_file_id where id = p_batch_id;
  perform set_config('acc.statement_file_change', '', true);

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values ('acc_bank_import_batch', p_batch_id, 'statement_file', auth.uid(),
          jsonb_build_object('statement_file_id', p_file_id));
end;
$$;

revoke all on function acc_link_reconciliation_statement_file(uuid, uuid) from public, anon;
grant execute on function acc_link_reconciliation_statement_file(uuid, uuid) to authenticated, service_role;
revoke all on function acc_link_import_batch_statement_file(uuid, uuid) from public, anon;
grant execute on function acc_link_import_batch_statement_file(uuid, uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 8. A file that is a reconciliation's or an import's statement is not archived
--    away. Otherwise as 0101 left it.
-- ----------------------------------------------------------------------------
create or replace function acc_archive_saved_report(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_date date;
begin
  if not acc_has_permission('documents.manage') then
    raise exception 'Not authorized to archive a report';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Say why this report is being archived';
  end if;

  -- Lock the file row first: a link in progress takes the same row for share
  -- (acc_statement_file_is_kept), so a link and an archive cannot both pass.
  perform 1 from acc_saved_report where id = p_id and status = 'active' for update;
  if not found then
    raise exception 'Report not found, or already archived';
  end if;

  select statement_ending_date into v_date
    from acc_statement_reconciliation where statement_file_id = p_id
   order by statement_ending_date desc limit 1;
  if v_date is not null then
    raise exception 'This file is the statement of the reconciliation to % — it stays',
      to_char(v_date, 'Mon FMDD, YYYY');
  end if;
  select imported_at::date into v_date
    from acc_bank_import_batch where statement_file_id = p_id
   order by imported_at desc limit 1;
  if v_date is not null then
    raise exception 'This file is the statement imported on % — it stays',
      to_char(v_date, 'Mon FMDD, YYYY');
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

-- ----------------------------------------------------------------------------
-- 9. Statement imports list their file. A returns-table function cannot change
--    shape in place, so the old one goes first. Otherwise as 0109 left it.
-- ----------------------------------------------------------------------------
drop function if exists acc_bank_statement_imports(uuid);

create or replace function acc_bank_statement_imports(p_bank_account_id uuid default null)
returns table (
  id uuid, bank_account_id uuid, account_code text, account_name text,
  filename text, row_count int, lines_here int, locked_lines int,
  imported_at timestamptz, status text, voided_at timestamptz, void_reason text,
  statement_file_id uuid
)
language sql stable security definer set search_path = public as $$
  select b.id, b.bank_account_id, a.account_code, a.name,
         b.filename, b.row_count,
         (select count(*)::int from acc_bank_transaction t where t.import_batch_id = b.id),
         acc_bank_import_batch_locked_lines(b.id),
         b.imported_at, b.status, b.voided_at, b.void_reason,
         b.statement_file_id
    from acc_bank_import_batch b
    join acc_bank_account ba on ba.id = b.bank_account_id
    join acc_account a on a.id = ba.account_id
   where p_bank_account_id is null or b.bank_account_id = p_bank_account_id
   order by b.imported_at desc
   limit 20;
$$;

revoke all on function acc_bank_statement_imports(uuid) from public, anon;
grant execute on function acc_bank_statement_imports(uuid) to authenticated, service_role;
