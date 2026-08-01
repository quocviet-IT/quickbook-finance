-- ============================================================================
-- 0074 — A period will not close over a control account that does not tie out.
--
-- Closing a period was already enforced in the database, but closing itself
-- checked nothing: an administrator could close a month while accounts
-- receivable disagreed with its control account, and the difference would then
-- be sealed behind a closed period.
--
-- Now the close runs the same reconciliation the report shows, at the period's
-- own end date, and refuses. A refusal that cannot be got past is a wall, not a
-- control, so there is an override — it demands the variance be acknowledged in
-- writing, and what it writes is kept with the period.
-- ============================================================================

alter table acc_accounting_period
  add column if not exists close_variance_note text;

/**
 * What stands in the way of closing this period, or null if nothing does.
 *
 * Callable on its own so the screen can show the answer before anyone presses
 * the button — the same sentence the close itself would refuse with.
 */
create or replace function acc_period_close_blockers(p_period_id uuid)
returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_p       acc_accounting_period;
  v_row     record;
  v_parts   text[] := array[]::text[];
  v_variance bigint;
begin
  select * into v_p from acc_accounting_period where id = p_period_id;
  if not found then raise exception 'Period not found'; end if;

  for v_row in select * from acc_control_reconciliation(v_p.period_end) loop
    v_variance := case
      when v_row.has_subledger then v_row.subledger_minor - v_row.control_minor
      else v_row.control_minor
    end;
    if v_variance <> 0 then
      v_parts := v_parts || format(
        '%s is out by %s',
        v_row.label,
        to_char(abs(v_variance) / 100.0, 'FM999,999,999,990.00')
      );
    end if;
  end loop;

  if array_length(v_parts, 1) is null then return null; end if;
  return format(
    '%s control account(s) do not tie out at %s: %s',
    array_length(v_parts, 1), v_p.period_end, array_to_string(v_parts, '; ')
  );
end;
$$;

revoke all on function acc_period_close_blockers(uuid) from public;
grant execute on function acc_period_close_blockers(uuid) to authenticated, service_role;

/**
 * Close a period.
 *
 * Unchanged except for the gate: a period whose control accounts are out will
 * not close unless the person closing it writes down what the difference is and
 * why it is acceptable. That note is stored on the period and audited, so a
 * month closed over a known variance says so forever.
 */
create or replace function acc_close_period(
  p_period_id uuid,
  p_reason text,
  p_variance_note text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_p        acc_accounting_period;
  v_blockers text;
begin
  if not acc_is_admin() then raise exception 'Only an admin can close a period'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A close reason is required'; end if;
  select * into v_p from acc_accounting_period where id = p_period_id for update;
  if not found then raise exception 'Period not found'; end if;
  if v_p.status = 'closed' then raise exception 'Period is already closed'; end if;

  v_blockers := acc_period_close_blockers(p_period_id);
  if v_blockers is not null and coalesce(btrim(p_variance_note), '') = '' then
    raise exception '% Close it anyway only with a written explanation of the difference.', v_blockers;
  end if;

  update acc_accounting_period
     set status = 'closed', closed_by = auth.uid(), closed_at = now(),
         close_reason = p_reason,
         close_variance_note = case when v_blockers is null then null
                                    else btrim(p_variance_note) end
   where id = p_period_id;

  insert into acc_period_event (period_id, event, reason, actor_id)
    values (
      p_period_id, 'close',
      case when v_blockers is null then p_reason
           else p_reason || ' — closed over a variance: ' || v_blockers
                || ' Explanation: ' || btrim(p_variance_note) end,
      auth.uid()
    );
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_accounting_period', p_period_id, 'close', auth.uid());
end;
$$;

-- The three-argument form replaces the two-argument one; drop the old
-- signature so an out-of-date caller fails loudly instead of skipping the gate.
drop function if exists acc_close_period(uuid, text);

revoke all on function acc_close_period(uuid, text, text) from public;
grant execute on function acc_close_period(uuid, text, text) to authenticated, service_role;
