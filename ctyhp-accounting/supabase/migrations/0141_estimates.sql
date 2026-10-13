-- ============================================================================
-- 0141  Estimates: a price promised to a customer, and the invoice made from one
--
-- An estimate sits outside the books. It has a customer and lines shaped
-- exactly like an invoice's (item, description, quantity, unit price, income
-- account, sales tax code), so turning one into an invoice loses nothing.
-- Nothing here posts: only the invoice made from an estimate posts, when it is
-- issued, as every invoice does.
--
-- State is worked out when read; only Declined is stored.
--   Converted  an invoice that is not void carries this estimate's id
--   Declined   declined_at is set
--   Expired    neither, and the company's today is after expiry_date. The app
--              decides this: today depends on the company's time zone.
--   Open       otherwise
-- The stored half also has a word, status = 'open' or 'declined', for the
-- Number Sequence report's status column. A check holds it equal to
-- declined_at at all times. It is a plain column rather than a generated one
-- because the backup restore loads every exported column back as written, and
-- Postgres refuses a value for a generated column. Converted and Expired are
-- never stored.
--
-- Four functions, all security definer and staff only:
--   acc_save_estimate                 create, or replace the header and lines
--   acc_set_estimate_declined         mark declined, or reopen
--   acc_delete_estimate               only an estimate that never had an invoice
--   acc_create_invoice_from_estimate  the draft invoice, linked, in one go
--
-- The conversion makes the draft by calling acc_create_draft_invoice (0058)
-- itself, so an invoice made from an estimate is checked and totalled by the
-- same function as every other invoice draft. The estimate's own totals use
-- that function's two roundings, line by line:
--   line subtotal = round(quantity * unit price)
--   line tax      = round(line subtotal * rate / 100)
-- The quantity is first rounded to the four places its column keeps, so the
-- invoice made from the stored lines comes to the same total.
--
-- Numbering: EST-000001 from its own sequence, assigned on the first save and
-- never changed. The sequence is registered for the Number Sequence report and
-- guarded like every numbered document (0066). An estimate may be deleted when
-- it never had an invoice, so the delete writes the freed number to
-- acc_number_gap_note, as deleting a payment does (0106), and the report still
-- adds up.
--
-- Access: every member of the company reads, as invoices are read (0005).
-- Nobody writes these tables directly. The tables have a read policy and no
-- write policy, and signed-in users hold SELECT only, as acc_adjusting_entry
-- (0124) and acc_stock_count (0139) do. An application session writes only
-- through the four functions, so the Converted lock and the totals the database
-- works out cannot be stepped around.
-- ============================================================================

set search_path = public;

-- ----------------------------------------------------------------------------
-- 1. The estimate and its lines
-- ----------------------------------------------------------------------------
create table if not exists acc_estimate (
  id               uuid primary key default gen_random_uuid(),
  estimate_number  text not null unique,
  customer_id      uuid not null references acc_customer (id),
  estimate_date    date not null,
  expiry_date      date not null,
  currency_code    text not null default 'USD' references acc_currency (code),
  memo             text,
  subtotal_minor   bigint not null default 0,
  tax_minor        bigint not null default 0,
  total_minor      bigint not null default 0,
  declined_at      timestamptz,
  status           text not null default 'open',
  created_by       uuid references auth.users (id),
  created_at       timestamptz not null default now(),
  updated_by       uuid references auth.users (id),
  updated_at       timestamptz not null default now(),
  constraint acc_estimate_expiry_ck check (expiry_date >= estimate_date),
  constraint acc_usd_currency_check check (currency_code = 'USD'),
  constraint acc_estimate_totals_ck
    check (subtotal_minor >= 0 and tax_minor >= 0 and total_minor = subtotal_minor + tax_minor),
  constraint acc_estimate_status_ck
    check (status in ('open', 'declined') and (status = 'declined') = (declined_at is not null))
);

create index if not exists acc_estimate_customer_idx on acc_estimate (customer_id);
create index if not exists acc_estimate_date_idx on acc_estimate (estimate_date desc, estimate_number desc);

create table if not exists acc_estimate_line (
  id                  uuid primary key default gen_random_uuid(),
  estimate_id         uuid not null references acc_estimate (id) on delete cascade,
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
  constraint acc_estimate_line_order_uq unique (estimate_id, line_order)
);

