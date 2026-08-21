-- ============================================================================
-- 0119  What a company decides about its own work
--
-- Phase 3 of the accounting cockpit
-- (docs/superpowers/specs/2026-08-19-accounting-dashboard-redesign-design.md).
--
-- Phase 1 recorded materiality and SLA as gaps and refused to invent them. A
-- queue ordered by a threshold nobody chose is a queue ordered by a developer's
-- guess, and a screen that says "late" on a deadline the company never set is
-- making one up. This is where a company says.
--
-- **Every column is nullable, and null is a real answer.** It means nobody has
-- decided, and the rules that need the number stay asleep with their names on
-- the screen. A default here would be worse than nothing: it would look like a
-- decision, and nobody would go and make the real one.
--
-- **Versioned, not overwritten.** The question an audit asks is never "what is
-- the threshold" — it is "what was the threshold when this was judged". Each
-- save writes a new row, and the current policy is the newest.
-- ============================================================================

set search_path = public;

create table if not exists acc_work_policy (
  id                      uuid primary key default gen_random_uuid(),
  -- Which version this is. `created_at` cannot answer that: now() is the
  -- transaction's start time, so two saves in one transaction share it and
  -- "the newest" becomes whichever the planner happened to return. A strictly
  -- increasing counter is exact, forever.
  version                 bigint generated always as identity,
  -- Minor units. Null until somebody sets one; zero is a legitimate answer
  -- meaning "every difference matters", which is not the same thing.
  materiality_minor       bigint check (materiality_minor is null or materiality_minor >= 0),
  approval_sla_days       int    check (approval_sla_days is null or approval_sla_days >= 0),
  unmatched_bank_age_days int    check (unmatched_bank_age_days is null or unmatched_bank_age_days >= 0),
  note                    text,
  created_at              timestamptz not null default now(),
  created_by              uuid references auth.users (id)
);

create index if not exists acc_work_policy_current_idx
  on acc_work_policy (version desc);

alter table acc_work_policy enable row level security;

drop policy if exists acc_work_policy_sel on acc_work_policy;
create policy acc_work_policy_sel on acc_work_policy
  for select using (acc_current_role() is not null);

-- No insert, update or delete policy: written only through the function below,
-- which is admin-only because this changes what the whole company sees.
revoke all on table acc_work_policy from public, anon;
grant select on table acc_work_policy to authenticated;
grant all    on table acc_work_policy to service_role;

/**
 * The policy in force now: the newest version, or every field null when a
 * company has never set one.
 *
 * Returns a row either way, so a caller never has to tell "no policy" from
 * "the query failed" — the difference between those two is exactly the kind
 * of thing this dashboard exists to keep straight.
 */
create or replace function acc_current_work_policy()
returns table (
  materiality_minor       bigint,
  approval_sla_days       int,
  unmatched_bank_age_days int,
  note                    text,
  created_at              timestamptz,
  created_by              uuid
)
language sql stable security definer set search_path = public as $$
  select p.materiality_minor, p.approval_sla_days, p.unmatched_bank_age_days,
         p.note, p.created_at, p.created_by
    from acc_work_policy p
   order by p.version desc
   limit 1;
$$;

/**
 * Record a new version of the policy.
 *
 * Admin only: materiality and an SLA change what every accountant in the
 * company is told is urgent and what is late, which is a decision about the
 * business rather than about one person's queue.
 */
create or replace function acc_save_work_policy(
  p_materiality_minor       bigint,
  p_approval_sla_days       int,
  p_unmatched_bank_age_days int,
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
    materiality_minor, approval_sla_days, unmatched_bank_age_days, note, created_by
  ) values (
    p_materiality_minor, p_approval_sla_days, p_unmatched_bank_age_days,
    nullif(btrim(coalesce(p_note, '')), ''), auth.uid()
  ) returning id into v_id;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values ('acc_work_policy', v_id, 'insert', auth.uid(),
          jsonb_build_object('materiality_minor', p_materiality_minor,
                             'approval_sla_days', p_approval_sla_days,
                             'unmatched_bank_age_days', p_unmatched_bank_age_days,
                             'note', nullif(btrim(coalesce(p_note, '')), '')));

  return v_id;
end $$;

revoke all on function acc_current_work_policy() from public, anon;
grant execute on function acc_current_work_policy() to authenticated, service_role;
revoke all on function acc_save_work_policy(bigint, int, int, text) from public, anon;
grant execute on function acc_save_work_policy(bigint, int, int, text) to authenticated, service_role;
