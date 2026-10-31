-- ============================================================================
-- 0183  Tighter rules from the 31 October review (2.94)
--
-- 1. Feedback is filed by the company's own people. A report, its attachments
--    and the files behind them need a role in the company they are filed in.
--    A new report starts untriaged and without a screenshot (the server links
--    its picture afterwards, as it always has). A report's folder takes one
--    screenshot and at most five attachments, as the dialog does, and an
--    attachment row names a file in its own report's folder.
-- 2. Manage users and Manage permissions are for admins only. Either one lets
--    its holder hand out every other permission, so the matrix stops offering
--    them to other roles, and a grant to another role is withdrawn. Every
--    company has them on admin alone today, as they were seeded.
-- 3. Tidying finished work is staff work. acc_retire_work_items still runs
--    whenever a work surface opens, but only an admin's or an accountant's
--    visit retires anything; for anyone else it does nothing.
-- 4. The two-step entries in the audit log record what happened.
--    acc_record_two_step_off and acc_record_mfa_reset refuse while the person
--    still has a verified second step, so an entry cannot be written for a
--    removal that did not happen.
-- 5. Questions to the model are counted (global): onebook.take_ai_turn lets
--    each person ask 60 an hour, counted in the database so it holds across
--    every server.
-- ============================================================================
set search_path = public;

-- ----------------------------------------------------------------------------
-- 1. Feedback.
-- ----------------------------------------------------------------------------
drop policy if exists acc_feedback_report_insert on acc_feedback_report;
create policy acc_feedback_report_insert on acc_feedback_report
  for insert to authenticated
  with check (
    (select acc_current_role()) is not null
    and reporter_id = auth.uid()
    and status = 'new'
    and triaged_by is null
    and triaged_at is null
    and triage_note is null
    and screenshot_path is null
    and length(page_url) <= 2048
    and length(page_route) <= 512
    and length(page_title) <= 512
  );

drop policy if exists acc_feedback_attachment_insert on acc_feedback_attachment;
create policy acc_feedback_attachment_insert on acc_feedback_attachment
  for insert to authenticated
  with check (
    (select acc_current_role()) is not null
    and uploaded_by = auth.uid()
    and starts_with(storage_path, report_id::text || '/')
    and exists (
      select 1 from acc_feedback_report report
       where report.id = report_id and report.reporter_id = auth.uid()
    )
  );

