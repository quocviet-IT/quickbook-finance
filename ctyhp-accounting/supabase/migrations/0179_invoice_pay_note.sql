-- ============================================================================
-- 0179  How to pay, printed at the foot of every invoice (2.83)
--
-- An invoice said what was owed and by when, but not how to pay it: the bank
-- details or the name a check is made out to had to be typed into each
-- invoice's memo, or sent separately. The company now keeps the words once, in
-- its settings, and every invoice prints them under the totals.
--
-- acc_save_company_settings takes the note as one more argument. Left out
-- (null), the note already saved is kept, so a caller that predates it cannot
-- wipe it; an empty string clears it. Otherwise the function is the one 0169
-- installed: settings.manage, a new version per save, the audit entry.
-- ============================================================================
set search_path = public;

alter table acc_company_setting_version
  add column if not exists pay_note text;

alter table acc_company_setting_version
  drop constraint if exists acc_company_setting_version_pay_note_len;
alter table acc_company_setting_version
  add constraint acc_company_setting_version_pay_note_len check (pay_note is null or char_length(pay_note) <= 600);

drop function if exists acc_save_company_settings(
  text, text, text, text, text, text, text, text, text, int, text, text, text, int, text, text);

create or replace function acc_save_company_settings(
  p_legal_name text, p_dba_name text, p_ein_ref text,
  p_address_line1 text, p_address_line2 text, p_city text, p_region text,
  p_postal_code text, p_country text,
  p_fiscal_year_start_month int, p_base_currency_code text, p_time_zone text,
  p_accounting_basis text, p_default_payment_terms_days int,
  p_inventory_valuation_method text default null,
  p_inventory_policy_memo text default null,
  p_pay_note text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_version int;
  v_id      uuid;
  v_current acc_company_setting_version;
  v_method  acc_inventory_valuation_method;
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

  select coalesce(max(version), 0) + 1 into v_version from acc_company_setting_version;
  insert into acc_company_setting_version
    (version, legal_name, dba_name, ein_ref, address_line1, address_line2, city, region,
     postal_code, country, fiscal_year_start_month, base_currency_code, time_zone,
     accounting_basis, default_payment_terms_days,
     inventory_valuation_method, inventory_policy_memo, pay_note, created_by)
  values
    (v_version, p_legal_name, p_dba_name, p_ein_ref, p_address_line1, p_address_line2, p_city,
     p_region, p_postal_code, p_country,
     coalesce(p_fiscal_year_start_month, 1), coalesce(p_base_currency_code, 'USD'),
     coalesce(p_time_zone, 'America/New_York'),
     coalesce(p_accounting_basis, 'accrual')::acc_accounting_basis,
     coalesce(p_default_payment_terms_days, 30),
     v_method,
     coalesce(nullif(btrim(coalesce(p_inventory_policy_memo, '')), ''), v_current.inventory_policy_memo),
     case when p_pay_note is null then v_current.pay_note else nullif(btrim(p_pay_note), '') end,
     auth.uid())
  returning id into v_id;

  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_company_setting_version', v_id, 'insert', auth.uid());
  return v_id;
end;
$$;

revoke all on function acc_save_company_settings(
  text, text, text, text, text, text, text, text, text, int, text, text, text, int, text, text, text) from public, anon;
grant execute on function acc_save_company_settings(
  text, text, text, text, text, text, text, text, text, int, text, text, text, int, text, text, text)
  to authenticated, service_role;
