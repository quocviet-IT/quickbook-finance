-- ============================================================================
-- 0164  Sales receipts (2.53)
--
-- A sale paid on the spot: the money goes straight to a deposit account and
-- nothing is owed, so Accounts Receivable is never touched. Saving a receipt
-- posts it at once:
--
--   DR deposit account (a bank or cash account, or 1210 Undeposited Funds)  total
--   CR income, one line per income account                                  subtotal
--   CR sales tax payable, one line per tax code's control account           tax
--   and, for inventory items, a separate cost-of-sales entry (source
--   'inventory'), exactly as an issued invoice does.
--
-- A posted receipt is not edited. A mistake is voided, with a reason, and the
-- sale entered again: the voided receipt keeps its number and its history, and
-- its entries stop counting (reports read status = 'posted'). A receipt dated
-- in a closed period can neither be posted nor voided; acc_post_entry and the
-- journal entry's closed-period trigger refuse both.
--
--   acc_sales_receipt, acc_sales_receipt_line
--   sequence 'sales_receipt' (SR-000001), registered as a number source
--   acc_create_sales_receipt(...)  validates, totals on the server, numbers,
--                                  saves and posts in one transaction
--   acc_void_sales_receipt(id, reason)
--   acc_sales_tax_collected        redefined: receipt lines count as collected
--                                  tax, as invoice lines always have
--   acc_transaction_list, acc_global_search  redefined below: a receipt shows
--                                  its customer, and its number is searchable
--   acc_gl_posting_report, acc_control_reconciliation  redefined: the posting
--                                  check lists receipts, and their tax is in
--                                  the Sales Tax Payable subledger, so taxed
--                                  receipts do not block closing a period
-- ============================================================================
set search_path = public;

-- ----------------------------------------------------------------------------
-- 1. Tables
-- ----------------------------------------------------------------------------
create table if not exists acc_sales_receipt (
  id                  uuid primary key default gen_random_uuid(),
  receipt_number      text not null unique,
  customer_id         uuid not null references acc_customer (id),
  receipt_date        date not null,
  currency_code       text not null default 'USD' references acc_currency (code),
  deposit_account_id  uuid not null references acc_account (id),
  payment_method      text,
  reference           text,
  memo                text,
  subtotal_minor      bigint not null default 0,
  tax_minor           bigint not null default 0,
  total_minor         bigint not null default 0,
  status              text not null default 'posted',
  journal_entry_id    uuid references acc_journal_entry (id),
  voided_at           timestamptz,
  voided_by           uuid references auth.users (id),
  void_reason         text,
  created_by          uuid references auth.users (id),
  created_at          timestamptz not null default now(),
  updated_by          uuid references auth.users (id),
  updated_at          timestamptz not null default now(),
  constraint acc_usd_currency_check check (currency_code = 'USD'),
  constraint acc_sales_receipt_method_ck
    check (payment_method is null or payment_method in ('cash', 'check', 'card', 'bank_transfer')),
  constraint acc_sales_receipt_reference_ck check (reference is null or char_length(reference) <= 80),
  constraint acc_sales_receipt_totals_ck
    check (subtotal_minor >= 0 and tax_minor >= 0 and total_minor = subtotal_minor + tax_minor and total_minor > 0),
  constraint acc_sales_receipt_status_ck
    check (status in ('posted', 'void') and (status = 'void') = (voided_at is not null)),
  constraint acc_sales_receipt_void_reason_ck
    check (status <> 'void' or char_length(btrim(coalesce(void_reason, ''))) >= 3)
);
create index if not exists acc_sales_receipt_customer_idx on acc_sales_receipt (customer_id);
create index if not exists acc_sales_receipt_date_idx on acc_sales_receipt (receipt_date desc, receipt_number desc);
create index if not exists acc_sales_receipt_entry_idx on acc_sales_receipt (journal_entry_id);

create table if not exists acc_sales_receipt_line (
  id                  uuid primary key default gen_random_uuid(),
  receipt_id          uuid not null references acc_sales_receipt (id) on delete cascade,
  line_order          int not null default 0,
  item_id             uuid references acc_item (id),
  description         text not null default '',
  quantity            numeric(20, 4) not null check (quantity > 0),
  unit_price_minor    bigint not null check (unit_price_minor >= 0),
  income_account_id   uuid not null references acc_account (id),
  tax_code_id         uuid references acc_tax_code (id),
  line_subtotal_minor bigint not null default 0,
  line_tax_minor      bigint not null default 0,
  line_total_minor    bigint not null default 0,
  constraint acc_sales_receipt_line_order_uq unique (receipt_id, line_order)
);

drop trigger if exists acc_sales_receipt_actor_stamp on acc_sales_receipt;
create trigger acc_sales_receipt_actor_stamp
  before insert or update on acc_sales_receipt
  for each row execute function acc_stamp_actor();
