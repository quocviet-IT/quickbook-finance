-- ============================================================================
-- Complete Fixed Asset lifecycle: prior depreciation, batch processing, and
-- disposal. Book depreciation remains separate from tax/MACRS depreciation.
-- ============================================================================

alter table acc_fixed_asset
  add column opening_accumulated_depreciation_minor bigint not null default 0
    check (opening_accumulated_depreciation_minor >= 0),
  add column opening_as_of_date date,
  add column opening_journal_entry_id uuid references acc_journal_entry (id),
  add column disposal_sale_price_minor bigint,
  add column disposal_cost_minor bigint,
  add column disposal_net_proceeds_minor bigint,
  add column disposal_gain_loss_minor bigint,
  add column disposal_proceeds_account_id uuid references acc_account (id),
  add column disposal_gain_account_id uuid references acc_account (id),
  add column disposal_loss_account_id uuid references acc_account (id),
  add column disposal_journal_entry_id uuid references acc_journal_entry (id),
  add column disposal_reason text,
  add constraint acc_fixed_asset_opening_amount_check
    check (opening_accumulated_depreciation_minor <= cost_minor - salvage_value_minor),
  add constraint acc_fixed_asset_opening_date_check
    check (
      (opening_accumulated_depreciation_minor = 0)
      or opening_as_of_date is not null
    ),
  add constraint acc_fixed_asset_disposal_amounts_check
    check (
      (status <> 'disposed')
      or (
        disposal_sale_price_minor is not null and disposal_sale_price_minor >= 0
        and disposal_cost_minor is not null and disposal_cost_minor >= 0
        and disposal_net_proceeds_minor = disposal_sale_price_minor - disposal_cost_minor
        and disposal_gain_loss_minor is not null
        and disposal_journal_entry_id is not null
        and coalesce(btrim(disposal_reason), '') <> ''
      )
    );

-- Replace the original two-state constraint with lifecycle-aware states.
do $$
declare v_constraint text;
begin
  for v_constraint in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'acc_asset_depreciation_schedule'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%status%'
       and pg_get_constraintdef(c.oid) like '%journal_entry_id%'
  loop
    execute format('alter table acc_asset_depreciation_schedule drop constraint %I', v_constraint);
  end loop;
end;
$$;

alter table acc_asset_depreciation_schedule
  add constraint acc_asset_depreciation_state_check check (
    (status = 'planned' and posted_amount_minor = 0 and journal_entry_id is null)
    or
    (status = 'opening' and posted_amount_minor > 0
      and posted_amount_minor <= planned_amount_minor and journal_entry_id is null)
    or
    (status = 'posted' and posted_amount_minor = planned_amount_minor
      and journal_entry_id is not null and posted_at is not null)
    or
    (status = 'cancelled' and posted_amount_minor >= 0
      and posted_amount_minor <= planned_amount_minor and journal_entry_id is null)
  );

-- Default disposal accounts; existing installations keep any account already
-- using these codes.
insert into acc_account
  (account_code, name, account_type, detail_type, currency_code, is_posting_account, status)
select '7990', 'Gain on Asset Disposal', 'other_income', 'Asset disposal gain', code, true, 'active'
  from acc_currency where is_base
on conflict (account_code) do nothing;

insert into acc_account
  (account_code, name, account_type, detail_type, currency_code, is_posting_account, status)
select '8990', 'Loss on Asset Disposal', 'other_expense', 'Asset disposal loss', code, true, 'active'
  from acc_currency where is_base
on conflict (account_code) do nothing;

insert into acc_permission (key, label, category, description, is_enforced) values
  ('fixed_assets.import', 'Import existing fixed assets', 'Accounting',
   'Import prior fixed assets and opening accumulated depreciation', true),
  ('fixed_assets.dispose', 'Dispose fixed assets', 'Accounting',
   'Retire or sell an asset and post the resulting gain or loss', true)
on conflict (key) do update
  set label = excluded.label,
      category = excluded.category,
      description = excluded.description,
      is_enforced = true;

insert into acc_role_permission (role, permission_key, allowed)
select r.role, p.key, r.role in ('admin'::acc_app_role, 'accountant'::acc_app_role)
  from (values ('admin'::acc_app_role), ('accountant'::acc_app_role), ('viewer'::acc_app_role)) r(role)
  cross join (values ('fixed_assets.import'), ('fixed_assets.dispose')) p(key)
on conflict (role, permission_key) do nothing;
