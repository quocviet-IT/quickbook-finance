-- Fix: a CASE expression whose branches are all text literals resolves to
-- type text (not "unknown"), so assigning it straight to an enum column
-- fails ("column ... is of type X but expression is of type text"). Same
-- bug class as 0008's fix for acc_record_payment; here it affects every
-- status-by-CASE assignment in 0020 that lacked the explicit ::enum cast.
create or replace function acc_apply_credit_memo(p_credit_memo_id uuid, p_allocations jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_cm  acc_credit_memo;
  v_inv acc_invoice;
  rec   record;
begin
  if not acc_is_staff() then raise exception 'Not authorized to apply credit memos'; end if;
  select * into v_cm from acc_credit_memo where id = p_credit_memo_id for update;
  if not found then raise exception 'Credit memo not found'; end if;
  if v_cm.status not in ('issued','partial') then raise exception 'Credit memo is not open for allocation'; end if;

  for rec in select (a->>'invoice_id')::uuid as invoice_id, (a->>'amount_minor')::bigint as amt
               from jsonb_array_elements(coalesce(p_allocations,'[]'::jsonb)) a
  loop
    if rec.amt is null or rec.amt <= 0 then continue; end if;
    select * into v_inv from acc_invoice where id = rec.invoice_id for update;
    if not found then raise exception 'Invoice not found: %', rec.invoice_id; end if;
    if v_inv.customer_id <> v_cm.customer_id then raise exception 'Invoice % is not for this customer', rec.invoice_id; end if;
    if v_inv.currency_code <> v_cm.currency_code then raise exception 'Invoice % currency mismatch', rec.invoice_id; end if;
    if v_inv.status not in ('issued','partial') then raise exception 'Invoice % is not open', rec.invoice_id; end if;
    if rec.amt > v_inv.balance_due_minor then raise exception 'Allocation % exceeds invoice balance %', rec.amt, v_inv.balance_due_minor; end if;
    if rec.amt > v_cm.balance_remaining_minor then raise exception 'Allocation % exceeds credit remaining %', rec.amt, v_cm.balance_remaining_minor; end if;

    insert into acc_credit_memo_allocation (credit_memo_id, invoice_id, amount_minor)
      values (p_credit_memo_id, rec.invoice_id, rec.amt)
      on conflict (credit_memo_id, invoice_id)
      do update set amount_minor = acc_credit_memo_allocation.amount_minor + excluded.amount_minor;
    update acc_invoice set balance_due_minor = balance_due_minor - rec.amt,
        status = (case when balance_due_minor - rec.amt = 0 then 'paid' else 'partial' end)::acc_invoice_status, updated_at = now()
     where id = rec.invoice_id;
    v_cm.balance_remaining_minor := v_cm.balance_remaining_minor - rec.amt;
  end loop;

  update acc_credit_memo set balance_remaining_minor = v_cm.balance_remaining_minor,
      status = (case when v_cm.balance_remaining_minor = 0 then 'applied' else 'partial' end)::acc_credit_status, updated_at = now()
   where id = p_credit_memo_id;
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_credit_memo', p_credit_memo_id, 'update', auth.uid());
end;
$$;

create or replace function acc_apply_vendor_credit(p_vendor_credit_id uuid, p_allocations jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_vc acc_vendor_credit; v_bill acc_bill; rec record;
begin
  if not acc_is_staff() then raise exception 'Not authorized to apply vendor credits'; end if;
  select * into v_vc from acc_vendor_credit where id = p_vendor_credit_id for update;
  if not found then raise exception 'Vendor credit not found'; end if;
  if v_vc.status not in ('issued','partial') then raise exception 'Vendor credit is not open for allocation'; end if;

  for rec in select (a->>'bill_id')::uuid as bill_id, (a->>'amount_minor')::bigint as amt
               from jsonb_array_elements(coalesce(p_allocations,'[]'::jsonb)) a
  loop
    if rec.amt is null or rec.amt <= 0 then continue; end if;
    select * into v_bill from acc_bill where id = rec.bill_id for update;
    if not found then raise exception 'Bill not found: %', rec.bill_id; end if;
    if v_bill.vendor_id <> v_vc.vendor_id then raise exception 'Bill % is not for this vendor', rec.bill_id; end if;
    if v_bill.currency_code <> v_vc.currency_code then raise exception 'Bill % currency mismatch', rec.bill_id; end if;
    if v_bill.status not in ('open','partial') then raise exception 'Bill % is not open', rec.bill_id; end if;
    if rec.amt > v_bill.balance_due_minor then raise exception 'Allocation % exceeds bill balance %', rec.amt, v_bill.balance_due_minor; end if;
    if rec.amt > v_vc.balance_remaining_minor then raise exception 'Allocation % exceeds credit remaining %', rec.amt, v_vc.balance_remaining_minor; end if;

    insert into acc_vendor_credit_allocation (vendor_credit_id, bill_id, amount_minor)
      values (p_vendor_credit_id, rec.bill_id, rec.amt)
      on conflict (vendor_credit_id, bill_id)
      do update set amount_minor = acc_vendor_credit_allocation.amount_minor + excluded.amount_minor;
    update acc_bill set balance_due_minor = balance_due_minor - rec.amt,
        status = (case when balance_due_minor - rec.amt = 0 then 'paid' else 'partial' end)::acc_bill_status, updated_at=now()
     where id = rec.bill_id;
    v_vc.balance_remaining_minor := v_vc.balance_remaining_minor - rec.amt;
  end loop;

  update acc_vendor_credit set balance_remaining_minor = v_vc.balance_remaining_minor,
      status = (case when v_vc.balance_remaining_minor = 0 then 'applied' else 'partial' end)::acc_credit_status, updated_at=now()
   where id = p_vendor_credit_id;
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_vendor_credit', p_vendor_credit_id, 'update', auth.uid());
end;
$$;

create or replace function acc_record_customer_refund(
  p_customer_id uuid, p_refund_date date, p_currency text, p_amount_minor bigint,
  p_source_type text, p_payment_id uuid, p_credit_memo_id uuid, p_bank_account_id uuid, p_memo text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_ar uuid; v_number text; v_entry uuid; v_base bigint; v_id uuid; v_pay acc_payment; v_cm acc_credit_memo;
begin
  if not acc_is_staff() then raise exception 'Not authorized to record refunds'; end if;
  if p_amount_minor <= 0 then raise exception 'Refund amount must be positive'; end if;
  v_ar := acc_active_ar_account();
  if v_ar is null then raise exception 'No active Accounts Receivable account configured'; end if;

  if p_source_type = 'payment' then
    select * into v_pay from acc_payment where id = p_payment_id for update;
    if not found then raise exception 'Payment not found'; end if;
    if v_pay.customer_id <> p_customer_id then raise exception 'Payment is not for this customer'; end if;
    if v_pay.status = 'void' then raise exception 'Payment is void'; end if;
    if p_currency <> v_pay.currency_code then raise exception 'Refund currency % does not match payment currency %', p_currency, v_pay.currency_code; end if;
    if p_amount_minor > v_pay.unapplied_minor then raise exception 'Refund % exceeds unapplied payment %', p_amount_minor, v_pay.unapplied_minor; end if;
    update acc_payment set unapplied_minor = unapplied_minor - p_amount_minor, updated_at=now() where id = p_payment_id;
  elsif p_source_type = 'credit_memo' then
    select * into v_cm from acc_credit_memo where id = p_credit_memo_id for update;
    if not found then raise exception 'Credit memo not found'; end if;
    if v_cm.customer_id <> p_customer_id then raise exception 'Credit memo is not for this customer'; end if;
    if v_cm.status not in ('issued','partial') then raise exception 'Credit memo is not open'; end if;
    if p_currency <> v_cm.currency_code then raise exception 'Refund currency % does not match credit memo currency %', p_currency, v_cm.currency_code; end if;
    if p_amount_minor > v_cm.balance_remaining_minor then raise exception 'Refund % exceeds credit remaining %', p_amount_minor, v_cm.balance_remaining_minor; end if;
    update acc_credit_memo set balance_remaining_minor = balance_remaining_minor - p_amount_minor,
        status = (case when balance_remaining_minor - p_amount_minor = 0 then 'applied' else 'partial' end)::acc_credit_status, updated_at=now()
     where id = p_credit_memo_id;
  else
    raise exception 'Invalid refund source %', p_source_type;
  end if;

  v_base := acc_to_base_minor(p_amount_minor, p_currency, p_refund_date);
  v_number := acc_next_number('customer_refund');
  v_entry := acc_post_entry(p_refund_date, 'Customer refund ' || v_number, 'payment', null, p_currency,
    jsonb_build_array(
      jsonb_build_object('account_id', v_ar, 'debit_minor', p_amount_minor, 'credit_minor', 0, 'amount_base_minor', v_base, 'memo', 'Refund to customer'),
      jsonb_build_object('account_id', p_bank_account_id, 'debit_minor', 0, 'credit_minor', p_amount_minor, 'amount_base_minor', v_base, 'memo', 'Bank payment')
    ));
  insert into acc_customer_refund (refund_number, customer_id, refund_date, currency_code, amount_minor,
      source_type, payment_id, credit_memo_id, bank_account_id, status, journal_entry_id, memo, created_by)
    values (v_number, p_customer_id, p_refund_date, p_currency, p_amount_minor,
      p_source_type::acc_refund_source, p_payment_id, p_credit_memo_id, p_bank_account_id, 'posted', v_entry, p_memo, auth.uid())
    returning id into v_id;
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_customer_refund', v_id, 'post', auth.uid());
  return v_id;
end;
$$;

create or replace function acc_write_off(
  p_side text, p_target_id uuid, p_offset_account_id uuid, p_amount_minor bigint, p_date date, p_reason text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_number text; v_entry uuid; v_base bigint; v_id uuid; v_offtype acc_account_type;
  v_ar uuid; v_ap uuid; v_inv acc_invoice; v_bill acc_bill; v_ccy text;
begin
  if not acc_is_staff() then raise exception 'Not authorized to write off balances'; end if;
  if p_amount_minor <= 0 then raise exception 'Write-off amount must be positive'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'A write-off reason is required'; end if;
  select account_type into v_offtype from acc_account where id = p_offset_account_id;
  if v_offtype is null then raise exception 'Offset account not found'; end if;

  if p_side = 'ar' then
    if v_offtype not in ('expense','cost_of_goods_sold','other_expense') then
      raise exception 'AR write-off offset must be an expense account';
    end if;
    select * into v_inv from acc_invoice where id = p_target_id for update;
    if not found then raise exception 'Invoice not found'; end if;
    if v_inv.status not in ('issued','partial') then raise exception 'Invoice is not open'; end if;
    if p_amount_minor > v_inv.balance_due_minor then raise exception 'Write-off % exceeds invoice balance %', p_amount_minor, v_inv.balance_due_minor; end if;
    v_ccy := v_inv.currency_code;
    v_ar := acc_active_ar_account();
    if v_ar is null then raise exception 'No active Accounts Receivable account configured'; end if;
    v_base := acc_to_base_minor(p_amount_minor, v_ccy, p_date);
    v_number := acc_next_number('write_off');
    v_entry := acc_post_entry(p_date, 'Write-off ' || v_number, 'manual', p_target_id, v_ccy,
      jsonb_build_array(
        jsonb_build_object('account_id', p_offset_account_id, 'debit_minor', p_amount_minor, 'credit_minor', 0, 'amount_base_minor', v_base, 'memo', 'Bad debt write-off'),
        jsonb_build_object('account_id', v_ar, 'debit_minor', 0, 'credit_minor', p_amount_minor, 'amount_base_minor', v_base, 'memo', 'Write off receivable')
      ));
    update acc_invoice set balance_due_minor = balance_due_minor - p_amount_minor,
        status = (case when balance_due_minor - p_amount_minor = 0 then 'paid' else 'partial' end)::acc_invoice_status, updated_at=now()
     where id = p_target_id;
    insert into acc_write_off (write_off_number, side, invoice_id, write_off_date, currency_code, amount_minor, offset_account_id, reason, status, journal_entry_id, created_by)
      values (v_number, 'ar', p_target_id, p_date, v_ccy, p_amount_minor, p_offset_account_id, p_reason, 'posted', v_entry, auth.uid())
      returning id into v_id;
  elsif p_side = 'ap' then
    if v_offtype not in ('income','other_income') then
      raise exception 'AP write-off offset must be an income account';
    end if;
    select * into v_bill from acc_bill where id = p_target_id for update;
    if not found then raise exception 'Bill not found'; end if;
    if v_bill.status not in ('open','partial') then raise exception 'Bill is not open'; end if;
    if p_amount_minor > v_bill.balance_due_minor then raise exception 'Write-off % exceeds bill balance %', p_amount_minor, v_bill.balance_due_minor; end if;
    v_ccy := v_bill.currency_code;
    v_ap := coalesce((select ap_account_id from acc_vendor where id = v_bill.vendor_id), acc_active_ap_account());
    if v_ap is null then raise exception 'No active Accounts Payable account configured'; end if;
    v_base := acc_to_base_minor(p_amount_minor, v_ccy, p_date);
    v_number := acc_next_number('write_off');
    v_entry := acc_post_entry(p_date, 'Write-off ' || v_number, 'manual', p_target_id, v_ccy,
      jsonb_build_array(
        jsonb_build_object('account_id', v_ap, 'debit_minor', p_amount_minor, 'credit_minor', 0, 'amount_base_minor', v_base, 'memo', 'Write off payable'),
        jsonb_build_object('account_id', p_offset_account_id, 'debit_minor', 0, 'credit_minor', p_amount_minor, 'amount_base_minor', v_base, 'memo', 'Payable write-off income')
      ));
    update acc_bill set balance_due_minor = balance_due_minor - p_amount_minor,
        status = (case when balance_due_minor - p_amount_minor = 0 then 'paid' else 'partial' end)::acc_bill_status, updated_at=now()
     where id = p_target_id;
    insert into acc_write_off (write_off_number, side, bill_id, write_off_date, currency_code, amount_minor, offset_account_id, reason, status, journal_entry_id, created_by)
      values (v_number, 'ap', p_target_id, p_date, v_ccy, p_amount_minor, p_offset_account_id, p_reason, 'posted', v_entry, auth.uid())
      returning id into v_id;
  else
    raise exception 'Invalid write-off side %', p_side;
  end if;

  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_write_off', v_id, 'post', auth.uid());
  return v_id;
end;
$$;

create or replace function acc_void_write_off(p_write_off_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_w acc_write_off;
begin
  if not acc_is_staff() then raise exception 'Not authorized to void write-offs'; end if;
  select * into v_w from acc_write_off where id = p_write_off_id for update;
  if not found then raise exception 'Write-off not found'; end if;
  if v_w.status = 'void' then raise exception 'Write-off is already void'; end if;
  if v_w.side = 'ar' then
    update acc_invoice set balance_due_minor = balance_due_minor + v_w.amount_minor,
        status = (case when balance_due_minor + v_w.amount_minor >= total_minor then 'issued' else 'partial' end)::acc_invoice_status,
        updated_at=now() where id = v_w.invoice_id and status <> 'void';
  else
    update acc_bill set balance_due_minor = balance_due_minor + v_w.amount_minor,
        status = (case when balance_due_minor + v_w.amount_minor >= total_minor then 'open' else 'partial' end)::acc_bill_status,
        updated_at=now() where id = v_w.bill_id and status <> 'void';
  end if;
  if v_w.journal_entry_id is not null then
    update acc_journal_entry set status='void', voided_at=now() where id = v_w.journal_entry_id;
  end if;
  update acc_write_off set status='void', updated_at=now() where id = p_write_off_id;
  insert into acc_audit_log (table_name, record_id, action, actor_id)
    values ('acc_write_off', p_write_off_id, 'void', auth.uid());
end;
$$;
