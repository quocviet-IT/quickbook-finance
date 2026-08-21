-- ============================================================================
-- 0118  Who picked this up, and who put it down
--
-- Phase 2 of the accounting cockpit
-- (docs/superpowers/specs/2026-08-19-accounting-dashboard-redesign-design.md).
--
-- The queue on /accounting is derived from the books on every read, and that
-- does not change here. What this adds is the layer of human judgement over
-- the top: who owns a piece of work, whether they have started it, and whether
-- somebody decided it does not need doing.
--
-- **Nothing accounting-shaped lives in this table.** No amount, no document id,
-- no control figure. That is the whole reason the item stays derived: a stored
-- copy of a balance goes stale the moment somebody posts, and then the screen
-- and the ledger disagree with nobody able to say which is right. A reader
-- checking this migration can see the table holds only decisions.
--
-- **Nobody may declare an item resolved.** Resolution belongs to the books —
-- an item goes when its exception goes, and `acc_retire_work_items` marks the
-- rows whose work has disappeared. A person claiming otherwise would be making
-- a statement the ledger contradicts.
-- ============================================================================

set search_path = public;

create table if not exists acc_work_item_state (
  -- The item's own deterministic key: `control:trial-balance`,
  -- `overdue_invoice:<uuid>`, `period:<uuid>`. Not a new identifier — the one
  -- the queue already builds, so the join needs nothing invented.
  work_key       text primary key check (length(btrim(work_key)) > 0),
  lifecycle      text not null default 'new'
                 check (lifecycle in ('new', 'acknowledged', 'in_progress', 'dismissed', 'resolved')),
  owner_id       uuid references auth.users (id),
  -- Entered by a person. Phase 3 adds a policy that can propose one; until
  -- then a date here is a promise somebody made, not one the system inferred.
  due_date       date,
  dismiss_reason text,
  -- The concurrency token. An integer rather than `updated_at`: a timestamp
  -- has microsecond precision in Postgres and millisecond precision in every
  -- driver and JSON serialiser between here and the browser, so comparing one
  -- for equality refuses writes that are not actually stale. A counter cannot
  -- lose precision on the way out and back.
  version        int not null default 1,
  updated_at     timestamptz not null default now(),
  updated_by     uuid references auth.users (id),
  resolved_at    timestamptz,
  -- A dismissal without a reason is an alert quietly switched off.
  check (lifecycle <> 'dismissed' or length(btrim(coalesce(dismiss_reason, ''))) > 0)
);

create index if not exists acc_work_item_state_owner_idx
  on acc_work_item_state (owner_id) where lifecycle <> 'resolved';

alter table acc_work_item_state enable row level security;

drop policy if exists acc_work_item_state_sel on acc_work_item_state;
create policy acc_work_item_state_sel on acc_work_item_state
  for select using (acc_current_role() is not null);

-- No insert, update or delete policy: an application session writes this table
-- only through the two functions below, and both check acc_is_staff().
revoke all on table acc_work_item_state from public, anon;
grant select on table acc_work_item_state to authenticated;
grant all    on table acc_work_item_state to service_role;

/**
 * Record what a person decided about one piece of work.
 *
 * `p_expected_version` is the concurrency token: the caller sends back the
 * version it rendered, and a row that has moved since is refused rather than
 * overwritten. Two accountants working the same queue is the normal case, not
 * the exceptional one, and silently losing one of their decisions is worse
 * than making one of them look again.
 *
 * Null `p_expected_version` means "I believe there is no row yet".
 */
drop function if exists acc_set_work_item_state(text, text, uuid, date, text, timestamptz, boolean);

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

  select * into v_current from acc_work_item_state where work_key = p_key;

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
  else
    if v_current.lifecycle = 'resolved' then
      raise exception 'This item is already resolved; its exception has cleared';
    end if;
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
                             'reason', v_reason));

  return v_version;
end $$;

/**
 * Retire the state of work that no longer exists.
 *
 * Called with the keys the queue just produced. Anything active that is not
 * among them has had its exception clear, so it is marked resolved — the
 * "resolve it automatically only when the source exception disappears" the
 * design document asks for.
 *
 * Without this a dismissal would outlive its exception: `control:trial-balance`
 * is the same key every time the trial balance goes out, so a dismissal from
 * March would silently hide the failure in April.
 */
create or replace function acc_retire_work_items(p_live_keys text[])
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  if acc_current_role() is null then
    raise exception 'Not authorized';
  end if;

  update acc_work_item_state
     set lifecycle = 'resolved', resolved_at = now()
   where lifecycle <> 'resolved'
     and not (work_key = any (coalesce(p_live_keys, array[]::text[])));
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function acc_set_work_item_state(text, text, uuid, date, text, int, boolean)
  from public, anon;
grant execute on function acc_set_work_item_state(text, text, uuid, date, text, int, boolean)
  to authenticated, service_role;
revoke all on function acc_retire_work_items(text[]) from public, anon;
grant execute on function acc_retire_work_items(text[]) to authenticated, service_role;
