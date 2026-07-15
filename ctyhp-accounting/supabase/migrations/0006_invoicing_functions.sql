-- ============================================================================
-- Module 2 posting functions (atomic: document state + ledger commit together).
--   acc_issue_invoice   — draft -> issued, posts DR AR / CR income / CR tax
--   acc_record_payment  — posts DR bank / CR AR, allocates to invoices
--   acc_void_invoice    — reverses the invoice entry (only if unpaid)
-- All are SECURITY DEFINER and gated by acc_is_staff().
-- ============================================================================

-- Convert a minor-unit amount in p_currency to base-currency minor units.
create or replace function acc_to_base_minor(p_minor bigint, p_currency text, p_date date)
returns bigint language plpgsql stable as $$
declare
  v_base text; v_base_dec int; v_cur_dec int; v_rate numeric;
begin
  select code, decimal_places into v_base, v_base_dec from acc_currency where is_base;
  if p_currency = v_base then
    return p_minor;
  end if;
  select decimal_places into v_cur_dec from acc_currency where code = p_currency;
  select rate_to_base into v_rate from acc_exchange_rate
    where currency_code = p_currency and rate_date <= p_date
    order by rate_date desc limit 1;
  if v_rate is null then
    raise exception 'No exchange rate for % on or before %', p_currency, p_date;
  end if;
  return round((p_minor::numeric / (10 ^ v_cur_dec)) * v_rate * (10 ^ v_base_dec));
end;
$$;

create or replace function acc_active_ar_account() returns uuid
language sql stable as $$
  select id from acc_account
   where account_type = 'accounts_receivable' and is_posting_account and status = 'active'
   order by account_code limit 1;
$$;

-- ----------------------------------------------------------------------------
create or replace function acc_issue_invoice(p_invoice_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_inv    acc_invoice;
  v_ar     uuid;
  v_number text;
  v_lines  jsonb := '[]'::jsonb;
  v_entry  uuid;
  rec      record;
begin
  if not acc_is_staff() then raise exception 'Not authorized to issue invoices'; end if;

  select * into v_inv from acc_invoice where id = p_invoice_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if v_inv.status <> 'draft' then raise exception 'Only draft invoices can be issued'; end if;
  if v_inv.total_minor <= 0 then raise exception 'Invoice total must be positive'; end if;

  v_ar := acc_active_ar_account();
  if v_ar is null then raise exception 'No active Accounts Receivable account configured'; end if;

  -- DR Accounts Receivable (total)
  v_lines := v_lines || jsonb_build_object(
    'account_id', v_ar, 'debit_minor', v_inv.total_minor, 'credit_minor', 0,
    'amount_base_minor', acc_to_base_minor(v_inv.total_minor, v_inv.currency_code, v_inv.issue_date),
    'memo', 'Accounts receivable');

  -- CR Income (grouped by income account)
  for rec in
    select income_account_id as acc, sum(line_subtotal_minor) as amt
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
    select tc.tax_account_id as acc, sum(il.line_tax_minor) as amt
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

  return v_entry;
end;
$$;

-- ----------------------------------------------------------------------------
create or replace function acc_record_payment(
  p_customer_id       uuid,
  p_payment_date      date,
  p_currency          text,
  p_amount_minor      bigint,
  p_deposit_account_id uuid,
  p_method            text,
  p_memo              text,
  p_allocations       jsonb  -- [{ "invoice_id": uuid, "amount_minor": bigint }]
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
      case when v_alloc_total = 0 then 'unapplied'
           when v_alloc_total = p_amount_minor then 'applied'
           else 'partial' end,
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
           status = case when balance_due_minor - rec.amt = 0 then 'paid' else 'partial' end,
           updated_at = now()
     where id = rec.invoice_id;
  end loop;

  return v_payment;
end;
$$;

-- ----------------------------------------------------------------------------
create or replace function acc_void_invoice(p_invoice_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_inv   acc_invoice;
  v_lines jsonb := '[]'::jsonb;
  rec     record;
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

  if v_inv.journal_entry_id is not null then
    for rec in
      select account_id, debit_minor, credit_minor, amount_base_minor
        from acc_journal_line where journal_entry_id = v_inv.journal_entry_id
    loop
      v_lines := v_lines || jsonb_build_object(
        'account_id', rec.account_id, 'debit_minor', rec.credit_minor,
        'credit_minor', rec.debit_minor, 'amount_base_minor', rec.amount_base_minor,
        'memo', 'Void invoice ' || coalesce(v_inv.invoice_number, ''));
    end loop;
    perform acc_post_entry(current_date, 'Void invoice ' || coalesce(v_inv.invoice_number, ''),
                           'invoice', p_invoice_id, v_inv.currency_code, v_lines);
    update acc_journal_entry set status = 'void', voided_at = now()
     where id = v_inv.journal_entry_id;
  end if;

  update acc_invoice set status = 'void', balance_due_minor = 0, updated_at = now()
   where id = p_invoice_id;
end;
$$;
