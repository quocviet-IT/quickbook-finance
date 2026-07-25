-- ============================================================================
-- Global search for the top bar: document numbers, contact names, item names.
--
-- Deliberately NOT `security definer`. Every other read in this application is
-- filtered by RLS, and a search box that ran with elevated rights would be a
-- hole straight through the access control Module C added — a suspended user
-- would still be able to enumerate customers and documents. Running as invoker
-- means acc_current_role() decides, exactly like every table read.
-- ============================================================================

create or replace function acc_global_search(p_query text, p_limit int default 10)
returns table (
  kind     text,
  id       uuid,
  label    text,
  sublabel text,
  href     text
)
language sql stable as $$
  with q as (select '%' || btrim(coalesce(p_query, '')) || '%' as pattern,
                    greatest(least(coalesce(p_limit, 10), 50), 1) as lim),
  hits as (
    select 'invoice' as kind, i.id, i.invoice_number as label,
           c.name as sublabel, '/invoices' as href, i.issue_date as sort_date
      from acc_invoice i
      join q on true
      left join acc_customer c on c.id = i.customer_id
     where i.invoice_number ilike q.pattern
    union all
    select 'bill', b.id, b.bill_number, v.name, '/bills', b.bill_date
      from acc_bill b
      join q on true
      left join acc_vendor v on v.id = b.vendor_id
     where b.bill_number ilike q.pattern
    union all
    select 'purchase_order', po.id, po.po_number, v.name,
           '/purchase-orders/' || po.id::text, po.order_date
      from acc_purchase_order po
      join q on true
      left join acc_vendor v on v.id = po.vendor_id
     where po.po_number ilike q.pattern
    union all
    select 'expense', e.id, e.expense_number, v.name, '/expenses', e.expense_date
      from acc_expense e
      join q on true
      left join acc_vendor v on v.id = e.vendor_id
     where e.expense_number ilike q.pattern
    union all
    select 'payment', p.id, p.payment_number, c.name, '/payments', p.payment_date
      from acc_payment p
      join q on true
      left join acc_customer c on c.id = p.customer_id
     where p.payment_number ilike q.pattern
    union all
    select 'bill_payment', bp.id, bp.payment_number, v.name, '/pay-bills', bp.payment_date
      from acc_bill_payment bp
      join q on true
      left join acc_vendor v on v.id = bp.vendor_id
     where bp.payment_number ilike q.pattern
    union all
    select 'customer', c.id, c.name, c.email, '/customers', null::date
      from acc_customer c join q on true
     where c.name ilike q.pattern
    union all
    select 'vendor', v.id, v.name, v.email, '/vendors', null::date
      from acc_vendor v join q on true
     where v.name ilike q.pattern
    union all
    select 'item', it.id, it.name, it.item_code, '/items', null::date
      from acc_item it join q on true
     where it.name ilike q.pattern or it.item_code ilike q.pattern
  )
  select h.kind, h.id, h.label, h.sublabel, h.href
    from hits h, q
   where btrim(coalesce(p_query, '')) <> ''
     and h.label is not null
   order by h.sort_date desc nulls last, h.label
   limit (select lim from q);
$$;
