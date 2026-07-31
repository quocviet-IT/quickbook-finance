-- ============================================================================
-- Settlement history and the inputs a cash-flow forecast needs.
--
-- A document's status and balance were always right, but nothing showed *how*
-- a balance got there: which payments landed, when, by what method, under what
-- check or wire reference, and what a credit memo or a write-off took off it.
-- The data was in three tables that no screen joined.
--
-- Nothing here stores a derived amount. `amount_paid` and `payment_date` stay
-- out of acc_invoice on purpose: they follow from the allocations, and a stored
-- copy is a second number that can disagree with the ledger.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The reference an American bank statement is reconciled by: a check number,
--    a wire reference, an ACH trace. `method` says how it was paid; this says
--    which one it was.
-- ----------------------------------------------------------------------------
alter table acc_payment
  add column if not exists reference text check (reference is null or length(reference) <= 80);
alter table acc_bill_payment
  add column if not exists reference text check (reference is null or length(reference) <= 80);

-- ----------------------------------------------------------------------------
-- 2. acc_record_payment, with the reference. Body copied verbatim from
--    0008_fix_payment_enum_cast.sql; the new parameter and the column it fills
--    are the only changes. The old signature is dropped so a call with the
--    original eight arguments is not ambiguous.
-- ----------------------------------------------------------------------------
drop function if exists acc_record_payment(uuid, date, text, bigint, uuid, text, text, jsonb);

