-- Staff feedback: bug reports and improvement suggestions filed from any page,
-- with the screenshot that shows what the reporter saw.
--
-- Reports are evidence: once filed, the kind, description, page context and
-- screenshot are immutable. Only the triage status moves, and only through
-- acc_set_feedback_status, which audits every move.

create type acc_feedback_kind as enum ('broken', 'suggestion');
create type acc_feedback_status as enum ('new', 'reviewing', 'resolved', 'declined');

create table acc_feedback_report (
  id              uuid primary key default gen_random_uuid(),
  kind            acc_feedback_kind not null,
  description     text check (description is null or length(description) <= 4000),
  status          acc_feedback_status not null default 'new',
  page_url        text not null,
  page_route      text not null,
  page_title      text not null default '',
  viewport_width  int not null check (viewport_width > 0),
  viewport_height int not null check (viewport_height > 0),
  -- Storage path inside the feedback-screenshots bucket, or null when the
  -- reporter chose "Don't include the screenshot".
  screenshot_path text,
  reporter_id     uuid references auth.users (id),
  triaged_by      uuid references auth.users (id),
  triaged_at      timestamptz,
  triage_note     text check (triage_note is null or length(triage_note) <= 2000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index acc_feedback_report_status_idx on acc_feedback_report (status, created_at desc);
create index acc_feedback_report_reporter_idx on acc_feedback_report (reporter_id);

-- ----------------------------------------------------------------------------
-- Permissions. During the test period every role may read the queue so testers
-- see each other's reports; only an administrator may change a status.
-- ----------------------------------------------------------------------------
insert into acc_permission (key, label, category, description, is_enforced) values
  ('feedback.read',   'Read the feedback queue', 'Governance',
   'View bug reports and suggestions filed by staff, including screenshots', true),
  ('feedback.triage', 'Triage feedback',         'Governance',
   'Move a report between the New, Reviewing, Resolved and Declined queues', true)
on conflict (key) do nothing;

insert into acc_role_permission (role, permission_key, allowed)
select r.role, p.key, case p.key
         when 'feedback.read' then true            -- test period: everyone reads
         else r.role = 'admin'                     -- triage stays with admin
       end
  from (select unnest(enum_range(null::acc_app_role)) as role) r
 cross join (values ('feedback.read'), ('feedback.triage')) as p(key)
 where not exists (
   select 1 from acc_role_permission rp
    where rp.role = r.role and rp.permission_key = p.key
 );

-- ----------------------------------------------------------------------------
-- A filed report is evidence. Anyone signed in may file one; nobody may edit
-- what it says afterwards.
-- ----------------------------------------------------------------------------
create or replace function acc_block_feedback_edit() returns trigger
language plpgsql as $$
begin
  if new.kind is distinct from old.kind
     or new.description is distinct from old.description
     or new.page_url is distinct from old.page_url
     or new.page_route is distinct from old.page_route
     or new.viewport_width is distinct from old.viewport_width
     or new.viewport_height is distinct from old.viewport_height
     or new.screenshot_path is distinct from old.screenshot_path
     or new.reporter_id is distinct from old.reporter_id
     or new.created_at is distinct from old.created_at then
    raise exception 'A filed report is immutable; only its triage status may change';
  end if;
  return new;
end;
$$;

create trigger acc_feedback_report_immutable
  before update on acc_feedback_report
  for each row execute function acc_block_feedback_edit();

-- Master-data style atomic auditing, same function the 0058 triggers use.
create trigger acc_feedback_report_atomic_audit
  after insert or update or delete on acc_feedback_report
  for each row execute function acc_audit_row_change();

alter table acc_feedback_report enable row level security;

-- Filing is open to anyone signed in: a tester who cannot report a bug will
-- simply not report it. The row records who filed it.
create policy acc_feedback_report_insert on acc_feedback_report
  for insert to authenticated
  with check (reporter_id = auth.uid() and status = 'new');

create policy acc_feedback_report_read on acc_feedback_report
  for select to authenticated
  using (acc_has_permission('feedback.read') or reporter_id = auth.uid());

-- No update or delete policy: status changes go through the RPC below, which
-- runs as the definer and checks the permission itself.

-- ----------------------------------------------------------------------------
-- The one path that moves a report between queues.
-- ----------------------------------------------------------------------------
create or replace function acc_set_feedback_status(
  p_report_id uuid,
  p_status    acc_feedback_status,
  p_note      text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_from acc_feedback_status;
begin
  if not acc_has_permission('feedback.triage') then
    raise exception 'feedback.triage permission is required to move a report';
  end if;

  select status into v_from from acc_feedback_report where id = p_report_id for update;
  if not found then raise exception 'Feedback report not found'; end if;

  if v_from = p_status then
    raise exception 'This report is already %', p_status;
  end if;
  -- Mirrors nextStatuses() in lib/domain/feedback.ts. New is arrival order, not
  -- a state to re-enter.
  if p_status = 'new'
     or (v_from = 'reviewing' and p_status not in ('resolved', 'declined'))
     or (v_from in ('resolved', 'declined') and p_status <> 'reviewing') then
    raise exception 'Cannot move a report from % to %', v_from, p_status;
  end if;

  update acc_feedback_report
     set status = p_status,
         triaged_by = auth.uid(),
         triaged_at = now(),
         triage_note = coalesce(p_note, triage_note),
         updated_at = now()
   where id = p_report_id;
end;
$$;

revoke all on function acc_set_feedback_status(uuid, acc_feedback_status, text) from public;
grant execute on function acc_set_feedback_status(uuid, acc_feedback_status, text) to authenticated;

-- ----------------------------------------------------------------------------
-- Private screenshot bucket. Path is <report id>/<uuid>.png, so an object can
-- only belong to a report that exists.
-- ----------------------------------------------------------------------------
create or replace function acc_feedback_screenshot_path_allowed(p_name text)
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
  if v_parts[2] !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$' then
    return false;
  end if;
  return exists (select 1 from acc_feedback_report where id = v_parts[1]::uuid);
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feedback-screenshots', 'feedback-screenshots', false, 5242880,
        array['image/png']::text[])
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy acc_feedback_object_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'feedback-screenshots'
    and public.acc_feedback_screenshot_path_allowed(name)
  );

-- A screenshot of an accounting page can show customer names and amounts, so
-- reading one needs the same permission as reading the queue.
create policy acc_feedback_object_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'feedback-screenshots'
    and (
      public.acc_has_permission('feedback.read')
      or exists (
        select 1 from public.acc_feedback_report report
         where report.screenshot_path = storage.objects.name
           and report.reporter_id = auth.uid()
      )
    )
  );

notify pgrst, 'reload schema';
