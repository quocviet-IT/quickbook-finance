-- ============================================================================
-- 0086 — A suggestion needs somewhere to say what "better" would look like.
--
-- The report form has one free-text box for both a fault and an idea, and the
-- two are not the same shape. A fault is "this is broken, here is what
-- happened". An improvement is an argument: what is hard today, what good would
-- look like, and how much it is costing meanwhile.
--
-- Squeezed into one box, the third part is almost always missing — which is
-- exactly the part that decides whether the idea is worth building. Every
-- suggestion in the queue so far reads as equally urgent, which is another way
-- of saying none of them are ranked at all.
--
-- The screen the report came from is recorded as well. The route was already
-- captured; what that route is *for* was not, and it is what tells a reader
-- which part of the system an idea belongs to without opening it.
-- ============================================================================

alter table acc_feedback_report
  -- What is difficult now. The problem, separate from the proposed answer,
  -- because a good problem statement outlives whichever solution is chosen.
  add column if not exists current_difficulty text
    check (current_difficulty is null or length(current_difficulty) <= 2000),
  -- What the reporter would like instead. Their direction, in their words.
  add column if not exists desired_outcome text
    check (desired_outcome is null or length(desired_outcome) <= 2000),
  -- How much it costs to leave alone.
  add column if not exists impact text
    check (impact is null or impact in ('blocking', 'slows_work', 'nice_to_have')),
  -- How often it bites. Frequency and impact together are what ranking needs;
  -- either alone ranks a rare catastrophe level with a daily nuisance.
  add column if not exists frequency text
    check (frequency is null or frequency in ('every_time', 'often', 'sometimes', 'rarely')),
  -- What the screen is for, from the guide, at the moment of reporting.
  add column if not exists page_purpose text
    check (page_purpose is null or length(page_purpose) <= 500);

comment on column acc_feedback_report.impact is
  'blocking = cannot complete the work; slows_work = there is a workaround but it costs time; nice_to_have = an improvement, not a problem.';

-- ----------------------------------------------------------------------------
-- Reading the queue in priority order.
--
-- A queue sorted by arrival tells you what is newest, which is rarely what you
-- want to build. Impact and frequency together give an ordering that can be
-- argued with — and the score is computed here rather than in the application
-- so every reader sees the same one.
-- ----------------------------------------------------------------------------
create or replace function acc_feedback_priority(p_impact text, p_frequency text)
returns int
language sql immutable as $$
  select coalesce(
    case p_impact
      when 'blocking'     then 30
      when 'slows_work'   then 15
      when 'nice_to_have' then 5
      else 10
    end, 10)
  + coalesce(
    case p_frequency
      when 'every_time' then 12
      when 'often'      then 8
      when 'sometimes'  then 4
      when 'rarely'     then 1
      else 3
    end, 3);
$$;

create or replace function acc_feedback_queue(p_status text default null)
returns table (
  id                 uuid,
  kind               text,
  status             text,
  description        text,
  current_difficulty text,
  desired_outcome    text,
  impact             text,
  frequency          text,
  priority           int,
  page_route         text,
  page_purpose       text,
  reporter_email     text,
  created_at         timestamptz
)
language sql stable security definer set search_path = public as $$
  select r.id, r.kind::text, r.status::text, r.description,
         r.current_difficulty, r.desired_outcome, r.impact, r.frequency,
         acc_feedback_priority(r.impact, r.frequency),
         r.page_route, r.page_purpose,
         u.email::text,
         r.created_at
    from acc_feedback_report r
    left join auth.users u on u.id = r.reporter_id
   where acc_has_permission('feedback.read')
     and (p_status is null or r.status::text = p_status)
   order by acc_feedback_priority(r.impact, r.frequency) desc, r.created_at desc;
$$;

revoke all on function acc_feedback_queue(text) from public, anon;
grant execute on function acc_feedback_queue(text) to authenticated, service_role;
revoke all on function acc_feedback_priority(text, text) from public, anon;
grant execute on function acc_feedback_priority(text, text) to authenticated, service_role;
