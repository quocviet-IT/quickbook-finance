-- ============================================================================
-- Localize base data for US accounting (English):
--   * base currency USD (VND kept as a secondary currency)
--   * accounts denominated in USD
--   * US "Sales Tax" terminology instead of VAT
-- Safe to run on the seeded (data-free) ledger.
-- ============================================================================

-- Flip base currency to USD (clear the old base first to satisfy the one-base index).
update acc_currency set is_base = false;
update acc_currency set is_base = true where code = 'USD';

-- Denominate seeded accounts in USD.
update acc_account set currency_code = 'USD' where currency_code = 'VND';

-- Rename tax control accounts to US sales-tax terminology.
update acc_account set name = 'Sales Tax Payable'    where account_code = '2100';
update acc_account set name = 'Sales Tax Receivable'  where account_code = '2110';
update acc_account set name = 'Operating Bank Account' where account_code = '1010';

-- Repurpose the tax codes in place (ids preserved, so account FKs stay valid).
update acc_tax_code set code = 'TAX',    name = 'Sales Tax',   rate_percent = 8.25, direction = 'sales'    where code = 'VAT10';
update acc_tax_code set code = 'TAX0',   name = 'Non-Taxable', rate_percent = 0,    direction = 'sales'    where code = 'VAT8';
update acc_tax_code set code = 'EXEMPT', name = 'Tax Exempt',  rate_percent = 0,    direction = 'sales'    where code = 'VAT0';
update acc_tax_code set code = 'NON',    name = 'Out of Scope',rate_percent = 0,    direction = 'none'     where code = 'OUT';
update acc_tax_code set code = 'USE',    name = 'Use Tax',     rate_percent = 8.25, direction = 'purchase' where code = 'VATIN10';
