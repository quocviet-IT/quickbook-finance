-- ============================================================================
-- 0153 — Account 7510 Cash Over and Short, in every existing company.
--
-- A cash count that finds the till over or short posts the difference here
-- unless the person chooses another account. New companies get the account from
-- the chart template (lib/domain/chart-templates.ts) as well.
--
-- This migration changes the chart of accounts of real companies, so it is kept
-- apart from the others (0152 and 0154) and is run only with the user's say-so.
-- It adds one row, and only where the code is free: a company that already uses
-- 7510 for something else keeps it untouched, and its count dialog asks for an
-- account instead.
-- ============================================================================

set search_path = public;

insert into acc_account
  (account_code, name, account_type, currency_code, is_posting_account, status, cash_flow_role)
select '7510', 'Cash Over and Short', 'other_expense', code, true, 'active', 'operating'
  from acc_currency where is_base
on conflict (account_code) do nothing;
