-- ============================================================================
-- 0178  Customer and vendor statements that add up (2.81)
--
-- A statement is an opening balance, the period's activity, and a closing
-- balance. The opening was the ageing as of the day before the period: every
-- open document dated before the period at what is left on it TODAY. A payment
-- received during the period had therefore already come off the opening, and
-- came off again as a line of the period. An invoice of 1,000 on 15 August paid
-- on 10 September made September's statement close at -1,000, a credit the
-- customer does not have. Its footer called point-in-time statements "a later
-- enhancement".
--
-- The opening is now the same activity the lines are, dated before the period:
-- what was owed before it starts, whatever happened later. Opening plus the
-- period's lines is what was owed at its end, and one month's closing is the
-- next month's opening.
--
-- For that to hold, the lines must be every movement on the balance:
--
-- 1. Drafts are left out. A draft invoice, bill, credit memo or vendor credit
--    is posted nowhere and owed by nobody; since 2.63 sales prepares draft
--    invoices for an accountant to issue, and they were printing on the
--    customer's statement.
-- 2. A write-off is a line (side 'ar' on the customer's, 'ap' on the vendor's):
--    it takes a document's balance down without a payment or credit.
-- 3. An early payment discount taken on a bill is a line on the vendor's
--    statement: the bill is settled by the cash and the discount (0076), and
--    only the cash was a line. It is dated by the payment that took it, the
--    bill's last payment on or before its discount date.
--
-- acc_customer_statement_opening and acc_vendor_statement_opening return the
-- opening as one figure, so a customer with years of history is not sent row by
-- row to be added up.
-- ============================================================================
set search_path = public;

create or replace function acc_customer_statement(p_customer_id uuid, p_from date, p_to date)
returns table(txn_date date, doc_type text, doc_number text, amount_minor bigint)
language sql stable as $$
  select i.issue_date, 'invoice', i.invoice_number, i.total_minor
    from acc_invoice i where i.customer_id = p_customer_id and i.status not in ('void', 'draft') and i.issue_date between p_from and p_to
  union all
  select p.payment_date, 'payment', p.payment_number, -p.amount_minor
    from acc_payment p where p.customer_id = p_customer_id and p.status <> 'void' and p.payment_date between p_from and p_to
  union all
  select m.memo_date, 'credit_memo', m.credit_memo_number, -m.total_minor
    from acc_credit_memo m where m.customer_id = p_customer_id and m.status not in ('void', 'draft') and m.memo_date between p_from and p_to
  union all
  select r.refund_date, 'refund', r.refund_number, r.amount_minor
    from acc_customer_refund r where r.customer_id = p_customer_id and r.status <> 'void' and r.refund_date between p_from and p_to
  union all
  select w.write_off_date, 'write_off', w.write_off_number, -w.amount_minor
    from acc_write_off w join acc_invoice i on i.id = w.invoice_id
   where w.side = 'ar' and i.customer_id = p_customer_id and w.status = 'posted' and w.write_off_date between p_from and p_to
  order by 1, 3;
$$;

create or replace function acc_vendor_statement(p_vendor_id uuid, p_from date, p_to date)
returns table(txn_date date, doc_type text, doc_number text, amount_minor bigint)
language sql stable as $$
  -- A discount reads after the payment that took it, on the same day.
  select u.txn_date, u.doc_type, u.doc_number, u.amount_minor from (
  select b.bill_date as txn_date, 'bill' as doc_type, b.bill_number as doc_number, b.total_minor as amount_minor
    from acc_bill b where b.vendor_id = p_vendor_id and b.status not in ('void', 'draft') and b.bill_date between p_from and p_to
  union all
  select bp.payment_date, 'bill_payment', bp.payment_number, -bp.amount_minor
    from acc_bill_payment bp where bp.vendor_id = p_vendor_id and bp.status <> 'void' and bp.payment_date between p_from and p_to
  union all
  select vc.credit_date, 'vendor_credit', vc.vendor_credit_number, -vc.total_minor
    from acc_vendor_credit vc where vc.vendor_id = p_vendor_id and vc.status not in ('void', 'draft') and vc.credit_date between p_from and p_to
  union all
  select w.write_off_date, 'write_off', w.write_off_number, -w.amount_minor
    from acc_write_off w join acc_bill b on b.id = w.bill_id
   where w.side = 'ap' and b.vendor_id = p_vendor_id and w.status = 'posted' and w.write_off_date between p_from and p_to
  union all
  select d.taken_on, 'discount', d.bill_number, -d.discount_taken_minor
    from (
      select b.bill_number, b.discount_taken_minor,
             coalesce(
               (select max(bp.payment_date)
                  from acc_bill_payment_allocation a
                  join acc_bill_payment bp on bp.id = a.bill_payment_id
                 where a.bill_id = b.id and bp.status <> 'void'
                   and (b.discount_due_date is null or bp.payment_date <= b.discount_due_date)),
               b.discount_due_date, b.bill_date) as taken_on
        from acc_bill b
       where b.vendor_id = p_vendor_id and b.status not in ('void', 'draft') and b.discount_taken_minor > 0
    ) d
   where d.taken_on between p_from and p_to
  ) u
  order by u.txn_date, u.doc_type = 'discount', u.doc_number;
$$;

-- What was owed before a day: the statement's own lines, from the beginning.
create or replace function acc_customer_statement_opening(p_customer_id uuid, p_before date)
returns bigint
language sql stable as $$
  select coalesce(sum(s.amount_minor), 0)::bigint
    from acc_customer_statement(p_customer_id, '-infinity'::date, p_before - 1) s;
$$;

create or replace function acc_vendor_statement_opening(p_vendor_id uuid, p_before date)
returns bigint
language sql stable as $$
  select coalesce(sum(s.amount_minor), 0)::bigint
    from acc_vendor_statement(p_vendor_id, '-infinity'::date, p_before - 1) s;
$$;

revoke all on function acc_customer_statement_opening(uuid, date) from public, anon;
grant execute on function acc_customer_statement_opening(uuid, date) to authenticated;
revoke all on function acc_vendor_statement_opening(uuid, date) from public, anon;
grant execute on function acc_vendor_statement_opening(uuid, date) to authenticated;