/**
 * A screenshot goes into the folder of a report the uploader filed, in
 * whichever company it was filed, while that report has no screenshot yet and
 * its folder is empty. Global: one storage table serves every company.
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
  if exists (select 1 from storage.objects o
              where o.bucket_id = 'feedback-screenshots'
                and starts_with(o.name, v_parts[1] || '/')) then
    return false;
  end if;
  for v_schema in
    select schema_name from onebook.company where status = 'active' order by display_order
  loop
    execute format(
      'select exists (select 1 from %I.acc_feedback_report
                       where id = $1 and reporter_id = auth.uid() and screenshot_path is null)', v_schema)
      into v_found using v_parts[1]::uuid;
    if v_found then return true; end if;
  end loop;
  return false;
end;
$$;

/**
 * An attachment goes into the folder of a report the uploader filed, in
 * whichever company it was filed, up to the five files the dialog allows.
 * Global, like the screenshot rule.
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
  if (select count(*) from storage.objects o
       where o.bucket_id = 'feedback-attachments'
         and starts_with(o.name, v_parts[1] || '/')) >= 5 then
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

-- ----------------------------------------------------------------------------
-- 2. The two permissions that hand out the others.
-- ----------------------------------------------------------------------------
update acc_permission set min_role = 'admin'
 where key in ('users.manage', 'permissions.manage');

update acc_role_permission rp
   set allowed = false, updated_at = now()
  from acc_permission p
 where p.key = rp.permission_key
   and p.key in ('users.manage', 'permissions.manage')
   and rp.allowed
   and not acc_role_meets(rp.role, p.min_role);

-- ----------------------------------------------------------------------------
-- 3. Retiring finished work.
-- ----------------------------------------------------------------------------
create or replace function acc_retire_work_items(p_live_keys text[], p_prefixes text[])
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  if acc_current_role() is null then
    raise exception 'Not authorized';
  end if;
  -- Retiring forgets what people decided about work that has gone (its owner,
  -- a dismissal, a snooze). Only staff opening a surface does the tidy-up.
  if not acc_is_staff() then
    return 0;
  end if;

  update acc_work_item_state s
     set lifecycle = 'resolved', resolved_at = now()
   where s.lifecycle <> 'resolved'
     and not (s.work_key = any (coalesce(p_live_keys, array[]::text[])))
     and exists (
       select 1
         from unnest(coalesce(p_prefixes, array[]::text[])) p
        where length(p) > 0 and starts_with(s.work_key, p)
     );
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function acc_retire_work_items(text[], text[]) from public, anon;
grant execute on function acc_retire_work_items(text[], text[]) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. Two-step entries in the audit log.
-- ----------------------------------------------------------------------------
create or replace function acc_record_two_step_off(p_removed int)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if acc_current_role() is null then
    raise exception 'Not authorized: you are not a member of this company' using errcode = '42501';
  end if;
  if exists (select 1 from auth.mfa_factors f
              where f.user_id = auth.uid() and f.status = 'verified') then
    raise exception 'Two-step sign-in is still on for this account' using errcode = '22023';
  end if;
  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values ('acc_app_user', auth.uid(), 'mfa_off', auth.uid(),
          jsonb_build_object('factors_removed', least(greatest(coalesce(p_removed, 0), 0), 10)));
end;
$$;

revoke all on function acc_record_two_step_off(int) from public, anon;
grant execute on function acc_record_two_step_off(int) to authenticated;

create or replace function acc_record_mfa_reset(p_user_id uuid, p_reason text, p_removed int)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform acc_mfa_reset_check(p_user_id, p_reason);
  if exists (select 1 from auth.mfa_factors f
              where f.user_id = p_user_id and f.status = 'verified') then
    raise exception 'That person still has two-step sign-in' using errcode = '22023';
  end if;
  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values ('acc_app_user', p_user_id, 'mfa_reset', auth.uid(),
          jsonb_build_object('reason', btrim(p_reason),
                             'factors_removed', least(greatest(coalesce(p_removed, 0), 0), 10)));
end;
$$;

revoke all on function acc_record_mfa_reset(uuid, text, int) from public, anon;
grant execute on function acc_record_mfa_reset(uuid, text, int) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Questions to the model (global).
-- ----------------------------------------------------------------------------
create table if not exists onebook.ai_request (
  user_id  uuid not null references auth.users (id) on delete cascade,
  asked_at timestamptz not null default now()
);
create index if not exists ai_request_user_asked_idx on onebook.ai_request (user_id, asked_at);
alter table onebook.ai_request enable row level security;
revoke all on onebook.ai_request from anon, authenticated;

/**
 * Counts one question for the person asking, or refuses it once they have
 * asked 60 in the past hour. Two questions at once from the same person wait
 * for each other, so both cannot be the sixtieth.
 */
create or replace function onebook.take_ai_turn()
returns boolean
language plpgsql security definer set search_path = onebook, public as $$
declare
  v_user uuid := auth.uid();
  v_used int;
begin
  if v_user is null then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('onebook.ai_request:' || v_user::text, 0));
  delete from onebook.ai_request where user_id = v_user and asked_at < now() - interval '1 hour';
  select count(*) into v_used from onebook.ai_request where user_id = v_user;
  if v_used >= 60 then return false; end if;
  insert into onebook.ai_request (user_id) values (v_user);
  return true;
end;
$$;

revoke all on function onebook.take_ai_turn() from public, anon;
grant execute on function onebook.take_ai_turn() to authenticated;

notify pgrst, 'reload schema';
