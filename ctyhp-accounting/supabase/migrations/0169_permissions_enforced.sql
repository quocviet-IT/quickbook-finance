-- ============================================================================
-- 0169  Every permission in the matrix is enforced (2.59)
--
-- Phase 4 of the permission plan. Three things, each closing one finding of the
-- 24-26 October 2026 review:
--
-- 1. The nine permissions the matrix showed as "Advisory" now decide. Until now
--    their functions asked only for the role (admin or accountant), so taking a
--    permission away in Settings > Permissions changed nothing. Each function
--    below keeps its role check and adds the permission check after it, the
--    way journal.post and inventory.adjust already work:
--
--      invoice.issue            acc_issue_invoice
--      invoice.void             acc_void_invoice
--      bill.post                acc_post_bill
--      bill.void                acc_void_bill
--      journal.void             acc_reverse_entry
--      reconciliation.complete  acc_complete_reconciliation,
--                               acc_bring_history_forward (it records a
--                               completed reconciliation)
--      period.close             acc_close_period (admin only until now)
--      po.approve               acc_approve_purchase_order
--      po.variance_approve      acc_create_bill_from_po, before a price or
--                               quantity variance beyond tolerance is accepted
--
--    The defaults stay what people can do today. The one exception is the
--    matrix itself: it showed accountants holding period.close, which they
--    never could use. That tick is removed, so closing stays with admins
--    unless an admin grants it.
--
-- 2. Settings saves follow the permission their card shows. The Company
--    profile, Work policy, Accounting periods set-up and Purchasing tolerances
--    were saved by admins only while their cards opened for settings.manage.
--    They now check settings.manage, as approval policies already did.
--
-- 3. Sessions hold a write privilege only where a migration gave the table a
--    policy for that write. Company creation used to grant every write on
--    every table after the migrations ran, which undid each migration's revokes
--    in a new company and left the companies differing from one another.
--    Row-level security already refused those writes; this makes the
--    privileges say the same. lib/services/company-provisioning.ts now grants
--    by the same rule.
--
-- The function bodies change only at the lines named above
-- (tests/unit/permissions-enforced-migration.test.ts holds each to its previous
-- definition).
-- ============================================================================
set search_path = public;

