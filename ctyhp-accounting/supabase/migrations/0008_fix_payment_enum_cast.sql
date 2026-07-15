-- Fix: CASE expressions yield text; cast to the enum types when writing
-- acc_payment.status and acc_invoice.status.
create or replace function acc_record_payment(
  p_customer_id       uuid,
  p_payment_date      date,
  p_currency          text,
  p_amount_minor      bigint,
  p_deposit_account_id uuid,
  p_method            text,
  p_memo              text,
  p_allocations       jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_ar          uuid;
  v_number      text;
  v_entry       uuid;
  v_payment     uuid;
  v_alloc_total bigint := 0;
  v_base        bigint;
  rec           record;
  v_inv         acc_invoice;
begin
  if not acc_is_staff() then raise exception 'Not authorized to record payments'; end if;
  if p_amount_minor <= 0 then raise exception 'Payment amount must be positive'; end if;

  select coalesce(sum((a->>'amount_minor')::bigint), 0) into v_alloc_total
    from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) a;
  if v_alloc_total > p_amount_minor then
    raise exception 'Allocations (%) exceed payment amount (%)', v_alloc_total, p_amount_minor;
  end if;

  v_ar := acc_active_ar_account();
  if v_ar is null then raise exception 'No active Accounts Receivable account configured'; end if;

  v_base := acc_to_base_minor(p_amount_minor, p_currency, p_payment_date);
  v_number := acc_next_number('payment');
  v_entry := acc_post_entry(
    p_payment_date, 'Payment ' || v_number, 'payment', null, p_currency,
    jsonb_build_array(
      jsonb_build_object('account_id', p_deposit_account_id, 'debit_minor', p_amount_minor,
        'credit_minor', 0, 'amount_base_minor', v_base, 'memo', 'Bank deposit'),
      jsonb_build_object('account_id', v_ar, 'debit_minor', 0, 'credit_minor', p_amount_minor,
        'amount_base_minor', v_base, 'memo', 'Clear receivable')
    ));

  insert into acc_payment(payment_number, customer_id, payment_date, currency_code, amount_minor,
      unapplied_minor, method, deposit_account_id, status, journal_entry_id, memo, created_by)
    values (v_number, p_customer_id, p_payment_date, p_currency, p_amount_minor,
      p_amount_minor - v_alloc_total, p_method, p_deposit_account_id,
      (case when v_alloc_total = 0 then 'unapplied'
            when v_alloc_total = p_amount_minor then 'applied'
            else 'partial' end)::acc_payment_status,
      v_entry, p_memo, auth.uid())
    returning id into v_payment;

  for rec in
    select (a->>'invoice_id')::uuid as invoice_id, (a->>'amount_minor')::bigint as amt
      from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) a
  loop
    if rec.amt is null or rec.amt <= 0 then continue; end if;
    select * into v_inv from acc_invoice where id = rec.invoice_id for update;
    if not found then raise exception 'Invoice not found: %', rec.invoice_id; end if;
    if rec.amt > v_inv.balance_due_minor then
      raise exception 'Allocation % exceeds invoice balance %', rec.amt, v_inv.balance_due_minor;
    end if;
    insert into acc_payment_allocation(payment_id, invoice_id, amount_minor)
      values (v_payment, rec.invoice_id, rec.amt);
    update acc_invoice
       set balance_due_minor = balance_due_minor - rec.amt,
           status = (case when balance_due_minor - rec.amt = 0 then 'paid' else 'partial' end)::acc_invoice_status,
           updated_at = now()
     where id = rec.invoice_id;
  end loop;

  return v_payment;
end;
$$;
