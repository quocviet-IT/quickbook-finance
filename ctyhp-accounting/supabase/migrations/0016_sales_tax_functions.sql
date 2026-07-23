-- ============================================================================
-- Sales Tax Center functions: read the liability (collected per rate + payable
-- balance) and post/void remittances. Posting is atomic and staff-gated.
-- Void marks the entry 'void' (reports exclude void) — no reversal posting.
-- ============================================================================

-- Tax collected per sales tax code from issued (non-void) invoices in [from,to].
create or replace function acc_sales_tax_collected(p_from date, p_to date)
returns table (tax_code_id uuid, code text, name text, rate_percent numeric,
               taxable_minor bigint, tax_minor bigint)
language sql stable as $$
  select tc.id, tc.code, tc.name, tc.rate_percent,
         coalesce(sum(il.line_subtotal_minor), 0)::bigint,
         coalesce(sum(il.line_tax_minor), 0)::bigint
    from acc_invoice_line il
    join acc_invoice inv on inv.id = il.invoice_id
    join acc_tax_code tc  on tc.id = il.tax_code_id
   where inv.status <> 'void'
     and inv.issue_date between p_from and p_to
   group by tc.id, tc.code, tc.name, tc.rate_percent
   having coalesce(sum(il.line_tax_minor), 0) <> 0
   order by tc.code;
$$;

-- Net Sales Tax Payable balance (credit - debit, base currency) up to p_to,
-- across accounts used as the tax account by sales-direction tax codes.
create or replace function acc_sales_tax_payable_balance(p_to date)
returns bigint language sql stable as $$
  select coalesce(sum(l.credit_minor - l.debit_minor), 0)::bigint
    from acc_journal_line l
    join acc_journal_entry e on e.id = l.journal_entry_id
   where e.status = 'posted'
     and e.entry_date <= p_to
     and l.account_id in (
       select distinct tax_account_id from acc_tax_code
        where direction = 'sales' and tax_account_id is not null
     );
$$;

-- Record a remittance: DR Sales Tax Payable / CR bank.
create or replace function acc_record_tax_payment(
  p_tax_account_id  uuid,
  p_bank_account_id uuid,
  p_payment_date    date,
  p_currency        text,
  p_amount_minor    bigint,
  p_period_start    date,
  p_period_end      date,
  p_memo            text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_number text;
  v_entry  uuid;
  v_base   bigint;
  v_id     uuid;
begin
  if not acc_is_staff() then raise exception 'Not authorized to record tax payments'; end if;
  if p_amount_minor <= 0 then raise exception 'Tax payment amount must be positive'; end if;

  v_base := acc_to_base_minor(p_amount_minor, p_currency, p_payment_date);
  v_number := acc_next_number('tax_payment');
  v_entry := acc_post_entry(
    p_payment_date, 'Sales tax payment ' || v_number, 'tax_payment', null, p_currency,
    jsonb_build_array(
      jsonb_build_object('account_id', p_tax_account_id, 'debit_minor', p_amount_minor,
        'credit_minor', 0, 'amount_base_minor', v_base, 'memo', 'Sales tax remittance'),
      jsonb_build_object('account_id', p_bank_account_id, 'debit_minor', 0,
        'credit_minor', p_amount_minor, 'amount_base_minor', v_base, 'memo', 'Bank payment')
    ));

  insert into acc_tax_payment(payment_number, tax_account_id, bank_account_id, payment_date,
      currency_code, amount_minor, period_start, period_end, status, journal_entry_id, memo, created_by)
    values (v_number, p_tax_account_id, p_bank_account_id, p_payment_date, p_currency,
      p_amount_minor, p_period_start, p_period_end, 'posted', v_entry, p_memo, auth.uid())
    returning id into v_id;

  return v_id;
end;
$$;

-- Void a remittance: mark the entry void (reports exclude void); no reversal.
create or replace function acc_void_tax_payment(p_payment_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_pay acc_tax_payment;
begin
  if not acc_is_staff() then raise exception 'Not authorized to void tax payments'; end if;

  select * into v_pay from acc_tax_payment where id = p_payment_id for update;
  if not found then raise exception 'Tax payment not found'; end if;
  if v_pay.status = 'void' then raise exception 'Tax payment is already void'; end if;

  if v_pay.journal_entry_id is not null then
    update acc_journal_entry set status = 'void', voided_at = now()
     where id = v_pay.journal_entry_id;
  end if;

  update acc_tax_payment set status = 'void', updated_at = now() where id = p_payment_id;
end;
$$;