-- ----------------------------------------------------------------------------
-- acc_issue_invoice: invoice.issue (otherwise as 0069_customer_credit_control)
-- ----------------------------------------------------------------------------
create or replace function acc_issue_invoice(
  p_invoice_id      uuid,
  p_override_reason text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_inv       acc_invoice;
  v_ar        uuid;
  v_number    text;
  v_lines     jsonb := '[]'::jsonb;
  v_entry     uuid;
  v_base      text;
  v_cost      bigint;
  v_cost_total bigint := 0;
  v_cost_lines jsonb := '[]'::jsonb;
  v_moves     jsonb := '[]'::jsonb;
  v_move      jsonb;
  v_cost_entry uuid;
  rec         record;
  v_limit     bigint;
  v_hold      boolean;
  v_exposure  bigint;
  v_reason    text := nullif(btrim(coalesce(p_override_reason, '')), '');
begin
  if not acc_is_staff() then raise exception 'Not authorized to issue invoices'; end if;
  if not acc_has_permission('invoice.issue') then
    raise exception 'You do not have permission to issue invoices';
  end if;

  select * into v_inv from acc_invoice where id = p_invoice_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if v_inv.status <> 'draft' then raise exception 'Only draft invoices can be issued'; end if;
  if v_inv.total_minor <= 0 then raise exception 'Invoice total must be positive'; end if;

  -- --- Credit control -------------------------------------------------------
  select credit_limit_minor, credit_hold into v_limit, v_hold
    from acc_customer where id = v_inv.customer_id for share;
  select coalesce(sum(balance_due_minor), 0)::bigint into v_exposure
    from acc_invoice
   where customer_id = v_inv.customer_id
     and status in ('issued', 'partial')
     and id <> p_invoice_id;

  if coalesce(v_hold, false) or (v_limit is not null and v_exposure + v_inv.total_minor > v_limit) then
    if not acc_has_permission('credit.override') then
      raise exception
        'Customer is %; issuing this invoice needs the credit override permission (open %, this invoice %, limit %)',
        case when coalesce(v_hold, false) then 'on credit hold' else 'over the credit limit' end,
        v_exposure, v_inv.total_minor, coalesce(v_limit::text, 'not set')
        using errcode = 'insufficient_privilege';
    end if;
    if v_reason is null then
      raise exception 'A credit override needs a written reason';
    end if;
    -- The override is the exception an auditor looks for, so it is logged as
    -- its own action rather than hidden inside the invoice's row history.
    insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
    values ('acc_invoice', p_invoice_id, 'credit_override', auth.uid(),
            jsonb_build_object('reason', v_reason,
                               'credit_hold', coalesce(v_hold, false),
                               'credit_limit_minor', v_limit,
                               'open_balance_minor', v_exposure,
                               'invoice_total_minor', v_inv.total_minor));
  elsif v_reason is not null then
    raise exception 'This invoice is within the customer credit limit; no override is needed';
  end if;
  -- --- End credit control ---------------------------------------------------

  v_ar := acc_active_ar_account();
  if v_ar is null then raise exception 'No active Accounts Receivable account configured'; end if;
  select code into v_base from acc_currency where is_base;

  -- DR Accounts Receivable (total)
  v_lines := v_lines || jsonb_build_object(
    'account_id', v_ar, 'debit_minor', v_inv.total_minor, 'credit_minor', 0,
    'amount_base_minor', acc_to_base_minor(v_inv.total_minor, v_inv.currency_code, v_inv.issue_date),
    'memo', 'Accounts receivable');

  -- CR Income (grouped by income account)
  for rec in
    select income_account_id as acc, sum(line_subtotal_minor)::bigint as amt
      from acc_invoice_line where invoice_id = p_invoice_id
      group by income_account_id having sum(line_subtotal_minor) <> 0
  loop
    v_lines := v_lines || jsonb_build_object(
      'account_id', rec.acc, 'debit_minor', 0, 'credit_minor', rec.amt,
      'amount_base_minor', acc_to_base_minor(rec.amt, v_inv.currency_code, v_inv.issue_date),
      'memo', 'Income');
  end loop;

  -- CR Sales Tax Payable (grouped by the tax code's control account)
  for rec in
    select tc.tax_account_id as acc, sum(il.line_tax_minor)::bigint as amt
      from acc_invoice_line il
      join acc_tax_code tc on tc.id = il.tax_code_id
     where il.invoice_id = p_invoice_id and il.line_tax_minor > 0 and tc.tax_account_id is not null
     group by tc.tax_account_id
  loop
    v_lines := v_lines || jsonb_build_object(
      'account_id', rec.acc, 'debit_minor', 0, 'credit_minor', rec.amt,
      'amount_base_minor', acc_to_base_minor(rec.amt, v_inv.currency_code, v_inv.issue_date),
      'memo', 'Sales tax payable');
  end loop;

  v_number := acc_next_number('invoice');
  v_entry := acc_post_entry(v_inv.issue_date, 'Invoice ' || v_number, 'invoice',
                            p_invoice_id, v_inv.currency_code, v_lines);

  update acc_invoice
     set invoice_number = v_number, status = 'issued',
         balance_due_minor = total_minor, journal_entry_id = v_entry, updated_at = now()
   where id = p_invoice_id;

  -- Cost of goods sold, per inventory item, at weighted average cost. The item
  -- rows are locked while the cost is computed so the average cannot move under
  -- us between the computation and the subledger write.
  for rec in
    select i.id as item_id, i.name, i.inventory_account_id, i.cogs_account_id,
           sum(il.quantity) as qty
      from acc_invoice_line il
      join acc_item i on i.id = il.item_id
     where il.invoice_id = p_invoice_id and i.is_inventory
     group by i.id, i.name, i.inventory_account_id, i.cogs_account_id
     order by i.id
  loop
    if v_inv.currency_code <> v_base then
      raise exception 'Inventory items require a base-currency (%) invoice', v_base;
    end if;
    if rec.inventory_account_id is null or rec.cogs_account_id is null then
      raise exception 'Item % needs both an inventory account and a COGS account', rec.name;
    end if;
    perform 1 from acc_item where id = rec.item_id for update;

    v_cost := acc_cost_of_sale_minor(rec.item_id, rec.qty);
    if v_cost <> 0 then
      v_cost_lines := v_cost_lines || jsonb_build_object(
        'account_id', rec.cogs_account_id, 'debit_minor', v_cost, 'credit_minor', 0,
        'amount_base_minor', v_cost, 'memo', 'Cost of goods sold: ' || rec.name);
      v_cost_lines := v_cost_lines || jsonb_build_object(
        'account_id', rec.inventory_account_id, 'debit_minor', 0, 'credit_minor', v_cost,
        'amount_base_minor', v_cost, 'memo', 'Inventory relieved: ' || rec.name);
      v_cost_total := v_cost_total + v_cost;
    end if;
    v_moves := v_moves || jsonb_build_object('item_id', rec.item_id, 'qty', rec.qty, 'cost', v_cost);
  end loop;

  if jsonb_array_length(v_moves) > 0 then
    if v_cost_total > 0 then
      v_cost_entry := acc_post_entry(v_inv.issue_date, 'Cost of sales for invoice ' || v_number,
                                     'inventory', p_invoice_id, v_base, v_cost_lines);
    end if;
    for v_move in select * from jsonb_array_elements(v_moves) loop
      perform acc_add_inventory_txn(
        (v_move ->> 'item_id')::uuid, v_inv.issue_date, 'sale', p_invoice_id,
        -((v_move ->> 'qty')::numeric), -((v_move ->> 'cost')::bigint), v_cost_entry, null,
        'Invoice ' || v_number);
    end loop;
  end if;

  return v_entry;
end;
$$;

-- ----------------------------------------------------------------------------
-- acc_void_invoice: invoice.void (otherwise as 0034_inventory_functions)
-- ----------------------------------------------------------------------------
create or replace function acc_void_invoice(p_invoice_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_inv        acc_invoice;
  v_cost_entry uuid;
begin
  if not acc_is_staff() then raise exception 'Not authorized to void invoices'; end if;
  if not acc_has_permission('invoice.void') then
    raise exception 'You do not have permission to void invoices';
  end if;

  select * into v_inv from acc_invoice where id = p_invoice_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if v_inv.status = 'void' then raise exception 'Invoice is already void'; end if;
  if v_inv.status = 'draft' then
    update acc_invoice set status = 'void', updated_at = now() where id = p_invoice_id;
    return;
  end if;
  if v_inv.balance_due_minor <> v_inv.total_minor then
    raise exception 'Cannot void an invoice with payments applied; remove payments first';
  end if;

  -- Put the goods back before the ledger effect is removed.
  select id into v_cost_entry from acc_journal_entry
   where source_type = 'inventory' and source_id = p_invoice_id and status = 'posted';
  if v_cost_entry is not null then
    perform acc_reverse_inventory_for_entry(v_cost_entry, v_inv.issue_date, 'Invoice voided');
    update acc_journal_entry set status = 'void', voided_at = now() where id = v_cost_entry;
  end if;

  -- Voiding the entry reverses its ledger effect (reports use status='posted' only);
  -- do NOT also post a reversal.
  if v_inv.journal_entry_id is not null then
    update acc_journal_entry set status = 'void', voided_at = now()
     where id = v_inv.journal_entry_id;
  end if;

  update acc_invoice set status = 'void', balance_due_minor = 0, updated_at = now()
   where id = p_invoice_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- acc_post_bill: bill.post (otherwise as 0075_vendor_payment_terms)
-- ----------------------------------------------------------------------------
create or replace function acc_post_bill(p_bill_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_bill   acc_bill;
  v_ap     uuid;
  v_total  bigint;
  v_number text;
  v_lines  jsonb := '[]'::jsonb;
  v_entry  uuid;
  v_bad    text;
  rec      record;
begin
  if not acc_is_staff() then raise exception 'Not authorized to post bills'; end if;
  if not acc_has_permission('bill.post') then
    raise exception 'You do not have permission to post bills';
  end if;

  select * into v_bill from acc_bill where id = p_bill_id for update;
  if not found then raise exception 'Bill not found'; end if;
  if v_bill.status <> 'draft' then raise exception 'Only draft bills can be posted'; end if;

  select i.name into v_bad
    from acc_bill_line bl
    join acc_item i on i.id = bl.item_id
   where bl.bill_id = p_bill_id and i.is_inventory
     and bl.purchase_order_line_id is null and not bl.is_inventory_variance
   limit 1;
  if v_bad is not null then
    raise exception 'Inventory item % must be purchased through a purchase order, not a direct bill', v_bad;
  end if;

  select coalesce(sum(amount_minor), 0) into v_total from acc_bill_line where bill_id = p_bill_id;
  if v_total <= 0 then raise exception 'Bill total must be positive'; end if;

  v_ap := coalesce((select ap_account_id from acc_vendor where id = v_bill.vendor_id), acc_active_ap_account());
  if v_ap is null then raise exception 'No active Accounts Payable account configured'; end if;

  for rec in
    select expense_account_id as acc, sum(amount_minor)::bigint as amt
      from acc_bill_line where bill_id = p_bill_id
      group by expense_account_id having sum(amount_minor) <> 0
  loop
    v_lines := v_lines || jsonb_build_object(
      'account_id', rec.acc, 'debit_minor', rec.amt, 'credit_minor', 0,
      'amount_base_minor', acc_to_base_minor(rec.amt, v_bill.currency_code, v_bill.bill_date),
      'memo', 'Expense');
  end loop;

  v_lines := v_lines || jsonb_build_object(
    'account_id', v_ap, 'debit_minor', 0, 'credit_minor', v_total,
    'amount_base_minor', acc_to_base_minor(v_total, v_bill.currency_code, v_bill.bill_date),
    'memo', 'Accounts payable');

  v_number := acc_next_number('bill');
  v_entry := acc_post_entry(v_bill.bill_date, 'Bill ' || v_number, 'bill',
                            p_bill_id, v_bill.currency_code, v_lines);

  update acc_bill
     set bill_number = v_number, status = 'open', total_minor = v_total,
         balance_due_minor = v_total, journal_entry_id = v_entry, updated_at = now()
   where id = p_bill_id;

  -- The terms depend on the total, so they are applied after it is settled.
  perform acc_apply_vendor_terms(p_bill_id);

  for rec in
    select item_id, amount_minor, description from acc_bill_line
     where bill_id = p_bill_id and is_inventory_variance and item_id is not null
  loop
    perform acc_add_inventory_txn(rec.item_id, v_bill.bill_date, 'bill_variance', p_bill_id,
                                 0, rec.amount_minor, v_entry, null, rec.description);
  end loop;

  return v_entry;
end;
$$;

-- ----------------------------------------------------------------------------
-- acc_void_bill: bill.void (otherwise as 0034_inventory_functions)
-- ----------------------------------------------------------------------------
create or replace function acc_void_bill(p_bill_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_bill  acc_bill;
begin
  if not acc_is_staff() then raise exception 'Not authorized to void bills'; end if;
  if not acc_has_permission('bill.void') then
    raise exception 'You do not have permission to void bills';
  end if;

  select * into v_bill from acc_bill where id = p_bill_id for update;
  if not found then raise exception 'Bill not found'; end if;
  if v_bill.status = 'void' then raise exception 'Bill is already void'; end if;
  if v_bill.status <> 'draft' and v_bill.balance_due_minor <> v_bill.total_minor then
    raise exception 'Cannot void a bill with payments applied; remove payments first';
  end if;

  -- Give the ordered quantity back to the purchase order, if this bill came from one.
  if v_bill.purchase_order_id is not null then
    update acc_purchase_order_line l
       set qty_billed = greatest(l.qty_billed - bl.quantity, 0)
      from acc_bill_line bl
     where bl.bill_id = p_bill_id
       and bl.purchase_order_line_id = l.id
       and bl.quantity is not null
       and not bl.is_inventory_variance
    ;
    perform acc_recompute_po_status(v_bill.purchase_order_id);
  end if;

  if v_bill.status = 'draft' then
    update acc_bill set status = 'void', updated_at = now() where id = p_bill_id;
    return;
  end if;

  if v_bill.journal_entry_id is not null then
    perform acc_reverse_inventory_for_entry(v_bill.journal_entry_id, v_bill.bill_date, 'Bill voided');
    update acc_journal_entry set status = 'void', voided_at = now()
     where id = v_bill.journal_entry_id;
  end if;

  update acc_bill set status = 'void', balance_due_minor = 0, updated_at = now()
   where id = p_bill_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- acc_reverse_entry: journal.void (otherwise as 0018_manual_journal_functions)
-- ----------------------------------------------------------------------------
create or replace function acc_reverse_entry(
  p_entry_id     uuid,
  p_reason       text,
  p_reversal_date date
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_src   acc_journal_entry;
  v_lines jsonb;
  v_rev   uuid;
begin
  if not acc_is_staff() then raise exception 'Not authorized to reverse entries'; end if;
  if not acc_has_permission('journal.void') then
    raise exception 'You do not have permission to reverse journal entries';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reversal reason is required'; end if;

  select * into v_src from acc_journal_entry where id = p_entry_id for update;
  if not found then raise exception 'Journal entry not found'; end if;
  if v_src.status <> 'posted' then raise exception 'Only a posted entry can be reversed'; end if;
  if v_src.source_type not in ('manual', 'opening_balance') then
    raise exception 'Only manual journals and opening balances can be reversed';
  end if;
  if exists (select 1 from acc_journal_reversal_link where original_entry_id = p_entry_id) then
    raise exception 'Entry has already been reversed';
  end if;
  if exists (select 1 from acc_journal_reversal_link where reversal_entry_id = p_entry_id) then
    raise exception 'A reversal entry cannot itself be reversed';
  end if;

  select jsonb_agg(jsonb_build_object(
           'account_id', l.account_id,
           'debit_minor', l.credit_minor,          -- swap
           'credit_minor', l.debit_minor,          -- swap
           'amount_base_minor', l.amount_base_minor,
           'tax_code_id', l.tax_code_id,
           'memo', 'Reversal: ' || coalesce(l.memo, '')
         ) order by l.line_order)
    into v_lines
    from acc_journal_line l
   where l.journal_entry_id = p_entry_id;

  v_rev := acc_post_entry(p_reversal_date,
             'Reversal of ' || v_src.entry_number || ' — ' || p_reason,
             v_src.source_type, v_src.id, v_src.currency_code, v_lines);

  insert into acc_journal_reversal_link (original_entry_id, reversal_entry_id, reason, created_by)
    values (p_entry_id, v_rev, p_reason, auth.uid());
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_journal_entry', p_entry_id, 'reverse', auth.uid());
  return v_rev;
end;
$$;

-- ----------------------------------------------------------------------------
-- acc_complete_reconciliation: reconciliation.complete (otherwise as 0026_bank_reconciliation_functions)
-- ----------------------------------------------------------------------------
create or replace function acc_complete_reconciliation(p_reconciliation_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_rec acc_statement_reconciliation; v_cleared bigint; v_diff bigint;
begin
  if not acc_is_staff() then raise exception 'Not authorized'; end if;
  if not acc_has_permission('reconciliation.complete') then
    raise exception 'You do not have permission to complete reconciliations';
  end if;
  select * into v_rec from acc_statement_reconciliation where id = p_reconciliation_id for update;
  if not found then raise exception 'Reconciliation not found'; end if;
  if v_rec.status <> 'in_progress' then raise exception 'Reconciliation is not in progress'; end if;
  v_cleared := acc_recon_cleared_total(p_reconciliation_id);
  v_diff := v_rec.statement_ending_balance_minor - (v_rec.beginning_balance_minor + v_cleared);
  if v_diff <> 0 then raise exception 'Cannot complete: unexplained difference of %', v_diff; end if;

  update acc_statement_reconciliation
     set status = 'completed', completed_by = auth.uid(), completed_at = now(), updated_at = now()
   where id = p_reconciliation_id;
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_statement_reconciliation', p_reconciliation_id, 'post', auth.uid());
end;
$$;

-- ----------------------------------------------------------------------------
-- acc_bring_history_forward: reconciliation.complete: it records a completed reconciliation (otherwise as 0142_reconciliation_history)
-- ----------------------------------------------------------------------------
create or replace function acc_bring_history_forward(
  p_bank_account_id uuid, p_through date, p_balance_minor bigint, p_note text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_gl      uuid;
  v_account text;
  v_today   date;
  v_open    acc_statement_reconciliation;
  v_balance bigint;
  v_id      uuid;
  v_moved   integer := 0;
  v_added   integer := 0;
  v_note    text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to bring a bank account forward';
  end if;
  if not acc_has_permission('reconciliation.complete') then
    raise exception 'You do not have permission to complete reconciliations';
  end if;
  if p_through is null then
    raise exception 'Choose the date the history is brought forward through';
  end if;
  if p_balance_minor is null then
    raise exception 'Enter the statement balance on that date';
  end if;
  -- Today in the company's own time zone, as the screens count it.
  v_today := coalesce(
    (select (now() at time zone s.time_zone)::date
       from acc_company_setting_version s order by s.version desc limit 1),
    current_date);
  if p_through > v_today then
    raise exception 'A bank account cannot be brought forward past today';
  end if;

  -- The row lock serialises this with any reconciliation being created for the
  -- account, as in 0132: an insert into acc_statement_reconciliation holds FOR
  -- KEY SHARE on this row through its foreign key until it commits, which FOR
  -- UPDATE waits for; the checks below then see that reconciliation.
  select b.account_id, a.name into v_gl, v_account
    from acc_bank_account b join acc_account a on a.id = b.account_id
   where b.id = p_bank_account_id
     for update of b;
  if v_gl is null then
    raise exception 'Bank account not found';
  end if;
  if exists (select 1 from acc_statement_reconciliation
              where bank_account_id = p_bank_account_id and status = 'completed') then
    raise exception 'This account already has a completed reconciliation.';
  end if;

  -- The session in progress, if any, locked so no tick lands in it meanwhile.
  select * into v_open from acc_statement_reconciliation
   where bank_account_id = p_bank_account_id and status = 'in_progress'
     for update;
  if v_open.id is not null and v_open.statement_ending_date <= p_through then
    raise exception 'Finish or discard the reconciliation in progress first.';
  end if;

  select coalesce(sum(case when l.debit_minor > 0 then l.amount_base_minor else -l.amount_base_minor end), 0)::bigint
    into v_balance
    from acc_journal_line l
    join acc_journal_entry e on e.id = l.journal_entry_id
   where l.account_id = v_gl and e.status = 'posted' and e.entry_date <= p_through;
  if v_balance <> p_balance_minor then
    raise exception 'The books hold % on %; the statement shows %. Out by %.',
      to_char(v_balance / 100.0, 'FM999,999,999,990.00'),
      to_char(p_through, 'Mon FMDD, YYYY'),
      to_char(p_balance_minor / 100.0, 'FM999,999,999,990.00'),
      to_char(abs(v_balance - p_balance_minor) / 100.0, 'FM999,999,999,990.00');
  end if;

  insert into acc_statement_reconciliation
    (bank_account_id, statement_ending_date, beginning_balance_minor, statement_ending_balance_minor,
     status, prepared_by, completed_by, completed_at, note, brought_forward)
  values (p_bank_account_id, p_through, 0, p_balance_minor,
          'completed', auth.uid(), auth.uid(), now(), v_note, true)
  returning id into v_id;

  -- The session in progress gives up its ticks on the earlier lines, keeping
  -- when each was ticked. A tick on an entry voided since is left where it is:
  -- it counts for nothing there, and in a completed session it would read as
  -- a discrepancy.
  if v_open.id is not null then
    with moved as (
      delete from acc_reconciliation_line rl
       using acc_journal_line l, acc_journal_entry e
       where rl.reconciliation_id = v_open.id
         and l.id = rl.journal_line_id
         and e.id = l.journal_entry_id
         and e.status = 'posted'
         and e.entry_date <= p_through
      returning rl.journal_line_id, rl.cleared_at
    )
    insert into acc_reconciliation_line (reconciliation_id, journal_line_id, cleared_at)
    select v_id, m.journal_line_id, m.cleared_at from moved m;
    get diagnostics v_moved = row_count;
  end if;

  -- Every other posted line through the date. No completed reconciliation
  -- exists for the account, so none of them is held elsewhere.
  insert into acc_reconciliation_line (reconciliation_id, journal_line_id)
  select v_id, l.id
    from acc_journal_line l
    join acc_journal_entry e on e.id = l.journal_entry_id
   where l.account_id = v_gl and e.status = 'posted' and e.entry_date <= p_through
     and not exists (select 1 from acc_reconciliation_line x
                      where x.reconciliation_id = v_id and x.journal_line_id = l.id);
  get diagnostics v_added = row_count;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values ('acc_statement_reconciliation', v_id, 'insert', auth.uid(),
          jsonb_build_object('bank_account_id', p_bank_account_id,
                             'account', v_account,
                             'brought_forward', true,
                             'through', p_through,
                             'balance_minor', p_balance_minor,
                             'lines', v_moved + v_added,
                             'moved', v_moved)),
         ('acc_statement_reconciliation', v_id, 'post', auth.uid(), null);

  if v_open.id is not null then
    update acc_statement_reconciliation
       set beginning_balance_minor = p_balance_minor, updated_at = now()
     where id = v_open.id;
    insert into acc_audit_log (table_name, record_id, action, actor_id, before_json, after_json)
    values ('acc_statement_reconciliation', v_open.id, 'update', auth.uid(),
            jsonb_build_object('beginning_balance_minor', v_open.beginning_balance_minor),
            jsonb_build_object('bank_account_id', p_bank_account_id,
                               'account', v_account,
                               'through', p_through,
                               'beginning_balance_minor', p_balance_minor,
                               'lines', v_moved,
                               'brought_forward_id', v_id));
  end if;

  return jsonb_build_object('reconciliation_id', v_id,
                            'lines', v_moved + v_added,
                            'moved', v_moved,
                            'rebased_reconciliation_id', v_open.id);
end;
$$;

-- ----------------------------------------------------------------------------
-- acc_close_period: period.close, in place of admin only (otherwise as 0081_cash_flow_indirect)
-- ----------------------------------------------------------------------------
create or replace function acc_close_period(
  p_period_id uuid,
  p_reason text,
  p_variance_note text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_p        acc_accounting_period;
  v_blockers text;
  v_cf       record;
begin
  if not acc_is_staff() then raise exception 'Not authorized to close a period'; end if;
  if not acc_has_permission('period.close') then
    raise exception 'You do not have permission to close a period';
  end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A close reason is required'; end if;
  select * into v_p from acc_accounting_period where id = p_period_id for update;
  if not found then raise exception 'Period not found'; end if;
  if v_p.status = 'closed' then raise exception 'Period is already closed'; end if;

  v_blockers := acc_period_close_blockers(p_period_id);
  if v_blockers is not null and coalesce(btrim(p_variance_note), '') = '' then
    raise exception '% Close it anyway only with a written explanation of the difference.', v_blockers;
  end if;

  select * into v_cf
    from acc_cash_flow_reconciliation(v_p.period_start, v_p.period_end);

  update acc_accounting_period
     set status = 'closed', closed_by = auth.uid(), closed_at = now(),
         close_reason = p_reason,
         close_variance_note = case when v_blockers is null then null
                                    else btrim(p_variance_note) end
   where id = p_period_id;

  insert into acc_cash_flow_close_snapshot (
    period_id, classification_version, opening_cash_minor,
    operating_minor, investing_minor, financing_minor,
    ending_cash_statement_minor, balance_sheet_cash_minor, difference_minor,
    unclassified_minor, unclassified_count, ties_out,
    generated_by, generated_at
  ) values (
    p_period_id, 1, v_cf.opening_cash_minor,
    v_cf.operating_minor, v_cf.investing_minor, v_cf.financing_minor,
    v_cf.ending_cash_statement_minor, v_cf.balance_sheet_cash_minor,
    v_cf.difference_minor, v_cf.unclassified_minor, v_cf.unclassified_count,
    v_cf.difference_minor = 0 and v_cf.unclassified_count = 0,
    auth.uid(), now()
  )
  on conflict (period_id) do update set
    classification_version = excluded.classification_version,
    opening_cash_minor = excluded.opening_cash_minor,
    operating_minor = excluded.operating_minor,
    investing_minor = excluded.investing_minor,
    financing_minor = excluded.financing_minor,
    ending_cash_statement_minor = excluded.ending_cash_statement_minor,
    balance_sheet_cash_minor = excluded.balance_sheet_cash_minor,
    difference_minor = excluded.difference_minor,
    unclassified_minor = excluded.unclassified_minor,
    unclassified_count = excluded.unclassified_count,
    ties_out = excluded.ties_out,
    generated_by = excluded.generated_by,
    generated_at = excluded.generated_at;

  insert into acc_period_event (period_id, event, reason, actor_id)
    values (
      p_period_id, 'close',
      case when v_blockers is null then p_reason
           else p_reason || ' — closed over a variance: ' || v_blockers
                || ' Explanation: ' || btrim(p_variance_note) end,
      auth.uid()
    );
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_accounting_period', p_period_id, 'close', auth.uid());
end;
$$;

-- ----------------------------------------------------------------------------
-- acc_approve_purchase_order: po.approve (otherwise as 0032_purchasing_functions)
-- ----------------------------------------------------------------------------
create or replace function acc_approve_purchase_order(p_po_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_status acc_po_status;
  v_lines  int;
  v_number text;
begin
  if not acc_is_staff() then raise exception 'Not authorized to approve purchase orders'; end if;
  if not acc_has_permission('po.approve') then
    raise exception 'You do not have permission to approve purchase orders';
  end if;

  select status into v_status from acc_purchase_order where id = p_po_id for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if v_status <> 'draft' then raise exception 'Only draft purchase orders can be approved'; end if;

  select count(*) into v_lines from acc_purchase_order_line where purchase_order_id = p_po_id;
  if v_lines = 0 then raise exception 'A purchase order needs at least one line'; end if;

  v_number := acc_next_number('purchase_order');
  update acc_purchase_order
     set po_number = v_number, status = 'open', updated_at = now()
   where id = p_po_id;
  return v_number;
end;
$$;

-- ----------------------------------------------------------------------------
-- acc_create_bill_from_po: po.variance_approve, before a quantity or price variance is accepted (otherwise as 0034_inventory_functions)
-- ----------------------------------------------------------------------------
create or replace function acc_create_bill_from_po(
  p_po_id           uuid,
  p_bill_date       date,
  p_due_date        date,
  p_vendor_ref      text,
  p_memo            text,
  p_lines           jsonb,
  p_variance_reason text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_po      acc_purchase_order;
  v_cfg     acc_purchasing_config;
  v_bill    uuid;
  v_line    jsonb;
  v_qty     numeric;
  v_cost    bigint;
  v_amount  bigint;
  v_total   bigint := 0;
  v_order   int := 0;
  v_po_line acc_purchase_order_line;
  v_item    acc_item;
  v_grni    uuid;
  v_variance bigint;
  v_new_billed numeric;
  v_qty_allowed numeric;
  v_bps     int;
  v_reason  text := coalesce(btrim(p_variance_reason), '');
begin
  if not acc_is_staff() then raise exception 'Not authorized to create bills'; end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'A bill needs at least one line';
  end if;

  select * into v_po from acc_purchase_order where id = p_po_id for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if v_po.status in ('draft', 'cancelled') then
    raise exception 'Cannot bill a % purchase order', v_po.status;
  end if;

  select * into v_cfg from acc_purchasing_config where singleton;

  insert into acc_bill
    (vendor_ref, vendor_id, bill_date, due_date, currency_code, memo,
     purchase_order_id, status, created_by)
  values (p_vendor_ref, v_po.vendor_id, p_bill_date, p_due_date, v_po.currency_code, p_memo,
          p_po_id, 'draft', auth.uid())
  returning id into v_bill;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty  := (v_line ->> 'quantity')::numeric;
    v_cost := (v_line ->> 'unit_cost_minor')::bigint;
    if v_qty is null or v_qty <= 0 then raise exception 'Billed quantity must be positive'; end if;
    if v_cost is null or v_cost < 0 then raise exception 'Billed unit cost cannot be negative'; end if;

    select * into v_po_line from acc_purchase_order_line
     where id = (v_line ->> 'purchase_order_line_id')::uuid for update;
    if not found then raise exception 'Purchase order line not found'; end if;
    if v_po_line.purchase_order_id <> p_po_id then
      raise exception 'Line % does not belong to this purchase order', v_po_line.id;
    end if;

    -- Quantity match: cumulative billed vs received, within tolerance.
    v_new_billed  := v_po_line.qty_billed + v_qty;
    v_qty_allowed := v_po_line.qty_received * (1 + v_cfg.qty_tolerance_bps / 10000.0);
    if v_new_billed > v_qty_allowed then
      v_bps := acc_variance_bps(v_po_line.qty_received, v_new_billed);
      if not acc_has_permission('po.variance_approve') then
        raise exception 'This bill is outside the purchase order''s matching tolerance, and you do not have permission to approve match variances';
      end if;
      if v_reason = '' then
        raise exception 'Quantity variance on line %: received %, billing % (cumulative). An approval reason is required',
          v_po_line.line_order + 1, v_po_line.qty_received, v_new_billed;
      end if;
      insert into acc_po_variance_exception
        (bill_id, purchase_order_id, purchase_order_line_id, kind,
         expected_value, actual_value, variance_bps, reason, approved_by)
      values (v_bill, p_po_id, v_po_line.id, 'quantity',
              v_po_line.qty_received, v_new_billed, v_bps, v_reason, auth.uid());
    end if;

    -- Price match: billed unit cost vs PO unit cost, within tolerance.
    v_bps := acc_variance_bps(v_po_line.unit_cost_minor, v_cost);
    if abs(v_bps) > v_cfg.price_tolerance_bps then
      if not acc_has_permission('po.variance_approve') then
        raise exception 'This bill is outside the purchase order''s matching tolerance, and you do not have permission to approve match variances';
      end if;
      if v_reason = '' then
        raise exception 'Price variance on line %: ordered at %, billed at % (% bps). An approval reason is required',
          v_po_line.line_order + 1, v_po_line.unit_cost_minor, v_cost, v_bps;
      end if;
      insert into acc_po_variance_exception
        (bill_id, purchase_order_id, purchase_order_line_id, kind,
         expected_value, actual_value, variance_bps, reason, approved_by)
      values (v_bill, p_po_id, v_po_line.id, 'price',
              v_po_line.unit_cost_minor, v_cost, v_bps, v_reason, auth.uid());
    end if;

    v_item := null;
    if v_po_line.item_id is not null then
      select * into v_item from acc_item where id = v_po_line.item_id;
    end if;

    if v_item.id is not null and v_item.is_inventory then
      -- Clear GRNI at the PO cost; the price difference adjusts the asset.
      v_grni := acc_active_grni_account();
      if v_grni is null then raise exception 'No active Goods Received Not Invoiced account configured'; end if;
      v_amount := round(v_qty * v_po_line.unit_cost_minor)::bigint;
      insert into acc_bill_line
        (bill_id, line_order, description, expense_account_id, amount_minor,
         item_id, purchase_order_line_id, quantity, unit_cost_minor)
      values (v_bill, v_order, v_po_line.description, v_grni, v_amount,
              v_item.id, v_po_line.id, v_qty, v_po_line.unit_cost_minor);
      v_total := v_total + v_amount;
      v_order := v_order + 1;

      v_variance := round(v_qty * v_cost)::bigint - v_amount;
      if v_variance <> 0 then
        if v_item.inventory_account_id is null then
          raise exception 'Item % has no inventory account configured', v_item.name;
        end if;
        insert into acc_bill_line
          (bill_id, line_order, description, expense_account_id, amount_minor,
           item_id, purchase_order_line_id, quantity, unit_cost_minor, is_inventory_variance)
        values (v_bill, v_order, 'Price variance: ' || v_po_line.description,
                v_item.inventory_account_id, v_variance,
                v_item.id, v_po_line.id, v_qty, v_cost, true);
        v_total := v_total + v_variance;
        v_order := v_order + 1;
      end if;
    else
      v_amount := round(v_qty * v_cost)::bigint;
      insert into acc_bill_line
        (bill_id, line_order, description, expense_account_id, amount_minor,
         item_id, purchase_order_line_id, quantity, unit_cost_minor)
      values (v_bill, v_order, v_po_line.description, v_po_line.expense_account_id, v_amount,
              v_po_line.item_id, v_po_line.id, v_qty, v_cost);
      v_total := v_total + v_amount;
      v_order := v_order + 1;
    end if;

    update acc_purchase_order_line set qty_billed = v_new_billed where id = v_po_line.id;
  end loop;

  update acc_bill set total_minor = v_total, updated_at = now() where id = v_bill;
  perform acc_recompute_po_status(p_po_id);
  return v_bill;
end;
$$;

-- ----------------------------------------------------------------------------
-- acc_save_company_settings: settings.manage, in place of admin only (otherwise as 0078_inventory_policy)
-- ----------------------------------------------------------------------------
create or replace function acc_save_company_settings(
  p_legal_name text, p_dba_name text, p_ein_ref text,
  p_address_line1 text, p_address_line2 text, p_city text, p_region text,
  p_postal_code text, p_country text,
  p_fiscal_year_start_month int, p_base_currency_code text, p_time_zone text,
  p_accounting_basis text, p_default_payment_terms_days int,
  p_inventory_valuation_method text default null,
  p_inventory_policy_memo text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_version int;
  v_id      uuid;
  v_current acc_company_setting_version;
  v_method  acc_inventory_valuation_method;
begin
  if not acc_has_permission('settings.manage') then
    raise exception 'You do not have permission to change company settings';
  end if;
  if coalesce(btrim(p_legal_name), '') = '' then raise exception 'Legal name is required'; end if;

  select * into v_current from acc_company_setting_version order by version desc limit 1;

  v_method := coalesce(
    nullif(btrim(coalesce(p_inventory_valuation_method, '')), '')::acc_inventory_valuation_method,
    v_current.inventory_valuation_method,
    'average_cost'
  );

  if not (v_method = any (acc_implemented_valuation_methods())) then
    raise exception
      'Inventory is costed at weighted average; the % method is not implemented, so recording it as the policy would state something the ledger contradicts',
      v_method;
  end if;

  select coalesce(max(version), 0) + 1 into v_version from acc_company_setting_version;
  insert into acc_company_setting_version
    (version, legal_name, dba_name, ein_ref, address_line1, address_line2, city, region,
     postal_code, country, fiscal_year_start_month, base_currency_code, time_zone,
     accounting_basis, default_payment_terms_days,
     inventory_valuation_method, inventory_policy_memo, created_by)
  values
    (v_version, p_legal_name, p_dba_name, p_ein_ref, p_address_line1, p_address_line2, p_city,
     p_region, p_postal_code, p_country,
     coalesce(p_fiscal_year_start_month, 1), coalesce(p_base_currency_code, 'USD'),
     coalesce(p_time_zone, 'America/New_York'),
     coalesce(p_accounting_basis, 'accrual')::acc_accounting_basis,
     coalesce(p_default_payment_terms_days, 30),
     v_method,
     coalesce(nullif(btrim(coalesce(p_inventory_policy_memo, '')), ''), v_current.inventory_policy_memo),
     auth.uid())
  returning id into v_id;

  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_company_setting_version', v_id, 'insert', auth.uid());
  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- acc_save_work_policy: settings.manage, in place of admin only (otherwise as 0120_close_window_policy)
-- ----------------------------------------------------------------------------
create or replace function acc_save_work_policy(
  p_materiality_minor       bigint,
  p_approval_sla_days       int,
  p_unmatched_bank_age_days int,
  p_close_window_days       int,
  p_note                    text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not acc_has_permission('settings.manage') then
    raise exception 'You do not have permission to change the work policy';
  end if;

  insert into acc_work_policy (
    materiality_minor, approval_sla_days, unmatched_bank_age_days,
    close_window_days, note, created_by
  ) values (
    p_materiality_minor, p_approval_sla_days, p_unmatched_bank_age_days,
    p_close_window_days, nullif(btrim(coalesce(p_note, '')), ''), auth.uid()
  ) returning id into v_id;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values ('acc_work_policy', v_id, 'insert', auth.uid(),
          jsonb_build_object('materiality_minor', p_materiality_minor,
                             'approval_sla_days', p_approval_sla_days,
                             'unmatched_bank_age_days', p_unmatched_bank_age_days,
                             'close_window_days', p_close_window_days,
                             'note', nullif(btrim(coalesce(p_note, '')), '')));

  return v_id;
end $$;

-- ----------------------------------------------------------------------------
-- acc_set_purchasing_config: settings.manage, in place of admin only (otherwise as 0032_purchasing_functions)
-- ----------------------------------------------------------------------------
create or replace function acc_set_purchasing_config(
  p_price_tolerance_bps int,
  p_qty_tolerance_bps   int
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not acc_has_permission('settings.manage') then
    raise exception 'You do not have permission to change purchasing tolerances';
  end if;
  update acc_purchasing_config
     set price_tolerance_bps = p_price_tolerance_bps,
         qty_tolerance_bps   = p_qty_tolerance_bps,
         updated_by = auth.uid(), updated_at = now()
   where singleton;
end;
$$;

-- ----------------------------------------------------------------------------
-- acc_generate_periods: settings.manage, in place of admin only (otherwise as 0029_company_periods_functions)
-- ----------------------------------------------------------------------------
create or replace function acc_generate_periods(p_fiscal_year int) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_start_month int;
  v_created int := 0;
  i int;
  v_cal_year int;
  v_cal_month int;
  v_start date;
  v_end date;
begin
  if not acc_has_permission('settings.manage') then
    raise exception 'You do not have permission to set up accounting periods';
  end if;

  select fiscal_year_start_month into v_start_month
    from acc_company_setting_version order by effective_from desc, version desc limit 1;
  v_start_month := coalesce(v_start_month, 1);

  for i in 1..12 loop
    v_cal_month := ((v_start_month - 1 + (i - 1)) % 12) + 1;
    v_cal_year  := p_fiscal_year + ((v_start_month - 1 + (i - 1)) / 12);
    v_start := make_date(v_cal_year, v_cal_month, 1);
    v_end   := (v_start + interval '1 month' - interval '1 day')::date;
    insert into acc_accounting_period (fiscal_year, period_month, period_start, period_end, label, status)
      values (p_fiscal_year, i, v_start, v_end, to_char(v_start, 'YYYY-MM'), 'open')
      on conflict (fiscal_year, period_month) do nothing;
    if found then v_created := v_created + 1; end if;
  end loop;
  return v_created;
end;
$$;

-- ----------------------------------------------------------------------------
-- The matrix: all nine enforced, the descriptions saying what each now covers,
-- and accountants no longer shown holding period.close.
-- ----------------------------------------------------------------------------
update acc_permission set is_enforced = true, description = 'Issue a draft invoice to a customer'
 where key = 'invoice.issue';
update acc_permission set is_enforced = true, description = 'Void an invoice, draft or issued'
 where key = 'invoice.void';
update acc_permission set is_enforced = true, description = 'Post a vendor bill to Accounts Payable'
 where key = 'bill.post';
update acc_permission set is_enforced = true, description = 'Void a vendor bill, draft or posted'
 where key = 'bill.void';
update acc_permission set is_enforced = true, description = 'Reverse a posted manual journal or opening balance'
 where key = 'journal.void';
update acc_permission set is_enforced = true,
       description = 'Complete a bank reconciliation, or bring an account''s reconciled history forward'
 where key = 'reconciliation.complete';
update acc_permission set is_enforced = true, description = 'Close a monthly accounting period'
 where key = 'period.close';
update acc_permission set is_enforced = true, description = 'Move a purchase order from draft to open'
 where key = 'po.approve';
update acc_permission set is_enforced = true,
       description = 'Bill a purchase order beyond its price or quantity tolerance, with a reason'
 where key = 'po.variance_approve';
update acc_permission
   set description = 'Company profile, work policy, the period calendar, purchasing tolerances and approval policies'
 where key = 'settings.manage';

update acc_role_permission
   set allowed = false, updated_at = now()
 where role = 'accountant' and permission_key = 'period.close' and allowed;

-- ----------------------------------------------------------------------------
-- Each write privilege only where a policy allows that write: INSERT where an
-- insert (or all) policy exists, and the same for UPDATE and DELETE. SELECT
-- stays; the service role keeps everything.
-- ----------------------------------------------------------------------------
do $$
declare
  t record;
  w text;
begin
  for t in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and left(c.relname, 4) = 'acc_'
  loop
    foreach w in array array['INSERT', 'UPDATE', 'DELETE'] loop
      if not exists (
        select 1
          from pg_policies p
         where p.schemaname = 'public'
           and p.tablename = t.relname
           and p.cmd in (w, 'ALL'))
      then
        execute format('revoke %s on %I from authenticated, anon', w, t.relname);
      end if;
    end loop;
  end loop;
end;
$$;

-- TRUNCATE skips row-level security, and nothing in the application truncates.
revoke truncate on all tables in schema public from authenticated, anon;
