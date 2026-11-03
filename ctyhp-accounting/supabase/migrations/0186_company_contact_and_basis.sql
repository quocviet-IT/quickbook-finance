-- ============================================================================
-- 0186  The company's email and phone on its documents; cash basis refused (2.99)
--
-- An invoice, an estimate and a sales receipt printed the company's name and
-- address and nothing a customer could answer: no email, no phone. The
-- company now keeps both in its settings, and every one of those documents
-- prints them under the address.
--
-- The settings also let "Cash" be chosen as the accounting basis, and saved
-- it, while every report is prepared on the accrual basis and says so. A
-- company that chose it was told one thing by its settings and the dashboard,
-- and another by every figure. Cash basis is not implemented, so it is now
-- refused, the way an inventory method the costing engine does not implement
-- already is (0078). No company has ever saved it, so nothing stored changes.
--
-- acc_save_company_settings takes the email and the phone as two more
-- arguments. Left out (null), what is already saved is kept, so a caller that
-- predates them cannot wipe them; an empty string clears them. Otherwise the
-- function is the one 0179 installed: settings.manage, a new version per
-- save, the audit entry.
-- ============================================================================
set search_path = public;

alter table acc_company_setting_version
  add column if not exists email text,
  add column if not exists phone text;

alter table acc_company_setting_version
  drop constraint if exists acc_company_setting_version_email_shape;
alter table acc_company_setting_version
  add constraint acc_company_setting_version_email_shape check (
    email is null
    or (char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
  );

alter table acc_company_setting_version
  drop constraint if exists acc_company_setting_version_phone_len;
alter table acc_company_setting_version
  add constraint acc_company_setting_version_phone_len check (phone is null or char_length(phone) <= 40);

drop function if exists acc_save_company_settings(
  text, text, text, text, text, text, text, text, text, int, text, text, text, int, text, text, text);

create or replace function acc_save_company_settings(
  p_legal_name text, p_dba_name text, p_ein_ref text,
  p_address_line1 text, p_address_line2 text, p_city text, p_region text,
  p_postal_code text, p_country text,
  p_fiscal_year_start_month int, p_base_currency_code text, p_time_zone text,
  p_accounting_basis text, p_default_payment_terms_days int,
  p_inventory_valuation_method text default null,
  p_inventory_policy_memo text default null,
  p_pay_note text default null,
  p_email text default null,
  p_phone text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_version int;
  v_id      uuid;
  v_current acc_company_setting_version;
  v_method  acc_inventory_valuation_method;
  v_basis   acc_accounting_basis;
begin
  if not acc_has_permission('settings.manage') then
    raise exception 'You do not have permission to change company settings';
  end if;
  if coalesce(btrim(p_legal_name), '') = '' then raise exception 'Legal name is required'; end if;

  select * into v_current from acc_company_setting_version order by version desc limit 1;

  v_method := coalesce(
    nullif(btrim(coalesce(p_inventory_valuation_method, '')), '')::acc_inventory_valuation_method,
    v_current.inventory_valuation_method,
    'average_cost'
  );

  if not (v_method = any (acc_implemented_valuation_methods())) then
    raise exception
      'Inventory is costed at weighted average; the % method is not implemented, so recording it as the policy would state something the ledger contradicts',
      v_method;
  end if;

  v_basis := coalesce(p_accounting_basis, 'accrual')::acc_accounting_basis;
  if v_basis <> 'accrual' then
    raise exception
      'Every report is prepared on the accrual basis; cash basis is not implemented, so recording it would state something every report contradicts';
  end if;

  select coalesce(max(version), 0) + 1 into v_version from acc_company_setting_version;
  insert into acc_company_setting_version
    (version, legal_name, dba_name, ein_ref, address_line1, address_line2, city, region,
     postal_code, country, fiscal_year_start_month, base_currency_code, time_zone,
     accounting_basis, default_payment_terms_days,
     inventory_valuation_method, inventory_policy_memo, pay_note, email, phone, created_by)
  values
    (v_version, p_legal_name, p_dba_name, p_ein_ref, p_address_line1, p_address_line2, p_city,
     p_region, p_postal_code, p_country,
     coalesce(p_fiscal_year_start_month, 1), coalesce(p_base_currency_code, 'USD'),
     coalesce(p_time_zone, 'America/New_York'),
     v_basis,
     coalesce(p_default_payment_terms_days, 30),
     v_method,
     coalesce(nullif(btrim(coalesce(p_inventory_policy_memo, '')), ''), v_current.inventory_policy_memo),
     case when p_pay_note is null then v_current.pay_note else nullif(btrim(p_pay_note), '') end,
     case when p_email is null then v_current.email else nullif(btrim(p_email), '') end,
     case when p_phone is null then v_current.phone else nullif(btrim(p_phone), '') end,
     auth.uid())
  returning id into v_id;

  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_company_setting_version', v_id, 'insert', auth.uid());
  return v_id;
end;
$$;

revoke all on function acc_save_company_settings(
  text, text, text, text, text, text, text, text, text, int, text, text, text, int, text, text, text, text, text)
  from public, anon;
grant execute on function acc_save_company_settings(
  text, text, text, text, text, text, text, text, text, int, text, text, text, int, text, text, text, text, text)
  to authenticated, service_role;
