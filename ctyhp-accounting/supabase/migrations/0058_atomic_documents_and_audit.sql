-- ============================================================================
-- Atomic document creation and audit capture.
--
-- Financial headers, their lines, ledger postings, and audit evidence must
-- commit or roll back together. Multi-table document creation therefore lives
-- in SECURITY DEFINER RPCs, while single-row mutations use an AFTER trigger so
-- the audit row is part of the same PostgreSQL transaction.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Shared row-audit trigger. TG_ARGV[0] may override the action used for INSERT
-- (for documents that are posted immediately).
-- ----------------------------------------------------------------------------
create or replace function acc_audit_row_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_before   jsonb;
  v_after    jsonb;
  v_action   text;
  v_record   uuid;
  v_old_stat text;
  v_new_stat text;
begin
  if tg_op = 'INSERT' then
    v_after := to_jsonb(new);
    v_action := coalesce(nullif(tg_argv[0], ''), 'insert');
    v_record := nullif(v_after ->> 'id', '')::uuid;
  elsif tg_op = 'UPDATE' then
    v_before := to_jsonb(old);
    v_after := to_jsonb(new);
    v_record := nullif(v_after ->> 'id', '')::uuid;
    v_old_stat := v_before ->> 'status';
    v_new_stat := v_after ->> 'status';

    if v_new_stat in ('void', 'cancelled') and v_new_stat is distinct from v_old_stat then
      v_action := 'void';
    elsif v_old_stat = 'draft' and v_new_stat in ('issued', 'open', 'posted') then
      v_action := 'post';
    else
      v_action := 'update';
    end if;
  else
    v_before := to_jsonb(old);
    v_action := 'delete';
    v_record := nullif(v_before ->> 'id', '')::uuid;
  end if;

  insert into acc_audit_log
    (table_name, record_id, action, actor_id, before_json, after_json)
  values
    (tg_table_name, v_record, v_action, auth.uid(), v_before, v_after);

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function acc_audit_row_change() from public;

-- Master data and schedules currently written as one database statement.
drop trigger if exists acc_account_atomic_audit on acc_account;
create trigger acc_account_atomic_audit
  after insert or update or delete on acc_account
  for each row execute function acc_audit_row_change();
drop trigger if exists acc_customer_atomic_audit on acc_customer;
create trigger acc_customer_atomic_audit
  after insert or update or delete on acc_customer
  for each row execute function acc_audit_row_change();
drop trigger if exists acc_vendor_atomic_audit on acc_vendor;
create trigger acc_vendor_atomic_audit
  after insert or update or delete on acc_vendor
  for each row execute function acc_audit_row_change();
drop trigger if exists acc_item_atomic_audit on acc_item;
create trigger acc_item_atomic_audit
  after insert or update or delete on acc_item
  for each row execute function acc_audit_row_change();
drop trigger if exists acc_tax_code_atomic_audit on acc_tax_code;
create trigger acc_tax_code_atomic_audit
  after insert or update or delete on acc_tax_code
  for each row execute function acc_audit_row_change();
drop trigger if exists acc_recurring_template_atomic_audit on acc_recurring_template;
create trigger acc_recurring_template_atomic_audit
  after insert or update or delete on acc_recurring_template
  for each row execute function acc_audit_row_change();
drop trigger if exists acc_app_user_insert_atomic_audit on acc_app_user;
create trigger acc_app_user_insert_atomic_audit
  after insert on acc_app_user
  for each row execute function acc_audit_row_change();
drop trigger if exists acc_bank_account_atomic_audit on acc_bank_account;
create trigger acc_bank_account_atomic_audit
  after insert or update or delete on acc_bank_account
  for each row execute function acc_audit_row_change();

-- Core financial documents. Payments and cash documents post on INSERT.
drop trigger if exists acc_invoice_atomic_audit on acc_invoice;
create trigger acc_invoice_atomic_audit
  after insert or update or delete on acc_invoice
  for each row execute function acc_audit_row_change();
drop trigger if exists acc_payment_atomic_audit on acc_payment;
create trigger acc_payment_atomic_audit
  after insert or update or delete on acc_payment
  for each row execute function acc_audit_row_change('post');
drop trigger if exists acc_bill_atomic_audit on acc_bill;
create trigger acc_bill_atomic_audit
  after insert or update or delete on acc_bill
  for each row execute function acc_audit_row_change();
