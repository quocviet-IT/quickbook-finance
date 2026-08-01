-- ============================================================================
-- 0082 — Bringing a company's lists and opening balances across.
--
-- Two jobs, and they are kept apart on purpose.
--
-- Master data — the chart of accounts, customers, vendors, products — is
-- reference data. Importing it twice must not produce two of everything, so
-- each row is matched on its natural key and updated rather than duplicated.
-- Imports get re-run; that is normal, not an error.
--
-- Opening balances are not reference data: they are a posting, and the books
-- have to balance afterwards. Every balance brought across is met by the same
-- amount in Opening Balance Equity, which is what that account is for.
--
-- One rule shapes the whole design: **receivables and payables opening balances
-- become documents, not journal lines.** A lump sum posted straight to the A/R
-- control account would leave the control reconciliation permanently out — the
-- subledger is the invoices, and there would be none. So each customer's
-- opening balance becomes an invoice and each vendor's becomes a bill, exactly
-- as QuickBooks does it, and the ageing works from the first day.
-- ============================================================================

/** Where the other side of an opening balance goes. */
create or replace function acc_opening_balance_equity_account() returns uuid
language sql stable as $$
  select id from acc_account
   where is_posting_account and status = 'active'
     and (account_code = '3900'
          or (account_type = 'equity' and name ilike 'opening balance equity%'))
   order by account_code
   limit 1;
$$;

-- ----------------------------------------------------------------------------
-- 1. Master data, imported so that running it twice changes nothing.
-- ----------------------------------------------------------------------------
create or replace function acc_import_accounts(p_rows jsonb)
returns table (created int, updated int, skipped int)
language plpgsql security definer set search_path = public as $$
declare
  rec       record;
  v_created int := 0;
  v_updated int := 0;
  v_skipped int := 0;
  v_id      uuid;
begin
  if not acc_is_admin() then raise exception 'Only an admin can import a chart of accounts'; end if;

  for rec in
    select r->>'account_code' as code,
           r->>'name' as name,
           r->>'account_type' as account_type,
           nullif(r->>'description', '') as description
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  loop
    if coalesce(btrim(rec.code), '') = '' or coalesce(btrim(rec.name), '') = '' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    select id into v_id from acc_account where account_code = rec.code;
    if v_id is null then
      insert into acc_account (account_code, name, account_type, description,
                               currency_code, is_posting_account, status)
      values (rec.code, rec.name, rec.account_type::acc_account_type, rec.description,
              (select code from acc_currency where is_base limit 1), true, 'active');
      v_created := v_created + 1;
    else
      -- The code is the identity. A second run corrects the name and type; it
      -- does not create a rival account with the same number.
      update acc_account
         set name = rec.name,
             account_type = rec.account_type::acc_account_type,
             description = coalesce(rec.description, description)
       where id = v_id;
      v_updated := v_updated + 1;
    end if;
  end loop;

  return query select v_created, v_updated, v_skipped;
end;
$$;

create or replace function acc_import_contacts(p_rows jsonb, p_kind text)
returns table (created int, updated int, skipped int)
language plpgsql security definer set search_path = public as $$
declare
  rec       record;
  v_created int := 0;
  v_updated int := 0;
  v_skipped int := 0;
  v_id      uuid;
begin
  if not acc_is_staff() then raise exception 'Not authorized to import contacts'; end if;
  if p_kind not in ('customer', 'vendor') then raise exception 'Unknown contact kind: %', p_kind; end if;

  for rec in
    select btrim(r->>'name') as name,
           nullif(btrim(coalesce(r->>'email', '')), '') as email,
           nullif(btrim(coalesce(r->>'contact_name', '')), '') as contact_name,
           nullif(btrim(coalesce(r->>'phone', '')), '') as phone,
           nullif(btrim(coalesce(r->>'city', '')), '') as city,
           nullif(btrim(coalesce(r->>'region', '')), '') as region,
           nullif(btrim(coalesce(r->>'postal_code', '')), '') as postal_code,
           nullif(btrim(coalesce(r->>'country', '')), '') as country
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  loop
    if coalesce(rec.name, '') = '' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if p_kind = 'customer' then
      select id into v_id from acc_customer where lower(name) = lower(rec.name);
      if v_id is null then
        insert into acc_customer (name, email, contact_name, phone, city, region, postal_code, country,
                                  currency_code)
        values (rec.name, rec.email, rec.contact_name, rec.phone, rec.city, rec.region,
                rec.postal_code, rec.country, (select code from acc_currency where is_base limit 1));
        v_created := v_created + 1;
      else
        update acc_customer
           set email = coalesce(rec.email, email),
               contact_name = coalesce(rec.contact_name, contact_name),
               phone = coalesce(rec.phone, phone),
               city = coalesce(rec.city, city),
               region = coalesce(rec.region, region),
               postal_code = coalesce(rec.postal_code, postal_code),
               country = coalesce(rec.country, country)
         where id = v_id;
        v_updated := v_updated + 1;
      end if;
    else
      select id into v_id from acc_vendor where lower(name) = lower(rec.name);
      if v_id is null then
        insert into acc_vendor (name, email, contact_name, phone, city, region, postal_code, country,
                                currency_code)
        values (rec.name, rec.email, rec.contact_name, rec.phone, rec.city, rec.region,
                rec.postal_code, rec.country, (select code from acc_currency where is_base limit 1));
        v_created := v_created + 1;
      else
        update acc_vendor
           set email = coalesce(rec.email, email),
               contact_name = coalesce(rec.contact_name, contact_name),
               phone = coalesce(rec.phone, phone),
               city = coalesce(rec.city, city),
               region = coalesce(rec.region, region),
               postal_code = coalesce(rec.postal_code, postal_code),
               country = coalesce(rec.country, country)
         where id = v_id;
        v_updated := v_updated + 1;
      end if;
    end if;
  end loop;

  return query select v_created, v_updated, v_skipped;
