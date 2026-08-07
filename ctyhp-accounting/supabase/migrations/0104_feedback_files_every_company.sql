-- ============================================================================
-- 0104  A feedback screenshot filed outside the first company
--
-- Reported 2026-08-07: screenshots stopped appearing. They were never stored.
--
-- `storage.objects` policies are global — one copy for the whole database — and
-- the guards they call were pinned to `public`. A report filed while working in
-- another company gets an id that `public.acc_feedback_report` has never heard
-- of, so the path check returned false and the upload was refused. The evidence
-- was exact: 22 of 22 reports in `public` had a screenshot, 0 of 4 in
-- `co_pc_49` did.
--
-- Each guard now asks the company register which books exist and looks in every
-- one of them. Reading is answered by the company that owns the report: its own
-- `acc_has_permission('feedback.read')`, or the reporter themself. An
-- administrator of one company therefore gains no sight of another's
-- screenshots by way of this fix.
--
-- Note for whoever changes this next: every statement here names `onebook.`, so
-- `scopeOf()` holds all of them back from company schemas and only the copy in
-- `public` is rebuilt. That is deliberate and it must stay that way — the
-- policies bind to the `public` copy, and a half-replayed migration is what the
-- first attempt at this file produced: a company schema whose guard called a
-- helper that had been held back.
-- ============================================================================

set search_path = public;

/**
 * Does any company's books hold this feedback report?
 *
 * It lives in `onebook` because that is where anything spanning companies
 * belongs — and because a statement naming `onebook.` is held back from company
 * schemas, which keeps the function and the grants that lock it on the same
 * side of that line. The first version of this file put them in `public`, where
 * the grants were replayed per company against a function that was not there.
 *
 * The register is the list of schemas; `%I` quotes each one, and `schema_name`
 * is constrained by the register to a plain identifier besides.
 */
create or replace function onebook.feedback_report_exists_anywhere(p_id uuid)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_schema text;
  v_found  boolean;
begin
  if p_id is null then return false; end if;
  for v_schema in
    select schema_name from onebook.company where status = 'active' order by display_order
  loop
    execute format(
      'select exists (select 1 from %I.acc_feedback_report where id = $1)', v_schema)
      into v_found using p_id;
    if v_found then return true; end if;
  end loop;
  return false;
end;
$$;

/**
 * May the caller read this stored file?
 *
 * Answered by the company whose report owns it: either the caller filed it, or
 * they hold `feedback.read` in that company. `p_kind` picks which table names
 * the object — the report itself for a screenshot, the attachment row for an
 * attachment.
 */
create or replace function onebook.feedback_file_readable(p_name text, p_kind text)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_schema text;
  v_ok     boolean;
begin
  if p_name is null or p_kind not in ('screenshot', 'attachment') then return false; end if;
  for v_schema in
    select schema_name from onebook.company where status = 'active' order by display_order
  loop
    if p_kind = 'screenshot' then
      execute format(
        'select exists (
           select 1 from %I.acc_feedback_report r
            where r.screenshot_path = $1
              and (r.reporter_id = auth.uid() or %I.acc_has_permission(''feedback.read''))
         )', v_schema, v_schema)
        into v_ok using p_name;
    else
      execute format(
        'select exists (
           select 1 from %I.acc_feedback_attachment a
             join %I.acc_feedback_report r on r.id = a.report_id
            where a.storage_path = $1
              and (r.reporter_id = auth.uid() or %I.acc_has_permission(''feedback.read''))
         )', v_schema, v_schema, v_schema)
        into v_ok using p_name;
    end if;
    if v_ok then return true; end if;
  end loop;
  return false;
end;
$$;

/**
 * The path shape is unchanged; only the question "does this report exist" moves
 * from one company's books to all of them.
 *
 * The register loop is written out rather than delegated, because a statement
 * that does not name `onebook.` is replayed into every company schema, where
 * the helper it would call does not exist.
 */
create or replace function acc_feedback_screenshot_path_allowed(p_name text)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_parts  text[];
  v_schema text;
  v_found  boolean;
begin
  v_parts := string_to_array(p_name, '/');
  if array_length(v_parts, 1) <> 2 then return false; end if;
  if v_parts[1] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  if v_parts[2] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$' then
    return false;
  end if;
  for v_schema in
    select schema_name from onebook.company where status = 'active' order by display_order
  loop
    execute format(
      'select exists (select 1 from %I.acc_feedback_report where id = $1)', v_schema)
      into v_found using v_parts[1]::uuid;
    if v_found then return true; end if;
  end loop;
  return false;
end;
$$;

/**
 * An attachment may only be uploaded by the person who filed the report, in
 * whichever company they filed it. That rule is unchanged; only the search is.
 */
create or replace function acc_feedback_attachment_path_allowed(p_name text)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_parts  text[];
  v_schema text;
  v_ok     boolean;
begin
  v_parts := string_to_array(p_name, '/');
  if array_length(v_parts, 1) <> 2 then return false; end if;
  if v_parts[1] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  if v_parts[2] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.[a-z0-9]{2,5}$' then
    return false;
  end if;
  for v_schema in
    select schema_name from onebook.company where status = 'active' order by display_order
  loop
    execute format(
      'select exists (select 1 from %I.acc_feedback_report
                       where id = $1 and reporter_id = auth.uid())', v_schema)
      into v_ok using v_parts[1]::uuid;
    if v_ok then return true; end if;
  end loop;
  return false;
end;
$$;

revoke all on function onebook.feedback_report_exists_anywhere(uuid) from public, anon;
grant execute on function onebook.feedback_report_exists_anywhere(uuid) to authenticated, service_role;
revoke all on function onebook.feedback_file_readable(text, text) from public, anon;
grant execute on function onebook.feedback_file_readable(text, text) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- The read policies. A screenshot of an accounting page can show customer names
-- and amounts, so the permission that governs the queue governs the file — but
-- it is now the owning company's permission, not the first company's.
--
-- `storage.objects` is global in its own right, so these policies are applied
-- once whatever else they name.
-- ----------------------------------------------------------------------------
drop policy if exists acc_feedback_object_read on storage.objects;
create policy acc_feedback_object_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'feedback-screenshots'
    and onebook.feedback_file_readable(name, 'screenshot')
  );

drop policy if exists acc_feedback_attachment_object_read on storage.objects;
create policy acc_feedback_attachment_object_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'feedback-attachments'
    and onebook.feedback_file_readable(name, 'attachment')
  );

notify pgrst, 'reload schema';