drop trigger if exists acc_expense_atomic_audit on acc_expense;
create trigger acc_expense_atomic_audit
  after insert or update or delete on acc_expense
  for each row execute function acc_audit_row_change('post');
drop trigger if exists acc_bill_payment_atomic_audit on acc_bill_payment;
create trigger acc_bill_payment_atomic_audit
  after insert or update or delete on acc_bill_payment
  for each row execute function acc_audit_row_change('post');
drop trigger if exists acc_tax_payment_atomic_audit on acc_tax_payment;
create trigger acc_tax_payment_atomic_audit
  after insert or update or delete on acc_tax_payment
  for each row execute function acc_audit_row_change('post');

-- Purchasing documents and configuration are already mutated by one RPC.
drop trigger if exists acc_purchase_order_atomic_audit on acc_purchase_order;
create trigger acc_purchase_order_atomic_audit
  after insert or update or delete on acc_purchase_order
  for each row execute function acc_audit_row_change();
drop trigger if exists acc_goods_receipt_atomic_audit on acc_goods_receipt;
create trigger acc_goods_receipt_atomic_audit
  after insert or update or delete on acc_goods_receipt
  for each row execute function acc_audit_row_change('post');

create or replace function acc_audit_purchasing_config_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into acc_audit_log
    (table_name, record_id, action, actor_id, before_json, after_json)
  values
    ('acc_purchasing_config', null, 'update', auth.uid(), to_jsonb(old), to_jsonb(new));
  return new;
end;
$$;

revoke all on function acc_audit_purchasing_config_change() from public;

drop trigger if exists acc_purchasing_config_atomic_audit on acc_purchasing_config;
create trigger acc_purchasing_config_atomic_audit
  after update on acc_purchasing_config
  for each row execute function acc_audit_purchasing_config_change();

-- Inventory adjustments are the only inventory movements that previously
-- depended on a second application-layer audit call. Receipt/sale movements
-- are evidenced by their owning document.
drop trigger if exists acc_inventory_adjustment_atomic_audit on acc_inventory_txn;
create trigger acc_inventory_adjustment_atomic_audit
  after insert on acc_inventory_txn
  for each row
  when (new.source = 'adjustment')
  execute function acc_audit_row_change('post');

