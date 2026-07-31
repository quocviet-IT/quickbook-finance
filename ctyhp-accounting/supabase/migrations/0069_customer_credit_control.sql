-- ============================================================================
-- Customer credit control.
--
-- Nothing recorded how much credit a customer was allowed, so nothing could
-- stop an invoice that put them over it — the reviewer's point. This adds the
-- limit, the terms and the hold flag to the customer record, reports the
-- exposure against them, and refuses to issue an invoice that breaks the limit
-- unless somebody with the authority to override says why.
--
-- What it deliberately does NOT add is a table holding "current balance" and
-- "available credit". Those follow from the open invoices in the ledger; a
-- stored copy is a second number that can disagree with the books. They are
-- computed on read, here and in the report.
--
-- References: NFCC credit policy guidance; AICPA CECL (a credit limit is the
-- control, the allowance is the estimate — this is the control).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The customer's credit terms.
--    credit_limit_minor null  = no limit set, nothing is enforced
--                        0    = cash only; any open balance breaks it
--    credit_terms_days  null  = fall back to the company default
-- ----------------------------------------------------------------------------
alter table acc_customer
  add column if not exists credit_limit_minor bigint check (credit_limit_minor is null or credit_limit_minor >= 0),
  add column if not exists credit_terms_days  int    check (credit_terms_days is null or credit_terms_days >= 0),
  add column if not exists credit_hold        boolean not null default false,
  add column if not exists credit_reviewed_at timestamptz,
  add column if not exists credit_review_note text;

-- ----------------------------------------------------------------------------
-- 2. Who may issue past a limit. Seeded to administrators only: the point of a
--    limit is that the person raising the invoice cannot wave it through.
-- ----------------------------------------------------------------------------
insert into acc_permission (key, label, category, description, is_enforced) values
  ('credit.override', 'Override a credit limit', 'Receivables',
   'Issue an invoice that exceeds a customer credit limit or is on credit hold', true)
on conflict (key) do update
  set label = excluded.label, category = excluded.category,
      description = excluded.description, is_enforced = excluded.is_enforced;

insert into acc_role_permission (role, permission_key, allowed) values
  ('admin', 'credit.override', true),
  ('accountant', 'credit.override', false),
  ('viewer', 'credit.override', false)
on conflict (role, permission_key) do nothing;

