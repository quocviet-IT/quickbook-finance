-- A bank line can already record that it settled a customer receipt
-- (acc_reconciliation.payment_id) or that it belongs to a posted journal line
-- (journal_line_id). Paying a vendor bill from a bank line has nowhere to
-- record itself, so give it one.
alter table acc_reconciliation
  add column if not exists bill_payment_id uuid references acc_bill_payment (id) on delete cascade;

create index if not exists acc_reconciliation_bill_payment_idx
  on acc_reconciliation (bill_payment_id)
  where bill_payment_id is not null;

-- The same guard journal_line_id already carries: one approved bank match per
-- settlement. Without it two bank lines could each claim the same payment, and
-- the statement would reconcile twice against one movement of money.
create unique index if not exists acc_reconciliation_bill_payment_once
  on acc_reconciliation (bill_payment_id)
  where bill_payment_id is not null and status = 'approved';