-- ----------------------------------------------------------------------------
-- Create a complete draft invoice (header + computed lines) atomically.
-- ----------------------------------------------------------------------------
create or replace function acc_create_draft_invoice(
  p_customer_id      uuid,
  p_issue_date       date,
  p_due_date         date,
  p_currency         text,
  p_memo             text,
  p_lines            jsonb,
  p_recurring_run_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_invoice      uuid;
  v_line         jsonb;
  v_quantity     numeric;
  v_unit_price   bigint;
  v_tax_code     uuid;
  v_tax_rate     numeric := 0;
  v_subtotal     bigint := 0;
  v_tax_total    bigint := 0;
  v_line_sub     bigint;
  v_line_tax     bigint;
  v_line_order   int := 0;
begin
  if not acc_is_staff()
     and not (auth.role() = 'service_role' and p_recurring_run_id is not null) then
    raise exception 'Not authorized to create invoices';
  end if;
  if jsonb_typeof(coalesce(p_lines, 'null'::jsonb)) <> 'array'
     or jsonb_array_length(p_lines) = 0 then
    raise exception 'An invoice needs at least one line';
  end if;
  if not exists (select 1 from acc_customer where id = p_customer_id and is_active) then
    raise exception 'Customer not found or inactive';
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_unit_price := (v_line ->> 'unit_price_minor')::bigint;
    v_tax_code := nullif(v_line ->> 'tax_code_id', '')::uuid;

    if v_quantity is null or v_quantity <= 0 then
      raise exception 'Invoice line quantity must be positive';
    end if;
    if v_unit_price is null or v_unit_price < 0 then
      raise exception 'Invoice line unit price cannot be negative';
    end if;
    if nullif(v_line ->> 'income_account_id', '') is null then
      raise exception 'Every invoice line needs an income account';
    end if;

    v_tax_rate := 0;
    if v_tax_code is not null then
      select rate_percent into v_tax_rate
        from acc_tax_code
       where id = v_tax_code and is_active and direction = 'sales';
      if not found then raise exception 'Sales tax code not found or inactive'; end if;
    end if;

    v_line_sub := round(v_quantity * v_unit_price)::bigint;
    v_line_tax := round(v_line_sub * v_tax_rate / 100)::bigint;
    v_subtotal := v_subtotal + v_line_sub;
    v_tax_total := v_tax_total + v_line_tax;
  end loop;

  insert into acc_invoice
    (customer_id, issue_date, due_date, currency_code, subtotal_minor,
     tax_total_minor, total_minor, balance_due_minor, memo, created_by,
     recurring_run_id)
  values
    (p_customer_id, coalesce(p_issue_date, current_date), p_due_date, p_currency,
     v_subtotal, v_tax_total, v_subtotal + v_tax_total,
     v_subtotal + v_tax_total, p_memo, auth.uid(), p_recurring_run_id)
  returning id into v_invoice;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_unit_price := (v_line ->> 'unit_price_minor')::bigint;
    v_tax_code := nullif(v_line ->> 'tax_code_id', '')::uuid;
    v_tax_rate := 0;
    if v_tax_code is not null then
      select rate_percent into v_tax_rate from acc_tax_code where id = v_tax_code;
    end if;
    v_line_sub := round(v_quantity * v_unit_price)::bigint;
    v_line_tax := round(v_line_sub * v_tax_rate / 100)::bigint;

    insert into acc_invoice_line
      (invoice_id, line_order, description, quantity, unit_price_minor,
       income_account_id, tax_code_id, item_id, line_subtotal_minor,
       line_tax_minor, line_total_minor)
    values
      (v_invoice, v_line_order, coalesce(v_line ->> 'description', ''),
       v_quantity, v_unit_price, (v_line ->> 'income_account_id')::uuid,
       v_tax_code, nullif(v_line ->> 'item_id', '')::uuid, v_line_sub,
       v_line_tax, v_line_sub + v_line_tax);
    v_line_order := v_line_order + 1;
  end loop;

  return v_invoice;
end;
$$;

revoke all on function acc_create_draft_invoice(uuid, date, date, text, text, jsonb, uuid) from public;
grant execute on function acc_create_draft_invoice(uuid, date, date, text, text, jsonb, uuid)
  to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Create a complete draft bill (header + lines) atomically.
-- ----------------------------------------------------------------------------
create or replace function acc_create_draft_bill(
  p_vendor_id       uuid,
  p_vendor_ref      text,
  p_bill_date       date,
  p_due_date        date,
  p_currency        text,
  p_memo            text,
  p_lines           jsonb,
  p_recurring_run_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_bill       uuid;
  v_line       jsonb;
  v_amount     bigint;
  v_total      bigint := 0;
  v_line_order int := 0;
begin
  if not acc_is_staff()
     and not (auth.role() = 'service_role' and p_recurring_run_id is not null) then
    raise exception 'Not authorized to create bills';
  end if;
  if jsonb_typeof(coalesce(p_lines, 'null'::jsonb)) <> 'array'
     or jsonb_array_length(p_lines) = 0 then
    raise exception 'A bill needs at least one line';
  end if;
  if not exists (select 1 from acc_vendor where id = p_vendor_id and is_active) then
    raise exception 'Vendor not found or inactive';
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_amount := (v_line ->> 'amount_minor')::bigint;
    if v_amount is null or v_amount <= 0 then
      raise exception 'Bill line amount must be positive';
    end if;
    if nullif(v_line ->> 'expense_account_id', '') is null then
      raise exception 'Every bill line needs an expense account';
    end if;
    v_total := v_total + v_amount;
  end loop;

  insert into acc_bill
    (vendor_id, vendor_ref, bill_date, due_date, currency_code, total_minor,
     balance_due_minor, memo, created_by, recurring_run_id)
  values
    (p_vendor_id, nullif(btrim(coalesce(p_vendor_ref, '')), ''),
     coalesce(p_bill_date, current_date), p_due_date, p_currency, v_total,
     v_total, p_memo, auth.uid(), p_recurring_run_id)
  returning id into v_bill;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    insert into acc_bill_line
      (bill_id, line_order, description, expense_account_id, amount_minor, item_id)
    values
      (v_bill, v_line_order, coalesce(v_line ->> 'description', ''),
       (v_line ->> 'expense_account_id')::uuid,
       (v_line ->> 'amount_minor')::bigint,
       nullif(v_line ->> 'item_id', '')::uuid);
    v_line_order := v_line_order + 1;
  end loop;

  return v_bill;
end;
$$;

revoke all on function acc_create_draft_bill(uuid, text, date, date, text, text, jsonb, uuid) from public;
grant execute on function acc_create_draft_bill(uuid, text, date, date, text, text, jsonb, uuid)
  to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- Credit creation previously used three commits (header, lines, issue). These
-- RPCs keep the complete credit and its posting/audit in one transaction.
-- ----------------------------------------------------------------------------
create or replace function acc_create_and_issue_credit_memo(
  p_customer_id uuid,
  p_memo_date   date,
  p_currency    text,
  p_reason      text,
  p_memo        text,
  p_lines       jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id          uuid;
  v_line        jsonb;
  v_quantity    numeric;
  v_unit_price  bigint;
  v_tax_code    uuid;
  v_tax_rate    numeric := 0;
  v_subtotal    bigint := 0;
  v_tax_total   bigint := 0;
  v_line_sub    bigint;
  v_line_tax    bigint;
  v_line_order  int := 0;
begin
  if not acc_is_staff() then raise exception 'Not authorized to create credit memos'; end if;
  if jsonb_typeof(coalesce(p_lines, 'null'::jsonb)) <> 'array'
     or jsonb_array_length(p_lines) = 0 then
    raise exception 'A credit memo needs at least one line';
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_unit_price := (v_line ->> 'unit_price_minor')::bigint;
    v_tax_code := nullif(v_line ->> 'tax_code_id', '')::uuid;
    if v_quantity is null or v_quantity <= 0 then raise exception 'Credit quantity must be positive'; end if;
    if v_unit_price is null or v_unit_price < 0 then raise exception 'Credit unit price cannot be negative'; end if;
    if nullif(v_line ->> 'income_account_id', '') is null then
      raise exception 'Every credit line needs an income account';
    end if;
    v_tax_rate := 0;
    if v_tax_code is not null then
      select rate_percent into v_tax_rate
        from acc_tax_code
       where id = v_tax_code and is_active and direction = 'sales';
      if not found then raise exception 'Sales tax code not found or inactive'; end if;
    end if;
    v_line_sub := round(v_quantity * v_unit_price)::bigint;
    v_line_tax := round(v_line_sub * v_tax_rate / 100)::bigint;
    v_subtotal := v_subtotal + v_line_sub;
    v_tax_total := v_tax_total + v_line_tax;
  end loop;
  if v_subtotal + v_tax_total <= 0 then raise exception 'Credit memo total must be positive'; end if;

  insert into acc_credit_memo
    (customer_id, memo_date, currency_code, subtotal_minor, tax_total_minor,
     total_minor, balance_remaining_minor, status, reason, memo, created_by)
  values
    (p_customer_id, coalesce(p_memo_date, current_date), p_currency, v_subtotal,
     v_tax_total, v_subtotal + v_tax_total, 0, 'draft', p_reason, p_memo, auth.uid())
  returning id into v_id;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_unit_price := (v_line ->> 'unit_price_minor')::bigint;
    v_tax_code := nullif(v_line ->> 'tax_code_id', '')::uuid;
    v_tax_rate := 0;
    if v_tax_code is not null then
      select rate_percent into v_tax_rate from acc_tax_code where id = v_tax_code;
    end if;
    v_line_sub := round(v_quantity * v_unit_price)::bigint;
    v_line_tax := round(v_line_sub * v_tax_rate / 100)::bigint;
    insert into acc_credit_memo_line
      (credit_memo_id, line_order, description, quantity, unit_price_minor,
       income_account_id, tax_code_id, line_subtotal_minor, line_tax_minor,
       line_total_minor)
    values
      (v_id, v_line_order, coalesce(v_line ->> 'description', ''), v_quantity,
       v_unit_price, (v_line ->> 'income_account_id')::uuid, v_tax_code,
       v_line_sub, v_line_tax, v_line_sub + v_line_tax);
    v_line_order := v_line_order + 1;
  end loop;

  perform acc_issue_credit_memo(v_id);
  return v_id;
end;
$$;

revoke all on function acc_create_and_issue_credit_memo(uuid, date, text, text, text, jsonb) from public;
grant execute on function acc_create_and_issue_credit_memo(uuid, date, text, text, text, jsonb)
  to authenticated;

create or replace function acc_create_and_issue_vendor_credit(
  p_vendor_id uuid,
  p_credit_date date,
  p_currency text,
  p_vendor_ref text,
  p_reason text,
  p_memo text,
  p_lines jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id         uuid;
  v_line       jsonb;
  v_total      bigint := 0;
  v_line_order int := 0;
begin
  if not acc_is_staff() then raise exception 'Not authorized to create vendor credits'; end if;
  if jsonb_typeof(coalesce(p_lines, 'null'::jsonb)) <> 'array'
     or jsonb_array_length(p_lines) = 0 then
    raise exception 'A vendor credit needs at least one line';
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    if coalesce((v_line ->> 'amount_minor')::bigint, 0) <= 0 then
      raise exception 'Vendor credit line amount must be positive';
    end if;
    if nullif(v_line ->> 'expense_account_id', '') is null then
      raise exception 'Every vendor credit line needs an expense account';
    end if;
    v_total := v_total + (v_line ->> 'amount_minor')::bigint;
  end loop;

  insert into acc_vendor_credit
    (vendor_id, credit_date, currency_code, total_minor,
     balance_remaining_minor, status, vendor_ref, reason, memo, created_by)
  values
    (p_vendor_id, coalesce(p_credit_date, current_date), p_currency, v_total,
     0, 'draft', nullif(btrim(coalesce(p_vendor_ref, '')), ''),
     p_reason, p_memo, auth.uid())
  returning id into v_id;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    insert into acc_vendor_credit_line
      (vendor_credit_id, line_order, description, expense_account_id, amount_minor)
    values
      (v_id, v_line_order, coalesce(v_line ->> 'description', ''),
       (v_line ->> 'expense_account_id')::uuid,
       (v_line ->> 'amount_minor')::bigint);
    v_line_order := v_line_order + 1;
  end loop;

  perform acc_issue_vendor_credit(v_id);
  return v_id;
end;
$$;

revoke all on function acc_create_and_issue_vendor_credit(uuid, date, text, text, text, text, jsonb)
  from public;
grant execute on function acc_create_and_issue_vendor_credit(uuid, date, text, text, text, text, jsonb)
  to authenticated;

-- ----------------------------------------------------------------------------
-- Bank statement batch + immutable rows + audit commit as one unit.
-- Hashes are supplied by the server service and must be SHA-256 hex.
-- ----------------------------------------------------------------------------
create or replace function acc_import_bank_statement(
  p_bank_account_id uuid,
  p_filename        text,
  p_rows            jsonb
) returns table (inserted int, skipped int, batch_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_batch    uuid;
  v_row      jsonb;
  v_inserted int := 0;
  v_affected int;
  v_count    int;
  v_hash     text;
begin
  if not acc_is_staff() then raise exception 'Not authorized to import bank statements'; end if;
  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array'
     or jsonb_array_length(p_rows) = 0 then
    raise exception 'A bank statement import needs at least one row';
  end if;
  v_count := jsonb_array_length(p_rows);

  insert into acc_bank_import_batch
    (bank_account_id, filename, row_count, imported_by)
  values
    (p_bank_account_id, nullif(btrim(coalesce(p_filename, '')), ''), v_count, auth.uid())
  returning id into v_batch;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_hash := lower(coalesce(v_row ->> 'raw_hash', ''));
    if v_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'Every imported bank row needs a SHA-256 hash';
    end if;

    insert into acc_bank_transaction
      (bank_account_id, import_batch_id, txn_date, description, reference,
       amount_minor, running_balance_minor, raw_line, raw_hash, source)
    values
      (p_bank_account_id, v_batch, (v_row ->> 'txn_date')::date,
       coalesce(v_row ->> 'description', ''), nullif(v_row ->> 'reference', ''),
       (v_row ->> 'amount_minor')::bigint,
       nullif(v_row ->> 'running_balance_minor', '')::bigint,
       v_row ->> 'raw_line', v_hash, 'file_upload')
    on conflict (bank_account_id, raw_hash) do nothing;
    get diagnostics v_affected = row_count;
    v_inserted := v_inserted + v_affected;
  end loop;

  insert into acc_audit_log
    (table_name, record_id, action, actor_id, after_json)
  values
    ('acc_bank_import_batch', v_batch, 'insert', auth.uid(),
     jsonb_build_object('filename', p_filename, 'rows', v_count,
                        'inserted', v_inserted, 'skipped', v_count - v_inserted));

  return query select v_inserted, v_count - v_inserted, v_batch;
end;
$$;

revoke all on function acc_import_bank_statement(uuid, text, jsonb) from public;
grant execute on function acc_import_bank_statement(uuid, text, jsonb) to authenticated;

-- Make newly added RPC signatures immediately visible to PostgREST.
notify pgrst, 'reload schema';
