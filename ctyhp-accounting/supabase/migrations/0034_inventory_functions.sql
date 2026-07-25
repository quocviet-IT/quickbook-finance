-- ============================================================================
-- Module G2 — Inventory posting and costing functions.
--
-- Weighted average cost, derived from acc_inventory_txn under a lock on the item
-- row so two concurrent postings cannot read the same average.
--
-- Residual rule: a sale that takes quantity to exactly zero relieves the ENTIRE
-- remaining value, not quantity x WAC. Without it, integer-cent rounding leaves
-- value attached to zero units and the valuation can never tie to the ledger.
--
-- Mirrors lib/domain/inventory.ts; the server re-derives every rule it enforces.
-- ============================================================================

create or replace function acc_active_grni_account() returns uuid
language sql stable as $$
  select id from acc_account
   where is_posting_account and status = 'active'
     and (account_code = '2150'
          or (account_type = 'current_liability' and name ilike 'goods received not invoiced%'))
   order by account_code
   limit 1;
$$;

/** Quantity on hand and value for an item, from the latest applied movement. */
create or replace function acc_item_on_hand(p_item_id uuid)
returns table (qty numeric, value_minor bigint)
language sql stable as $$
  select coalesce((select running_qty from acc_inventory_txn
                    where item_id = p_item_id order by seq desc limit 1), 0)::numeric,
         coalesce((select running_value_minor from acc_inventory_txn
                    where item_id = p_item_id order by seq desc limit 1), 0)::bigint;
$$;

/** Weighted average unit cost in minor units; 0 when nothing is on hand. */
create or replace function acc_item_wac(p_item_id uuid) returns bigint
language plpgsql stable as $$
declare
  v_qty numeric; v_val bigint;
begin
  select qty, value_minor into v_qty, v_val from acc_item_on_hand(p_item_id);
  if v_qty is null or v_qty = 0 then return 0; end if;
  return round(v_val::numeric / v_qty)::bigint;
end;
$$;

