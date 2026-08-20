-- ============================================================================
-- 0115  A frozen what-if analysis
--
-- Asked for in feedback, 2026-08: "we can use data and do a financial
-- analysis … we can save it as a frozen report … but it does not save to the
-- data because it's just an analysis data."
--
-- A row here is a photograph: the adjustments someone assumed and the report
-- those assumptions produced, computed by the application at the moment of
-- freezing. Nothing in this migration calls acc_post_entry, writes a journal
-- line, or touches a document — and scripts/verify-financial-analysis.mjs
-- asserts that rather than trusting this comment.
-- ============================================================================

set search_path = public;

create table if not exists acc_financial_analysis (
  id             uuid primary key default gen_random_uuid(),
  title          text not null check (length(btrim(title)) > 0),
  notes          text,
  period_start   date not null,
  period_end     date not null,
  adjustments    jsonb not null,
  snapshot       jsonb not null,
  status         text not null default 'active' check (status in ('active', 'archived')),
  created_by     uuid references auth.users (id),
  created_at     timestamptz not null default now(),
  archived_by    uuid references auth.users (id),
  archived_at    timestamptz,
  archive_reason text,
  check (period_end >= period_start),
  -- A snapshot is a rendering, not a data lake. These caps keep a runaway
  -- client from storing megabytes per click.
  check (pg_column_size(adjustments) <= 65536),
  check (pg_column_size(snapshot) <= 262144)
);

create index if not exists acc_financial_analysis_listing_idx
  on acc_financial_analysis (status, created_at desc);

alter table acc_financial_analysis enable row level security;

drop policy if exists acc_financial_analysis_sel on acc_financial_analysis;
create policy acc_financial_analysis_sel on acc_financial_analysis
  for select using (acc_current_role() is not null);

-- No insert, update or delete policy exists: an application session can only
-- write this table through the two functions below.
revoke all on table acc_financial_analysis from public, anon;
grant select on table acc_financial_analysis to authenticated;
grant all    on table acc_financial_analysis to service_role;

create or replace function acc_freeze_financial_analysis(
  p_title        text,
  p_notes        text,
  p_period_start date,
  p_period_end   date,
  p_adjustments  jsonb,
  p_snapshot     jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to freeze an analysis';
  end if;
  if jsonb_typeof(p_adjustments) <> 'array' or jsonb_array_length(p_adjustments) = 0 then
    raise exception 'A frozen analysis must carry at least one adjustment';
  end if;

  insert into acc_financial_analysis (
    title, notes, period_start, period_end, adjustments, snapshot, created_by
  ) values (
    p_title, p_notes, p_period_start, p_period_end, p_adjustments, p_snapshot, auth.uid()
  ) returning id into v_id;

  return v_id;
end $$;

create or replace function acc_archive_financial_analysis(
  p_id     uuid,
  p_reason text
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to archive an analysis';
  end if;

  update acc_financial_analysis
     set status = 'archived',
         archived_by = auth.uid(),
         archived_at = now(),
         archive_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = p_id and status = 'active';

  if not found then
    raise exception 'Analysis not found or already archived';
  end if;
end $$;

revoke all on function acc_freeze_financial_analysis(text, text, date, date, jsonb, jsonb) from public, anon;
grant execute on function acc_freeze_financial_analysis(text, text, date, date, jsonb, jsonb) to authenticated, service_role;
revoke all on function acc_archive_financial_analysis(uuid, text) from public, anon;
grant execute on function acc_archive_financial_analysis(uuid, text) to authenticated, service_role;
