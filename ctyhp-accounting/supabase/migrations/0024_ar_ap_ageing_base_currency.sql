-- supabase/migrations/0024_ar_ap_ageing_base_currency.sql
-- ============================================================================
-- Fix: acc_ar_ageing / acc_ap_ageing summed document-currency balances but the
-- app reconciled them to the (base-currency) AR/AP control account. Redefine
-- both RPCs identically to 0021 except each returned balance is converted to
-- base currency via acc_to_base_minor(..., current_date) — the current open
-- position, in base currency. Historical point-in-time ageing and native
-- multi-currency ageing remain out of scope (see design doc).
-- ============================================================================

create or replace function acc_ar_ageing(p_as_of date)
returns table (customer_id uuid, customer_name text, doc_type text, doc_number text,
               doc_date date, due_date date, balance_minor bigint)
language sql stable as $$
  select c.id, c.name, 'invoice', i.invoice_number, i.issue_date, coalesce(i.due_date, i.issue_date),
         acc_to_base_minor(i.balance_due_minor, i.currency_code, current_date)::bigint
    from acc_invoice i join acc_customer c on c.id = i.customer_id
   where i.status in ('issued','partial') and i.balance_due_minor > 0 and i.issue_date <= p_as_of
  union all
  select c.id, c.name, 'credit_memo', m.credit_memo_number, m.memo_date, m.memo_date,
         -acc_to_base_minor(m.balance_remaining_minor, m.currency_code, current_date)::bigint
    from acc_credit_memo m join acc_customer c on c.id = m.customer_id
   where m.status in ('issued','partial') and m.balance_remaining_minor > 0 and m.memo_date <= p_as_of
  union all
  select c.id, c.name, 'payment', p.payment_number, p.payment_date, p.payment_date,
         -acc_to_base_minor(p.unapplied_minor, p.currency_code, current_date)::bigint
    from acc_payment p join acc_customer c on c.id = p.customer_id
   where p.status in ('unapplied','partial') and p.unapplied_minor > 0 and p.payment_date <= p_as_of;
$$;

create or replace function acc_ap_ageing(p_as_of date)
returns table (vendor_id uuid, vendor_name text, doc_type text, doc_number text,
               doc_date date, due_date date, balance_minor bigint)
language sql stable as $$
  select v.id, v.name, 'bill', b.bill_number, b.bill_date, coalesce(b.due_date, b.bill_date),
         acc_to_base_minor(b.balance_due_minor, b.currency_code, current_date)::bigint
    from acc_bill b join acc_vendor v on v.id = b.vendor_id
   where b.status in ('open','partial') and b.balance_due_minor > 0 and b.bill_date <= p_as_of
  union all
  select v.id, v.name, 'vendor_credit', vc.vendor_credit_number, vc.credit_date, vc.credit_date,
         -acc_to_base_minor(vc.balance_remaining_minor, vc.currency_code, current_date)::bigint
    from acc_vendor_credit vc join acc_vendor v on v.id = vc.vendor_id
   where vc.status in ('issued','partial') and vc.balance_remaining_minor > 0 and vc.credit_date <= p_as_of
  union all
  select v.id, v.name, 'bill_payment', bp.payment_number, bp.payment_date, bp.payment_date,
         -acc_to_base_minor(bp.unapplied_minor, bp.currency_code, current_date)::bigint
    from acc_bill_payment bp join acc_vendor v on v.id = bp.vendor_id
   where bp.status in ('unapplied','partial') and bp.unapplied_minor > 0 and bp.payment_date <= p_as_of;
$$;
