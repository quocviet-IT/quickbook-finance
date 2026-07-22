-- ============================================================================
-- Module 3b posting functions (atomic: document state + ledger commit together).
--   acc_post_bill        — draft -> open, posts DR expense / CR AP
--   acc_record_expense   — posts DR expense / CR bank|credit card
--   acc_pay_bills        — posts DR AP / CR bank|credit card, allocates to bills
--   acc_void_*           — reverse the entry (only if safe)
-- All SECURITY DEFINER and gated by acc_is_staff(). Amounts recomputed server-side.
-- ============================================================================

create or replace function acc_active_ap_account() returns uuid
language sql stable as $$
  select id from acc_account
   where account_type = 'accounts_payable' and is_posting_account and status = 'active'
   order by account_code limit 1;
$$;

-- ----------------------------------------------------------------------------
-- Post a bill: DR expense (grouped) / CR Accounts Payable (total).
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
  rec      record;
begin
  if not acc_is_staff() then raise exception 'Not authorized to post bills'; end if;

  select * into v_bill from acc_bill where id = p_bill_id for update;
  if not found then raise exception 'Bill not found'; end if;
  if v_bill.status <> 'draft' then raise exception 'Only draft bills can be posted'; end if;

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

  return v_entry;
end;
$$;

-- ----------------------------------------------------------------------------
-- Void a bill (only if unpaid). Draft bills are simply marked void.
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
  if v_bill.status = 'draft' then
    update acc_bill set status = 'void', updated_at = now() where id = p_bill_id;
    return;
  end if;
  if v_bill.balance_due_minor <> v_bill.total_minor then
    raise exception 'Cannot void a bill with payments applied; remove payments first';
  end if;

  -- Reports include only status='posted' entries, so voiding the entry reverses
  -- its ledger effect. Do NOT also post a reversal (that would double-count).
  if v_bill.journal_entry_id is not null then
    update acc_journal_entry set status = 'void', voided_at = now()
     where id = v_bill.journal_entry_id;
  end if;

  update acc_bill set status = 'void', balance_due_minor = 0, updated_at = now()
   where id = p_bill_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Record an immediate expense: DR expense (grouped) / CR payment account.
