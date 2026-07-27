-- ============================================================================
-- Recurring transaction execution
-- Claiming and completion are database-serialized. The unique occurrence key
-- prevents duplicate documents when cron and an interactive user overlap.
-- ============================================================================

create or replace function acc_is_automation() returns boolean
language sql stable as $$
  select coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role';
$$;

create or replace function acc_recurring_authorized() returns boolean
language sql stable security definer set search_path = public as $$
  select acc_is_automation() or acc_has_permission('recurring.manage');
$$;

create or replace function acc_recurring_next_date(
  p_current date,
  p_start date,
  p_frequency acc_recurring_frequency,
  p_interval_count integer
) returns date
language plpgsql immutable as $$
declare
  v_months integer;
  v_target_first date;
  v_target_last date;
  v_start_last date;
  v_day integer;
begin
  if p_frequency = 'weekly' then
    return p_current + (p_interval_count * 7);
  end if;

  v_months := p_interval_count *
    case p_frequency when 'monthly' then 1 when 'quarterly' then 3 else 12 end;
  v_target_first := date_trunc('month', p_current + make_interval(months => v_months))::date;
  v_target_last := (v_target_first + interval '1 month - 1 day')::date;
  v_start_last := (date_trunc('month', p_start)::date + interval '1 month - 1 day')::date;
  v_day := case
    when p_start = v_start_last then extract(day from v_target_last)::integer
    else least(extract(day from p_start)::integer, extract(day from v_target_last)::integer)
  end;
  return make_date(extract(year from v_target_first)::integer,
                   extract(month from v_target_first)::integer, v_day);
end;
$$;

create or replace function acc_claim_recurring_run(p_template_id uuid)
returns table (
  run_id uuid,
  scheduled_date date,
  document_type acc_recurring_document_type,
  payload_snapshot jsonb,
  run_status acc_recurring_run_status,
  document_id uuid,
  approval_request_id uuid,
  claimed boolean
)
language plpgsql security definer set search_path = public as $$
declare
  v_template acc_recurring_template;
  v_run acc_recurring_run;
  v_inserted boolean := false;
begin
  if not acc_recurring_authorized() then
    raise exception 'You do not have permission to run recurring transactions';
  end if;

  select * into v_template
    from acc_recurring_template
   where id = p_template_id
   for update;
  if not found then raise exception 'Recurring schedule not found'; end if;
  if v_template.status <> 'active' then
    raise exception 'Only an active recurring schedule can be generated';
  end if;
  if v_template.end_date is not null and v_template.next_run_date > v_template.end_date then
    update acc_recurring_template
       set status = 'ended', updated_at = now()
     where id = p_template_id;
    raise exception 'This recurring schedule has ended';
  end if;

  insert into acc_recurring_run (
    template_id, document_type, scheduled_date, payload_snapshot, generated_by
  )
  values (
    v_template.id, v_template.document_type, v_template.next_run_date,
    v_template.payload, auth.uid()
  )
  on conflict (template_id, scheduled_date) do nothing
  returning * into v_run;

  if found then
    v_inserted := true;
  else
    select * into v_run
      from acc_recurring_run
     where template_id = v_template.id
       and scheduled_date = v_template.next_run_date
     for update;

    if v_run.status = 'failed'
       or (v_run.status = 'processing' and v_run.started_at < now() - interval '15 minutes') then
      update acc_recurring_run
         set status = 'processing',
             error_message = null,
             generated_by = auth.uid(),
             started_at = now(),
             completed_at = null
       where id = v_run.id
       returning * into v_run;
      v_inserted := true;
    end if;
  end if;

  return query select
    v_run.id, v_run.scheduled_date, v_run.document_type, v_run.payload_snapshot,
    v_run.status, v_run.document_id, v_run.approval_request_id, v_inserted;
end;
$$;

