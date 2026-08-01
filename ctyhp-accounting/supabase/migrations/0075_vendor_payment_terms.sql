-- ============================================================================
-- 0075 — Vendor payment terms, early payment discounts, and paying by priority.
--
-- Every vendor already carried payment terms — as free text ("Net 30", "Due on
-- receipt"). A string cannot work out a due date, so the date was typed by hand
-- on every bill, and it cannot express a discount at all.
--
-- Terms become numbers here. A bill snapshots them when it posts, because terms
-- change and a bill keeps the terms it was raised under. And paying inside the
-- discount window becomes a posting the system knows how to make, rather than
-- advice nobody could act on without a manual journal.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Terms the system can compute with.
-- ----------------------------------------------------------------------------
alter table acc_vendor
  add column if not exists payment_terms_days int
    check (payment_terms_days is null or payment_terms_days between 0 and 365),
  -- 1/10 net 30 is discount_percent 1.00, discount_days 10, terms_days 30.
  add column if not exists discount_percent numeric(5, 2)
    check (discount_percent is null or (discount_percent >= 0 and discount_percent <= 100)),
  add column if not exists discount_days int
    check (discount_days is null or discount_days between 0 and 365);

comment on column acc_vendor.payment_terms is
  'Free-text label kept for display. The numbers beside it are what the system computes with.';

-- Read the eleven existing vendors' own words rather than making something up.
update acc_vendor
   set payment_terms_days = case
         when payment_terms ~* 'due on receipt|cod|immediate' then 0
         when payment_terms ~* 'net\s*([0-9]+)'
           then (regexp_match(payment_terms, 'net\s*([0-9]+)', 'i'))[1]::int
         else null
       end
 where payment_terms_days is null and payment_terms is not null;

-- ----------------------------------------------------------------------------
-- 2. What the bill was raised under, frozen at posting.
-- ----------------------------------------------------------------------------
alter table acc_bill
  add column if not exists terms_label           text,
  add column if not exists discount_due_date     date,
  add column if not exists discount_amount_minor bigint not null default 0
    check (discount_amount_minor >= 0),
  add column if not exists discount_taken_minor  bigint not null default 0
    check (discount_taken_minor >= 0);

comment on column acc_bill.discount_amount_minor is
  'What could be saved by paying on or before discount_due_date. A snapshot: the vendor''s terms may change, this bill''s do not.';

-- ----------------------------------------------------------------------------
-- 3. Somewhere for a discount to land.
--
-- Taking a discount settles the bill in full while paying less cash. The
-- difference is income and needs an account; without one the whole feature is
-- advice nobody can act on.
-- ----------------------------------------------------------------------------
insert into acc_account (account_code, name, account_type, is_posting_account, status, currency_code)
select '7010', 'Purchase Discounts Taken', 'other_income', true, 'active',
       (select code from acc_currency where is_base limit 1)
 where not exists (select 1 from acc_account where account_code = '7010');

create or replace function acc_active_purchase_discount_account() returns uuid
language sql stable as $$
  select id from acc_account
   where is_posting_account and status = 'active'
     and (account_code = '7010'
          or (account_type = 'other_income' and name ilike 'purchase discount%'))
   order by account_code
   limit 1;
$$;

-- ----------------------------------------------------------------------------
-- 4. Posting a bill applies the vendor's terms.
--
-- A due date typed by hand is kept — someone may have agreed something special.
-- Where none was typed, the terms decide it, so a bill can no longer arrive on
-- the books with no due date and fall out of every ageing bucket.
-- ----------------------------------------------------------------------------
create or replace function acc_apply_vendor_terms(p_bill_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_bill   acc_bill;
  v_vendor acc_vendor;
  v_days   int;
begin
  select * into v_bill from acc_bill where id = p_bill_id;
  if not found then return; end if;
  select * into v_vendor from acc_vendor where id = v_bill.vendor_id;
  if not found then return; end if;

  v_days := coalesce(
    v_vendor.payment_terms_days,
    (select default_payment_terms_days from acc_company_setting_version
      order by version desc limit 1),
    30
  );

  update acc_bill
     set due_date = coalesce(v_bill.due_date, v_bill.bill_date + v_days),
         terms_label = coalesce(v_vendor.payment_terms,
                                case when v_days = 0 then 'Due on receipt'
                                     else 'Net ' || v_days end),
         discount_due_date = case
           when v_vendor.discount_percent is null or v_vendor.discount_percent = 0 then null
           else v_bill.bill_date + coalesce(v_vendor.discount_days, 0)
         end,
         discount_amount_minor = case
           when v_vendor.discount_percent is null or v_vendor.discount_percent = 0 then 0
           -- Round to the cent the way an invoice would: half up.
           else floor(v_bill.total_minor * v_vendor.discount_percent / 100.0 + 0.5)::bigint
         end
   where id = p_bill_id;
end;
$$;

revoke all on function acc_apply_vendor_terms(uuid) from public;
grant execute on function acc_apply_vendor_terms(uuid) to authenticated, service_role;

/**
 * Post a bill. Unchanged except that the vendor's terms are applied once the
 * total is known — the discount is a percentage of it, so it cannot be worked
 * out before.
 */
create or replace function acc_post_bill(p_bill_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_bill   acc_bill;
  v_ap     uuid;
  v_total  bigint;
  v_number text;
  v_lines  jsonb := '[]'::jsonb;
  v_entry  uuid;
  v_bad    text;
  rec      record;
begin
  if not acc_is_staff() then raise exception 'Not authorized to post bills'; end if;

  select * into v_bill from acc_bill where id = p_bill_id for update;
  if not found then raise exception 'Bill not found'; end if;
  if v_bill.status <> 'draft' then raise exception 'Only draft bills can be posted'; end if;

  select i.name into v_bad
    from acc_bill_line bl
    join acc_item i on i.id = bl.item_id
   where bl.bill_id = p_bill_id and i.is_inventory
     and bl.purchase_order_line_id is null and not bl.is_inventory_variance
   limit 1;
  if v_bad is not null then
    raise exception 'Inventory item % must be purchased through a purchase order, not a direct bill', v_bad;
  end if;

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

  -- The terms depend on the total, so they are applied after it is settled.
  perform acc_apply_vendor_terms(p_bill_id);

  for rec in
    select item_id, amount_minor, description from acc_bill_line
     where bill_id = p_bill_id and is_inventory_variance and item_id is not null
  loop
    perform acc_add_inventory_txn(rec.item_id, v_bill.bill_date, 'bill_variance', p_bill_id,
                                 0, rec.amount_minor, v_entry, null, rec.description);
  end loop;

  return v_entry;
end;
$$;

-- Give the bills already on the books their terms, so the pay-run has
-- something to rank on from the first time it is opened.
do $$
declare r record;
begin
  for r in select id from acc_bill where status in ('open', 'partial') loop
    perform acc_apply_vendor_terms(r.id);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 5. Everything the pay-run needs to rank a bill, in one read.
--
-- The ranking itself is a rule, and rules live in lib/domain/payment-terms.ts
-- where tests can hold them. This returns the facts.
-- ----------------------------------------------------------------------------
create or replace function acc_payables_priority(p_as_of date)
returns table (
  bill_id               uuid,
  bill_number           text,
  vendor_id             uuid,
  vendor_name           text,
  bill_date             date,
  due_date              date,
  terms_label           text,
  currency_code         text,
  total_minor           bigint,
  balance_due_minor     bigint,
  discount_due_date     date,
  discount_amount_minor bigint,
  discount_taken_minor  bigint,
  status                text
)
language sql stable security definer set search_path = public as $$
  select b.id, b.bill_number, b.vendor_id, v.name, b.bill_date, b.due_date,
         b.terms_label, b.currency_code, b.total_minor, b.balance_due_minor,
         b.discount_due_date, b.discount_amount_minor, b.discount_taken_minor,
         b.status::text
    from acc_bill b
    join acc_vendor v on v.id = b.vendor_id
   where b.status in ('open', 'partial')
     and b.balance_due_minor > 0
     and b.bill_date <= p_as_of
   order by b.due_date nulls last, b.bill_number;
$$;

revoke all on function acc_payables_priority(date) from public;
grant execute on function acc_payables_priority(date) to authenticated, service_role;
