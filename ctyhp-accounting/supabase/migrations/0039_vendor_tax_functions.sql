-- ============================================================================
-- Module G3 — vendor tax profile save + 1099 preparation dataset.
--
-- A 1099 reports what was PAID in the calendar year, so the dataset sums posted
-- bill payments and posted immediate expenses, converted to base currency at the
-- document date. Vendor credits are not subtracted: a credit reduces a later
-- payment, so the payment total already reflects it.
--
-- The taxpayer identifier never leaves this table: the report returns only
-- "on file: yes/no", and the audit row records which fields changed, never their
-- values.
-- ============================================================================

/** The current (highest) version of a vendor's tax profile. */
create or replace function acc_vendor_tax_profile_current(p_vendor_id uuid)
returns acc_vendor_tax_profile
language sql stable as $$
  select * from acc_vendor_tax_profile
   where vendor_id = p_vendor_id
   order by version desc limit 1;
$$;

-- ----------------------------------------------------------------------------
-- Save a new version. Elevated permission, a mandatory reason, and — when the
-- policy is enabled — Module C's approval gate, using the same dispatch-flag
-- pattern as the other controlled actions.
-- ----------------------------------------------------------------------------
create or replace function acc_save_vendor_tax_profile(
  p_vendor_id            uuid,
  p_w9_status            acc_w9_status,
  p_w9_received_date     date,
  p_w9_expires_date      date,
  p_classification       acc_tax_classification,
  p_reporting_name       text,
  p_tin_ref              text,
  p_tin_type             acc_tin_type,
  p_address_line1        text,
  p_address_line2        text,
  p_city                 text,
  p_region               text,
  p_postal_code          text,
  p_country              text,
  p_is_1099_eligible     boolean,
  p_box_code             text,
  p_eligibility_override boolean,
  p_override_reason      text,
  p_reason               text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_prev    acc_vendor_tax_profile;
  v_version int;
  v_id      uuid;
  v_changed text[] := '{}';
begin
  if not acc_has_permission('vendor.tax_manage') then
    raise exception 'You do not have permission to change a vendor tax profile';
  end if;
  if acc_approval_required('vendor_tax_profile', 0) and not acc_in_approval_dispatch() then
    raise exception 'Changing a vendor tax profile requires approval; submit it for approval instead';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A change reason is required'; end if;
  if p_eligibility_override and coalesce(btrim(p_override_reason), '') = '' then
    raise exception 'An override needs its own documented reason';
  end if;
  if p_is_1099_eligible and coalesce(btrim(p_box_code), '') = '' then
    raise exception 'An eligible vendor needs a reporting box';
  end if;
  if not exists (select 1 from acc_vendor where id = p_vendor_id) then
    raise exception 'Vendor not found';
  end if;

  v_prev := acc_vendor_tax_profile_current(p_vendor_id);
  v_version := coalesce(v_prev.version, 0) + 1;

  insert into acc_vendor_tax_profile
    (vendor_id, version, w9_status, w9_received_date, w9_expires_date, classification,
     reporting_name, tin_ref, tin_type, address_line1, address_line2, city, region,
     postal_code, country, is_1099_eligible, box_code, eligibility_override,
     override_reason, change_reason, created_by)
  values
    (p_vendor_id, v_version, coalesce(p_w9_status, 'not_requested'), p_w9_received_date,
     p_w9_expires_date, p_classification, nullif(btrim(coalesce(p_reporting_name, '')), ''),
     nullif(btrim(coalesce(p_tin_ref, '')), ''), p_tin_type,
     p_address_line1, p_address_line2, p_city, p_region, p_postal_code,
     coalesce(nullif(btrim(coalesce(p_country, '')), ''), 'US'),
     coalesce(p_is_1099_eligible, false), nullif(btrim(coalesce(p_box_code, '')), ''),
     coalesce(p_eligibility_override, false), nullif(btrim(coalesce(p_override_reason, '')), ''),
     p_reason, auth.uid())
  returning id into v_id;

  -- Which fields moved — never what they moved to, because one of them is a
  -- taxpayer identifier.
  if v_prev.id is null then
    v_changed := array['created']::text[];
  else
    if v_prev.w9_status is distinct from p_w9_status then v_changed := array_append(v_changed, 'w9_status'); end if;
    if v_prev.w9_expires_date is distinct from p_w9_expires_date then v_changed := array_append(v_changed, 'w9_expires_date'); end if;
    if v_prev.classification is distinct from p_classification then v_changed := array_append(v_changed, 'classification'); end if;
    if v_prev.reporting_name is distinct from p_reporting_name then v_changed := array_append(v_changed, 'reporting_name'); end if;
    if coalesce(v_prev.tin_ref, '') is distinct from coalesce(p_tin_ref, '') then v_changed := array_append(v_changed, 'tin_ref'); end if;
    if v_prev.is_1099_eligible is distinct from coalesce(p_is_1099_eligible, false) then v_changed := array_append(v_changed, 'is_1099_eligible'); end if;
    if v_prev.box_code is distinct from p_box_code then v_changed := array_append(v_changed, 'box_code'); end if;
    if v_prev.eligibility_override is distinct from coalesce(p_eligibility_override, false) then v_changed := array_append(v_changed, 'eligibility_override'); end if;
  end if;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
    values ('acc_vendor_tax_profile', v_id, case when v_prev.id is null then 'insert' else 'update' end,
            auth.uid(),
            jsonb_build_object('vendor_id', p_vendor_id, 'version', v_version,
                               'changed_fields', to_jsonb(v_changed), 'reason', p_reason));
  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- What was paid to a vendor in a calendar year, in base currency.
-- ----------------------------------------------------------------------------
create or replace function acc_1099_paid_minor(p_vendor_id uuid, p_year int) returns bigint
language sql stable as $$
  select coalesce(sum(amt), 0)::bigint from (
    select acc_to_base_minor(bp.amount_minor, bp.currency_code, bp.payment_date) as amt
      from acc_bill_payment bp
     where bp.vendor_id = p_vendor_id and bp.status <> 'void'
       and bp.payment_date >= make_date(p_year, 1, 1)
       and bp.payment_date <  make_date(p_year + 1, 1, 1)
    union all
    select acc_to_base_minor(e.total_minor, e.currency_code, e.expense_date)
      from acc_expense e
     where e.vendor_id = p_vendor_id and e.status = 'posted'
       and e.expense_date >= make_date(p_year, 1, 1)
       and e.expense_date <  make_date(p_year + 1, 1, 1)
  ) s;
$$;

/** Control total: the same population summed directly from the documents. */
create or replace function acc_1099_control_total(p_year int) returns bigint
language sql stable as $$
  select coalesce(sum(acc_1099_paid_minor(v.id, p_year)), 0)::bigint from acc_vendor v;
$$;

-- ----------------------------------------------------------------------------
-- The review dataset. Facts only: whether a TIN is on file, not what it is.
-- Reportability and the exception list are derived in lib/domain/vendorTax.ts so
-- they are unit-testable; nothing here is a filing.
-- ----------------------------------------------------------------------------
create or replace function acc_1099_summary(p_year int)
returns table (
  vendor_id            uuid,
  vendor_name          text,
  reporting_name       text,
  classification       acc_tax_classification,
  w9_status            acc_w9_status,
  w9_expires_date      date,
  tin_on_file          boolean,
  address_complete     boolean,
  is_1099_eligible     boolean,
  box_code             text,
  box_label            text,
  threshold_minor      bigint,
  paid_minor           bigint,
  eligibility_override boolean
)
language plpgsql stable as $$
begin
  if not acc_has_permission('report.1099') then
    raise exception 'You do not have permission to run the 1099 review';
  end if;

  return query
  with current_profile as (
    select p.* from acc_vendor_tax_profile p
     where p.version = (select max(p2.version) from acc_vendor_tax_profile p2
                         where p2.vendor_id = p.vendor_id)
  ),
  paid as (
    select v.id as vendor_id, acc_1099_paid_minor(v.id, p_year) as amt from acc_vendor v
  )
  select v.id, v.name, c.reporting_name, c.classification,
         coalesce(c.w9_status, 'not_requested'::acc_w9_status), c.w9_expires_date,
         (c.tin_ref is not null),
         (coalesce(c.address_line1, '') <> '' and coalesce(c.city, '') <> ''
          and coalesce(c.region, '') <> '' and coalesce(c.postal_code, '') <> ''),
         coalesce(c.is_1099_eligible, false), c.box_code, b.box_label,
         coalesce(b.threshold_minor, 60000), pd.amt,
         coalesce(c.eligibility_override, false)
    from acc_vendor v
    join paid pd on pd.vendor_id = v.id
    left join current_profile c on c.vendor_id = v.id
    left join acc_1099_box b on b.code = c.box_code
   where pd.amt > 0 or coalesce(c.is_1099_eligible, false)
   order by v.name;
end;
$$;

-- ----------------------------------------------------------------------------
-- acc_approve_request — body from 0037_access_control_functions.sql with one
-- extra dispatch branch for the new controlled action. Copied mechanically so
-- none of the existing dispatcher can be lost in a retype.
-- ----------------------------------------------------------------------------
create or replace function acc_approve_request(p_request_id uuid, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_req    acc_approval_request;
  v_policy acc_approval_policy;
  v_p      jsonb;
  v_result uuid;
begin
  if not acc_has_permission('approval.decide') then
    raise exception 'You do not have permission to decide approval requests';
  end if;

  select * into v_req from acc_approval_request where id = p_request_id for update;
  if not found then raise exception 'Approval request not found'; end if;
  if v_req.status <> 'pending' then raise exception 'Request is already %', v_req.status; end if;

  select * into v_policy from acc_approval_policy where action_key = v_req.action_key;
  if v_policy.require_segregation and v_req.requested_by = auth.uid() then
    raise exception 'You cannot approve your own request while segregation of duties is enabled';
  end if;

  v_p := v_req.payload;
  perform set_config('acc.approval_dispatch', 'on', true);

  if v_req.action_key = 'manual_journal' then
    v_result := acc_post_manual_journal(
      (v_p ->> 'entry_date')::date, v_p ->> 'description', v_p ->> 'source_ref',
      v_p ->> 'currency', v_p -> 'lines');
  elsif v_req.action_key = 'write_off' then
    v_result := acc_write_off(
      v_p ->> 'side', (v_p ->> 'target_id')::uuid, (v_p ->> 'offset_account_id')::uuid,
      (v_p ->> 'amount_minor')::bigint, (v_p ->> 'date')::date, v_req.reason);
  elsif v_req.action_key = 'inventory_adjustment' then
    v_result := acc_adjust_inventory(
      (v_p ->> 'item_id')::uuid, (v_p ->> 'date')::date, (v_p ->> 'qty_delta')::numeric,
      (v_p ->> 'unit_cost_minor')::bigint, (v_p ->> 'value_delta_minor')::bigint,
      (v_p ->> 'offset_account_id')::uuid, v_req.reason);
  elsif v_req.action_key = 'period_reopen' then
    perform acc_reopen_period((v_p ->> 'period_id')::uuid, v_req.reason);
    v_result := (v_p ->> 'period_id')::uuid;
  elsif v_req.action_key = 'reconciliation_reopen' then
    perform acc_reopen_reconciliation((v_p ->> 'reconciliation_id')::uuid, v_req.reason);
    v_result := (v_p ->> 'reconciliation_id')::uuid;
  elsif v_req.action_key = 'vendor_tax_profile' then
    v_result := acc_save_vendor_tax_profile(
      (v_p ->> 'vendor_id')::uuid,
      (v_p ->> 'w9_status')::acc_w9_status,
      nullif(v_p ->> 'w9_received_date', '')::date,
      nullif(v_p ->> 'w9_expires_date', '')::date,
      nullif(v_p ->> 'classification', '')::acc_tax_classification,
      v_p ->> 'reporting_name',
      v_p ->> 'tin_ref',
      nullif(v_p ->> 'tin_type', '')::acc_tin_type,
      v_p ->> 'address_line1', v_p ->> 'address_line2', v_p ->> 'city',
      v_p ->> 'region', v_p ->> 'postal_code', v_p ->> 'country',
      (v_p ->> 'is_1099_eligible')::boolean,
      v_p ->> 'box_code',
      (v_p ->> 'eligibility_override')::boolean,
      v_p ->> 'override_reason',
      v_req.reason);
  else
    raise exception 'No dispatch defined for %', v_req.action_key;
  end if;

  perform set_config('acc.approval_dispatch', 'off', true);

  update acc_approval_request
     set status = 'approved', decided_by = auth.uid(), decided_at = now(),
         decision_note = p_note, result_id = v_result
   where id = p_request_id;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
    values ('acc_approval_request', p_request_id, 'post', auth.uid(),
            jsonb_build_object('status', 'approved', 'result_id', v_result, 'note', p_note));
  return v_result;
end;
$$;