-- p_lines: [{ "expense_account_id": uuid, "amount_minor": bigint, "description": text }]
-- ----------------------------------------------------------------------------
create or replace function acc_record_expense(
  p_vendor_id          uuid,
  p_payment_account_id uuid,
  p_expense_date       date,
  p_currency           text,
  p_memo               text,
  p_lines              jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_total  bigint := 0;
  v_number text;
  v_entry  uuid;
  v_exp    uuid;
  v_jlines jsonb := '[]'::jsonb;
  rec      record;
  v_order  int := 0;
  v_line   jsonb;
begin
  if not acc_is_staff() then raise exception 'Not authorized to record expenses'; end if;

  select coalesce(sum((l->>'amount_minor')::bigint), 0) into v_total
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l;
  if v_total <= 0 then raise exception 'Expense total must be positive'; end if;

  for rec in
    select (l->>'expense_account_id')::uuid as acc, sum((l->>'amount_minor')::bigint)::bigint as amt
      from jsonb_array_elements(p_lines) l
      group by (l->>'expense_account_id')::uuid having sum((l->>'amount_minor')::bigint) <> 0
  loop
    v_jlines := v_jlines || jsonb_build_object(
      'account_id', rec.acc, 'debit_minor', rec.amt, 'credit_minor', 0,
      'amount_base_minor', acc_to_base_minor(rec.amt, p_currency, p_expense_date), 'memo', 'Expense');
  end loop;
  v_jlines := v_jlines || jsonb_build_object(
    'account_id', p_payment_account_id, 'debit_minor', 0, 'credit_minor', v_total,
    'amount_base_minor', acc_to_base_minor(v_total, p_currency, p_expense_date), 'memo', 'Payment');

  v_number := acc_next_number('expense');
  v_entry := acc_post_entry(p_expense_date, 'Expense ' || v_number, 'expense', null, p_currency, v_jlines);

  insert into acc_expense(expense_number, vendor_id, payment_account_id, expense_date,
      currency_code, total_minor, status, journal_entry_id, memo, created_by)
    values (v_number, p_vendor_id, p_payment_account_id, p_expense_date, p_currency,
      v_total, 'posted', v_entry, p_memo, auth.uid())
    returning id into v_exp;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    insert into acc_expense_line(expense_id, line_order, description, expense_account_id, amount_minor)
      values (v_exp, v_order, coalesce(v_line->>'description', ''),
              (v_line->>'expense_account_id')::uuid, (v_line->>'amount_minor')::bigint);
    v_order := v_order + 1;
  end loop;

  return v_exp;
end;
$$;

-- ----------------------------------------------------------------------------
-- Void an expense: reverse its entry.
-- ----------------------------------------------------------------------------
create or replace function acc_void_expense(p_expense_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_exp   acc_expense;
begin
  if not acc_is_staff() then raise exception 'Not authorized to void expenses'; end if;

  select * into v_exp from acc_expense where id = p_expense_id for update;
  if not found then raise exception 'Expense not found'; end if;
  if v_exp.status = 'void' then raise exception 'Expense is already void'; end if;

  -- Voiding the entry reverses its ledger effect (reports use status='posted' only);
  -- do NOT also post a reversal.
  if v_exp.journal_entry_id is not null then
    update acc_journal_entry set status = 'void', voided_at = now()
     where id = v_exp.journal_entry_id;
  end if;

  update acc_expense set status = 'void', updated_at = now() where id = p_expense_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Pay bills: DR Accounts Payable / CR payment account; allocate to bills.
-- p_allocations: [{ "bill_id": uuid, "amount_minor": bigint }]
-- ----------------------------------------------------------------------------
create or replace function acc_pay_bills(
  p_vendor_id          uuid,
  p_payment_date       date,
  p_currency           text,
  p_amount_minor       bigint,
  p_payment_account_id uuid,
  p_method             text,
  p_memo               text,
  p_allocations        jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_ap          uuid;
  v_number      text;
  v_entry       uuid;
  v_payment     uuid;
  v_alloc_total bigint := 0;
  v_base        bigint;
  rec           record;
  v_bill        acc_bill;
begin
  if not acc_is_staff() then raise exception 'Not authorized to pay bills'; end if;
  if p_amount_minor <= 0 then raise exception 'Payment amount must be positive'; end if;

  select coalesce(sum((a->>'amount_minor')::bigint), 0) into v_alloc_total
    from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) a;
  if v_alloc_total > p_amount_minor then
    raise exception 'Allocations (%) exceed payment amount (%)', v_alloc_total, p_amount_minor;
  end if;

  v_ap := coalesce((select ap_account_id from acc_vendor where id = p_vendor_id), acc_active_ap_account());
  if v_ap is null then raise exception 'No active Accounts Payable account configured'; end if;

  v_base := acc_to_base_minor(p_amount_minor, p_currency, p_payment_date);
  v_number := acc_next_number('bill_payment');
  v_entry := acc_post_entry(
    p_payment_date, 'Bill payment ' || v_number, 'bill_payment', null, p_currency,
    jsonb_build_array(
      jsonb_build_object('account_id', v_ap, 'debit_minor', p_amount_minor, 'credit_minor', 0,
        'amount_base_minor', v_base, 'memo', 'Pay accounts payable'),
      jsonb_build_object('account_id', p_payment_account_id, 'debit_minor', 0, 'credit_minor', p_amount_minor,
        'amount_base_minor', v_base, 'memo', 'Bank/credit payment')
    ));

  insert into acc_bill_payment(payment_number, vendor_id, payment_date, currency_code, amount_minor,
      unapplied_minor, payment_account_id, method, status, journal_entry_id, memo, created_by)
    values (v_number, p_vendor_id, p_payment_date, p_currency, p_amount_minor,
      p_amount_minor - v_alloc_total, p_payment_account_id, p_method,
      (case when v_alloc_total = 0 then 'unapplied'
           when v_alloc_total = p_amount_minor then 'applied'
           else 'partial' end)::acc_bill_payment_status,
      v_entry, p_memo, auth.uid())
    returning id into v_payment;

  for rec in
    select (a->>'bill_id')::uuid as bill_id, (a->>'amount_minor')::bigint as amt
      from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) a
  loop
    if rec.amt is null or rec.amt <= 0 then continue; end if;
    select * into v_bill from acc_bill where id = rec.bill_id for update;
    if not found then raise exception 'Bill not found: %', rec.bill_id; end if;
    -- The bill must be an open payable for this same vendor and currency, so a
    -- payment can never be allocated to a draft/paid/void bill, another vendor's
    -- bill, or a bill in a different currency (guards ledger/subledger integrity).
    if v_bill.vendor_id <> p_vendor_id then
      raise exception 'Bill % does not belong to vendor %', rec.bill_id, p_vendor_id;
    end if;
    if v_bill.status not in ('open', 'partial') then
      raise exception 'Bill % is not an open payable (status %)', rec.bill_id, v_bill.status;
    end if;
    if v_bill.currency_code <> p_currency then
      raise exception 'Bill % currency % does not match payment currency %', rec.bill_id, v_bill.currency_code, p_currency;
    end if;
    if rec.amt > v_bill.balance_due_minor then
      raise exception 'Allocation % exceeds bill balance %', rec.amt, v_bill.balance_due_minor;
    end if;
    insert into acc_bill_payment_allocation(bill_payment_id, bill_id, amount_minor)
      values (v_payment, rec.bill_id, rec.amt);
    update acc_bill
       set balance_due_minor = balance_due_minor - rec.amt,
           status = (case when balance_due_minor - rec.amt = 0 then 'paid' else 'partial' end)::acc_bill_status,
           updated_at = now()
     where id = rec.bill_id;
  end loop;

  return v_payment;
end;
$$;

-- ----------------------------------------------------------------------------
-- Void a bill payment: reverse the entry and restore bill balances.
-- ----------------------------------------------------------------------------
create or replace function acc_void_bill_payment(p_payment_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_pay   acc_bill_payment;
  arec    record;
begin
  if not acc_is_staff() then raise exception 'Not authorized to void bill payments'; end if;

  select * into v_pay from acc_bill_payment where id = p_payment_id for update;
  if not found then raise exception 'Bill payment not found'; end if;
  if v_pay.status = 'void' then raise exception 'Bill payment is already void'; end if;

  -- Restore each allocated bill's balance/status.
  for arec in select bill_id, amount_minor from acc_bill_payment_allocation where bill_payment_id = p_payment_id
  loop
    update acc_bill
       set balance_due_minor = balance_due_minor + arec.amount_minor,
           status = (case when balance_due_minor + arec.amount_minor >= total_minor then 'open' else 'partial' end)::acc_bill_status,
           updated_at = now()
     where id = arec.bill_id and status <> 'void';
  end loop;

  -- Voiding the entry reverses its ledger effect (reports use status='posted' only);
  -- do NOT also post a reversal.
  if v_pay.journal_entry_id is not null then
    update acc_journal_entry set status = 'void', voided_at = now()
     where id = v_pay.journal_entry_id;
  end if;

  update acc_bill_payment set status = 'void', unapplied_minor = 0, updated_at = now()
   where id = p_payment_id;
end;
$$;