-- ----------------------------------------------------------------------------
-- 3. Exposure, read from the ledger. One row per customer: what they owe, what
--    is late, and what they have been invoiced lately (which is what turns a
--    balance into days sales outstanding upstairs).
--
--    Every amount is minor units of the base currency — the product is USD-only
--    since migration 0051, so open balances add up directly.
-- ----------------------------------------------------------------------------
create or replace function acc_customer_credit_status(
  p_as_of              date default current_date,
  p_sales_window_days  int  default 90
)
returns table (
  customer_id        uuid,
  name               text,
  is_active          boolean,
  credit_limit_minor bigint,
  credit_terms_days  int,
  credit_hold        boolean,
  credit_reviewed_at timestamptz,
  open_balance_minor bigint,
  overdue_minor      bigint,
  oldest_due_date    date,
  sales_window_minor bigint,
  has_billing_address boolean
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_as_of date := coalesce(p_as_of, current_date);
  v_days  int  := greatest(coalesce(p_sales_window_days, 90), 1);
begin
  if acc_current_role() is null then
    raise exception 'Not authorized to read customer credit status';
  end if;

  return query
    select c.id,
           c.name,
           c.is_active,
           c.credit_limit_minor,
           c.credit_terms_days,
           c.credit_hold,
           c.credit_reviewed_at,
           coalesce(open.balance_minor, 0)::bigint,
           coalesce(open.overdue_minor, 0)::bigint,
           open.oldest_due_date,
           coalesce(sales.total_minor, 0)::bigint,
           nullif(btrim(coalesce(c.address_line1, '')), '') is not null
      from acc_customer c
      left join lateral (
        select sum(i.balance_due_minor)::bigint as balance_minor,
               sum(case when i.due_date is not null and i.due_date < v_as_of
                        then i.balance_due_minor else 0 end)::bigint as overdue_minor,
               min(case when i.due_date is not null and i.due_date < v_as_of
                        then i.due_date end) as oldest_due_date
          from acc_invoice i
         where i.customer_id = c.id
           and i.status in ('issued', 'partial')
           and i.balance_due_minor > 0
      ) open on true
      left join lateral (
        select sum(i.total_minor)::bigint as total_minor
          from acc_invoice i
         where i.customer_id = c.id
           and i.status <> 'void'
           and i.invoice_number is not null
           and i.issue_date > v_as_of - v_days
           and i.issue_date <= v_as_of
      ) sales on true
     order by c.name;
end;
$$;

revoke all on function acc_customer_credit_status(date, int) from public;
grant execute on function acc_customer_credit_status(date, int) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. The control itself, inside the issue RPC — the only place an invoice
--    becomes a receivable. The body is copied verbatim from
--    0035_fix_issue_invoice_cast.sql; the credit block and the override reason
--    are the only additions.
--
--    The one-argument version is dropped first: leaving it beside a version
--    whose second argument has a default makes every one-argument call
--    ambiguous.
-- ----------------------------------------------------------------------------
drop function if exists acc_issue_invoice(uuid);

create or replace function acc_issue_invoice(
  p_invoice_id      uuid,
  p_override_reason text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_inv       acc_invoice;
  v_ar        uuid;
  v_number    text;
  v_lines     jsonb := '[]'::jsonb;
  v_entry     uuid;
  v_base      text;
  v_cost      bigint;
  v_cost_total bigint := 0;
  v_cost_lines jsonb := '[]'::jsonb;
  v_moves     jsonb := '[]'::jsonb;
  v_move      jsonb;
  v_cost_entry uuid;
  rec         record;
  v_limit     bigint;
  v_hold      boolean;
  v_exposure  bigint;
  v_reason    text := nullif(btrim(coalesce(p_override_reason, '')), '');
begin
  if not acc_is_staff() then raise exception 'Not authorized to issue invoices'; end if;

  select * into v_inv from acc_invoice where id = p_invoice_id for update;
  if not found then raise exception 'Invoice not found'; end if;
  if v_inv.status <> 'draft' then raise exception 'Only draft invoices can be issued'; end if;
  if v_inv.total_minor <= 0 then raise exception 'Invoice total must be positive'; end if;

  -- --- Credit control -------------------------------------------------------
  select credit_limit_minor, credit_hold into v_limit, v_hold
    from acc_customer where id = v_inv.customer_id for share;
  select coalesce(sum(balance_due_minor), 0)::bigint into v_exposure
    from acc_invoice
   where customer_id = v_inv.customer_id
     and status in ('issued', 'partial')
     and id <> p_invoice_id;

  if coalesce(v_hold, false) or (v_limit is not null and v_exposure + v_inv.total_minor > v_limit) then
    if not acc_has_permission('credit.override') then
      raise exception
        'Customer is %; issuing this invoice needs the credit override permission (open %, this invoice %, limit %)',
        case when coalesce(v_hold, false) then 'on credit hold' else 'over the credit limit' end,
        v_exposure, v_inv.total_minor, coalesce(v_limit::text, 'not set')
        using errcode = 'insufficient_privilege';
    end if;
    if v_reason is null then
      raise exception 'A credit override needs a written reason';
    end if;
    -- The override is the exception an auditor looks for, so it is logged as
    -- its own action rather than hidden inside the invoice's row history.
    insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
    values ('acc_invoice', p_invoice_id, 'credit_override', auth.uid(),
            jsonb_build_object('reason', v_reason,
                               'credit_hold', coalesce(v_hold, false),
                               'credit_limit_minor', v_limit,
                               'open_balance_minor', v_exposure,
                               'invoice_total_minor', v_inv.total_minor));
  elsif v_reason is not null then
    raise exception 'This invoice is within the customer credit limit; no override is needed';
  end if;
  -- --- End credit control ---------------------------------------------------

  v_ar := acc_active_ar_account();
  if v_ar is null then raise exception 'No active Accounts Receivable account configured'; end if;
  select code into v_base from acc_currency where is_base;

  -- DR Accounts Receivable (total)
  v_lines := v_lines || jsonb_build_object(
    'account_id', v_ar, 'debit_minor', v_inv.total_minor, 'credit_minor', 0,
    'amount_base_minor', acc_to_base_minor(v_inv.total_minor, v_inv.currency_code, v_inv.issue_date),
    'memo', 'Accounts receivable');

  -- CR Income (grouped by income account)
  for rec in
    select income_account_id as acc, sum(line_subtotal_minor)::bigint as amt
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
    select tc.tax_account_id as acc, sum(il.line_tax_minor)::bigint as amt
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

  -- Cost of goods sold, per inventory item, at weighted average cost. The item
  -- rows are locked while the cost is computed so the average cannot move under
  -- us between the computation and the subledger write.
  for rec in
    select i.id as item_id, i.name, i.inventory_account_id, i.cogs_account_id,
           sum(il.quantity) as qty
      from acc_invoice_line il
      join acc_item i on i.id = il.item_id
     where il.invoice_id = p_invoice_id and i.is_inventory
     group by i.id, i.name, i.inventory_account_id, i.cogs_account_id
     order by i.id
  loop
    if v_inv.currency_code <> v_base then
      raise exception 'Inventory items require a base-currency (%) invoice', v_base;
    end if;
    if rec.inventory_account_id is null or rec.cogs_account_id is null then
      raise exception 'Item % needs both an inventory account and a COGS account', rec.name;
    end if;
    perform 1 from acc_item where id = rec.item_id for update;

    v_cost := acc_cost_of_sale_minor(rec.item_id, rec.qty);
    if v_cost <> 0 then
      v_cost_lines := v_cost_lines || jsonb_build_object(
        'account_id', rec.cogs_account_id, 'debit_minor', v_cost, 'credit_minor', 0,
        'amount_base_minor', v_cost, 'memo', 'Cost of goods sold: ' || rec.name);
      v_cost_lines := v_cost_lines || jsonb_build_object(
        'account_id', rec.inventory_account_id, 'debit_minor', 0, 'credit_minor', v_cost,
        'amount_base_minor', v_cost, 'memo', 'Inventory relieved: ' || rec.name);
      v_cost_total := v_cost_total + v_cost;
    end if;
    v_moves := v_moves || jsonb_build_object('item_id', rec.item_id, 'qty', rec.qty, 'cost', v_cost);
  end loop;

  if jsonb_array_length(v_moves) > 0 then
    if v_cost_total > 0 then
      v_cost_entry := acc_post_entry(v_inv.issue_date, 'Cost of sales for invoice ' || v_number,
                                     'inventory', p_invoice_id, v_base, v_cost_lines);
    end if;
    for v_move in select * from jsonb_array_elements(v_moves) loop
      perform acc_add_inventory_txn(
        (v_move ->> 'item_id')::uuid, v_inv.issue_date, 'sale', p_invoice_id,
        -((v_move ->> 'qty')::numeric), -((v_move ->> 'cost')::bigint), v_cost_entry, null,
        'Invoice ' || v_number);
    end loop;
  end if;

  return v_entry;
end;
$$;

revoke all on function acc_issue_invoice(uuid, text) from public;
grant execute on function acc_issue_invoice(uuid, text) to authenticated, service_role;