drop trigger if exists acc_sales_receipt_atomic_audit on acc_sales_receipt;
create trigger acc_sales_receipt_atomic_audit
  after insert or update or delete on acc_sales_receipt
  for each row execute function acc_audit_row_change();
-- Numbers are written once, and a numbered receipt is never deleted: it is voided.
drop trigger if exists acc_sales_receipt_number_guard on acc_sales_receipt;
create trigger acc_sales_receipt_number_guard
  before update or delete on acc_sales_receipt
  for each row execute function acc_guard_document_number('receipt_number');

-- Read by any signed-in user of the company; written only by the functions below.
alter table acc_sales_receipt enable row level security;
alter table acc_sales_receipt_line enable row level security;
drop policy if exists acc_sales_receipt_read on acc_sales_receipt;
create policy acc_sales_receipt_read on acc_sales_receipt
  for select using (acc_current_role() is not null);
drop policy if exists acc_sales_receipt_line_read on acc_sales_receipt_line;
create policy acc_sales_receipt_line_read on acc_sales_receipt_line
  for select using (acc_current_role() is not null);
revoke all on acc_sales_receipt from public, anon;
revoke all on acc_sales_receipt_line from public, anon;
revoke insert, update, delete, truncate on acc_sales_receipt from authenticated;
revoke insert, update, delete, truncate on acc_sales_receipt_line from authenticated;
grant select on acc_sales_receipt to authenticated;
grant select on acc_sales_receipt_line to authenticated;
grant all on acc_sales_receipt to service_role;
grant all on acc_sales_receipt_line to service_role;

insert into acc_sequence (key, prefix, next_value)
values ('sales_receipt', 'SR-', 1)
on conflict (key) do nothing;

insert into acc_number_source
  (sequence_key, label, table_name, number_column, date_column, status_column)
values
  ('sales_receipt', 'Sales receipts', 'acc_sales_receipt', 'receipt_number', 'receipt_date', 'status')
on conflict (sequence_key) do update
  set label = excluded.label,
      table_name = excluded.table_name,
      number_column = excluded.number_column,
      date_column = excluded.date_column,
      status_column = excluded.status_column;

