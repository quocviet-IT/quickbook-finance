-- ============================================================================
-- 0076 — Paying a bill early, and keeping the discount.
--
-- An early-payment discount settles the bill in full while less cash leaves the
-- bank. The difference is income:
--
--     Dr  Accounts Payable        what the bill is settled for
--       Cr  Bank                  cash actually paid
--       Cr  Purchase Discounts    the difference
--
-- Every rule about when a discount may be taken is enforced here rather than in
-- the screen, because a discount claimed after the window has closed is money
-- the vendor will still ask for.
-- ============================================================================

create or replace function acc_pay_bills(
  p_vendor_id          uuid,
  p_payment_date       date,
  p_currency           text,
  p_amount_minor       bigint,
  p_payment_account_id uuid,
  p_method             text,
  p_memo               text,
  p_allocations        jsonb,
  p_reference          text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_ap            uuid;
  v_discount_acct uuid;
  v_number        text;
  v_entry         uuid;
  v_payment       uuid;
  v_alloc_total   bigint := 0;
  v_disc_total    bigint := 0;
  v_base          bigint;
  v_lines         jsonb;
  rec             record;
  v_bill          acc_bill;
  v_settled       bigint;
begin
  if not acc_is_staff() then raise exception 'Not authorized to pay bills'; end if;
  if p_amount_minor <= 0 then raise exception 'Payment amount must be positive'; end if;

  select coalesce(sum((a->>'amount_minor')::bigint), 0),
         coalesce(sum((a->>'discount_minor')::bigint), 0)
    into v_alloc_total, v_disc_total
    from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) a;
  if v_alloc_total > p_amount_minor then
    raise exception 'Allocations (%) exceed payment amount (%)', v_alloc_total, p_amount_minor;
  end if;

  v_ap := coalesce((select ap_account_id from acc_vendor where id = p_vendor_id), acc_active_ap_account());
  if v_ap is null then raise exception 'No active Accounts Payable account configured'; end if;

  if v_disc_total > 0 then
    v_discount_acct := acc_active_purchase_discount_account();
    if v_discount_acct is null then
      raise exception 'No active Purchase Discounts account configured; a discount has nowhere to post';
    end if;
  end if;

  v_base := acc_to_base_minor(p_amount_minor, p_currency, p_payment_date);
  v_number := acc_next_number('bill_payment');

  -- Payables are relieved by the cash *and* the discount; the two credits add
  -- back to the debit, which is what keeps the entry balanced.
  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', v_ap,
      'debit_minor', p_amount_minor + v_disc_total, 'credit_minor', 0,
      'amount_base_minor', acc_to_base_minor(p_amount_minor + v_disc_total, p_currency, p_payment_date),
      'memo', 'Pay accounts payable'),
    jsonb_build_object('account_id', p_payment_account_id,
      'debit_minor', 0, 'credit_minor', p_amount_minor,
      'amount_base_minor', v_base, 'memo', 'Bank/credit payment')
  );
  if v_disc_total > 0 then
    v_lines := v_lines || jsonb_build_object(
      'account_id', v_discount_acct, 'debit_minor', 0, 'credit_minor', v_disc_total,
      'amount_base_minor', acc_to_base_minor(v_disc_total, p_currency, p_payment_date),
      'memo', 'Early payment discount taken');
  end if;

  v_entry := acc_post_entry(
    p_payment_date, 'Bill payment ' || v_number, 'bill_payment', null, p_currency, v_lines);

  insert into acc_bill_payment(payment_number, vendor_id, payment_date, currency_code, amount_minor,
      unapplied_minor, payment_account_id, method, reference, status, journal_entry_id, memo, created_by)
    values (v_number, p_vendor_id, p_payment_date, p_currency, p_amount_minor,
      p_amount_minor - v_alloc_total, p_payment_account_id, p_method,
      nullif(btrim(coalesce(p_reference, '')), ''),
      (case when v_alloc_total = 0 then 'unapplied'
           when v_alloc_total = p_amount_minor then 'applied'
           else 'partial' end)::acc_bill_payment_status,
      v_entry, p_memo, auth.uid())
    returning id into v_payment;

  for rec in
    select (a->>'bill_id')::uuid as bill_id,
           (a->>'amount_minor')::bigint as amt,
           coalesce((a->>'discount_minor')::bigint, 0) as disc
      from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) a
  loop
    if rec.amt is null or rec.amt <= 0 then continue; end if;
    select * into v_bill from acc_bill where id = rec.bill_id for update;
    if not found then raise exception 'Bill not found: %', rec.bill_id; end if;
    if v_bill.vendor_id <> p_vendor_id then
      raise exception 'Bill % does not belong to vendor %', rec.bill_id, p_vendor_id;
    end if;
    if v_bill.status not in ('open', 'partial') then
      raise exception 'Bill % is not an open payable (status %)', rec.bill_id, v_bill.status;
    end if;
    if v_bill.currency_code <> p_currency then
      raise exception 'Bill % currency % does not match payment currency %',
        rec.bill_id, v_bill.currency_code, p_currency;
    end if;

    if rec.disc > 0 then
      if v_bill.discount_due_date is null then
        raise exception 'Bill % offers no early payment discount', coalesce(v_bill.bill_number, rec.bill_id::text);
      end if;
      if p_payment_date > v_bill.discount_due_date then
        raise exception 'The discount on bill % expired on %; it cannot be taken on %',
          coalesce(v_bill.bill_number, rec.bill_id::text), v_bill.discount_due_date, p_payment_date;
      end if;
      if rec.disc > v_bill.discount_amount_minor - v_bill.discount_taken_minor then
        raise exception 'Discount % exceeds what bill % offers (%)',
          rec.disc, coalesce(v_bill.bill_number, rec.bill_id::text),
          v_bill.discount_amount_minor - v_bill.discount_taken_minor;
      end if;
    end if;

    v_settled := rec.amt + rec.disc;
    if v_settled > v_bill.balance_due_minor then
      raise exception 'Payment and discount (%) exceed the balance of bill % (%)',
        v_settled, coalesce(v_bill.bill_number, rec.bill_id::text), v_bill.balance_due_minor;
    end if;

    insert into acc_bill_payment_allocation(bill_payment_id, bill_id, amount_minor)
      values (v_payment, rec.bill_id, rec.amt);

    update acc_bill
       set balance_due_minor = balance_due_minor - v_settled,
           discount_taken_minor = discount_taken_minor + rec.disc,
           status = (case when balance_due_minor - v_settled = 0 then 'paid' else 'partial' end)::acc_bill_status,
           updated_at = now()
     where id = rec.bill_id;
  end loop;

  return v_payment;
end;
$$;

revoke all on function acc_pay_bills(uuid, date, text, bigint, uuid, text, text, jsonb, text) from public;
grant execute on function acc_pay_bills(uuid, date, text, bigint, uuid, text, text, jsonb, text)
  to authenticated, service_role;
