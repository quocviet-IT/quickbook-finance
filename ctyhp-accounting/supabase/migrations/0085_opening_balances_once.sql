-- ============================================================================
-- 0085 — Opening balances can only be brought across once.
--
-- Master data is idempotent: import the customer list twice and there is still
-- one of each customer. Opening balances are not, and cannot be — they create
-- documents and post entries, so running them again does not re-sync anything.
-- It doubles the company's books.
--
-- The end-to-end test caught this the honest way. A re-run left receivables at
-- exactly twice the file's total, and the control account *agreed* with the
-- inflated figure, because the invoices behind it were perfectly real. Nothing
-- looked broken. That is the failure mode worth refusing outright.
--
-- So each of the three postings now checks whether it has already happened.
-- The account-level posting refuses the whole run; the customer and vendor
-- postings skip the contacts already carrying an opening document, because the
-- rest of the file may be new and should still go in.
-- ============================================================================

create or replace function acc_post_opening_balances(p_as_of date, p_rows jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  rec       record;
  v_obe     uuid;
  v_lines   jsonb := '[]'::jsonb;
  v_net     bigint := 0;
  v_account acc_account;
  v_entry   uuid;
begin
  if not acc_is_admin() then raise exception 'Only an admin can post opening balances'; end if;

  if exists (
    select 1 from acc_journal_entry
     where description = 'Opening balances' and status = 'posted'
  ) then
    raise exception
      'Opening balances have already been posted for this company. Posting them again would double the books; void the existing entry first if it was wrong.';
  end if;

  v_obe := acc_opening_balance_equity_account();
  if v_obe is null then raise exception 'No Opening Balance Equity account is configured'; end if;

  for rec in
    select r->>'account_code' as code,
           nullif(r->>'account_type', '') as expected_type,
           coalesce((r->>'amount_minor')::bigint, 0) as amount
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  loop
    if rec.amount = 0 then continue; end if;

    select * into v_account from acc_account where account_code = rec.code;
    if not found then
      raise exception 'No account % — import the chart of accounts first', rec.code;
    end if;

    if v_account.account_type in ('accounts_receivable', 'accounts_payable') then
      raise exception
        'Account % is a control account. Bring its opening balance across on the customer or vendor list, so the subledger and the control account agree.',
        rec.code;
    end if;

    if rec.expected_type is not null
       and v_account.account_type <> rec.expected_type::acc_account_type then
      raise exception
        'Account % is % here but the file calls it %. Nothing was posted — reconcile the chart of accounts first.',
        rec.code, v_account.account_type, rec.expected_type;
    end if;

    if v_account.account_type in ('bank', 'current_asset', 'fixed_asset', 'cost_of_goods_sold',
                                  'expense', 'other_expense') then
      v_lines := v_lines || jsonb_build_object(
        'account_id', v_account.id,
        'debit_minor', greatest(rec.amount, 0), 'credit_minor', greatest(-rec.amount, 0),
        'amount_base_minor', abs(rec.amount), 'memo', 'Opening balance');
      v_net := v_net + rec.amount;
    else
      v_lines := v_lines || jsonb_build_object(
        'account_id', v_account.id,
        'debit_minor', greatest(-rec.amount, 0), 'credit_minor', greatest(rec.amount, 0),
        'amount_base_minor', abs(rec.amount), 'memo', 'Opening balance');
      v_net := v_net - rec.amount;
    end if;
  end loop;

  if jsonb_array_length(v_lines) = 0 then
    raise exception 'No opening balances to post';
  end if;

  if v_net <> 0 then
    v_lines := v_lines || jsonb_build_object(
      'account_id', v_obe,
      'debit_minor', greatest(-v_net, 0), 'credit_minor', greatest(v_net, 0),
      'amount_base_minor', abs(v_net), 'memo', 'Opening balance equity');
  end if;

  v_entry := acc_post_entry(
    p_as_of, 'Opening balances', 'manual', null,
    (select code from acc_currency where is_base limit 1), v_lines);
  return v_entry;
end;
$$;

create or replace function acc_import_opening_receivables(p_as_of date, p_rows jsonb)
returns table (created int, skipped int)
language plpgsql security definer set search_path = public as $$
declare
  rec        record;
  v_created  int := 0;
  v_skipped  int := 0;
  v_obe      uuid;
  v_customer uuid;
  v_invoice  uuid;
begin
  if not acc_is_staff() then raise exception 'Not authorized to import opening balances'; end if;
  v_obe := acc_opening_balance_equity_account();
  if v_obe is null then raise exception 'No Opening Balance Equity account is configured'; end if;

  for rec in
    select btrim(r->>'name') as name,
           coalesce((r->>'amount_minor')::bigint, 0) as amount
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  loop
    if rec.amount <= 0 or coalesce(rec.name, '') = '' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select id into v_customer from acc_customer where lower(name) = lower(rec.name);
    if v_customer is null then
      raise exception 'No customer named % — import the customer list first', rec.name;
    end if;

    -- Already carries one. A second would be a second debt, not a correction.
    if exists (
      select 1 from acc_invoice
       where customer_id = v_customer
         and memo = 'Opening balance brought forward'
         and status <> 'void'
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into acc_invoice (customer_id, issue_date, due_date, currency_code, memo,
                             subtotal_minor, tax_total_minor, total_minor, balance_due_minor)
    values (v_customer, p_as_of, p_as_of,
            (select code from acc_currency where is_base limit 1),
            'Opening balance brought forward',
            rec.amount, 0, rec.amount, rec.amount)
    returning id into v_invoice;

    insert into acc_invoice_line
      (invoice_id, line_order, description, quantity, unit_price_minor, income_account_id,
       line_subtotal_minor, line_tax_minor, line_total_minor)
    values (v_invoice, 0, 'Opening balance', 1, rec.amount, v_obe, rec.amount, 0, rec.amount);

    perform acc_issue_invoice(v_invoice);
    v_created := v_created + 1;
  end loop;

  return query select v_created, v_skipped;
end;
$$;

create or replace function acc_import_opening_payables(p_as_of date, p_rows jsonb)
returns table (created int, skipped int)
language plpgsql security definer set search_path = public as $$
declare
  rec       record;
  v_created int := 0;
  v_skipped int := 0;
  v_obe     uuid;
  v_vendor  uuid;
  v_bill    uuid;
begin
  if not acc_is_staff() then raise exception 'Not authorized to import opening balances'; end if;
  v_obe := acc_opening_balance_equity_account();
  if v_obe is null then raise exception 'No Opening Balance Equity account is configured'; end if;

  for rec in
    select btrim(r->>'name') as name,
           coalesce((r->>'amount_minor')::bigint, 0) as amount
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  loop
    if rec.amount <= 0 or coalesce(rec.name, '') = '' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select id into v_vendor from acc_vendor where lower(name) = lower(rec.name);
    if v_vendor is null then
      raise exception 'No vendor named % — import the vendor list first', rec.name;
    end if;

    if exists (
      select 1 from acc_bill
       where vendor_id = v_vendor
         and memo = 'Opening balance brought forward'
         and status <> 'void'
    ) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    insert into acc_bill (vendor_id, bill_date, due_date, currency_code, memo)
    values (v_vendor, p_as_of, p_as_of,
            (select code from acc_currency where is_base limit 1),
            'Opening balance brought forward')
    returning id into v_bill;

    insert into acc_bill_line (bill_id, line_order, description, amount_minor, expense_account_id)
    values (v_bill, 0, 'Opening balance', rec.amount, v_obe);

    perform acc_post_bill(v_bill);
    v_created := v_created + 1;
  end loop;

  return query select v_created, v_skipped;
end;
$$;
