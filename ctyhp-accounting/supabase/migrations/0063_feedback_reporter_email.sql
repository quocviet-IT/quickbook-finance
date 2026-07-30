-- Fix: the triage queue could not show who filed a report.
--
-- 0061 recorded only reporter_id. Resolving that to a person needs auth.users,
-- which is not readable over the API, and the acc_list_users RPC is gated on
-- users.manage — while the feedback queue is readable by every role during the
-- test period. So the reviewer saw an anonymous list.
--
-- The reporter's identity at filing time is part of the evidence, so it is
-- stamped onto the row. A trigger reads it from auth.users rather than trusting
-- the client: RLS can only check that reporter_id is the caller, so an email
-- supplied in the payload could be forged by anyone posting straight to the API.

alter table acc_feedback_report
  add column if not exists reporter_email text;

create or replace function acc_stamp_feedback_reporter() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.reporter_email := (select email from auth.users where id = new.reporter_id);
  return new;
end;
$$;

drop trigger if exists acc_feedback_report_stamp_reporter on acc_feedback_report;
create trigger acc_feedback_report_stamp_reporter
  before insert on acc_feedback_report
  for each row execute function acc_stamp_feedback_reporter();

-- Backfill the reports filed before this migration.
update acc_feedback_report report
   set reporter_email = users.email
  from auth.users users
 where users.id = report.reporter_id
   and report.reporter_email is null;

-- The stamped identity is as immutable as the rest of the report.
create or replace function acc_block_feedback_edit() returns trigger
language plpgsql as $$
begin
  if new.kind is distinct from old.kind
     or new.description is distinct from old.description
     or new.page_url is distinct from old.page_url
     or new.page_route is distinct from old.page_route
     or new.viewport_width is distinct from old.viewport_width
     or new.viewport_height is distinct from old.viewport_height
     or new.reporter_id is distinct from old.reporter_id
     or new.reporter_email is distinct from old.reporter_email
     or new.created_at is distinct from old.created_at then
    raise exception 'A filed report is immutable; only its triage status may change';
  end if;

  -- One-time attach: null -> path is the upload linking itself. Anything else is
  -- an attempt to change what the report shows.
  if new.screenshot_path is distinct from old.screenshot_path
     and old.screenshot_path is not null then
    raise exception 'A report screenshot cannot be replaced or removed once attached';
  end if;

  return new;
end;
$$;

notify pgrst, 'reload schema';