create or replace function acc_record_payment(
  p_customer_id       uuid,
  p_payment_date      date,
  p_currency          text,
  p_amount_minor      bigint,
  p_deposit_account_id uuid,
  p_method            text,
  p_memo              text,
  p_allocations       jsonb,
  p_reference         text default null
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
      unapplied_minor, method, reference, deposit_account_id, status, journal_entry_id, memo, created_by)
    values (v_number, p_customer_id, p_payment_date, p_currency, p_amount_minor,
      p_amount_minor - v_alloc_total, p_method, nullif(btrim(coalesce(p_reference, '')), ''),
      p_deposit_account_id,
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

revoke all on function acc_record_payment(uuid, date, text, bigint, uuid, text, text, jsonb, text) from public;
grant execute on function acc_record_payment(uuid, date, text, bigint, uuid, text, text, jsonb, text)
  to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. acc_pay_bills, with the same reference. Body copied verbatim from
--    0012_payables_functions.sql.
-- ----------------------------------------------------------------------------
drop function if exists acc_pay_bills(uuid, date, text, bigint, uuid, text, text, jsonb);

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
    select (a->>'bill_id')::uuid as bill_id, (a->>'amount_minor')::bigint as amt
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

revoke all on function acc_pay_bills(uuid, date, text, bigint, uuid, text, text, jsonb, text) from public;
grant execute on function acc_pay_bills(uuid, date, text, bigint, uuid, text, text, jsonb, text)
  to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. Everything that has settled one invoice: payments, credit memos applied,
--    and write-offs. Voided documents are excluded — a void put the balance
--    back, so listing it would show money that never left.
-- ----------------------------------------------------------------------------
create or replace function acc_invoice_settlements(p_invoice_id uuid)
returns table (
  settled_on     date,
  settlement_type text,
  document_number text,
  method         text,
  reference      text,
  memo           text,
  amount_minor   bigint
)
language sql stable security definer set search_path = public as $$
  select p.payment_date, 'payment', p.payment_number, p.method, p.reference, p.memo, a.amount_minor
    from acc_payment_allocation a
    join acc_payment p on p.id = a.payment_id
   where a.invoice_id = p_invoice_id and p.status <> 'void'
  union all
  select m.memo_date, 'credit_memo', m.credit_memo_number, null, null, m.memo, ca.amount_minor
    from acc_credit_memo_allocation ca
    join acc_credit_memo m on m.id = ca.credit_memo_id
   where ca.invoice_id = p_invoice_id and m.status <> 'void'
  union all
  select w.write_off_date, 'write_off', w.write_off_number, null, null, w.reason, w.amount_minor
    from acc_write_off w
   where w.invoice_id = p_invoice_id and w.status <> 'void'
  order by 1, 3;
$$;

revoke all on function acc_invoice_settlements(uuid) from public;
grant execute on function acc_invoice_settlements(uuid) to authenticated, service_role;

-- The same for a bill: payments made, vendor credits applied, and write-offs.
create or replace function acc_bill_settlements(p_bill_id uuid)
returns table (
  settled_on     date,
  settlement_type text,
  document_number text,
  method         text,
  reference      text,
  memo           text,
  amount_minor   bigint
)
language sql stable security definer set search_path = public as $$
  select bp.payment_date, 'payment', bp.payment_number, bp.method, bp.reference, bp.memo, a.amount_minor
    from acc_bill_payment_allocation a
    join acc_bill_payment bp on bp.id = a.bill_payment_id
   where a.bill_id = p_bill_id and bp.status <> 'void'
  union all
  select vc.credit_date, 'vendor_credit', vc.vendor_credit_number, null, null, vc.memo, va.amount_minor
    from acc_vendor_credit_allocation va
    join acc_vendor_credit vc on vc.id = va.vendor_credit_id
   where va.bill_id = p_bill_id and vc.status <> 'void'
  union all
  select w.write_off_date, 'write_off', w.write_off_number, null, null, w.reason, w.amount_minor
    from acc_write_off w
   where w.bill_id = p_bill_id and w.status <> 'void'
  order by 1, 3;
$$;

revoke all on function acc_bill_settlements(uuid) from public;
grant execute on function acc_bill_settlements(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 5. Forecast inputs.
--
--    Open items are what is still owed, by due date. Settled history is how
--    late those documents were actually paid, which is the only honest basis
--    for adjusting a due date into an expected date. Both are raw rows: the
--    projection itself is computed in the application, where it is unit tested.
-- ----------------------------------------------------------------------------
create or replace function acc_open_items(p_as_of date default current_date)
returns table (
  side          text,
  document_id   uuid,
  document_number text,
  party_name    text,
  due_date      date,
  balance_minor bigint
)
language sql stable security definer set search_path = public as $$
  select 'receivable', i.id, i.invoice_number, c.name,
         coalesce(i.due_date, i.issue_date),
         acc_to_base_minor(i.balance_due_minor, i.currency_code, current_date)::bigint
    from acc_invoice i
    join acc_customer c on c.id = i.customer_id
   where i.status in ('issued', 'partial') and i.balance_due_minor > 0
     and i.issue_date <= coalesce(p_as_of, current_date)
  union all
  select 'payable', b.id, b.bill_number, v.name,
         coalesce(b.due_date, b.bill_date),
         acc_to_base_minor(b.balance_due_minor, b.currency_code, current_date)::bigint
    from acc_bill b
    join acc_vendor v on v.id = b.vendor_id
   where b.status in ('open', 'partial') and b.balance_due_minor > 0
     and b.bill_date <= coalesce(p_as_of, current_date)
  order by 5, 3;
$$;

revoke all on function acc_open_items(date) from public;
grant execute on function acc_open_items(date) to authenticated, service_role;

/**
 * How late settled documents were, one row each: the due date, the date the
 * last settlement landed, and the amount. A forecast reads the lag from this
 * rather than assuming everyone pays on the day they promised.
 */
create or replace function acc_settlement_lag(p_since date default null)
returns table (
  side         text,
  due_date     date,
  settled_on   date,
  amount_minor bigint
)
language sql stable security definer set search_path = public as $$
  with paid_invoices as (
    select i.id, coalesce(i.due_date, i.issue_date) as due_date,
           max(p.payment_date) as settled_on,
           acc_to_base_minor(i.total_minor, i.currency_code, current_date)::bigint as amount_minor
      from acc_invoice i
      join acc_payment_allocation a on a.invoice_id = i.id
      join acc_payment p on p.id = a.payment_id and p.status <> 'void'
     where i.status = 'paid'
     group by i.id, i.due_date, i.issue_date, i.total_minor, i.currency_code
  ),
  paid_bills as (
    select b.id, coalesce(b.due_date, b.bill_date) as due_date,
           max(bp.payment_date) as settled_on,
           acc_to_base_minor(b.total_minor, b.currency_code, current_date)::bigint as amount_minor
      from acc_bill b
      join acc_bill_payment_allocation a on a.bill_id = b.id
      join acc_bill_payment bp on bp.id = a.bill_payment_id and bp.status <> 'void'
     where b.status = 'paid'
     group by b.id, b.due_date, b.bill_date, b.total_minor, b.currency_code
  )
  select 'receivable', due_date, settled_on, amount_minor from paid_invoices
   where p_since is null or settled_on >= p_since
  union all
  select 'payable', due_date, settled_on, amount_minor from paid_bills
   where p_since is null or settled_on >= p_since;
$$;

revoke all on function acc_settlement_lag(date) from public;
grant execute on function acc_settlement_lag(date) to authenticated, service_role;

notify pgrst, 'reload schema';
