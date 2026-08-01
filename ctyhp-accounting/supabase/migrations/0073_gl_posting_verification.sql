-- ============================================================================
-- 0073 — General ledger posting verification.
--
-- Nothing here changes how anything posts. Posting is already atomic with the
-- document and the database already refuses an unbalanced entry. What was
-- missing is the ability to *see* that from outside the database: which
-- document produced which journal entry, and whether every subledger still
-- ties to its control account.
--
-- Both functions are read-only. They report what the ledger holds; the rules
-- for reading the result (what counts as an exception, what a variance means)
-- live in lib/domain/gl-posting.ts, where unit tests hold them to account.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Every document, and the journal entry it produced.
--
-- One row per document across every subledger, whether or not it posted. A row
-- whose document is live and whose entry is missing is the exception the
-- reviewer was looking for; the application decides that, not this query.
-- ----------------------------------------------------------------------------
create or replace function acc_gl_posting_report(p_from date, p_to date)
returns table (
  source_type      text,
  document_id      uuid,
  document_number  text,
  document_date    date,
  party_name       text,
  document_status  text,
  amount_minor     bigint,
  journal_entry_id uuid,
  entry_number     text,
  entry_date       date,
  entry_status     text,
  entry_total_minor bigint
)
language sql stable security definer set search_path = public as $$
  with documents as (
    select 'invoice'::text, i.id, i.invoice_number, i.issue_date, c.name,
           i.status::text, i.total_minor, i.journal_entry_id
      from acc_invoice i join acc_customer c on c.id = i.customer_id
     where i.issue_date between p_from and p_to
    union all
    select 'bill', b.id, b.bill_number, b.bill_date, v.name,
           b.status::text, b.total_minor, b.journal_entry_id
      from acc_bill b join acc_vendor v on v.id = b.vendor_id
     where b.bill_date between p_from and p_to
    union all
    select 'customer_payment', p.id, p.payment_number, p.payment_date, c.name,
           p.status::text, p.amount_minor, p.journal_entry_id
      from acc_payment p join acc_customer c on c.id = p.customer_id
     where p.payment_date between p_from and p_to
    union all
    select 'vendor_payment', bp.id, bp.payment_number, bp.payment_date, v.name,
           bp.status::text, bp.amount_minor, bp.journal_entry_id
      from acc_bill_payment bp join acc_vendor v on v.id = bp.vendor_id
     where bp.payment_date between p_from and p_to
    union all
    select 'expense', e.id, e.expense_number, e.expense_date, coalesce(v.name, 'Expense'),
           e.status::text, e.total_minor, e.journal_entry_id
      from acc_expense e left join acc_vendor v on v.id = e.vendor_id
     where e.expense_date between p_from and p_to
    union all
    select 'credit_memo', cm.id, cm.credit_memo_number, cm.memo_date, c.name,
           cm.status::text, cm.total_minor, cm.journal_entry_id
      from acc_credit_memo cm join acc_customer c on c.id = cm.customer_id
     where cm.memo_date between p_from and p_to
    union all
    select 'vendor_credit', vc.id, vc.vendor_credit_number, vc.credit_date, v.name,
           vc.status::text, vc.total_minor, vc.journal_entry_id
      from acc_vendor_credit vc join acc_vendor v on v.id = vc.vendor_id
     where vc.credit_date between p_from and p_to
    union all
    select 'tax_payment', tp.id, tp.payment_number, tp.payment_date, 'Sales tax authority',
           tp.status::text, tp.amount_minor, tp.journal_entry_id
      from acc_tax_payment tp
     where tp.payment_date between p_from and p_to
  )
  select d.source_type, d.document_id, d.document_number, d.document_date,
         d.party_name, d.document_status, d.amount_minor, d.journal_entry_id,
         je.entry_number, je.entry_date, je.status::text,
         coalesce((select sum(jl.debit_minor) from acc_journal_line jl
                    where jl.journal_entry_id = je.id), 0)::bigint
    from documents d (source_type, document_id, document_number, document_date,
                      party_name, document_status, amount_minor, journal_entry_id)
    left join acc_journal_entry je on je.id = d.journal_entry_id
   order by d.document_date desc, d.source_type, d.document_number nulls last;
$$;

