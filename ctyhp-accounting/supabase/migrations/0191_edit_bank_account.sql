-- ============================================================================
-- 0191  A bank account's name and number can be corrected (3.0.22)
--
-- A bank account could be added (acc_save_bank_account, 0170) and never
-- changed: the table has been read-only to the screens since 0171, and no
-- function updated it. Someone who named an account after the wrong bank had
-- one way to put it right — add the account again under the right name — and
-- then chose the same statement for it. Every line came in a second time, was
-- coded a second time, and the same money stood in the books twice, on a
-- second ledger account.
--
-- acc_update_bank_account changes the two columns that are only words about
-- the account: its name and its number as the person writes it. It does not
-- change the ledger account or the currency: lines are already posted to
-- them, and moving a bank account to another ledger account is not a rename.
-- Who may: the same people who may add one (staff). What is kept: the audit
-- trigger on the table (0058) writes the row before and after, so the old and
-- the new name are both in the audit log.
--
-- Additive: one new function. No table, column or existing function changes.
-- ============================================================================
set search_path = public;

create or replace function acc_update_bank_account(p_id uuid, p_values jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to change a bank account' using errcode = '42501';
  end if;
  if p_id is null then
    raise exception 'Choose the bank account to change';
  end if;
  -- A name may be left out of the change, but not saved empty.
  if coalesce(p_values, '{}'::jsonb) ? 'bank_name'
     and nullif(btrim(coalesce(p_values ->> 'bank_name', '')), '') is null then
    raise exception 'Enter the bank account''s name';
  end if;
  return acc_write_master('acc_bank_account', p_id, p_values, array['bank_name', 'account_number_masked']);
end;
$$;

revoke all on function acc_update_bank_account(uuid, jsonb) from public, anon;
grant execute on function acc_update_bank_account(uuid, jsonb) to authenticated, service_role;

comment on function acc_update_bank_account(uuid, jsonb) is
  'Correct a bank account''s name or number. The ledger account and currency are not changed here.';