-- ----------------------------------------------------------------------------
-- 2. Save and post a receipt
-- ----------------------------------------------------------------------------
create or replace function acc_create_sales_receipt(
  p_customer_id        uuid,
  p_receipt_date       date,
  p_deposit_account_id uuid,
  p_payment_method     text,
  p_reference          text,
  p_memo               text,
  p_lines              jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_receipt     uuid;
  v_number      text;
  v_customer    text;
  v_deposit     acc_account;
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
  v_date        date := coalesce(p_receipt_date, current_date);
  v_method      text := nullif(btrim(coalesce(p_payment_method, '')), '');
  v_lines       jsonb := '[]'::jsonb;
  v_entry       uuid;
  v_base        text;
  v_cost        bigint;
  v_cost_total  bigint := 0;
  v_cost_lines  jsonb := '[]'::jsonb;
  v_moves       jsonb := '[]'::jsonb;
  v_move        jsonb;
  v_cost_entry  uuid;
  rec           record;
begin
  if not acc_is_staff() then raise exception 'Not authorized to record sales receipts'; end if;
  if jsonb_typeof(coalesce(p_lines, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'A sales receipt needs at least one line';
  end if;
  select name into v_customer from acc_customer where id = p_customer_id and is_active;
  if not found then raise exception 'Customer not found or inactive'; end if;

  -- Most accounts have no detail type; a bare comparison with it is null, and
  -- `not (false or null)` is null, which IF reads as false and lets an income
  -- account through. Hence the coalesce.
  select * into v_deposit from acc_account where id = p_deposit_account_id;
  if not found or v_deposit.status <> 'active' or not coalesce(v_deposit.is_posting_account, false)
     or not (v_deposit.account_type = 'bank' or coalesce(v_deposit.detail_type, '') = 'undeposited_funds') then
    raise exception 'Deposit the money to an active bank or cash account, or to Undeposited Funds';
  end if;
  if v_method is not null and v_method not in ('cash', 'check', 'card', 'bank_transfer') then
    raise exception 'Payment method must be cash, check, card or bank transfer';
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_quantity := (v_line ->> 'quantity')::numeric;
    v_unit_price := (v_line ->> 'unit_price_minor')::bigint;
    v_tax_code := nullif(v_line ->> 'tax_code_id', '')::uuid;
    if v_quantity is null or v_quantity <= 0 then
      raise exception 'Sales receipt line quantity must be positive';
    end if;
    if v_unit_price is null or v_unit_price < 0 then
      raise exception 'Sales receipt line unit price cannot be negative';
    end if;
    if nullif(v_line ->> 'income_account_id', '') is null then
      raise exception 'Every sales receipt line needs an income account';
    end if;
    v_tax_rate := 0;
    if v_tax_code is not null then
      select rate_percent into v_tax_rate from acc_tax_code
       where id = v_tax_code and is_active and direction = 'sales';
      if not found then raise exception 'Sales tax code not found or inactive'; end if;
    end if;
    v_line_sub := round(v_quantity * v_unit_price)::bigint;
    v_line_tax := round(v_line_sub * v_tax_rate / 100)::bigint;
    v_subtotal := v_subtotal + v_line_sub;
    v_tax_total := v_tax_total + v_line_tax;
  end loop;
  if v_subtotal + v_tax_total <= 0 then
    raise exception 'A sales receipt total must be positive';
  end if;

  v_number := acc_next_number('sales_receipt');
  insert into acc_sales_receipt
    (receipt_number, customer_id, receipt_date, currency_code, deposit_account_id,
     payment_method, reference, memo, subtotal_minor, tax_minor, total_minor, status, created_by)
  values
    (v_number, p_customer_id, v_date, 'USD', p_deposit_account_id,
     v_method, nullif(btrim(coalesce(p_reference, '')), ''), nullif(btrim(coalesce(p_memo, '')), ''),
     v_subtotal, v_tax_total, v_subtotal + v_tax_total, 'posted', auth.uid())
  returning id into v_receipt;

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
    insert into acc_sales_receipt_line
      (receipt_id, line_order, description, quantity, unit_price_minor, income_account_id,
       tax_code_id, item_id, line_subtotal_minor, line_tax_minor, line_total_minor)
    values
      (v_receipt, v_line_order, coalesce(v_line ->> 'description', ''), v_quantity, v_unit_price,
       (v_line ->> 'income_account_id')::uuid, v_tax_code, nullif(v_line ->> 'item_id', '')::uuid,
       v_line_sub, v_line_tax, v_line_sub + v_line_tax);
    v_line_order := v_line_order + 1;
  end loop;

  select code into v_base from acc_currency where is_base;

  -- DR the deposit account (total)
  v_lines := v_lines || jsonb_build_object(
    'account_id', p_deposit_account_id, 'debit_minor', v_subtotal + v_tax_total, 'credit_minor', 0,
    'amount_base_minor', acc_to_base_minor(v_subtotal + v_tax_total, 'USD', v_date),
    'memo', 'Sales receipt ' || v_number);

  -- CR Income (grouped by income account)
  for rec in
    select income_account_id as acc, sum(line_subtotal_minor)::bigint as amt
      from acc_sales_receipt_line where receipt_id = v_receipt
     group by income_account_id having sum(line_subtotal_minor) <> 0
  loop
    v_lines := v_lines || jsonb_build_object(
      'account_id', rec.acc, 'debit_minor', 0, 'credit_minor', rec.amt,
      'amount_base_minor', acc_to_base_minor(rec.amt, 'USD', v_date), 'memo', 'Income');
  end loop;

  -- CR Sales Tax Payable (grouped by the tax code's control account)
  for rec in
    select tc.tax_account_id as acc, sum(rl.line_tax_minor)::bigint as amt
      from acc_sales_receipt_line rl
      join acc_tax_code tc on tc.id = rl.tax_code_id
     where rl.receipt_id = v_receipt and rl.line_tax_minor > 0 and tc.tax_account_id is not null
     group by tc.tax_account_id
  loop
    v_lines := v_lines || jsonb_build_object(
      'account_id', rec.acc, 'debit_minor', 0, 'credit_minor', rec.amt,
      'amount_base_minor', acc_to_base_minor(rec.amt, 'USD', v_date), 'memo', 'Sales tax payable');
  end loop;

  -- The number and the customer are in the description, so a bank line that
  -- names either is matched to this entry.
  v_entry := acc_post_entry(v_date, 'Sales receipt ' || v_number || ' · ' || v_customer,
                            'sales_receipt', v_receipt, 'USD', v_lines);
  update acc_sales_receipt set journal_entry_id = v_entry, updated_at = now() where id = v_receipt;

  -- Cost of goods sold, per inventory item, at weighted average cost (as 0069).
  for rec in
    select i.id as item_id, i.name, i.inventory_account_id, i.cogs_account_id, sum(rl.quantity) as qty
      from acc_sales_receipt_line rl
      join acc_item i on i.id = rl.item_id
     where rl.receipt_id = v_receipt and i.is_inventory
     group by i.id, i.name, i.inventory_account_id, i.cogs_account_id
     order by i.id
  loop
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
      v_cost_entry := acc_post_entry(v_date, 'Cost of sales for sales receipt ' || v_number,
                                     'inventory', v_receipt, v_base, v_cost_lines);
    end if;
    for v_move in select * from jsonb_array_elements(v_moves) loop
      perform acc_add_inventory_txn(
        (v_move ->> 'item_id')::uuid, v_date, 'sale', v_receipt,
        -((v_move ->> 'qty')::numeric), -((v_move ->> 'cost')::bigint), v_cost_entry, null,
        'Sales receipt ' || v_number);
    end loop;
  end if;

  return v_receipt;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Void a receipt
-- ----------------------------------------------------------------------------
create or replace function acc_void_sales_receipt(p_receipt_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_receipt    acc_sales_receipt;
  v_cost_entry uuid;
  v_reason     text := btrim(coalesce(p_reason, ''));
begin
  if not acc_is_staff() then raise exception 'Not authorized to void sales receipts'; end if;
  if char_length(v_reason) < 3 then raise exception 'Say why this sales receipt is being voided'; end if;

  select * into v_receipt from acc_sales_receipt where id = p_receipt_id for update;
  if not found then raise exception 'Sales receipt not found'; end if;
  if v_receipt.status = 'void' then raise exception 'This sales receipt is already void'; end if;

  -- Put the goods back before the ledger effect is removed (as acc_void_invoice).
  select id into v_cost_entry from acc_journal_entry
   where source_type = 'inventory' and source_id = p_receipt_id and status = 'posted';
  if v_cost_entry is not null then
    perform acc_reverse_inventory_for_entry(v_cost_entry, v_receipt.receipt_date, 'Sales receipt voided');
    update acc_journal_entry set status = 'void', voided_at = now() where id = v_cost_entry;
  end if;

  -- Voiding the entry removes its ledger effect (reports read status = 'posted');
  -- the closed-period trigger refuses this inside a closed period.
  if v_receipt.journal_entry_id is not null then
    update acc_journal_entry set status = 'void', voided_at = now() where id = v_receipt.journal_entry_id;
  end if;

  update acc_sales_receipt
     set status = 'void', voided_at = now(), voided_by = auth.uid(), void_reason = v_reason, updated_at = now()
   where id = p_receipt_id;
end;
$$;

revoke all on function acc_create_sales_receipt(uuid, date, uuid, text, text, text, jsonb) from public, anon;
grant execute on function acc_create_sales_receipt(uuid, date, uuid, text, text, text, jsonb) to authenticated;
revoke all on function acc_void_sales_receipt(uuid, text) from public, anon;
grant execute on function acc_void_sales_receipt(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Sales tax collected counts receipt lines too (as 0016 otherwise)
-- ----------------------------------------------------------------------------
create or replace function acc_sales_tax_collected(p_from date, p_to date)
returns table (tax_code_id uuid, code text, name text, rate_percent numeric,
               taxable_minor bigint, tax_minor bigint)
language sql stable as $$
  select tc.id, tc.code, tc.name, tc.rate_percent,
         coalesce(sum(t.subtotal_minor), 0)::bigint,
         coalesce(sum(t.tax_minor), 0)::bigint
    from (
      select il.tax_code_id, il.line_subtotal_minor as subtotal_minor, il.line_tax_minor as tax_minor
        from acc_invoice_line il
        join acc_invoice inv on inv.id = il.invoice_id
       where inv.status not in ('draft', 'void')
         and inv.issue_date between p_from and p_to
      union all
      select rl.tax_code_id, rl.line_subtotal_minor, rl.line_tax_minor
        from acc_sales_receipt_line rl
        join acc_sales_receipt r on r.id = rl.receipt_id
       where r.status = 'posted'
         and r.receipt_date between p_from and p_to
    ) t
    join acc_tax_code tc on tc.id = t.tax_code_id
   group by tc.id, tc.code, tc.name, tc.rate_percent
   having coalesce(sum(t.tax_minor), 0) <> 0
   order by tc.code;
$$;

-- ----------------------------------------------------------------------------
-- 5. The transaction list names a receipt's customer (as 0128 otherwise)
-- ----------------------------------------------------------------------------
create or replace function acc_transaction_list(
  p_from date,
  p_to   date
) returns table (
  entry_id      uuid,
  entry_number  text,
  entry_date    date,
  description   text,
  source_type   text,
  party_name    text,
  category_label text,
  money_label   text,
  amount_minor  bigint,
  currency_code text,
  reconciled    boolean,
  account_ids   uuid[]
)
language sql stable security definer set search_path = public as $$
  with entries as (
    select e.id, e.entry_number, e.entry_date, e.description, e.source_type, e.source_id, e.currency_code
      from acc_journal_entry e
     where e.status = 'posted'
       and e.entry_date between p_from and p_to
  ),
  lines as (
    select l.journal_entry_id, l.account_id, l.debit_minor, l.credit_minor, a.name as account_name,
           case
             when a.account_type in ('bank', 'credit_card') then 'money'
             when a.account_type in ('accounts_receivable', 'accounts_payable') then 'control'
             when a.account_type in ('income', 'other_income', 'expense', 'other_expense',
                                     'cost_of_goods_sold') then 'category'
             else 'other'
           end as bucket
      from acc_journal_line l
      join acc_account a on a.id = l.account_id
     where l.journal_entry_id in (select id from entries)
  ),
  -- One row per entry and kind of account: how many accounts of that kind it
  -- touched, the one account when there is one, and their net.
  labelled as (
    select journal_entry_id, bucket,
           case when count(distinct account_name) = 1 then min(account_name) else '— Split —' end as label,
           sum(debit_minor - credit_minor) as net_minor
      from lines
     group by journal_entry_id, bucket
  ),
  -- The same facts pivoted to one row per entry. A kind the entry did not touch
  -- is null, exactly as 0105's subquery returned no row for it.
  per_entry as (
    select journal_entry_id,
           max(net_minor) filter (where bucket = 'money')    as money_net,
           max(net_minor) filter (where bucket = 'control')  as control_net,
           max(net_minor) filter (where bucket = 'category') as category_net,
           max(label)     filter (where bucket = 'money')    as money_label,
           max(label)     filter (where bucket = 'category') as category_label,
           max(label)     filter (where bucket = 'other')    as other_label
      from labelled
     group by journal_entry_id
  ),
  totals as (
    select journal_entry_id,
           sum(debit_minor) as debit_total,
           array_agg(distinct account_id) as account_ids
      from lines
     group by journal_entry_id
  ),
  reconciled as (
    select distinct l.journal_entry_id
      from acc_reconciliation r
      join acc_journal_line l on l.id = r.journal_line_id
     where r.status = 'approved'
       and l.journal_entry_id in (select id from entries)
  ),
  -- Documents are found from their own journal_entry_id rather than from
  -- acc_journal_entry.source_id, because source_id is only populated for some
  -- of them. Goods receipts are the one party-bearing document with no
  -- journal_entry_id column, so they keep the source_id route. The rank is
  -- 0105's coalesce order.
  parties as (
    select distinct on (journal_entry_id) journal_entry_id, name
      from (
        select d.journal_entry_id, c.name, 1 as rank from acc_invoice d join acc_customer c on c.id = d.customer_id
         where d.journal_entry_id in (select id from entries)
        union all
        select d.journal_entry_id, c.name, 2 from acc_payment d join acc_customer c on c.id = d.customer_id
         where d.journal_entry_id in (select id from entries)
        union all
        select d.journal_entry_id, c.name, 3 from acc_credit_memo d join acc_customer c on c.id = d.customer_id
         where d.journal_entry_id in (select id from entries)
        union all
        select d.journal_entry_id, v.name, 4 from acc_bill d join acc_vendor v on v.id = d.vendor_id
         where d.journal_entry_id in (select id from entries)
        union all
        select d.journal_entry_id, v.name, 5 from acc_bill_payment d join acc_vendor v on v.id = d.vendor_id
         where d.journal_entry_id in (select id from entries)
        union all
        select d.journal_entry_id, v.name, 6 from acc_expense d join acc_vendor v on v.id = d.vendor_id
         where d.journal_entry_id in (select id from entries)
        union all
        select d.journal_entry_id, v.name, 7 from acc_vendor_credit d join acc_vendor v on v.id = d.vendor_id
         where d.journal_entry_id in (select id from entries)
        union all
        select e.id, v.name, 8 from entries e
          join acc_goods_receipt d on d.id = e.source_id
          join acc_vendor v on v.id = d.vendor_id
        union all
        select d.journal_entry_id, c.name, 9 from acc_sales_receipt d join acc_customer c on c.id = d.customer_id
         where d.journal_entry_id in (select id from entries)
      ) found
     where name is not null
     order by journal_entry_id, rank
  )
  select
    e.id,
    e.entry_number,
    e.entry_date,
    coalesce(nullif(btrim(e.description), ''), initcap(replace(e.source_type::text, '_', ' '))),
    e.source_type::text,
    p.name,
    coalesce(pe.category_label, pe.other_label),
    pe.money_label,
    -- Amount reads as what the transaction did to the business, negative for
    -- money leaving: cash first, then what is owed, then the category side
    -- inverted, then — nothing but assets and liabilities moved — the entry
    -- total.
    coalesce(pe.money_net, pe.control_net, -pe.category_net, t.debit_total, 0)::bigint,
    e.currency_code,
    r.journal_entry_id is not null,
    coalesce(t.account_ids, array[]::uuid[])
  from entries e
  left join per_entry pe on pe.journal_entry_id = e.id
  left join totals t on t.journal_entry_id = e.id
  left join reconciled r on r.journal_entry_id = e.id
  left join parties p on p.journal_entry_id = e.id
  order by e.entry_date, e.entry_number;
$$;

revoke all on function acc_transaction_list(date, date) from public, anon;
grant execute on function acc_transaction_list(date, date) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Global search finds a receipt by its number (as 0042 otherwise)
-- ----------------------------------------------------------------------------
create or replace function acc_global_search(p_query text, p_limit int default 10)
returns table (
  kind     text,
  id       uuid,
  label    text,
  sublabel text,
  href     text
)
language sql stable as $$
  with q as (select '%' || btrim(coalesce(p_query, '')) || '%' as pattern,
                    greatest(least(coalesce(p_limit, 10), 50), 1) as lim),
  hits as (
    select 'invoice' as kind, i.id, i.invoice_number as label,
           c.name as sublabel, '/invoices' as href, i.issue_date as sort_date
      from acc_invoice i
      join q on true
      left join acc_customer c on c.id = i.customer_id
     where i.invoice_number ilike q.pattern
    union all
    select 'sales_receipt', r.id, r.receipt_number, c.name, '/sales-receipts', r.receipt_date
      from acc_sales_receipt r
      join q on true
      left join acc_customer c on c.id = r.customer_id
     where r.receipt_number ilike q.pattern
    union all
    select 'bill', b.id, b.bill_number, v.name, '/bills', b.bill_date
      from acc_bill b
      join q on true
      left join acc_vendor v on v.id = b.vendor_id
     where b.bill_number ilike q.pattern
    union all
    select 'purchase_order', po.id, po.po_number, v.name,
           '/purchase-orders/' || po.id::text, po.order_date
      from acc_purchase_order po
      join q on true
      left join acc_vendor v on v.id = po.vendor_id
     where po.po_number ilike q.pattern
    union all
    select 'expense', e.id, e.expense_number, v.name, '/expenses', e.expense_date
      from acc_expense e
      join q on true
      left join acc_vendor v on v.id = e.vendor_id
     where e.expense_number ilike q.pattern
    union all
    select 'payment', p.id, p.payment_number, c.name, '/payments', p.payment_date
      from acc_payment p
      join q on true
      left join acc_customer c on c.id = p.customer_id
     where p.payment_number ilike q.pattern
    union all
    select 'bill_payment', bp.id, bp.payment_number, v.name, '/pay-bills', bp.payment_date
      from acc_bill_payment bp
      join q on true
      left join acc_vendor v on v.id = bp.vendor_id
     where bp.payment_number ilike q.pattern
    union all
    select 'customer', c.id, c.name, c.email, '/customers', null::date
      from acc_customer c join q on true
     where c.name ilike q.pattern
    union all
    select 'vendor', v.id, v.name, v.email, '/vendors', null::date
      from acc_vendor v join q on true
     where v.name ilike q.pattern
    union all
    select 'item', it.id, it.name, it.item_code, '/items', null::date
      from acc_item it join q on true
     where it.name ilike q.pattern or it.item_code ilike q.pattern
  )
  select h.kind, h.id, h.label, h.sublabel, h.href
    from hits h, q
   where btrim(coalesce(p_query, '')) <> ''
     and h.label is not null
   order by h.sort_date desc nulls last, h.label
   limit (select lim from q);
$$;

-- ----------------------------------------------------------------------------
-- 7. The posting check lists receipts, and sales tax ties out with them
--    (as 0073 otherwise)
--
-- A receipt's tax is credited to Sales Tax Payable like an invoice's. Left out
-- of the subledger, every taxed receipt would show as a variance on Sales Tax
-- Payable, and closing the period (0074) refuses a control account that does
-- not tie. Its own total is the debit to the deposit account, so the posting
-- check compares it the way it compares an invoice. Its cost of goods sold is
-- a separate inventory entry, as an invoice's is.
-- ----------------------------------------------------------------------------
create or replace function acc_gl_posting_report(p_from date, p_to date)
returns table (
  source_type      text,
  document_id      uuid,
  document_number  text,
  document_date    date,
  party_name       text,
  document_status  text,
  amount_minor     bigint,
  journal_entry_id uuid,
  entry_number     text,
  entry_date       date,
  entry_status     text,
  entry_total_minor bigint
)
language sql stable security definer set search_path = public as $$
  with documents as (
    select 'invoice'::text, i.id, i.invoice_number, i.issue_date, c.name,
           i.status::text, i.total_minor, i.journal_entry_id
      from acc_invoice i join acc_customer c on c.id = i.customer_id
     where i.issue_date between p_from and p_to
    union all
    select 'sales_receipt', sr.id, sr.receipt_number, sr.receipt_date, c.name,
           sr.status, sr.total_minor, sr.journal_entry_id
      from acc_sales_receipt sr join acc_customer c on c.id = sr.customer_id
     where sr.receipt_date between p_from and p_to
    union all
    select 'bill', b.id, b.bill_number, b.bill_date, v.name,
           b.status::text, b.total_minor, b.journal_entry_id
      from acc_bill b join acc_vendor v on v.id = b.vendor_id
     where b.bill_date between p_from and p_to
    union all
    select 'customer_payment', p.id, p.payment_number, p.payment_date, c.name,
           p.status::text, p.amount_minor, p.journal_entry_id
      from acc_payment p join acc_customer c on c.id = p.customer_id
     where p.payment_date between p_from and p_to
    union all
    select 'vendor_payment', bp.id, bp.payment_number, bp.payment_date, v.name,
           bp.status::text, bp.amount_minor, bp.journal_entry_id
      from acc_bill_payment bp join acc_vendor v on v.id = bp.vendor_id
     where bp.payment_date between p_from and p_to
    union all
    select 'expense', e.id, e.expense_number, e.expense_date, coalesce(v.name, 'Expense'),
           e.status::text, e.total_minor, e.journal_entry_id
      from acc_expense e left join acc_vendor v on v.id = e.vendor_id
     where e.expense_date between p_from and p_to
    union all
    select 'credit_memo', cm.id, cm.credit_memo_number, cm.memo_date, c.name,
           cm.status::text, cm.total_minor, cm.journal_entry_id
      from acc_credit_memo cm join acc_customer c on c.id = cm.customer_id
     where cm.memo_date between p_from and p_to
    union all
    select 'vendor_credit', vc.id, vc.vendor_credit_number, vc.credit_date, v.name,
           vc.status::text, vc.total_minor, vc.journal_entry_id
      from acc_vendor_credit vc join acc_vendor v on v.id = vc.vendor_id
     where vc.credit_date between p_from and p_to
    union all
    select 'tax_payment', tp.id, tp.payment_number, tp.payment_date, 'Sales tax authority',
           tp.status::text, tp.amount_minor, tp.journal_entry_id
      from acc_tax_payment tp
     where tp.payment_date between p_from and p_to
  )
  select d.source_type, d.document_id, d.document_number, d.document_date,
         d.party_name, d.document_status, d.amount_minor, d.journal_entry_id,
         je.entry_number, je.entry_date, je.status::text,
         coalesce((select sum(jl.debit_minor) from acc_journal_line jl
                    where jl.journal_entry_id = je.id), 0)::bigint
    from documents d (source_type, document_id, document_number, document_date,
                      party_name, document_status, amount_minor, journal_entry_id)
    left join acc_journal_entry je on je.id = d.journal_entry_id
   order by d.document_date desc, d.source_type, d.document_number nulls last;
$$;

revoke all on function acc_gl_posting_report(date, date) from public;
grant execute on function acc_gl_posting_report(date, date) to authenticated, service_role;

create or replace function acc_control_reconciliation(p_as_of date)
returns table (
  control_key       text,
  label             text,
  account_codes     text,
  has_subledger     boolean,
  subledger_minor   bigint,
  control_minor     bigint
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_grni uuid := acc_active_grni_account();
begin
  return query
  -- Accounts receivable: what customers still owe, less credit not yet applied.
  select 'ar'::text, 'Accounts Receivable'::text,
         (select string_agg(distinct a.account_code, ', ' order by a.account_code)
            from acc_account a where a.account_type = 'accounts_receivable'),
         true,
         (
           coalesce((select sum(i.balance_due_minor) from acc_invoice i
                      where i.status in ('issued', 'partial') and i.issue_date <= p_as_of), 0)
         - coalesce((select sum(cm.balance_remaining_minor) from acc_credit_memo cm
                      where cm.status in ('issued', 'partial') and cm.memo_date <= p_as_of), 0)
         )::bigint,
         coalesce((select sum(jl.debit_minor - jl.credit_minor)
                     from acc_journal_line jl
                     join acc_journal_entry je on je.id = jl.journal_entry_id
                     join acc_account a on a.id = jl.account_id
                    where a.account_type = 'accounts_receivable'
                      and je.status = 'posted' and je.entry_date <= p_as_of), 0)::bigint;

  -- Accounts payable: what is owed to vendors, less vendor credit not applied.
  return query
  select 'ap', 'Accounts Payable',
         (select string_agg(distinct a.account_code, ', ' order by a.account_code)
            from acc_account a where a.account_type = 'accounts_payable'),
         true,
         (
           coalesce((select sum(b.balance_due_minor) from acc_bill b
                      where b.status in ('open', 'partial') and b.bill_date <= p_as_of), 0)
         - coalesce((select sum(vc.balance_remaining_minor) from acc_vendor_credit vc
                      where vc.status in ('issued', 'partial') and vc.credit_date <= p_as_of), 0)
         )::bigint,
         -- Payables sit on the credit side; report the subledger's own sign.
         coalesce((select sum(jl.credit_minor - jl.debit_minor)
                     from acc_journal_line jl
                     join acc_journal_entry je on je.id = jl.journal_entry_id
                     join acc_account a on a.id = jl.account_id
                    where a.account_type = 'accounts_payable'
                      and je.status = 'posted' and je.entry_date <= p_as_of), 0)::bigint;

  -- Inventory: quantity on hand at weighted average cost.
  return query
  select 'inventory', 'Inventory',
         (select string_agg(distinct a.account_code, ', ' order by a.account_code)
            from acc_account a
            join acc_item it on it.inventory_account_id = a.id
           where it.is_inventory),
         true,
         coalesce((select sum(v.value_minor) from acc_inventory_valuation(p_as_of) v), 0)::bigint,
         coalesce((select sum(jl.debit_minor - jl.credit_minor)
                     from acc_journal_line jl
                     join acc_journal_entry je on je.id = jl.journal_entry_id
                    where jl.account_id in (select distinct it.inventory_account_id
                                              from acc_item it
                                             where it.is_inventory
                                               and it.inventory_account_id is not null)
                      and je.status = 'posted' and je.entry_date <= p_as_of), 0)::bigint;

  -- Goods received not invoiced: received on a purchase order, not yet billed.
  return query
  select 'grni', 'Goods Received Not Invoiced',
         (select a.account_code from acc_account a where a.id = v_grni),
         v_grni is not null,
         coalesce((select sum((pol.qty_received - pol.qty_billed) * pol.unit_cost_minor)
                     from acc_purchase_order_line pol
                     join acc_purchase_order po on po.id = pol.purchase_order_id
                    where pol.qty_received > pol.qty_billed
                      and po.order_date <= p_as_of), 0)::bigint,
         coalesce((select sum(jl.credit_minor - jl.debit_minor)
                     from acc_journal_line jl
                     join acc_journal_entry je on je.id = jl.journal_entry_id
                    where jl.account_id = v_grni
                      and je.status = 'posted' and je.entry_date <= p_as_of), 0)::bigint;

  -- Sales tax payable: tax charged on live invoices and sales receipts, less
  -- tax remitted.
  return query
  select 'sales_tax', 'Sales Tax Payable',
         (select string_agg(distinct a.account_code, ', ' order by a.account_code)
            from acc_account a
            join acc_tax_code tc on tc.tax_account_id = a.id),
         true,
         (
           coalesce((select sum(i.tax_total_minor) from acc_invoice i
                      where i.status in ('issued', 'partial', 'paid') and i.issue_date <= p_as_of), 0)
         + coalesce((select sum(sr.tax_minor) from acc_sales_receipt sr
                      where sr.status = 'posted' and sr.receipt_date <= p_as_of), 0)
         - coalesce((select sum(cm.tax_total_minor) from acc_credit_memo cm
                      where cm.status <> 'draft' and cm.status <> 'void' and cm.memo_date <= p_as_of), 0)
         - coalesce((select sum(tp.amount_minor) from acc_tax_payment tp
                      where tp.status = 'posted' and tp.payment_date <= p_as_of), 0)
         )::bigint,
         coalesce((select sum(jl.credit_minor - jl.debit_minor)
                     from acc_journal_line jl
                     join acc_journal_entry je on je.id = jl.journal_entry_id
                    where jl.account_id in (select distinct tc.tax_account_id
                                              from acc_tax_code tc
                                             where tc.tax_account_id is not null)
                      and je.status = 'posted' and je.entry_date <= p_as_of), 0)::bigint;

  -- Undeposited funds: no subledger feeds it, so the ledger balance is
  -- reported on its own. Anything sitting here came from a manual journal and
  -- deserves an explanation, which is exactly what the screen will ask for.
  return query
  select 'undeposited', 'Undeposited Funds',
         (select string_agg(a.account_code, ', ' order by a.account_code)
            from acc_account a where a.account_code = '1210'),
         false,
         0::bigint,
         coalesce((select sum(jl.debit_minor - jl.credit_minor)
                     from acc_journal_line jl
                     join acc_journal_entry je on je.id = jl.journal_entry_id
                     join acc_account a on a.id = jl.account_id
                    where a.account_code = '1210'
                      and je.status = 'posted' and je.entry_date <= p_as_of), 0)::bigint;
end;
$$;

revoke all on function acc_control_reconciliation(date) from public;
grant execute on function acc_control_reconciliation(date) to authenticated, service_role;
