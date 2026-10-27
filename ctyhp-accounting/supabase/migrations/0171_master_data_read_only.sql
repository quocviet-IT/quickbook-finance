-- ============================================================================
-- 0171  Master data changes only through its functions (2.61)
--
-- Phase 3, second part, of the permission plan: the lock. 2.60 (0170) gave
-- every master-data write the screens make a function of its own, and the
-- application has used those functions since it was deployed. Nothing in the
-- application writes these eleven tables directly any more, so this drops
-- their nineteen write policies, the same in all seven schemas, and takes
-- writing away from sessions:
--
--   acc_account, acc_bank_account, acc_bank_rule, acc_banking_preference,
--   acc_customer, acc_item, acc_recurring_template, acc_related_company,
--   acc_repayment_account, acc_tax_code, acc_vendor
--
-- Each keeps its read policy. The functions run as their owner, so they keep
-- writing; the service role keeps everything.
--
-- With this, the only tables a session may write directly are the three it
-- files into, each by a rule that pins the row to its writer: attachments
-- (acc_document_attachment) and feedback reports and their screenshots
-- (acc_feedback_report, acc_feedback_attachment).
-- ============================================================================
set search_path = public;

drop policy if exists acc_account_write on acc_account;
drop policy if exists acc_bank_account_write on acc_bank_account;
drop policy if exists acc_bank_rule_del on acc_bank_rule;
drop policy if exists acc_bank_rule_ins on acc_bank_rule;
drop policy if exists acc_bank_rule_upd on acc_bank_rule;
drop policy if exists acc_banking_preference_ins on acc_banking_preference;
drop policy if exists acc_banking_preference_upd on acc_banking_preference;
drop policy if exists acc_customer_write on acc_customer;
drop policy if exists acc_item_write on acc_item;
drop policy if exists acc_recurring_template_insert on acc_recurring_template;
drop policy if exists acc_recurring_template_update on acc_recurring_template;
drop policy if exists acc_related_company_del on acc_related_company;
drop policy if exists acc_related_company_ins on acc_related_company;
drop policy if exists acc_related_company_upd on acc_related_company;
drop policy if exists acc_repayment_account_del on acc_repayment_account;
drop policy if exists acc_repayment_account_ins on acc_repayment_account;
drop policy if exists acc_repayment_account_upd on acc_repayment_account;
drop policy if exists acc_tax_code_admin on acc_tax_code;
drop policy if exists acc_vendor_write on acc_vendor;

revoke insert, update, delete, truncate on
  acc_account, acc_bank_account, acc_bank_rule, acc_banking_preference, acc_customer, acc_item,
  acc_recurring_template, acc_related_company, acc_repayment_account, acc_tax_code, acc_vendor
  from authenticated, anon;

grant select on
  acc_account, acc_bank_account, acc_bank_rule, acc_banking_preference, acc_customer, acc_item,
  acc_recurring_template, acc_related_company, acc_repayment_account, acc_tax_code, acc_vendor
  to authenticated;
