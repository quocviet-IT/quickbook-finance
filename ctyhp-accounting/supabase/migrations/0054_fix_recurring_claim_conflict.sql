-- The RETURNS TABLE output names are PL/pgSQL variables. Referencing the
-- unique-key columns directly in ON CONFLICT made scheduled_date ambiguous.
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
  on conflict on constraint acc_recurring_run_template_id_scheduled_date_key do nothing
  returning * into v_run;

  if found then
    v_inserted := true;
  else
    select * into v_run
      from acc_recurring_run r
     where r.template_id = v_template.id
       and r.scheduled_date = v_template.next_run_date
     for update;

    if v_run.status = 'failed'
       or (v_run.status = 'processing' and v_run.started_at < now() - interval '15 minutes') then
      update acc_recurring_run r
         set status = 'processing',
             error_message = null,
             generated_by = auth.uid(),
             started_at = now(),
             completed_at = null
       where r.id = v_run.id
       returning r.* into v_run;
      v_inserted := true;
    end if;
  end if;

  return query select
    v_run.id, v_run.scheduled_date, v_run.document_type, v_run.payload_snapshot,
    v_run.status, v_run.document_id, v_run.approval_request_id, v_inserted;
end;
$$;
