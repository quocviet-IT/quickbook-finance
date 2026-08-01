-- ============================================================================
-- 0078 — The inventory accounting policy, written down.
--
-- Inventory has always been carried at weighted average cost. The arithmetic
-- was never in doubt; what was missing is a record saying so, which is what
-- ASC 330-10-50-1 asks for and what an auditor asks for first.
--
-- The policy goes on the company settings, which are already versioned with
-- effective dates — so the memorandum is retained with its history for free,
-- and a past period can be shown under the policy that applied at the time.
--
-- Choosing a method the engine does not implement is refused. A policy that
-- says FIFO over an engine computing an average is not a disclosure; it is a
-- statement the ledger contradicts.
-- ============================================================================

create type acc_inventory_valuation_method as enum (
  'average_cost',
  'fifo',
  'specific_identification'
);

alter table acc_company_setting_version
  add column if not exists inventory_valuation_method acc_inventory_valuation_method
    not null default 'average_cost',
  add column if not exists inventory_policy_memo text;

comment on column acc_company_setting_version.inventory_policy_memo is
  'Why this method was chosen and when it was adopted. Retained per version, so the policy in force on any past date can be shown.';

-- LIFO is deliberately absent. It is permitted in US GAAP, but the conformity
-- rule (IRC 472(c)) requires it in the financial statements once it is used on
-- the tax return, it is prohibited under IFRS, and it needs a layer engine and
-- a reserve. It is a decision, not a setting, and nobody should be able to pick
-- it from a dropdown.

/** The one method the costing engine actually implements. */
create or replace function acc_implemented_valuation_methods()
returns acc_inventory_valuation_method[]
language sql immutable as $$
  select array['average_cost']::acc_inventory_valuation_method[];
$$;

create or replace function acc_save_company_settings(
  p_legal_name text, p_dba_name text, p_ein_ref text,
  p_address_line1 text, p_address_line2 text, p_city text, p_region text,
  p_postal_code text, p_country text,
  p_fiscal_year_start_month int, p_base_currency_code text, p_time_zone text,
  p_accounting_basis text, p_default_payment_terms_days int,
  p_inventory_valuation_method text default null,
  p_inventory_policy_memo text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_version int;
  v_id      uuid;
  v_current acc_company_setting_version;
  v_method  acc_inventory_valuation_method;
begin
  if not acc_is_admin() then raise exception 'Only an admin can change company settings'; end if;
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
     inventory_valuation_method, inventory_policy_memo, created_by)
  values
    (v_version, p_legal_name, p_dba_name, p_ein_ref, p_address_line1, p_address_line2, p_city,
     p_region, p_postal_code, p_country,
     coalesce(p_fiscal_year_start_month, 1), coalesce(p_base_currency_code, 'USD'),
     coalesce(p_time_zone, 'America/New_York'),
     coalesce(p_accounting_basis, 'accrual')::acc_accounting_basis,
     coalesce(p_default_payment_terms_days, 30),
     v_method,
     coalesce(nullif(btrim(coalesce(p_inventory_policy_memo, '')), ''), v_current.inventory_policy_memo),
     auth.uid())
  returning id into v_id;

  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_company_setting_version', v_id, 'insert', auth.uid());
  return v_id;
end;
$$;

drop function if exists acc_save_company_settings(
  text, text, text, text, text, text, text, text, text, int, text, text, text, int);

revoke all on function acc_save_company_settings(
  text, text, text, text, text, text, text, text, text, int, text, text, text, int, text, text) from public;
grant execute on function acc_save_company_settings(
  text, text, text, text, text, text, text, text, text, int, text, text, text, int, text, text)
  to authenticated, service_role;

-- The policy in force today, for any report that has to state it.
create or replace function acc_inventory_policy()
returns table (method text, memo text, effective_from date)
language sql stable security definer set search_path = public as $$
  select v.inventory_valuation_method::text, v.inventory_policy_memo, v.effective_from
    from acc_company_setting_version v
   order by v.version desc
   limit 1;
$$;

revoke all on function acc_inventory_policy() from public;
grant execute on function acc_inventory_policy() to authenticated, service_role;

-- Write down the memorandum that has been true all along but never recorded.
update acc_company_setting_version
   set inventory_policy_memo =
'Inventory is measured at weighted average cost (ASC 330-10-30-9). The average is recomputed on every receipt and every sale relieves inventory at the average then in force, so a single method applies to all inventory items with no exceptions.

Measurement after acquisition follows the lower of cost and net realisable value (ASC 330-10-35-1B, as amended by ASU 2015-11). The lower-of-cost-or-market test with its market ceiling and floor does not apply, as it is retained only for LIFO and the retail inventory method.

Adopted on the adoption of the inventory module. Recorded 2026-08-01; no change of method has occurred.'
 where version = (select max(version) from acc_company_setting_version)
   and inventory_policy_memo is null;
