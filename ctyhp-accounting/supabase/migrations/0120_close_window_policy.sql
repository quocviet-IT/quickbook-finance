-- ============================================================================
-- 0120  When a company starts thinking about the close
--
-- Phase 4 of the accounting cockpit
-- (docs/superpowers/plans/2026-08-21-accounting-cockpit-phase4.md).
--
-- A period still open after the last day it covers is overdue by arithmetic and
-- needs no policy. A period *approaching* its end is a judgement: three days
-- before month end is early for one company and late for another. So the second
-- trigger waits on a number somebody chose, and until they do it stays asleep
-- and the screen names it — the rule 0119 set, applied to one more field.
--
-- Null is still a real answer, and still means nobody has decided. Zero still
-- means the last day only, which is a policy, not an absence.
-- ============================================================================

set search_path = public;

alter table acc_work_policy
  add column if not exists close_window_days int;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'acc_work_policy_close_window_days_check'
       and conrelid = 'acc_work_policy'::regclass
  ) then
    alter table acc_work_policy
      add constraint acc_work_policy_close_window_days_check
      check (close_window_days is null or close_window_days >= 0);
  end if;
end $$;

-- A `returns table` cannot change shape in place, so the old one goes first.
-- Nothing else reads it: the only caller is lib/services/accounting-dashboard.
drop function if exists acc_current_work_policy();

create or replace function acc_current_work_policy()
returns table (
  materiality_minor       bigint,
  approval_sla_days       int,
  unmatched_bank_age_days int,
  close_window_days       int,
  note                    text,
  created_at              timestamptz,
  created_by              uuid
)
language sql stable security definer set search_path = public as $$
  select p.materiality_minor, p.approval_sla_days, p.unmatched_bank_age_days,
         p.close_window_days, p.note, p.created_at, p.created_by
    from acc_work_policy p
   order by p.version desc
   limit 1;
$$;

/**
 * Record a new version of the policy, now including the close window.
 *
 * The four-argument form is dropped rather than kept alongside. A caller still
 * on the old signature would save a policy with the close window silently
 * discarded — every save would quietly unset a field the company had chosen.
 * Failing loudly is the rule migration 0074 set for `acc_close_period`, and it
 * applies for the same reason.
 */
create or replace function acc_save_work_policy(
  p_materiality_minor       bigint,
  p_approval_sla_days       int,
  p_unmatched_bank_age_days int,
  p_close_window_days       int,
  p_note                    text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not acc_is_admin() then
    raise exception 'Only an admin can change the work policy';
  end if;

  insert into acc_work_policy (
    materiality_minor, approval_sla_days, unmatched_bank_age_days,
    close_window_days, note, created_by
  ) values (
    p_materiality_minor, p_approval_sla_days, p_unmatched_bank_age_days,
    p_close_window_days, nullif(btrim(coalesce(p_note, '')), ''), auth.uid()
  ) returning id into v_id;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values ('acc_work_policy', v_id, 'insert', auth.uid(),
          jsonb_build_object('materiality_minor', p_materiality_minor,
                             'approval_sla_days', p_approval_sla_days,
                             'unmatched_bank_age_days', p_unmatched_bank_age_days,
                             'close_window_days', p_close_window_days,
                             'note', nullif(btrim(coalesce(p_note, '')), '')));

  return v_id;
end $$;

drop function if exists acc_save_work_policy(bigint, int, int, text);

/**
 * How long each closed period took to close.
 *
 * Nothing new is stored: `acc_period_event` has carried close events since
 * 0028, and the distance from a period's own end date to the day it was closed
 * is a measurement of history that already exists.
 *
 * The *latest* close event per period is the one that counts. A period that was
 * closed, reopened and closed again took until the second close — reporting the
 * first would say the month finished on a day the books were later reopened.
 */
create or replace function acc_period_close_history(p_limit int default 6)
returns table (
  period_id    uuid,
  period_label text,
  period_end   date,
  closed_at    timestamptz
)
language sql stable security definer set search_path = public as $$
  select p.id, p.label, p.period_end, e.closed_at
    from acc_accounting_period p
    join lateral (
      select max(ev.created_at) as closed_at
        from acc_period_event ev
       where ev.period_id = p.id and ev.event = 'close'
    ) e on e.closed_at is not null
   where p.status = 'closed'
   order by p.period_end desc
   limit greatest(coalesce(p_limit, 6), 1);
$$;

revoke all on function acc_current_work_policy() from public, anon;
grant execute on function acc_current_work_policy() to authenticated, service_role;
revoke all on function acc_save_work_policy(bigint, int, int, int, text) from public, anon;
grant execute on function acc_save_work_policy(bigint, int, int, int, text) to authenticated, service_role;
revoke all on function acc_period_close_history(int) from public, anon;
grant execute on function acc_period_close_history(int) to authenticated, service_role;
