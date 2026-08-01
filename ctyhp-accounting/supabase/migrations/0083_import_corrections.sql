-- ============================================================================
-- 0083 — Three corrections the end-to-end import test found.
--
-- The third one is not a slip; it is a design fault worth naming.
--
-- An imported chart of accounts carries account *numbers* from another system,
-- and the same number means different things in different charts. In the test
-- file, QuickBooks account 2100 is a Visa card. Here, 2100 is Sales Tax
-- Payable, and the sales tax codes point at it. The import happily changed its
-- name and type, and the sales tax control account went out by the card's
-- balance — silently, because nothing about an import is supposed to be able to
-- repurpose an account the system's own configuration depends on.
--
-- So an import no longer changes what an existing account *is*. It may correct
-- a name; it may not turn a payable into a credit card. A collision is reported
-- for a person to resolve, which is the only sane answer: only they know
-- whether the two 2100s are the same account.
-- ============================================================================

-- The result gains a conflicts column, so the old signature has to go first;
-- Postgres will not replace a function whose return type differs.
drop function if exists acc_import_accounts(jsonb);
create or replace function acc_import_accounts(p_rows jsonb)
returns table (created int, updated int, skipped int, conflicts text)
language plpgsql security definer set search_path = public as $$
declare
  rec         record;
  v_created   int := 0;
  v_updated   int := 0;
  v_skipped   int := 0;
  v_conflicts text[] := array[]::text[];
  v_existing  acc_account;
  v_type      acc_account_type;
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
    v_type := rec.account_type::acc_account_type;

    select * into v_existing from acc_account where account_code = rec.code;

    if not found then
      insert into acc_account (account_code, name, account_type, description,
                               currency_code, is_posting_account, status)
      values (rec.code, rec.name, v_type, rec.description,
              (select code from acc_currency where is_base limit 1), true, 'active');
      v_created := v_created + 1;

    elsif v_existing.account_type <> v_type then
      -- The same number, a different kind of account. Left exactly as it was.
      v_conflicts := v_conflicts || format(
        '%s is %s here but %s in the file (%s) — left unchanged',
        rec.code, v_existing.account_type, v_type, rec.name);
      v_skipped := v_skipped + 1;

    else
      update acc_account
         set name = rec.name,
             description = coalesce(rec.description, description)
       where id = v_existing.id;
      v_updated := v_updated + 1;
    end if;
  end loop;

  return query select v_created, v_updated, v_skipped,
    case when array_length(v_conflicts, 1) is null then null
         else array_to_string(v_conflicts, E'\n') end;
end;
$$;

-- ----------------------------------------------------------------------------
-- The vendor table has no address; it never had one. Writing an import against
-- columns that do not exist fails on the first row, which is how this surfaced.
-- ----------------------------------------------------------------------------
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
        insert into acc_customer (name, email, contact_name, phone, city, region, postal_code,
                                  country, currency_code)
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
      -- Vendors carry a name, an email and a phone number. Address columns
      -- from the file are read and discarded rather than silently failing.
      select id into v_id from acc_vendor where lower(name) = lower(rec.name);
      if v_id is null then
        insert into acc_vendor (name, email, phone, currency_code)
        values (rec.name, rec.email, rec.phone,
                (select code from acc_currency where is_base limit 1));
        v_created := v_created + 1;
      else
        update acc_vendor
           set email = coalesce(rec.email, email),
               phone = coalesce(rec.phone, phone)
         where id = v_id;
        v_updated := v_updated + 1;
      end if;
    end if;
  end loop;

  return query select v_created, v_updated, v_skipped;
end;
$$;

-- ----------------------------------------------------------------------------
-- An invoice's own totals are what `acc_issue_invoice` checks, and inserting
-- lines does not fill them in. The opening invoice has to state its total.
-- ----------------------------------------------------------------------------
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

revoke all on function acc_import_accounts(jsonb) from public, anon;
grant execute on function acc_import_accounts(jsonb) to authenticated, service_role;
