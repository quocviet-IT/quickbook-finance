-- ============================================================================
-- Seed base data: currencies, a starter Vietnamese Chart of Accounts, and
-- VAT tax codes. Runs as a migration (bypasses RLS).
-- ============================================================================

-- Currencies (VND is base, 0 decimal places).
insert into acc_currency (code, name, symbol, decimal_places, is_base) values
  ('VND', 'Vietnamese Dong', '₫', 0, true),
  ('USD', 'US Dollar', '$', 2, false)
on conflict (code) do nothing;

-- Starter Chart of Accounts (manual §8 numbering ranges).
insert into acc_account (account_code, name, account_type, currency_code, is_posting_account) values
  ('1000', 'Cash on Hand',            'bank',                'VND', true),
  ('1010', 'Bank Account - VND',      'bank',                'VND', true),
  ('1100', 'Accounts Receivable',     'accounts_receivable', 'VND', true),
  ('1200', 'Inventory',               'current_asset',       'VND', true),
  ('1210', 'Undeposited Funds',       'current_asset',       'VND', true),
  ('1500', 'Fixed Assets',            'fixed_asset',         'VND', true),
  ('2000', 'Accounts Payable',        'accounts_payable',    'VND', true),
  ('2100', 'VAT Payable (Output)',    'current_liability',   'VND', true),
  ('2110', 'VAT Receivable (Input)',  'current_asset',       'VND', true),
  ('3000', 'Owner Equity',            'equity',              'VND', true),
  ('3900', 'Opening Balance Equity',  'equity',              'VND', true),
  ('4000', 'Sales Revenue',           'income',              'VND', true),
  ('4100', 'Service Revenue',         'income',              'VND', true),
  ('5000', 'Cost of Goods Sold',      'cost_of_goods_sold',  'VND', true),
  ('6000', 'Operating Expenses',      'expense',             'VND', true),
  ('7000', 'Other Income',            'other_income',        'VND', true),
  ('7500', 'Other Expenses',          'other_expense',       'VND', true)
on conflict (account_code) do nothing;

-- VAT tax codes, pointing at the relevant control accounts.
insert into acc_tax_code (code, name, rate_percent, direction, tax_account_id)
select v.code, v.name, v.rate_percent, v.direction::acc_tax_direction,
       (select id from acc_account where account_code = v.acc_code)
from (values
  ('VAT10',   'VAT 10% (Sales)',      10, 'sales',    '2100'),
  ('VAT8',    'VAT 8% (Sales)',        8, 'sales',    '2100'),
  ('VAT0',    'VAT 0% (Sales)',        0, 'sales',    '2100'),
  ('OUT',     'Out of Scope',          0, 'none',     null),
  ('VATIN10', 'VAT 10% (Purchase)',   10, 'purchase', '2110')
) as v(code, name, rate_percent, direction, acc_code)
on conflict (code) do nothing;

-- Set a sensible default sales tax code on revenue accounts.
update acc_account
   set default_tax_code_id = (select id from acc_tax_code where code = 'VAT10')
 where account_code in ('4000', '4100')
   and default_tax_code_id is null;
