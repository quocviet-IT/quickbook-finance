-- ============================================================================
-- 0168  Bank lines, reconciliations, purchase orders, goods receipts, sales
--       tax payments and the posting configuration are read-only to a
--       signed-in session (2.58)
--
-- Phase 3 of the permission plan, first part (R5). Until now any staff member
-- could write these seventeen tables straight through the API: change the
-- amount or status of an imported bank line, edit a completed reconciliation,
-- alter a received purchase order or a posted sales tax payment, add a
-- reversal link, or change currencies and posting tolerances - all without
-- the functions that check the period, post the entry and keep the books in
-- step. The screens never do: every change goes through those functions.
--
-- Checked against the live database before this was written (2026-10-26):
--   * the same 20 write policies stand on these tables in all seven schemas;
--   * no function that runs as its caller writes any of them; every writer
--     runs as its owner;
--   * the application writes none of them directly (only an end-to-end
--     clean-up does, with the service role, which this does not touch);
--   * each table keeps its own read policy, so nothing that can be seen today
--     stops being visible.
--
-- Master data the screens still write directly - accounts, customers,
-- vendors, items, bank accounts, bank rules, tax codes and the like - is left
-- for the second part, which needs functions for those screens first.
-- ============================================================================
set search_path = public;

-- Banking and reconciliation
drop policy if exists acc_bank_txn_write on acc_bank_transaction;
drop policy if exists acc_bank_batch_write on acc_bank_import_batch;
drop policy if exists acc_bank_category_ins on acc_bank_category;
drop policy if exists acc_bank_category_upd on acc_bank_category;
drop policy if exists acc_recon_write on acc_reconciliation;
drop policy if exists acc_recon_line_ins on acc_reconciliation_line;
drop policy if exists acc_recon_line_del on acc_reconciliation_line;
drop policy if exists acc_stmt_recon_ins on acc_statement_reconciliation;
drop policy if exists acc_stmt_recon_upd on acc_statement_reconciliation;

-- Purchasing, sales tax payments and reversals
drop policy if exists acc_po_write on acc_purchase_order;
drop policy if exists acc_po_line_write on acc_purchase_order_line;
drop policy if exists acc_receipt_write on acc_goods_receipt;
drop policy if exists acc_receipt_line_write on acc_goods_receipt_line;
drop policy if exists acc_tax_payment_write on acc_tax_payment;
drop policy if exists acc_reversal_link_insert on acc_journal_reversal_link;

-- Posting configuration
drop policy if exists acc_currency_admin on acc_currency;
drop policy if exists acc_exchange_admin on acc_exchange_rate;
drop policy if exists acc_purchasing_config_write on acc_purchasing_config;
drop policy if exists acc_afda_rate_write on acc_afda_rate;
drop policy if exists acc_1099_box_write on acc_1099_box;

revoke insert, update, delete, truncate on
  acc_bank_transaction, acc_bank_import_batch, acc_bank_category,
  acc_reconciliation, acc_reconciliation_line, acc_statement_reconciliation,
  acc_purchase_order, acc_purchase_order_line, acc_goods_receipt, acc_goods_receipt_line,
  acc_tax_payment, acc_journal_reversal_link,
  acc_currency, acc_exchange_rate, acc_purchasing_config, acc_afda_rate, acc_1099_box
from authenticated, anon;

grant select on
  acc_bank_transaction, acc_bank_import_batch, acc_bank_category,
  acc_reconciliation, acc_reconciliation_line, acc_statement_reconciliation,
  acc_purchase_order, acc_purchase_order_line, acc_goods_receipt, acc_goods_receipt_line,
  acc_tax_payment, acc_journal_reversal_link,
  acc_currency, acc_exchange_rate, acc_purchasing_config, acc_afda_rate, acc_1099_box
to authenticated;
