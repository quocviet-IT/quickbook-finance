-- Fix: a report's screenshot could never be attached.
--
-- 0061 uploads the screenshot after inserting the report (the storage path guard
-- requires the report to exist), then links the path. Both halves of that link
-- were blocked: the table has no update policy, so a client write silently
-- affected zero rows, and acc_block_feedback_edit rejected any change to
-- screenshot_path. Reports were filed with the picture stored but unreferenced.
--
-- The link is now allowed exactly once, from null to a value. Swapping or
-- clearing an existing screenshot stays impossible, so the evidence rule holds:
-- what a report shows cannot be changed after it is filed. The link itself is
-- performed server-side with the service role — no client update path exists.

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