-- ----------------------------------------------------------------------------
-- 2. The invoice made from an estimate. At most one invoice that is not void
--    per estimate; a voided one keeps its link, which is how the delete rule
--    knows the estimate has had an invoice.
-- ----------------------------------------------------------------------------
alter table acc_invoice
  add column if not exists estimate_id uuid references acc_estimate (id);

create index if not exists acc_invoice_estimate_idx
  on acc_invoice (estimate_id) where estimate_id is not null;
create unique index if not exists acc_invoice_estimate_live_uq
  on acc_invoice (estimate_id) where estimate_id is not null and status <> 'void';

-- ----------------------------------------------------------------------------
-- 3. Actor stamps, the audit trail and the number guard, on the header. The
--    lines are replaced wholesale by every save, so the header's audit row is
--    the record of who changed the estimate.
-- ----------------------------------------------------------------------------
drop trigger if exists acc_estimate_actor_stamp on acc_estimate;
create trigger acc_estimate_actor_stamp
  before insert or update on acc_estimate
  for each row execute function acc_stamp_actor();

drop trigger if exists acc_estimate_atomic_audit on acc_estimate;
create trigger acc_estimate_atomic_audit
  after insert or update or delete on acc_estimate
  for each row execute function acc_audit_row_change();

drop trigger if exists acc_estimate_number_guard on acc_estimate;
create trigger acc_estimate_number_guard
  before update or delete on acc_estimate
  for each row execute function acc_guard_document_number('estimate_number');

-- ----------------------------------------------------------------------------
-- 4. Row-level security and grants: read as invoices are read, written only
--    through the functions below (the 0124 and 0139 pattern)
-- ----------------------------------------------------------------------------
alter table acc_estimate enable row level security;
alter table acc_estimate_line enable row level security;

drop policy if exists acc_estimate_read on acc_estimate;
create policy acc_estimate_read on acc_estimate
  for select using (acc_current_role() is not null);
drop policy if exists acc_estimate_line_read on acc_estimate_line;
create policy acc_estimate_line_read on acc_estimate_line
  for select using (acc_current_role() is not null);

-- No insert, update or delete policy: an application session writes these
-- tables only through the functions below.
revoke all on acc_estimate from public, anon;
revoke all on acc_estimate_line from public, anon;
-- Schema public hands authenticated write rights on every new table through
-- Supabase's default privileges. These tables are written only by the
-- security definer functions below, so take those rights back.
revoke insert, update, delete, truncate on acc_estimate from authenticated;
revoke insert, update, delete, truncate on acc_estimate_line from authenticated;
grant select on acc_estimate to authenticated;
grant select on acc_estimate_line to authenticated;
grant all on acc_estimate to service_role;
grant all on acc_estimate_line to service_role;

-- ----------------------------------------------------------------------------
-- 5. The EST- sequence and its place in the Number Sequence report
-- ----------------------------------------------------------------------------
insert into acc_sequence (key, prefix, next_value)
values ('estimate', 'EST-', 1)
on conflict (key) do nothing;

insert into acc_number_source
  (sequence_key, label, table_name, number_column, date_column, status_column)
values
  ('estimate', 'Estimates', 'acc_estimate', 'estimate_number', 'estimate_date', 'status')
on conflict (sequence_key) do update
  set label = excluded.label,
      table_name = excluded.table_name,
      number_column = excluded.number_column,
      date_column = excluded.date_column,
      status_column = excluded.status_column;

