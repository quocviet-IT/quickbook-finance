-- supabase/migrations/0021_ar_ap_reports.sql
-- ============================================================================
-- AR/AP read RPCs: open-item ageing and statements. Ageing returns one row per
-- open document (positive) and open credit/unapplied payment (negative) with its
-- due date, so the app can bucket by age and reconcile the total to the AR/AP
-- control account. Runs as invoker (RLS applies).
-- ============================================================================

-- AR ageing: open invoices (balance_due>0) as positives; open credit memos and
-- unapplied customer payments as negatives (Current). Reference date = due date
-- for invoices, document date for credits/payments.
create or replace function acc_ar_ageing(p_as_of date)
returns table (customer_id uuid, customer_name text, doc_type text, doc_number text,
               doc_date date, due_date date, balance_minor bigint)
language sql stable as $$
  select c.id, c.name, 'invoice', i.invoice_number, i.issue_date, coalesce(i.due_date, i.issue_date), i.balance_due_minor
    from acc_invoice i join acc_customer c on c.id = i.customer_id
   where i.status in ('issued','partial') and i.balance_due_minor > 0 and i.issue_date <= p_as_of
  union all
  select c.id, c.name, 'credit_memo', m.credit_memo_number, m.memo_date, m.memo_date, -m.balance_remaining_minor
    from acc_credit_memo m join acc_customer c on c.id = m.customer_id
   where m.status in ('issued','partial') and m.balance_remaining_minor > 0 and m.memo_date <= p_as_of
  union all
  select c.id, c.name, 'payment', p.payment_number, p.payment_date, p.payment_date, -p.unapplied_minor
    from acc_payment p join acc_customer c on c.id = p.customer_id
   where p.status in ('unapplied','partial') and p.unapplied_minor > 0 and p.payment_date <= p_as_of;
$$;

create or replace function acc_ap_ageing(p_as_of date)
returns table (vendor_id uuid, vendor_name text, doc_type text, doc_number text,
               doc_date date, due_date date, balance_minor bigint)
language sql stable as $$
  select v.id, v.name, 'bill', b.bill_number, b.bill_date, coalesce(b.due_date, b.bill_date), b.balance_due_minor
    from acc_bill b join acc_vendor v on v.id = b.vendor_id
   where b.status in ('open','partial') and b.balance_due_minor > 0 and b.bill_date <= p_as_of
  union all
  select v.id, v.name, 'vendor_credit', vc.vendor_credit_number, vc.credit_date, vc.credit_date, -vc.balance_remaining_minor
    from acc_vendor_credit vc join acc_vendor v on v.id = vc.vendor_id
   where vc.status in ('issued','partial') and vc.balance_remaining_minor > 0 and vc.credit_date <= p_as_of
  union all
  select v.id, v.name, 'bill_payment', bp.payment_number, bp.payment_date, bp.payment_date, -bp.unapplied_minor
    from acc_bill_payment bp join acc_vendor v on v.id = bp.vendor_id
   where bp.status in ('unapplied','partial') and bp.unapplied_minor > 0 and bp.payment_date <= p_as_of;
$$;

-- Customer statement: activity rows in [p_from, p_to] with a signed AR effect
-- (invoice + / payment - / credit memo - / refund +). The app adds the opening
-- balance (activity before p_from) to produce a running balance.
create or replace function acc_customer_statement(p_customer_id uuid, p_from date, p_to date)
returns table (txn_date date, doc_type text, doc_number text, amount_minor bigint)
language sql stable as $$
  select i.issue_date, 'invoice', i.invoice_number, i.total_minor
    from acc_invoice i where i.customer_id = p_customer_id and i.status <> 'void' and i.issue_date between p_from and p_to
  union all
  select p.payment_date, 'payment', p.payment_number, -p.amount_minor
    from acc_payment p where p.customer_id = p_customer_id and p.status <> 'void' and p.payment_date between p_from and p_to
  union all
  select m.memo_date, 'credit_memo', m.credit_memo_number, -m.total_minor
    from acc_credit_memo m where m.customer_id = p_customer_id and m.status <> 'void' and m.memo_date between p_from and p_to
  union all
  select r.refund_date, 'refund', r.refund_number, r.amount_minor
    from acc_customer_refund r where r.customer_id = p_customer_id and r.status <> 'void' and r.refund_date between p_from and p_to
  order by 1, 3;
$$;

create or replace function acc_vendor_statement(p_vendor_id uuid, p_from date, p_to date)
returns table (txn_date date, doc_type text, doc_number text, amount_minor bigint)
language sql stable as $$
  select b.bill_date, 'bill', b.bill_number, b.total_minor
    from acc_bill b where b.vendor_id = p_vendor_id and b.status <> 'void' and b.bill_date between p_from and p_to
  union all
  select bp.payment_date, 'bill_payment', bp.payment_number, -bp.amount_minor
    from acc_bill_payment bp where bp.vendor_id = p_vendor_id and bp.status <> 'void' and bp.payment_date between p_from and p_to
  union all
  select vc.credit_date, 'vendor_credit', vc.vendor_credit_number, -vc.total_minor
    from acc_vendor_credit vc where vc.vendor_id = p_vendor_id and vc.status <> 'void' and vc.credit_date between p_from and p_to
  order by 1, 3;
$$;
