-- ============================================================================
-- 0180  What the close checklist said when a month was closed (2.84)
--
-- The month-end checklist is worked out from the books each time it is read:
-- trial balance, control accounts, drafts, bank and card reconciliations,
-- approvals, holding accounts and the rest. Nothing of it was kept. Once a
-- month was closed, nobody could say which checks were complete when it was
-- closed and which were waved through, and the Month-End Close Log said so.
--
-- A close can now carry the checklist as it stood when it was closed, kept on
-- the close's own event (acc_period_event, which already records who closed
-- it, when and why). acc_close_period is unchanged: the new
-- acc_close_period_with_checklist calls it, with all of its checks, then puts
-- the checklist on the close event it has just written, in the same
-- transaction. Either the month is closed with its checklist, or nothing
-- changes.
--
-- The checklist is what the closing screen worked out and showed; the
-- database checks its shape, not its verdicts, which are the application's to
-- work out. A close made some other way keeps no checklist, and the log says
-- that rather than inventing one.
-- ============================================================================
set search_path = public;

alter table acc_period_event
  add column if not exists checklist jsonb;

alter table acc_period_event
  drop constraint if exists acc_period_event_checklist_shape;
alter table acc_period_event
  add constraint acc_period_event_checklist_shape check (
    checklist is null
    or (event = 'close' and jsonb_typeof(checklist) = 'array' and pg_column_size(checklist) <= 65536)
  );

create or replace function acc_close_period_with_checklist(
  p_period_id     uuid,
  p_reason        text,
  p_variance_note text,
  p_checklist     jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_step   jsonb;
  v_event  uuid;
  v_before uuid[];
begin
  -- The caller first, as acc_close_period checks it: nobody without the right to
  -- close learns anything else about the checklist or the period.
  if not acc_is_staff() then raise exception 'Not authorized to close a period'; end if;
  if not acc_has_permission('period.close') then
    raise exception 'You do not have permission to close a period';
  end if;
  if p_checklist is null or jsonb_typeof(p_checklist) <> 'array'
     or jsonb_array_length(p_checklist) = 0 or jsonb_array_length(p_checklist) > 40 then
    raise exception 'A close checklist is a list of between 1 and 40 steps';
  end if;
  for v_step in select value from jsonb_array_elements(p_checklist) loop
    if jsonb_typeof(v_step) <> 'object'
       or coalesce(btrim(v_step ->> 'key'), '') = ''
       or coalesce(btrim(v_step ->> 'title'), '') = ''
       or coalesce(v_step ->> 'status', '') not in ('complete', 'outstanding', 'not-applicable', 'unavailable') then
      raise exception 'Each close checklist step needs a key, a title and a status';
    end if;
  end loop;

  -- The close events already there, so the one acc_close_period writes is
  -- known by being new, not by its time: every event of one transaction has
  -- the same created_at.
  select coalesce(array_agg(id), '{}') into v_before
    from acc_period_event
   where period_id = p_period_id and event = 'close';

  -- Every rule about closing stays where it is: permission, reason, the gate.
  perform acc_close_period(p_period_id, p_reason, p_variance_note);

  select id into v_event
    from acc_period_event
   where period_id = p_period_id and event = 'close' and not (id = any (v_before));
  if v_event is null then
    raise exception 'The close was not recorded, so its checklist has nowhere to go';
  end if;
  update acc_period_event set checklist = p_checklist where id = v_event;
  return v_event;
end;
$$;

revoke all on function acc_close_period_with_checklist(uuid, text, text, jsonb) from public, anon;
grant execute on function acc_close_period_with_checklist(uuid, text, text, jsonb) to authenticated;