-- ----------------------------------------------------------------------------
-- 6. Save: create an estimate with its lines, or replace an existing one's.
--    p_estimate_id null creates; p_expiry_date null means the estimate date
--    plus 30 days. Every line is checked before anything is written, and a new
--    estimate is numbered only once all of it has passed.
--    Returns { id, estimate_number, subtotal_minor, tax_minor, total_minor }.
-- ----------------------------------------------------------------------------
create or replace function acc_save_estimate(
  p_estimate_id   uuid,
  p_customer_id   uuid,
  p_estimate_date date,
  p_expiry_date   date,
  p_currency      text,
  p_memo          text,
  p_lines         jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_est        acc_estimate;
  v_id         uuid;
  v_number     text;
  v_live       text;
  v_expiry     date;
  v_memo       text := nullif(btrim(coalesce(p_memo, '')), '');
  v_line       jsonb;
  v_n          bigint;
  v_rows       jsonb := '[]'::jsonb;
  v_quantity   numeric;
  v_unit_price bigint;
  v_account    uuid;
  v_tax_code   uuid;
  v_item       uuid;
  v_tax_rate   numeric;
  v_line_sub   bigint;
  v_line_tax   bigint;
  v_subtotal   bigint := 0;
  v_tax_total  bigint := 0;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to save estimates';
  end if;

  -- An edit locks the estimate first, so a conversion cannot slip in between
  -- this check and the save.
  if p_estimate_id is not null then
    select * into v_est from acc_estimate where id = p_estimate_id for update;
    if not found then
      raise exception 'Estimate not found';
    end if;
    select coalesce(i.invoice_number, 'a draft invoice') into v_live
      from acc_invoice i
     where i.estimate_id = p_estimate_id and i.status <> 'void'
     limit 1;
    if v_live is not null then
      raise exception '% has been turned into an invoice (%), so it can no longer be edited.',
        v_est.estimate_number, v_live;
    end if;
  end if;

  if p_customer_id is null
     or not exists (select 1 from acc_customer where id = p_customer_id and is_active) then
    raise exception 'Choose an active customer for the estimate.';
  end if;
  if p_estimate_date is null then
    raise exception 'Choose the estimate date.';
  end if;
  v_expiry := coalesce(p_expiry_date, p_estimate_date + 30);
  if v_expiry < p_estimate_date then
    raise exception 'Valid until cannot be before the estimate date.';
  end if;
  if coalesce(p_currency, 'USD') <> 'USD' then
    raise exception 'Estimates are in US dollars (USD) only.';
  end if;
  if jsonb_typeof(coalesce(p_lines, 'null'::jsonb)) <> 'array'
     or jsonb_array_length(p_lines) = 0 then
    raise exception 'An estimate needs at least one line.';
  end if;

  for v_line, v_n in
    select e.value, e.ordinality
      from jsonb_array_elements(p_lines) with ordinality as e(value, ordinality)
     order by e.ordinality
  loop
    v_quantity := round((v_line ->> 'quantity')::numeric, 4);
    v_unit_price := (v_line ->> 'unit_price_minor')::bigint;
    v_account := nullif(v_line ->> 'income_account_id', '')::uuid;
    v_tax_code := nullif(v_line ->> 'tax_code_id', '')::uuid;
    v_item := nullif(v_line ->> 'item_id', '')::uuid;

    if v_quantity is null or v_quantity <= 0 then
      raise exception 'Line %: the quantity must be more than zero.', v_n;
    end if;
    if v_unit_price is null then
      raise exception 'Line %: enter a unit price.', v_n;
    end if;
    if v_unit_price < 0 then
      raise exception 'Line %: the unit price cannot be negative.', v_n;
    end if;
    if v_account is null then
      raise exception 'Line %: choose an income account.', v_n;
    end if;
    -- The rule the invoice form applies to its account list
    -- (isSalesRevenueAccount, lib/domain/accounts.ts): a sale credits
    -- operating revenue.
    if not exists (
      select 1 from acc_account
       where id = v_account and account_type = 'income'
         and is_posting_account and status = 'active'
    ) then
      raise exception 'Line %: the account must be an active income account.', v_n;
    end if;
    v_tax_rate := 0;
    if v_tax_code is not null then
      select rate_percent into v_tax_rate
        from acc_tax_code
       where id = v_tax_code and is_active and direction = 'sales';
      if not found then
        raise exception 'Line %: the tax code must be an active sales tax code.', v_n;
      end if;
    end if;
    if v_item is not null and not exists (select 1 from acc_item where id = v_item) then
      raise exception 'Line %: the item was not found.', v_n;
    end if;

    v_line_sub := round(v_quantity * v_unit_price)::bigint;
    v_line_tax := round(v_line_sub * v_tax_rate / 100)::bigint;
    v_subtotal := v_subtotal + v_line_sub;
    v_tax_total := v_tax_total + v_line_tax;

    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'line_order', v_n - 1,
      'item_id', v_item,
      'description', coalesce(v_line ->> 'description', ''),
      'quantity', v_quantity,
      'unit_price_minor', v_unit_price,
      'income_account_id', v_account,
      'tax_code_id', v_tax_code,
      'line_subtotal_minor', v_line_sub,
      'line_tax_minor', v_line_tax,
      'line_total_minor', v_line_sub + v_line_tax));
  end loop;

  if p_estimate_id is null then
    v_number := acc_next_number('estimate');
    insert into acc_estimate
      (estimate_number, customer_id, estimate_date, expiry_date, currency_code, memo,
       subtotal_minor, tax_minor, total_minor, created_by)
    values
      (v_number, p_customer_id, p_estimate_date, v_expiry, 'USD', v_memo,
       v_subtotal, v_tax_total, v_subtotal + v_tax_total, auth.uid())
    returning id into v_id;
  else
    v_id := p_estimate_id;
    v_number := v_est.estimate_number;
    update acc_estimate
       set customer_id = p_customer_id,
           estimate_date = p_estimate_date,
           expiry_date = v_expiry,
           memo = v_memo,
           subtotal_minor = v_subtotal,
           tax_minor = v_tax_total,
           total_minor = v_subtotal + v_tax_total,
           updated_at = now()
     where id = v_id;
    delete from acc_estimate_line where estimate_id = v_id;
  end if;

  insert into acc_estimate_line
    (estimate_id, line_order, item_id, description, quantity, unit_price_minor,
     income_account_id, tax_code_id, line_subtotal_minor, line_tax_minor, line_total_minor)
  select v_id, r.line_order, r.item_id, r.description, r.quantity, r.unit_price_minor,
         r.income_account_id, r.tax_code_id, r.line_subtotal_minor, r.line_tax_minor,
         r.line_total_minor
    from jsonb_to_recordset(v_rows) as r(
      line_order int, item_id uuid, description text, quantity numeric,
      unit_price_minor bigint, income_account_id uuid, tax_code_id uuid,
      line_subtotal_minor bigint, line_tax_minor bigint, line_total_minor bigint);

  return jsonb_build_object(
    'id', v_id,
    'estimate_number', v_number,
    'subtotal_minor', v_subtotal,
    'tax_minor', v_tax_total,
    'total_minor', v_subtotal + v_tax_total);
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. Mark declined (p_declined true) or reopen (false). Declining twice keeps
--    the first time it was declined.
--    Returns { id, estimate_number, declined_at }.
-- ----------------------------------------------------------------------------
create or replace function acc_set_estimate_declined(p_estimate_id uuid, p_declined boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_est      acc_estimate;
  v_live     text;
  v_declined timestamptz;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to change estimates';
  end if;
  if p_declined is null then
    raise exception 'Say whether the estimate is declined or reopened.';
  end if;

  select * into v_est from acc_estimate where id = p_estimate_id for update;
  if not found then
    raise exception 'Estimate not found';
  end if;
  select coalesce(i.invoice_number, 'a draft invoice') into v_live
    from acc_invoice i
   where i.estimate_id = p_estimate_id and i.status <> 'void'
   limit 1;
  if v_live is not null then
    if p_declined then
      raise exception '% has been turned into an invoice (%), so it cannot be marked declined.',
        v_est.estimate_number, v_live;
    end if;
    raise exception '% has been turned into an invoice (%), so it cannot be reopened.',
      v_est.estimate_number, v_live;
  end if;

  v_declined := case when p_declined then coalesce(v_est.declined_at, now()) end;
  if v_declined is distinct from v_est.declined_at then
    update acc_estimate
       set declined_at = v_declined,
           status = case when v_declined is null then 'open' else 'declined' end,
           updated_at = now()
     where id = p_estimate_id;
  end if;

  return jsonb_build_object(
    'id', p_estimate_id,
    'estimate_number', v_est.estimate_number,
    'declined_at', v_declined);
end;
$$;

-- ----------------------------------------------------------------------------
-- 8. Delete an estimate and its lines. Refused once any invoice, void or not,
--    has been made from it: that history stays, and declining is the way to
--    set the estimate aside.
--    Returns { id, estimate_number }.
-- ----------------------------------------------------------------------------
create or replace function acc_delete_estimate(p_estimate_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_est    acc_estimate;
  v_live   text;
  v_prefix text;
  v_digits text;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to delete estimates';
  end if;

  select * into v_est from acc_estimate where id = p_estimate_id for update;
  if not found then
    raise exception 'Estimate not found';
  end if;
  select coalesce(i.invoice_number, 'a draft invoice') into v_live
    from acc_invoice i
   where i.estimate_id = p_estimate_id and i.status <> 'void'
   limit 1;
  if v_live is not null then
    raise exception '% has been turned into an invoice (%), so it cannot be deleted.',
      v_est.estimate_number, v_live;
  end if;
  if exists (select 1 from acc_invoice i where i.estimate_id = p_estimate_id) then
    raise exception '% has had an invoice made from it. Mark it declined instead.',
      v_est.estimate_number;
  end if;

  -- Account for the number before the row that holds it goes.
  select prefix into v_prefix from acc_sequence where key = 'estimate';
  if v_prefix is not null and left(v_est.estimate_number, length(v_prefix)) = v_prefix then
    v_digits := substring(v_est.estimate_number from length(v_prefix) + 1);
    if v_digits ~ '^[0-9]{1,18}$' then
      if v_digits::bigint > 0 then
        insert into acc_number_gap_note (sequence_key, number_value, reason, noted_by)
        values ('estimate', v_digits::bigint,
                'Estimate ' || v_est.estimate_number
                || ' was deleted. An estimate is not in the books, so nothing else changed.',
                auth.uid())
        on conflict (sequence_key, number_value) do nothing;
      end if;
    end if;
  end if;

  delete from acc_estimate where id = p_estimate_id;

  return jsonb_build_object('id', p_estimate_id, 'estimate_number', v_est.estimate_number);
end;
$$;

-- ----------------------------------------------------------------------------
-- 9. Turn an estimate into a draft invoice, in one transaction. The fields and
--    lines are the New invoice form's, which may differ from the estimate's;
--    only the customer must match. Returns the new invoice's id.
-- ----------------------------------------------------------------------------
create or replace function acc_create_invoice_from_estimate(
  p_estimate_id uuid,
  p_customer_id uuid,
  p_issue_date  date,
  p_due_date    date,
  p_currency    text,
  p_memo        text,
  p_lines       jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_est      acc_estimate;
  v_live     text;
  v_customer text;
  v_invoice  uuid;
begin
  if not acc_is_staff() then
    raise exception 'Not authorized to create invoices';
  end if;

  -- 1. Lock the estimate. A second conversion waits here, then sees the first.
  select * into v_est from acc_estimate where id = p_estimate_id for update;
  if not found then
    raise exception 'Estimate not found';
  end if;

  -- 2. Declined.
  if v_est.declined_at is not null then
    raise exception '% is marked declined. Reopen it before turning it into an invoice.',
      v_est.estimate_number;
  end if;

  -- 3. Already turned into an invoice that is not void.
  select coalesce(i.invoice_number, 'a draft invoice') into v_live
    from acc_invoice i
   where i.estimate_id = p_estimate_id and i.status <> 'void'
   limit 1;
  if v_live is not null then
    raise exception '% has already been turned into an invoice (%).',
      v_est.estimate_number, v_live;
  end if;

  -- 4. The same customer.
  if p_customer_id is distinct from v_est.customer_id then
    select c.name into v_customer from acc_customer c where c.id = v_est.customer_id;
    raise exception '% is for %. The invoice made from it must be for the same customer.',
      v_est.estimate_number, v_customer;
  end if;

  -- 5. The draft, through the function every invoice draft goes through.
  v_invoice := acc_create_draft_invoice(
    p_customer_id, p_issue_date, p_due_date, p_currency, p_memo, p_lines);

  -- 6. The link. acc_invoice_estimate_live_uq is the last word on "one".
  update acc_invoice set estimate_id = p_estimate_id where id = v_invoice;

  return v_invoice;
end;
$$;

-- ----------------------------------------------------------------------------
-- 10. Who may call them
-- ----------------------------------------------------------------------------
revoke all on function acc_save_estimate(uuid, uuid, date, date, text, text, jsonb) from public, anon;
revoke all on function acc_set_estimate_declined(uuid, boolean) from public, anon;
revoke all on function acc_delete_estimate(uuid) from public, anon;
revoke all on function acc_create_invoice_from_estimate(uuid, uuid, date, date, text, text, jsonb) from public, anon;
grant execute on function acc_save_estimate(uuid, uuid, date, date, text, text, jsonb) to authenticated, service_role;
grant execute on function acc_set_estimate_declined(uuid, boolean) to authenticated, service_role;
grant execute on function acc_delete_estimate(uuid) to authenticated, service_role;
grant execute on function acc_create_invoice_from_estimate(uuid, uuid, date, date, text, text, jsonb) to authenticated, service_role;