revoke all on function acc_gl_posting_report(date, date) from public;
grant execute on function acc_gl_posting_report(date, date) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. Every control account against the subledger behind it.
--
-- A control account is only trustworthy if something independent adds up to
-- it. Six of them have a subledger; where one does not, the row says so rather
-- than inventing a total, because a fake tie-out is worse than an honest gap.
-- ----------------------------------------------------------------------------
create or replace function acc_control_reconciliation(p_as_of date)
returns table (
  control_key       text,
  label             text,
  account_codes     text,
  has_subledger     boolean,
  subledger_minor   bigint,
  control_minor     bigint
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_grni uuid := acc_active_grni_account();
begin
  return query
  -- Accounts receivable: what customers still owe, less credit not yet applied.
  select 'ar'::text, 'Accounts Receivable'::text,
         (select string_agg(distinct a.account_code, ', ' order by a.account_code)
            from acc_account a where a.account_type = 'accounts_receivable'),
         true,
         (
           coalesce((select sum(i.balance_due_minor) from acc_invoice i
                      where i.status in ('issued', 'partial') and i.issue_date <= p_as_of), 0)
         - coalesce((select sum(cm.balance_remaining_minor) from acc_credit_memo cm
                      where cm.status in ('issued', 'partial') and cm.memo_date <= p_as_of), 0)
         )::bigint,
         coalesce((select sum(jl.debit_minor - jl.credit_minor)
                     from acc_journal_line jl
                     join acc_journal_entry je on je.id = jl.journal_entry_id
                     join acc_account a on a.id = jl.account_id
                    where a.account_type = 'accounts_receivable'
                      and je.status = 'posted' and je.entry_date <= p_as_of), 0)::bigint;

  -- Accounts payable: what is owed to vendors, less vendor credit not applied.
  return query
  select 'ap', 'Accounts Payable',
         (select string_agg(distinct a.account_code, ', ' order by a.account_code)
            from acc_account a where a.account_type = 'accounts_payable'),
         true,
         (
           coalesce((select sum(b.balance_due_minor) from acc_bill b
                      where b.status in ('open', 'partial') and b.bill_date <= p_as_of), 0)
         - coalesce((select sum(vc.balance_remaining_minor) from acc_vendor_credit vc
                      where vc.status in ('issued', 'partial') and vc.credit_date <= p_as_of), 0)
         )::bigint,
         -- Payables sit on the credit side; report the subledger's own sign.
         coalesce((select sum(jl.credit_minor - jl.debit_minor)
                     from acc_journal_line jl
                     join acc_journal_entry je on je.id = jl.journal_entry_id
                     join acc_account a on a.id = jl.account_id
                    where a.account_type = 'accounts_payable'
                      and je.status = 'posted' and je.entry_date <= p_as_of), 0)::bigint;

  -- Inventory: quantity on hand at weighted average cost.
  return query
  select 'inventory', 'Inventory',
         (select string_agg(distinct a.account_code, ', ' order by a.account_code)
            from acc_account a
            join acc_item it on it.inventory_account_id = a.id
           where it.is_inventory),
         true,
         coalesce((select sum(v.value_minor) from acc_inventory_valuation(p_as_of) v), 0)::bigint,
         coalesce((select sum(jl.debit_minor - jl.credit_minor)
                     from acc_journal_line jl
                     join acc_journal_entry je on je.id = jl.journal_entry_id
                    where jl.account_id in (select distinct it.inventory_account_id
                                              from acc_item it
                                             where it.is_inventory
                                               and it.inventory_account_id is not null)
                      and je.status = 'posted' and je.entry_date <= p_as_of), 0)::bigint;

  -- Goods received not invoiced: received on a purchase order, not yet billed.
  return query
  select 'grni', 'Goods Received Not Invoiced',
         (select a.account_code from acc_account a where a.id = v_grni),
         v_grni is not null,
         coalesce((select sum((pol.qty_received - pol.qty_billed) * pol.unit_cost_minor)
                     from acc_purchase_order_line pol
                     join acc_purchase_order po on po.id = pol.purchase_order_id
                    where pol.qty_received > pol.qty_billed
                      and po.order_date <= p_as_of), 0)::bigint,
         coalesce((select sum(jl.credit_minor - jl.debit_minor)
                     from acc_journal_line jl
                     join acc_journal_entry je on je.id = jl.journal_entry_id
                    where jl.account_id = v_grni
                      and je.status = 'posted' and je.entry_date <= p_as_of), 0)::bigint;

  -- Sales tax payable: tax charged on live documents, less tax remitted.
  return query
  select 'sales_tax', 'Sales Tax Payable',
         (select string_agg(distinct a.account_code, ', ' order by a.account_code)
            from acc_account a
            join acc_tax_code tc on tc.tax_account_id = a.id),
         true,
         (
           coalesce((select sum(i.tax_total_minor) from acc_invoice i
                      where i.status in ('issued', 'partial', 'paid') and i.issue_date <= p_as_of), 0)
         - coalesce((select sum(cm.tax_total_minor) from acc_credit_memo cm
                      where cm.status <> 'draft' and cm.status <> 'void' and cm.memo_date <= p_as_of), 0)
         - coalesce((select sum(tp.amount_minor) from acc_tax_payment tp
                      where tp.status = 'posted' and tp.payment_date <= p_as_of), 0)
         )::bigint,
         coalesce((select sum(jl.credit_minor - jl.debit_minor)
                     from acc_journal_line jl
                     join acc_journal_entry je on je.id = jl.journal_entry_id
                    where jl.account_id in (select distinct tc.tax_account_id
                                              from acc_tax_code tc
                                             where tc.tax_account_id is not null)
                      and je.status = 'posted' and je.entry_date <= p_as_of), 0)::bigint;

  -- Undeposited funds: no subledger feeds it, so the ledger balance is
  -- reported on its own. Anything sitting here came from a manual journal and
  -- deserves an explanation, which is exactly what the screen will ask for.
  return query
  select 'undeposited', 'Undeposited Funds',
         (select string_agg(a.account_code, ', ' order by a.account_code)
            from acc_account a where a.account_code = '1210'),
         false,
         0::bigint,
         coalesce((select sum(jl.debit_minor - jl.credit_minor)
                     from acc_journal_line jl
                     join acc_journal_entry je on je.id = jl.journal_entry_id
                     join acc_account a on a.id = jl.account_id
                    where a.account_code = '1210'
                      and je.status = 'posted' and je.entry_date <= p_as_of), 0)::bigint;
end;
$$;

revoke all on function acc_control_reconciliation(date) from public;
grant execute on function acc_control_reconciliation(date) to authenticated, service_role;
