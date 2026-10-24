-- ============================================================================
-- 0165  The sales and purchase documents are read-only to a signed-in session
--
-- Until now, 26 row-level security policies let any staff member insert,
-- update and delete invoices, bills, payments, expenses, credits, refunds and
-- write-offs, and their lines and allocations, straight through the API. The
-- screens never do: every write goes through a database function that checks
-- the document, posts its journal entry and keeps the two in step. A direct
-- write skips all of that, so a staff member with the API key and their own
-- sign-in could, for instance, change an issued invoice's total or mark it
-- paid, and Accounts Receivable would no longer agree with the ledger.
--
-- Checked against the live database before this was written (2026-10-24):
--   * all 33 functions that write these tables run as their owner (security
--     definer), so none of them depends on the policies dropped here;
--   * every function the application calls that writes anything is a
--     security definer (206 called, none an exception);
--   * the application code has no direct insert, update or delete on these
--     tables; backup restore writes them over its own owner connection;
--   * each table keeps its own read policy, so nothing that can be seen today
--     stops being visible.
--
-- What it does, per table: drops the write policies (with row-level security
-- on and no write policy, a direct insert is refused and a direct update or
-- delete finds no row), and revokes the write privileges as well, so a direct
-- write is refused outright here. Reading is unchanged.
--
-- A company provisioned after this grants every table to `authenticated` once
-- its migrations have run (lib/services/company-provisioning.ts); there the
-- dropped policies are what refuses the write.
-- ============================================================================
set search_path = public;

-- Invoices and customer payments
drop policy if exists acc_invoice_write on acc_invoice;
drop policy if exists acc_invoice_line_write on acc_invoice_line;
drop policy if exists acc_payment_write on acc_payment;
drop policy if exists acc_payment_alloc_write on acc_payment_allocation;

-- Bills, bill payments and expenses
drop policy if exists acc_bill_write on acc_bill;
drop policy if exists acc_bill_line_write on acc_bill_line;
drop policy if exists acc_bill_payment_write on acc_bill_payment;
drop policy if exists acc_bp_alloc_write on acc_bill_payment_allocation;
drop policy if exists acc_expense_write on acc_expense;
drop policy if exists acc_expense_line_write on acc_expense_line;

-- Credit memos, vendor credits, refunds and write-offs
drop policy if exists acc_credit_memo_ins on acc_credit_memo;
drop policy if exists acc_credit_memo_upd on acc_credit_memo;
drop policy if exists acc_credit_memo_line_ins on acc_credit_memo_line;
drop policy if exists acc_credit_memo_line_upd on acc_credit_memo_line;
drop policy if exists acc_credit_memo_allocation_ins on acc_credit_memo_allocation;
drop policy if exists acc_credit_memo_allocation_upd on acc_credit_memo_allocation;
drop policy if exists acc_vendor_credit_ins on acc_vendor_credit;
drop policy if exists acc_vendor_credit_upd on acc_vendor_credit;
drop policy if exists acc_vendor_credit_line_ins on acc_vendor_credit_line;
drop policy if exists acc_vendor_credit_line_upd on acc_vendor_credit_line;
drop policy if exists acc_vendor_credit_allocation_ins on acc_vendor_credit_allocation;
drop policy if exists acc_vendor_credit_allocation_upd on acc_vendor_credit_allocation;
drop policy if exists acc_customer_refund_ins on acc_customer_refund;
drop policy if exists acc_customer_refund_upd on acc_customer_refund;
drop policy if exists acc_write_off_ins on acc_write_off;
drop policy if exists acc_write_off_upd on acc_write_off;

revoke insert, update, delete, truncate on
  acc_invoice, acc_invoice_line, acc_payment, acc_payment_allocation,
  acc_bill, acc_bill_line, acc_bill_payment, acc_bill_payment_allocation,
  acc_expense, acc_expense_line,
  acc_credit_memo, acc_credit_memo_line, acc_credit_memo_allocation,
  acc_vendor_credit, acc_vendor_credit_line, acc_vendor_credit_allocation,
  acc_customer_refund, acc_write_off
from authenticated, anon;

grant select on
  acc_invoice, acc_invoice_line, acc_payment, acc_payment_allocation,
  acc_bill, acc_bill_line, acc_bill_payment, acc_bill_payment_allocation,
  acc_expense, acc_expense_line,
  acc_credit_memo, acc_credit_memo_line, acc_credit_memo_allocation,
  acc_vendor_credit, acc_vendor_credit_line, acc_vendor_credit_allocation,
  acc_customer_refund, acc_write_off
to authenticated;
