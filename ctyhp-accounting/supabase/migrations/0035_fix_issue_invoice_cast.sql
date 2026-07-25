-- ============================================================================
-- Fix: SUM(bigint) returns numeric in Postgres, so the grouped income and tax
-- amounts must be cast back to bigint before calling acc_to_base_minor(bigint..).
-- This is the same fix 0007 made to the pre-inventory acc_issue_invoice; the
-- redefinition in 0034 reintroduced the uncast version. Behaviour is otherwise
-- identical to 0034 (cost of sales posted as a separate base-currency entry).
-- ============================================================================

create or replace function acc_issue_invoice(p_invoice_id uuid) returns uuid
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
begin
  if not acc_is_staff() then raise exception 'Not authorized to issue invoices'; end if;

  select * into v_inv from acc_invoice where id = p_invoice_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if v_inv.status <> 'draft' then raise exception 'Only draft invoices can be issued'; end if;
  if v_inv.total_minor <= 0 then raise exception 'Invoice total must be positive'; end if;

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

