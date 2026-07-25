-- ============================================================================
-- Fix: in PL/pgSQL `text[] || 'literal'` makes Postgres parse the literal as an
-- array, so appending a changed-field name failed with "malformed array
-- literal". Use array_append, which takes the element type from the array.
-- Behaviour is otherwise identical to 0039.
-- ============================================================================

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
