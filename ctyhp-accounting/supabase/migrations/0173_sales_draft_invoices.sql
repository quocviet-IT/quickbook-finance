-- ============================================================================
-- 0173  Sales prepares invoices, an accountant issues them (2.63)
--
-- The access audit of 27 October 2026 asked what the Sales role is for: it
-- read the whole ledger and could change nothing but the product list. The
-- owner decided that Sales prepares the invoices for the sales it makes, and an
-- admin or accountant checks and issues them; and that Sales sees the
-- documents attached to what it reads.
--
-- 1. A permission, invoice.create, "Create draft invoices", on for admin,
--    accountant and sales. It is added once: a company that later switches it
--    off keeps its choice if this runs again.
-- 2. acc_create_draft_invoice asks for invoice.create instead of "admin or
--    accountant". Every road to a draft passes through it (the New invoice
--    form, an estimate turned into an invoice, an invoice import), so
--    switching the permission off stops all of them. The recurring runner keeps
--    its own way in. Issuing, voiding and writing off are unchanged: admin or
--    accountant, each with its own permission.
-- 3. Sales reads supporting documents. documents.read was granted to every
--    role in 0055, before the sales role existed; 0088 gave the new role a row
--    for every permission, switched off. No one has set the cell since, in any
--    company, so it is switched on where no person ever set it; a company whose
--    admin decided otherwise keeps that decision. The change is written to the
--    audit log, with no actor, so the history says why the matrix moved.
-- ============================================================================
set search_path = public;

-- ----------------------------------------------------------------------------
-- 1. The permission.
-- ----------------------------------------------------------------------------
insert into acc_permission (key, label, category, description, is_enforced, min_role)
values ('invoice.create', 'Create draft invoices', 'Sales',
        'Create a draft invoice for a customer; issuing it to the ledger is a separate permission', true, 'any')
on conflict (key) do update
set label = excluded.label,
    category = excluded.category,
    description = excluded.description,
    is_enforced = excluded.is_enforced,
    min_role = excluded.min_role;

insert into acc_role_permission (role, permission_key, allowed)
select role, 'invoice.create', role in ('admin'::acc_app_role, 'accountant'::acc_app_role, 'sales'::acc_app_role)
  from unnest(enum_range(null::acc_app_role)) as role
on conflict (role, permission_key) do nothing;

-- ----------------------------------------------------------------------------
-- 2. A draft invoice needs invoice.create (otherwise as 0058).
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
  if not acc_has_permission('invoice.create')
     and not (auth.role() = 'service_role' and p_recurring_run_id is not null) then
    raise exception 'You do not have permission to create invoices';
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
-- 3. Sales reads supporting documents, where no person decided otherwise.
-- ----------------------------------------------------------------------------
with changed as (
  update acc_role_permission
     set allowed = true, updated_at = now()
   where role = 'sales' and permission_key = 'documents.read' and not allowed and updated_by is null
  returning role
)
insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
select 'acc_role_permission', null, 'update', null,
       jsonb_build_object('role', 'sales', 'permission_key', 'documents.read', 'allowed', true,
                          'reason', 'Release 2.63: sales sees the documents attached to what it reads')
  from changed;