-- ----------------------------------------------------------------------------
-- The ONLY writer of the subledger. Locks the item, reads the previous running
-- pair, refuses a negative resulting quantity, writes the new running pair.
-- ----------------------------------------------------------------------------
create or replace function acc_add_inventory_txn(
  p_item_id     uuid,
  p_date        date,
  p_source      acc_inventory_source,
  p_source_id   uuid,
  p_qty_delta   numeric,
  p_cost_delta  bigint,
  p_entry_id    uuid,
  p_reversal_of uuid,
  p_memo        text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_name    text;
  v_qty     numeric := 0;
  v_val     bigint  := 0;
  v_new_qty numeric;
  v_new_val bigint;
  v_id      uuid;
begin
  select name into v_name from acc_item where id = p_item_id for update;
  if not found then raise exception 'Item not found'; end if;

  select running_qty, running_value_minor into v_qty, v_val
    from acc_inventory_txn where item_id = p_item_id order by seq desc limit 1;
  v_qty := coalesce(v_qty, 0);
  v_val := coalesce(v_val, 0);

  v_new_qty := v_qty + p_qty_delta;
  if v_new_qty < 0 then
    raise exception 'Insufficient inventory for %: % on hand, movement of %', v_name, v_qty, p_qty_delta;
  end if;
  v_new_val := v_val + p_cost_delta;

  insert into acc_inventory_txn
    (item_id, txn_date, source, source_id, qty_delta, cost_delta_minor,
     running_qty, running_value_minor, journal_entry_id, reversal_of, memo, created_by)
  values
    (p_item_id, p_date, p_source, p_source_id, p_qty_delta, p_cost_delta,
     v_new_qty, v_new_val, p_entry_id, p_reversal_of, p_memo, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

/** Cost to relieve for a sale, applying the residual rule. */
create or replace function acc_cost_of_sale_minor(p_item_id uuid, p_qty numeric) returns bigint
language plpgsql stable as $$
declare
  v_qty numeric; v_val bigint;
begin
  select qty, value_minor into v_qty, v_val from acc_item_on_hand(p_item_id);
  v_qty := coalesce(v_qty, 0); v_val := coalesce(v_val, 0);
  if p_qty > v_qty then
    raise exception 'Insufficient inventory: % on hand, selling %', v_qty, p_qty;
  end if;
  if p_qty = v_qty then return v_val; end if;   -- residual rule
  if v_qty = 0 then return 0; end if;
  return round(p_qty * (v_val::numeric / v_qty))::bigint;
end;
$$;

/** Reverse every subledger movement of one journal entry, as new rows. */
create or replace function acc_reverse_inventory_for_entry(p_entry_id uuid, p_date date, p_memo text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  rec record;
begin
  for rec in
    select t.id, t.item_id, t.qty_delta, t.cost_delta_minor, t.source_id
      from acc_inventory_txn t
     where t.journal_entry_id = p_entry_id and t.reversal_of is null
       and not exists (select 1 from acc_inventory_txn r where r.reversal_of = t.id)
     order by t.seq
  loop
    perform acc_add_inventory_txn(rec.item_id, p_date, 'reversal', rec.source_id,
                                 -rec.qty_delta, -rec.cost_delta_minor, p_entry_id, rec.id, p_memo);
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- Receiving, now posting DR Inventory / CR GRNI for inventory lines.
-- Base-currency purchase orders only when inventory is involved (FX is Module I).
-- ----------------------------------------------------------------------------
create or replace function acc_receive_purchase_order(
  p_po_id        uuid,
  p_receipt_date date,
  p_memo         text,
  p_lines        jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_po       acc_purchase_order;
  v_receipt  uuid;
  v_number   text;
  v_line     jsonb;
  v_qty      numeric;
  v_po_line  acc_purchase_order_line;
  v_item     acc_item;
  v_base     text;
  v_grni     uuid;
  v_cost     bigint;
  v_inv_total bigint := 0;
  v_entry    uuid;
  v_entry_lines jsonb := '[]'::jsonb;
  v_moves    jsonb := '[]'::jsonb;
  v_move     jsonb;
begin
  if not acc_is_staff() then raise exception 'Not authorized to receive purchase orders'; end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'A receipt needs at least one line';
  end if;

  select * into v_po from acc_purchase_order where id = p_po_id for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if v_po.status not in ('open', 'partial') then
    raise exception 'Cannot receive against a % purchase order', v_po.status;
  end if;
  select code into v_base from acc_currency where is_base;

  v_number := acc_next_number('goods_receipt');
  insert into acc_goods_receipt
    (receipt_number, purchase_order_id, vendor_id, receipt_date, memo, created_by)
  values (v_number, p_po_id, v_po.vendor_id, p_receipt_date, p_memo, auth.uid())
  returning id into v_receipt;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty := (v_line ->> 'quantity')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'Received quantity must be positive'; end if;

    select * into v_po_line from acc_purchase_order_line
     where id = (v_line ->> 'purchase_order_line_id')::uuid for update;
    if not found then raise exception 'Purchase order line not found'; end if;
    if v_po_line.purchase_order_id <> p_po_id then
      raise exception 'Line % does not belong to this purchase order', v_po_line.id;
    end if;
    if v_po_line.is_closed then
      raise exception 'Line % is closed and cannot be received', v_po_line.id;
    end if;
    if v_po_line.qty_received + v_qty > v_po_line.quantity then
      raise exception 'Over-receipt on line %: ordered %, already received %, receiving %',
        v_po_line.line_order + 1, v_po_line.quantity, v_po_line.qty_received, v_qty;
    end if;

    insert into acc_goods_receipt_line
      (goods_receipt_id, purchase_order_line_id, quantity, unit_cost_minor)
    values (v_receipt, v_po_line.id, v_qty, v_po_line.unit_cost_minor);

    update acc_purchase_order_line
       set qty_received = qty_received + v_qty where id = v_po_line.id;

    -- Inventory lines recognize an asset now, against GRNI.
    if v_po_line.item_id is not null then
      select * into v_item from acc_item where id = v_po_line.item_id;
      if v_item.is_inventory then
        if v_po.currency_code <> v_base then
          raise exception 'Inventory items require a base-currency (%) purchase order', v_base;
        end if;
        if v_item.inventory_account_id is null then
          raise exception 'Item % has no inventory account configured', v_item.name;
        end if;
        v_cost := round(v_qty * v_po_line.unit_cost_minor)::bigint;
        v_inv_total := v_inv_total + v_cost;
        v_entry_lines := v_entry_lines || jsonb_build_object(
          'account_id', v_item.inventory_account_id, 'debit_minor', v_cost, 'credit_minor', 0,
          'amount_base_minor', v_cost, 'memo', 'Inventory received: ' || v_item.name);
        v_moves := v_moves || jsonb_build_object('item_id', v_item.id, 'qty', v_qty, 'cost', v_cost);
      end if;
    end if;
  end loop;

  if v_inv_total > 0 then
    v_grni := acc_active_grni_account();
    if v_grni is null then raise exception 'No active Goods Received Not Invoiced account configured'; end if;
    v_entry_lines := v_entry_lines || jsonb_build_object(
      'account_id', v_grni, 'debit_minor', 0, 'credit_minor', v_inv_total,
      'amount_base_minor', v_inv_total, 'memo', 'Goods received not invoiced');

    v_entry := acc_post_entry(p_receipt_date, 'Goods receipt ' || v_number, 'goods_receipt',
                              v_receipt, v_base, v_entry_lines);

    for v_move in select * from jsonb_array_elements(v_moves) loop
      perform acc_add_inventory_txn(
        (v_move ->> 'item_id')::uuid, p_receipt_date, 'receipt', v_receipt,
        (v_move ->> 'qty')::numeric, (v_move ->> 'cost')::bigint, v_entry, null,
        'Receipt ' || v_number);
    end loop;
  end if;

  perform acc_recompute_po_status(p_po_id);
  return v_receipt;
end;
$$;

-- ----------------------------------------------------------------------------
-- Voiding a receipt now also voids its inventory entry and reverses the
-- subledger. The negative-quantity guard refuses a void whose stock was sold.
-- ----------------------------------------------------------------------------
create or replace function acc_void_goods_receipt(p_receipt_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_receipt acc_goods_receipt;
  v_entry   uuid;
  rec       record;
begin
  if not acc_is_staff() then raise exception 'Not authorized to void receipts'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A void reason is required'; end if;

  select * into v_receipt from acc_goods_receipt where id = p_receipt_id for update;
  if not found then raise exception 'Receipt not found'; end if;
  if v_receipt.status = 'void' then raise exception 'Receipt is already void'; end if;

  for rec in
    select rl.quantity, l.id as line_id, l.line_order, l.qty_received, l.qty_billed
      from acc_goods_receipt_line rl
      join acc_purchase_order_line l on l.id = rl.purchase_order_line_id
     where rl.goods_receipt_id = p_receipt_id
     for update of l
  loop
    if rec.qty_received - rec.quantity < rec.qty_billed then
      raise exception 'Cannot void: line % has already been billed; void the bill first',
        rec.line_order + 1;
    end if;
  end loop;

  update acc_purchase_order_line l
     set qty_received = l.qty_received - rl.quantity
    from acc_goods_receipt_line rl
   where rl.goods_receipt_id = p_receipt_id and l.id = rl.purchase_order_line_id;

  -- Reverse the inventory movements, then void the entry that made them.
  select id into v_entry from acc_journal_entry
   where source_type = 'goods_receipt' and source_id = p_receipt_id and status = 'posted';
  if v_entry is not null then
    perform acc_reverse_inventory_for_entry(v_entry, v_receipt.receipt_date, 'Receipt voided');
    update acc_journal_entry set status = 'void', voided_at = now() where id = v_entry;
  end if;

  update acc_goods_receipt set status = 'void', void_reason = p_reason where id = p_receipt_id;
  perform acc_recompute_po_status(v_receipt.purchase_order_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- Conversion to a bill: an inventory line debits GRNI at the PURCHASE-ORDER
-- cost (clearing exactly what the receipt credited); any price difference
-- becomes a second line against the inventory account, flagged as a variance so
-- acc_post_bill can record it in the subledger.
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
-- Posting a bill now records the inventory cost variance in the subledger, and
-- refuses an inventory item on a line that did not come from a purchase order
-- (inventory enters only through receiving, or an explicit adjustment).
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

  -- Recompute the total from lines; never trust a stored/client value.
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

  -- Inventory cost corrections: quantity unchanged, value adjusted.
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
-- Voiding a bill reverses its inventory cost corrections as well as G1's
-- billed-quantity rollback.
-- ----------------------------------------------------------------------------
create or replace function acc_void_bill(p_bill_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_bill  acc_bill;
begin
  if not acc_is_staff() then raise exception 'Not authorized to void bills'; end if;

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
-- Issuing an invoice now relieves inventory at WAC through a SEPARATE
-- base-currency cost entry, leaving the sales entry in the sales currency.
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- Voiding an invoice also voids its cost entry and reverses the subledger.
-- ----------------------------------------------------------------------------
create or replace function acc_void_invoice(p_invoice_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_inv        acc_invoice;
  v_cost_entry uuid;
begin
  if not acc_is_staff() then raise exception 'Not authorized to void invoices'; end if;

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
-- Manual adjustment: shrinkage, found stock, or a pure revaluation.
--   qty_delta > 0 -> costed at p_unit_cost_minor
--   qty_delta < 0 -> costed at WAC, applying the residual rule
--   qty_delta = 0 -> p_value_delta_minor is the revaluation
-- ----------------------------------------------------------------------------
create or replace function acc_adjust_inventory(
  p_item_id           uuid,
  p_date              date,
  p_qty_delta         numeric,
  p_unit_cost_minor   bigint,
  p_value_delta_minor bigint,
  p_offset_account_id uuid,
  p_reason            text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_item  acc_item;
  v_cost  bigint;
  v_lines jsonb;
  v_entry uuid;
  v_base  text;
begin
  if not acc_is_staff() then raise exception 'Not authorized to adjust inventory'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'An adjustment reason is required'; end if;

  select * into v_item from acc_item where id = p_item_id for update;
  if not found then raise exception 'Item not found'; end if;
  if not v_item.is_inventory then raise exception 'Item % is not an inventory item', v_item.name; end if;
  if v_item.inventory_account_id is null then
    raise exception 'Item % has no inventory account configured', v_item.name;
  end if;
  select code into v_base from acc_currency where is_base;

  if p_qty_delta > 0 then
    if coalesce(p_unit_cost_minor, 0) <= 0 then
      raise exception 'A unit cost is required when adding quantity';
    end if;
    v_cost := round(p_qty_delta * p_unit_cost_minor)::bigint;
  elsif p_qty_delta < 0 then
    v_cost := -acc_cost_of_sale_minor(p_item_id, -p_qty_delta);
  else
    v_cost := coalesce(p_value_delta_minor, 0);
    if v_cost = 0 then raise exception 'An adjustment must change quantity or value'; end if;
  end if;

  if v_cost > 0 then
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_item.inventory_account_id, 'debit_minor', v_cost,
                         'credit_minor', 0, 'amount_base_minor', v_cost, 'memo', 'Inventory adjustment'),
      jsonb_build_object('account_id', p_offset_account_id, 'debit_minor', 0,
                         'credit_minor', v_cost, 'amount_base_minor', v_cost, 'memo', p_reason));
  else
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', p_offset_account_id, 'debit_minor', -v_cost,
                         'credit_minor', 0, 'amount_base_minor', -v_cost, 'memo', p_reason),
      jsonb_build_object('account_id', v_item.inventory_account_id, 'debit_minor', 0,
                         'credit_minor', -v_cost, 'amount_base_minor', -v_cost, 'memo', 'Inventory adjustment'));
  end if;

  v_entry := acc_post_entry(p_date, 'Inventory adjustment: ' || v_item.name,
                            'inventory_adjustment', p_item_id, v_base, v_lines);

  return acc_add_inventory_txn(p_item_id, p_date, 'adjustment', v_entry,
                               p_qty_delta, v_cost, v_entry, null, p_reason);
end;
$$;

-- ----------------------------------------------------------------------------
-- As-of valuation, summed by transaction date so a back-dated movement reports
-- in the right period. Every movement counts, including reversal rows — a void
-- is represented by its reversal, so the sum is self-correcting and history is
-- never rewritten.
-- ----------------------------------------------------------------------------
create or replace function acc_inventory_valuation(p_as_of date)
returns table (
  item_id              uuid,
  item_code            text,
  name                 text,
  inventory_account_id uuid,
  qty_on_hand          numeric,
  value_minor          bigint,
  unit_cost_minor      bigint
)
language sql stable as $$
  select i.id, i.item_code, i.name, i.inventory_account_id,
         coalesce(sum(t.qty_delta), 0)::numeric,
         coalesce(sum(t.cost_delta_minor), 0)::bigint,
         case when coalesce(sum(t.qty_delta), 0) = 0 then 0
              else round(coalesce(sum(t.cost_delta_minor), 0)::numeric
                         / sum(t.qty_delta))::bigint end
    from acc_item i
    left join acc_inventory_txn t on t.item_id = i.id and t.txn_date <= p_as_of
   where i.is_inventory
   group by i.id, i.item_code, i.name, i.inventory_account_id
   order by i.name;
$$;
