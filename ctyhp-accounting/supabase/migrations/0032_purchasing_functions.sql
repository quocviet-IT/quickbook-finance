-- ============================================================================
-- Module G1 — Purchase order / receiving / three-way-match RPCs.
-- Nothing here writes to the ledger: a PO is a commitment and (in G1) a receipt
-- is quantity-only. The bill produced by acc_create_bill_from_po is a DRAFT and
-- is posted by the existing acc_post_bill, which already enforces the
-- closed-period guard in acc_post_entry.
--
-- The derived counters acc_purchase_order_line.qty_received / qty_billed are
-- maintained here only, always under `for update` row locks, so two concurrent
-- receipts or conversions cannot both pass the over-quantity guard.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Status recompute: 'received' when every line is fully received or closed,
-- 'partial' when some quantity is in, else 'open'. Terminal statuses stay.
-- ----------------------------------------------------------------------------
create or replace function acc_recompute_po_status(p_po_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_status     acc_po_status;
  v_open_lines int;
  v_received   numeric;
begin
  select status into v_status from acc_purchase_order where id = p_po_id;
  if v_status in ('draft', 'cancelled', 'closed') then return; end if;

  select count(*) filter (where not is_closed and qty_received < quantity),
         coalesce(sum(qty_received), 0)
    into v_open_lines, v_received
    from acc_purchase_order_line where purchase_order_id = p_po_id;

  update acc_purchase_order
     set status = case
                    when v_open_lines = 0 then 'received'::acc_po_status
                    when v_received > 0   then 'partial'::acc_po_status
                    else 'open'::acc_po_status
                  end,
         updated_at = now()
   where id = p_po_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Signed variance in basis points of (actual - expected) / expected.
-- Zero expected with a non-zero actual is a full 10000 bps so a
-- from-nothing variance can never look "within tolerance".
-- Mirrors lib/domain/purchasing.ts varianceBps (one rule, two enforcement points).
-- ----------------------------------------------------------------------------
create or replace function acc_variance_bps(p_expected numeric, p_actual numeric) returns int
language sql immutable as $$
  select case
           when p_expected = 0 and p_actual = 0 then 0
           when p_expected = 0                  then 10000
           else round((p_actual - p_expected) / abs(p_expected) * 10000)::int
         end;
$$;

-- ----------------------------------------------------------------------------
-- Create (p_po_id null) or replace a DRAFT purchase order and its lines.
-- p_lines: [{ item_id, description, quantity, unit_cost_minor, expense_account_id }]
-- Totals are always recomputed server-side; client totals are never trusted.
-- ----------------------------------------------------------------------------
create or replace function acc_save_purchase_order(
  p_po_id         uuid,
  p_vendor_id     uuid,
  p_order_date    date,
  p_expected_date date,
  p_currency      text,
  p_ship_to       text,
  p_memo          text,
  p_lines         jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_po_id  uuid := p_po_id;
  v_status acc_po_status;
  v_line   jsonb;
  v_qty    numeric;
  v_cost   bigint;
  v_order  int := 0;
  v_total  bigint := 0;
begin
  if not acc_is_staff() then raise exception 'Not authorized to edit purchase orders'; end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'A purchase order needs at least one line';
  end if;

  if v_po_id is null then
    insert into acc_purchase_order
      (vendor_id, order_date, expected_date, currency_code, ship_to, memo, created_by)
    values (p_vendor_id, p_order_date, p_expected_date, p_currency, p_ship_to, p_memo, auth.uid())
    returning id into v_po_id;
  else
    select status into v_status from acc_purchase_order where id = v_po_id for update;
    if not found then raise exception 'Purchase order not found'; end if;
    if v_status <> 'draft' then
      raise exception 'Only draft purchase orders can be edited (status is %)', v_status;
    end if;
    update acc_purchase_order
       set vendor_id = p_vendor_id, order_date = p_order_date, expected_date = p_expected_date,
           currency_code = p_currency, ship_to = p_ship_to, memo = p_memo, updated_at = now()
     where id = v_po_id;
    delete from acc_purchase_order_line where purchase_order_id = v_po_id;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_qty  := (v_line ->> 'quantity')::numeric;
    v_cost := (v_line ->> 'unit_cost_minor')::bigint;
    if v_qty is null or v_qty <= 0 then raise exception 'Line quantity must be positive'; end if;
    if v_cost is null or v_cost < 0 then raise exception 'Line unit cost cannot be negative'; end if;
    if (v_line ->> 'expense_account_id') is null then
      raise exception 'Every line needs an expense account';
    end if;

    insert into acc_purchase_order_line
      (purchase_order_id, line_order, item_id, description, quantity, unit_cost_minor,
       expense_account_id, line_total_minor)
    values
      (v_po_id, v_order, nullif(v_line ->> 'item_id', '')::uuid,
       coalesce(v_line ->> 'description', ''), v_qty, v_cost,
       (v_line ->> 'expense_account_id')::uuid, round(v_qty * v_cost)::bigint);

    v_total := v_total + round(v_qty * v_cost)::bigint;
    v_order := v_order + 1;
  end loop;

  update acc_purchase_order set total_minor = v_total, updated_at = now() where id = v_po_id;
  return v_po_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Approve a draft PO: assign its number and open it for receiving.
-- ----------------------------------------------------------------------------
create or replace function acc_approve_purchase_order(p_po_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_status acc_po_status;
  v_lines  int;
  v_number text;
begin
  if not acc_is_staff() then raise exception 'Not authorized to approve purchase orders'; end if;

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
-- Cancel a PO that nothing has happened to yet.
-- ----------------------------------------------------------------------------
create or replace function acc_cancel_purchase_order(p_po_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_status acc_po_status;
  v_moved  numeric;
begin
  if not acc_is_staff() then raise exception 'Not authorized to cancel purchase orders'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A cancellation reason is required'; end if;

  select status into v_status from acc_purchase_order where id = p_po_id for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if v_status in ('cancelled', 'closed') then
    raise exception 'Purchase order is already %', v_status;
  end if;

  select coalesce(sum(qty_received + qty_billed), 0) into v_moved
    from acc_purchase_order_line where purchase_order_id = p_po_id;
  if v_moved > 0 then
    raise exception 'Cannot cancel a purchase order with receipts or bills; short-close it instead';
  end if;

  update acc_purchase_order
     set status = 'cancelled', close_reason = p_reason, updated_at = now()
   where id = p_po_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Short close: the remaining quantity will never arrive.
-- ----------------------------------------------------------------------------
create or replace function acc_close_purchase_order(p_po_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_status acc_po_status;
begin
  if not acc_is_staff() then raise exception 'Not authorized to close purchase orders'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A close reason is required'; end if;

  select status into v_status from acc_purchase_order where id = p_po_id for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if v_status = 'draft' then raise exception 'A draft purchase order cannot be closed; cancel it'; end if;
  if v_status in ('cancelled', 'closed') then
    raise exception 'Purchase order is already %', v_status;
  end if;

  update acc_purchase_order_line set is_closed = true
   where purchase_order_id = p_po_id and qty_received < quantity;
  update acc_purchase_order
     set status = 'closed', close_reason = p_reason, updated_at = now()
   where id = p_po_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Receive against a PO. p_lines: [{ purchase_order_line_id, quantity }]
-- Cumulative qty_received may never exceed the ordered quantity — that guard,
-- held under a row lock, is what prevents a duplicated receipt.
-- G2 extension point: inventory lines will also post DR Inventory / CR GRNI.
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
  end loop;

  perform acc_recompute_po_status(p_po_id);
  return v_receipt;
end;
$$;

-- ----------------------------------------------------------------------------
-- Void a receipt: allowed only while the quantity it brought in is unbilled.
-- G2 extension point: also voids the receipt's journal entry.
-- ----------------------------------------------------------------------------
create or replace function acc_void_goods_receipt(p_receipt_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_receipt acc_goods_receipt;
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

  update acc_goods_receipt set status = 'void', void_reason = p_reason where id = p_receipt_id;
  perform acc_recompute_po_status(v_receipt.purchase_order_id);
end;
$$;

-- ----------------------------------------------------------------------------
-- Convert received PO lines into a DRAFT bill, applying three-way matching.
-- p_lines: [{ purchase_order_line_id, quantity, unit_cost_minor }]
--
-- Quantity is matched as (already billed + this bill) against what was RECEIVED
-- — you bill what arrived, not what was ordered. Price is matched against the
-- PO unit cost. A line outside either tolerance requires p_variance_reason and
-- records an acc_po_variance_exception row (US-FR-073).
--
-- G2 extension point: inventory lines will debit GRNI rather than the expense
-- account and post the cost variance to inventory.
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

    v_amount := round(v_qty * v_cost)::bigint;
    insert into acc_bill_line
      (bill_id, line_order, description, expense_account_id, amount_minor,
       item_id, purchase_order_line_id, quantity, unit_cost_minor)
    values (v_bill, v_order, v_po_line.description, v_po_line.expense_account_id, v_amount,
            v_po_line.item_id, v_po_line.id, v_qty, v_cost);

    update acc_purchase_order_line set qty_billed = v_new_billed where id = v_po_line.id;

    v_total := v_total + v_amount;
    v_order := v_order + 1;
  end loop;

  update acc_bill set total_minor = v_total, updated_at = now() where id = v_bill;
  perform acc_recompute_po_status(p_po_id);
  return v_bill;
end;
$$;

-- ----------------------------------------------------------------------------
-- Redefinition of acc_void_bill (0012) that also rolls the PO billed counter
-- back, so the counter stays honest whether or not the bill was ever posted.
-- The rest of the behaviour is unchanged: voiding the journal entry IS the
-- reversal (reports count status='posted' only) — never post a second one.
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
       and bl.quantity is not null;
    perform acc_recompute_po_status(v_bill.purchase_order_id);
  end if;

  if v_bill.status = 'draft' then
    update acc_bill set status = 'void', updated_at = now() where id = p_bill_id;
    return;
  end if;

  if v_bill.journal_entry_id is not null then
    update acc_journal_entry set status = 'void', voided_at = now()
     where id = v_bill.journal_entry_id;
  end if;

  update acc_bill set status = 'void', balance_due_minor = 0, updated_at = now()
   where id = p_bill_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Three-way-match tolerances (admin only).
-- ----------------------------------------------------------------------------
create or replace function acc_set_purchasing_config(
  p_price_tolerance_bps int,
  p_qty_tolerance_bps   int
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not acc_is_admin() then raise exception 'Only an admin can change purchasing tolerances'; end if;
  update acc_purchasing_config
     set price_tolerance_bps = p_price_tolerance_bps,
         qty_tolerance_bps   = p_qty_tolerance_bps,
         updated_by = auth.uid(), updated_at = now()
   where singleton;
end;
$$;

-- ----------------------------------------------------------------------------
-- Received-not-billed exposure: what arrived but has no bill yet. In G1 this
-- has no ledger effect (see the module spec §2), so the list is the control.
-- ----------------------------------------------------------------------------
create or replace function acc_received_not_billed()
returns table (
  purchase_order_id      uuid,
  purchase_order_line_id uuid,
  po_number              text,
  vendor_name            text,
  order_date             date,
  description            text,
  qty_outstanding        numeric,
  unit_cost_minor        bigint,
  value_minor            bigint,
  currency_code          text
)
language sql stable as $$
  select po.id, l.id, po.po_number, v.name, po.order_date, l.description,
         (l.qty_received - l.qty_billed)::numeric,
         l.unit_cost_minor,
         round((l.qty_received - l.qty_billed) * l.unit_cost_minor)::bigint,
         po.currency_code
    from acc_purchase_order_line l
    join acc_purchase_order po on po.id = l.purchase_order_id
    join acc_vendor v on v.id = po.vendor_id
   where l.qty_received > l.qty_billed
     and po.status not in ('draft', 'cancelled')
   order by po.order_date, po.po_number, l.line_order;
$$;
