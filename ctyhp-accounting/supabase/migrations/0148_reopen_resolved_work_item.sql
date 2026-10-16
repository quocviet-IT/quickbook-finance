-- ============================================================================
-- 0148  An item that comes back can be worked on again
--
-- When an item's exception clears, its stored state is marked `resolved` by the
-- retire. The work lists read only states that are not resolved, so when the
-- same key comes back (a bank line unmatched again, a control failing again) it
-- shows as new, with no version to send. But acc_set_work_item_state refused any
-- change to a row whose lifecycle was `resolved`, so an item that came back
-- could never be acknowledged, started, assigned, dated or dismissed.
--
-- A resolved row is now treated as no row. The screen never reads it, so it
-- sends no version: a null `p_expected_version` reopens the row in place, with
-- the lifecycle, owner, due date and reason the caller sent, and the version
-- goes up by one. A resolved row with a version is refused as changed by someone
-- else, as for any version mismatch. Every other refusal keeps its order and
-- wording.
--
-- Also drops the one-argument retire. Since 2.09 nothing calls it; the scoped
-- two-argument version from 0147 replaces it.
-- ============================================================================

set search_path = public;

/**
 * Record what a person decided about one piece of work.
 *
 * A null `p_expected_version` means "I believe there is no active row": it
 * inserts a new row, or reopens a resolved one. A version is the one the caller
 * rendered from an active row, and a row that has moved since is refused.
 */
create or replace function acc_set_work_item_state(
  p_key              text,
  p_lifecycle        text,
  p_owner_id         uuid,
  p_due_date         date,
  p_reason           text,
  p_expected_version int,
  p_blocks_close     boolean default false
) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_current  acc_work_item_state;
  v_reason   text := nullif(btrim(coalesce(p_reason, '')), '');
  v_version  int;
  v_reopened boolean := false;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to change work';
  end if;
  if length(btrim(coalesce(p_key, ''))) = 0 then
    raise exception 'A work item key is required';
  end if;

  -- The same three refusals the domain states, restated here because the
  -- screen is not the only thing that can call this.
  if p_lifecycle = 'resolved' then
    raise exception 'Work is resolved by the books, not by hand';
  end if;
  if p_lifecycle = 'dismissed' then
    if coalesce(p_blocks_close, false) then
      raise exception 'This blocks the period close and cannot be dismissed';
    end if;
    if v_reason is null then
      raise exception 'Say why this is being dismissed';
    end if;
  end if;

  -- Locked, so a second caller waits for the first and then re-reads its
  -- committed row: two people cannot both reopen the same item, and a stale
  -- version cannot win.
  select * into v_current from acc_work_item_state where work_key = p_key for update;

  if v_current.work_key is null then
    if p_expected_version is not null then
      raise exception 'This item has been changed by someone else. Reload and try again';
    end if;
    insert into acc_work_item_state (
      work_key, lifecycle, owner_id, due_date, dismiss_reason, updated_by
    ) values (
      btrim(p_key), p_lifecycle, p_owner_id, p_due_date, v_reason, auth.uid()
    )
    returning version into v_version;
  elsif v_current.lifecycle = 'resolved' then
    -- The exception cleared and has come back. The screen reads no resolved row,
    -- so it sends no version; anything else is a stale view.
    if p_expected_version is not null then
      raise exception 'This item has been changed by someone else. Reload and try again';
    end if;
    update acc_work_item_state
       set lifecycle = p_lifecycle,
           owner_id = p_owner_id,
           due_date = p_due_date,
           dismiss_reason = case when p_lifecycle = 'dismissed' then v_reason else null end,
           resolved_at = null,
           version = version + 1,
           updated_at = now(),
           updated_by = auth.uid()
     where work_key = p_key
    returning version into v_version;
    v_reopened := true;
  else
    if p_expected_version is null or v_current.version <> p_expected_version then
      raise exception 'This item has been changed by someone else. Reload and try again';
    end if;
    update acc_work_item_state
       set lifecycle = p_lifecycle,
           owner_id = p_owner_id,
           due_date = p_due_date,
           dismiss_reason = case when p_lifecycle = 'dismissed' then v_reason else null end,
           version = version + 1,
           updated_at = now(),
           updated_by = auth.uid()
     where work_key = p_key
    returning version into v_version;
  end if;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values ('acc_work_item_state', gen_random_uuid(),
          case when v_current.work_key is null then 'insert' else 'update' end,
          auth.uid(),
          jsonb_build_object('work_key', btrim(p_key), 'lifecycle', p_lifecycle,
                             'owner_id', p_owner_id, 'due_date', p_due_date,
                             'reason', v_reason)
          || case when v_reopened then jsonb_build_object('reopened', true) else '{}'::jsonb end);

  return v_version;
end $$;

revoke all on function acc_set_work_item_state(text, text, uuid, date, text, int, boolean)
  from public, anon;
grant execute on function acc_set_work_item_state(text, text, uuid, date, text, int, boolean)
  to authenticated, service_role;

drop function if exists acc_retire_work_items(text[]);