create or replace function acc_complete_recurring_run(
  p_run_id uuid,
  p_status acc_recurring_run_status,
  p_document_id uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_run acc_recurring_run;
  v_template acc_recurring_template;
  v_next date;
  v_template_status acc_recurring_template_status;
begin
  if not acc_recurring_authorized() then
    raise exception 'You do not have permission to complete recurring transactions';
  end if;
  if p_status not in ('generated', 'pending_review') then
    raise exception 'Invalid initial recurring result status %', p_status;
  end if;

  select * into v_run from acc_recurring_run where id = p_run_id for update;
  if not found then raise exception 'Recurring run not found'; end if;
  select * into v_template from acc_recurring_template where id = v_run.template_id for update;

  update acc_recurring_run
     set status = p_status,
         document_id = p_document_id,
         error_message = null,
         completed_at = now()
   where id = p_run_id;

  if v_template.next_run_date = v_run.scheduled_date then
    v_next := acc_recurring_next_date(
      v_run.scheduled_date, v_template.start_date,
      v_template.frequency, v_template.interval_count
    );
    v_template_status := case
      when v_template.end_date is not null and v_next > v_template.end_date then 'ended'
      else v_template.status
    end;
    update acc_recurring_template
       set next_run_date = v_next,
           status = v_template_status,
           last_run_at = now(),
           last_run_status = p_status,
           last_error = null,
           updated_at = now()
     where id = v_template.id;
  end if;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values (
    'acc_recurring_run', p_run_id, 'insert', auth.uid(),
    jsonb_build_object('status', p_status, 'document_id', p_document_id,
                       'scheduled_date', v_run.scheduled_date)
  );
end;
$$;

create or replace function acc_fail_recurring_run(p_run_id uuid, p_error text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_template_id uuid;
begin
  if not acc_recurring_authorized() then
    raise exception 'You do not have permission to update recurring transactions';
  end if;
  update acc_recurring_run
     set status = 'failed',
         error_message = left(coalesce(p_error, 'Generation failed'), 1000),
         completed_at = now()
   where id = p_run_id
   returning template_id into v_template_id;
  if not found then raise exception 'Recurring run not found'; end if;

  update acc_recurring_template
     set last_run_at = now(),
         last_run_status = 'failed',
         last_error = left(coalesce(p_error, 'Generation failed'), 1000),
         updated_at = now()
   where id = v_template_id;
end;
$$;

create or replace function acc_post_recurring_expense(p_run_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_run acc_recurring_run;
  v_payload jsonb;
  v_expense uuid;
begin
  if not acc_has_permission('recurring.manage') then
    raise exception 'You do not have permission to review recurring transactions';
  end if;
  select * into v_run from acc_recurring_run where id = p_run_id for update;
  if not found or v_run.document_type <> 'expense' then
    raise exception 'Recurring expense draft not found';
  end if;
  if v_run.status = 'generated' and v_run.document_id is not null then
    return v_run.document_id;
  end if;
  if v_run.status <> 'pending_review' then
    raise exception 'This recurring expense is not waiting for review';
  end if;

  v_payload := v_run.payload_snapshot;
  v_expense := acc_record_expense(
    nullif(v_payload ->> 'vendor_id', '')::uuid,
    (v_payload ->> 'payment_account_id')::uuid,
    v_run.scheduled_date,
    'USD',
    v_payload ->> 'memo',
    v_payload -> 'lines'
  );
  update acc_expense set recurring_run_id = p_run_id where id = v_expense;
  update acc_recurring_run
     set status = 'generated', document_id = v_expense,
         error_message = null, completed_at = now()
   where id = p_run_id;
  return v_expense;
end;
$$;

create or replace function acc_post_recurring_journal(p_run_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_run acc_recurring_run;
  v_payload jsonb;
  v_entry uuid;
begin
  if not acc_has_permission('recurring.manage') then
    raise exception 'You do not have permission to review recurring transactions';
  end if;
  select * into v_run from acc_recurring_run where id = p_run_id for update;
  if not found or v_run.document_type <> 'journal' then
    raise exception 'Recurring journal draft not found';
  end if;
  if v_run.status = 'generated' and v_run.document_id is not null then
    return v_run.document_id;
  end if;
  if v_run.status <> 'pending_review' then
    raise exception 'This recurring journal is not waiting for review';
  end if;

  v_payload := v_run.payload_snapshot;
  v_entry := acc_post_manual_journal(
    v_run.scheduled_date,
    v_payload ->> 'description',
    v_payload ->> 'source_ref',
    'USD',
    v_payload -> 'lines'
  );
  update acc_journal_entry set recurring_run_id = p_run_id where id = v_entry;
  update acc_recurring_run
     set status = 'generated', document_id = v_entry,
         error_message = null, completed_at = now()
   where id = p_run_id;
  return v_entry;
end;
$$;

create or replace function acc_mark_recurring_approval(
  p_run_id uuid,
  p_request_id uuid
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not acc_has_permission('recurring.manage') then
    raise exception 'You do not have permission to review recurring transactions';
  end if;
  if not exists (
    select 1 from acc_approval_request
     where id = p_request_id
       and payload ->> 'recurring_run_id' = p_run_id::text
  ) then
    raise exception 'Approval request does not belong to this recurring run';
  end if;
  update acc_recurring_run
     set status = 'awaiting_approval',
         approval_request_id = p_request_id,
         error_message = null
   where id = p_run_id and status = 'pending_review';
  if not found then raise exception 'Recurring journal is not waiting for review'; end if;
end;
$$;

create or replace function acc_sync_recurring_approval() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_run_id uuid;
begin
  if new.payload ? 'recurring_run_id' then
    v_run_id := (new.payload ->> 'recurring_run_id')::uuid;
    if new.status = 'approved' and old.status is distinct from new.status then
      update acc_journal_entry set recurring_run_id = v_run_id where id = new.result_id;
      update acc_recurring_run
         set status = 'generated', document_id = new.result_id,
             error_message = null, completed_at = now()
       where id = v_run_id;
    elsif new.status in ('rejected', 'cancelled') and old.status is distinct from new.status then
      update acc_recurring_run
         set status = 'pending_review',
             approval_request_id = null,
             error_message = case
               when new.status = 'rejected' then coalesce(new.decision_note, 'Approval rejected')
               else 'Approval cancelled'
             end
       where id = v_run_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger acc_approval_request_recurring_sync
  after update of status on acc_approval_request
  for each row execute function acc_sync_recurring_approval();