end;
$$;

create or replace function acc_import_items(p_rows jsonb)
returns table (created int, updated int, skipped int)
language plpgsql security definer set search_path = public as $$
declare
  rec       record;
  v_created int := 0;
  v_updated int := 0;
  v_skipped int := 0;
  v_id      uuid;
  v_income  uuid;
  v_expense uuid;
begin
  if not acc_is_staff() then raise exception 'Not authorized to import products'; end if;

  select id into v_income from acc_account
   where account_type = 'income' and is_posting_account and status = 'active'
   order by account_code limit 1;
  select id into v_expense from acc_account
   where account_type = 'cost_of_goods_sold' and is_posting_account and status = 'active'
   order by account_code limit 1;

  for rec in
    select nullif(btrim(coalesce(r->>'item_code', '')), '') as item_code,
           btrim(r->>'name') as name,
           coalesce(r->>'description', '') as description,
           coalesce((r->>'sales_price_minor')::bigint, 0) as sales_price,
           coalesce((r->>'purchase_cost_minor')::bigint, 0) as purchase_cost,
           coalesce((r->>'is_inventory')::boolean, false) as is_inventory
      from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  loop
    if coalesce(rec.name, '') = '' then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- Match on the code where there is one, otherwise on the name: an export
    -- without SKUs is common, and it should still be re-runnable.
    if rec.item_code is not null then
      select id into v_id from acc_item where item_code = rec.item_code;
    else
      select id into v_id from acc_item where lower(name) = lower(rec.name);
    end if;

    if v_id is null then
      insert into acc_item (item_code, name, description, is_sold, sales_price_minor,
                            income_account_id, is_purchased, purchase_cost_minor,
                            expense_account_id, is_inventory)
      values (rec.item_code, rec.name, rec.description, true, rec.sales_price,
              v_income, rec.purchase_cost > 0, rec.purchase_cost,
              v_expense, false);
      v_created := v_created + 1;
    else
      -- Inventory tracking is deliberately not changed by an import. Turning it
      -- on for an item that already has movements would leave the subledger
      -- describing history the ledger never recorded.
      update acc_item
         set name = rec.name,
             description = case when rec.description = '' then description else rec.description end,
             sales_price_minor = rec.sales_price,
             purchase_cost_minor = rec.purchase_cost
       where id = v_id;
      v_updated := v_updated + 1;
    end if;
  end loop;

  return query select v_created, v_updated, v_skipped;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Opening balances.
--
-- One journal entry for the balance-sheet accounts, balanced against Opening
-- Balance Equity. Receivables and payables are refused here by name, because
-- they belong in the customer and vendor lists where they become documents.
-- ----------------------------------------------------------------------------
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

  v_obe := acc_opening_balance_equity_account();
  if v_obe is null then raise exception 'No Opening Balance Equity account is configured'; end if;

  for rec in
    select r->>'account_code' as code,
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

    -- A positive figure means the account's own natural side.
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

  -- Whatever the balances do not settle between themselves is equity. This is
  -- what makes the entry balance, and it is why the account exists.
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

/**
 * A customer's opening balance, as an invoice.
 *
 * Not a journal line: the receivables control account is only trustworthy
 * because the invoices behind it add up to it. An opening balance with no
 * invoice would put the ageing report and the control reconciliation out on
 * day one, and neither would ever come back without someone unpicking it.
 */
create or replace function acc_import_opening_receivables(p_as_of date, p_rows jsonb)
returns table (created int, skipped int)
language plpgsql security definer set search_path = public as $$
declare
  rec       record;
  v_created int := 0;
  v_skipped int := 0;
  v_obe     uuid;
  v_customer uuid;
  v_invoice uuid;
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

    insert into acc_invoice (customer_id, issue_date, due_date, currency_code, memo)
    values (v_customer, p_as_of, p_as_of,
            (select code from acc_currency where is_base limit 1),
            'Opening balance brought forward')
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

/** A vendor's opening balance, as a bill, for the same reason. */
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

revoke all on function acc_import_accounts(jsonb) from public, anon;
revoke all on function acc_import_contacts(jsonb, text) from public, anon;
revoke all on function acc_import_items(jsonb) from public, anon;
revoke all on function acc_post_opening_balances(date, jsonb) from public, anon;
revoke all on function acc_import_opening_receivables(date, jsonb) from public, anon;
revoke all on function acc_import_opening_payables(date, jsonb) from public, anon;

grant execute on function acc_import_accounts(jsonb) to authenticated, service_role;
grant execute on function acc_import_contacts(jsonb, text) to authenticated, service_role;
grant execute on function acc_import_items(jsonb) to authenticated, service_role;
grant execute on function acc_post_opening_balances(date, jsonb) to authenticated, service_role;
grant execute on function acc_import_opening_receivables(date, jsonb) to authenticated, service_role;
grant execute on function acc_import_opening_payables(date, jsonb) to authenticated, service_role;
