-- ============================================================================
-- 0139 — Stock Count: a periodic count sheet that corrects the inventory
-- accounts to what was counted.
--
-- A count compares the counted value (quantity x cost, line by line) with the
-- ledger balance of the company's inventory accounts on a date, and posts ONE
-- adjusting entry for the difference. It does not move units: books kept this
-- way take purchases to cost of sales and let the count fix the balance sheet.
--
-- Needs 0138 (the 'stock_count' journal source). That value cannot be used in
-- the transaction that adds it, so it lives in its own migration; every
-- function below only names it inside a plpgsql body, which Postgres resolves
-- when the function runs.
--
-- Writes go only through the functions below: the tables have a read policy
-- and no write policy, as acc_adjusting_entry does (0124).
-- ============================================================================

set search_path = public;

-- ----------------------------------------------------------------------------
-- The two tables
-- ----------------------------------------------------------------------------
create table if not exists acc_stock_count (
  id                   uuid primary key default gen_random_uuid(),
  count_number         text not null unique,
  as_of                date not null,
  status               text not null default 'draft'
                         check (status in ('draft', 'pending_approval', 'posted')),
  memo                 text check (memo is null or length(memo) <= 500),
  -- frozen at posting
  counted_minor        bigint,
  book_minor           bigint,
  difference_minor     bigint,
  inventory_account_id uuid references acc_account (id),
  offset_account_id    uuid references acc_account (id),
  journal_entry_id     uuid references acc_journal_entry (id),
  approval_request_id  uuid references acc_approval_request (id),
  posted_by            uuid references auth.users (id),
  posted_at            timestamptz,
  created_by           uuid references auth.users (id),
  created_at           timestamptz not null default now(),
  updated_by           uuid references auth.users (id),
  updated_at           timestamptz not null default now(),
  constraint acc_stock_count_posted_ck
    check (status <> 'posted'
           or (journal_entry_id is not null and counted_minor is not null and book_minor is not null
               and difference_minor is not null and inventory_account_id is not null
               and offset_account_id is not null and posted_at is not null))
);

-- One count is open (draft or waiting for approval) at a time.
create unique index if not exists acc_stock_count_one_open_idx
  on acc_stock_count ((true)) where status in ('draft', 'pending_approval');
create index if not exists acc_stock_count_as_of_idx on acc_stock_count (as_of desc, count_number desc);

create table if not exists acc_stock_count_line (
  id              uuid primary key default gen_random_uuid(),
  stock_count_id  uuid not null references acc_stock_count (id) on delete cascade,
  line_order      integer not null,
  name            text not null check (length(btrim(name)) between 1 and 200),
  sku             text check (sku is null or length(sku) <= 100),
  quantity        numeric(20,4) not null default 0 check (quantity >= 0),
  unit_cost_minor bigint not null default 0 check (unit_cost_minor >= 0),
  sells_for_minor bigint check (sells_for_minor is null or sells_for_minor >= 0),
  constraint acc_stock_count_line_order_uq unique (stock_count_id, line_order)
);

-- The actor stamps and the audit trail sit on the header. The line rows are
-- replaced wholesale by every save (up to 2,000 at a time) and carry no actor
-- columns, so the header's audit row is the record of who changed the count.
drop trigger if exists acc_stock_count_actor_stamp on acc_stock_count;
create trigger acc_stock_count_actor_stamp
  before insert or update on acc_stock_count
  for each row execute function acc_stamp_actor();

drop trigger if exists acc_stock_count_atomic_audit on acc_stock_count;
create trigger acc_stock_count_atomic_audit
  after insert or update or delete on acc_stock_count
  for each row execute function acc_audit_row_change();

alter table acc_stock_count enable row level security;
alter table acc_stock_count_line enable row level security;

drop policy if exists acc_stock_count_read on acc_stock_count;
create policy acc_stock_count_read on acc_stock_count
  for select using (acc_current_role() is not null);
drop policy if exists acc_stock_count_line_read on acc_stock_count_line;
create policy acc_stock_count_line_read on acc_stock_count_line
  for select using (acc_current_role() is not null);

-- No insert, update or delete policy: an application session writes these
-- tables only through the functions below.
revoke all on acc_stock_count from public, anon;
revoke all on acc_stock_count_line from public, anon;
-- Schema public hands authenticated write rights on every new table through
-- Supabase's default privileges. These tables are written only by the
-- security definer functions below, so take those rights back.
revoke insert, update, delete, truncate on acc_stock_count from authenticated;
revoke insert, update, delete, truncate on acc_stock_count_line from authenticated;
grant select on acc_stock_count to authenticated;
grant select on acc_stock_count_line to authenticated;
grant all on acc_stock_count to service_role;
grant all on acc_stock_count_line to service_role;

insert into acc_sequence (key, prefix, next_value)
values ('stock_count', 'SC-', 1)
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- Which accounts hold the company's stock. The same rule as 1.95's
-- pickInventoryAccounts (lib/domain/inventory-accounts.ts):
--   1. accounts inventory items post to (acc_item.inventory_account_id on items
--      with is_inventory) plus accounts whose cash_flow_role is
--      'operating_inventory';
--   2. only when that finds nothing: current_asset accounts named like
--      inventory or stock.
-- ----------------------------------------------------------------------------
create or replace function acc_inventory_account_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  with by_item_or_role as (
    select i.inventory_account_id as id
      from acc_item i
     where i.is_inventory and i.inventory_account_id is not null
    union
    select a.id from acc_account a where a.cash_flow_role = 'operating_inventory'
  ),
  by_name as (
    select a.id from acc_account a
     where a.account_type = 'current_asset' and a.name ~* 'inventory|stock'
  )
  select id from by_item_or_role
  union
  select id from by_name where not exists (select 1 from by_item_or_role);
$$;

-- ----------------------------------------------------------------------------
-- The accounts a count posts to when the person has not chosen others.
--   inventory: the inventory account with the lowest code that can be posted to;
--   offset:    an active posting cost-of-sales account named like
--              "Inventory Adjustment", else the inventory write-down account,
--              else the lowest-coded active cost-of-sales account.
-- Either is null when the company has no such account.
-- ----------------------------------------------------------------------------
create or replace function acc_stock_count_default_accounts()
returns table (inventory_account_id uuid, offset_account_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare
  v_inventory uuid;
  v_offset    uuid;
begin
  select a.id into v_inventory
    from acc_account a
   where a.id in (select acc_inventory_account_ids())
     and a.is_posting_account and a.status = 'active'
   order by a.account_code, a.id
   limit 1;

  select a.id into v_offset
    from acc_account a
   where a.account_type = 'cost_of_goods_sold' and a.is_posting_account and a.status = 'active'
     and a.name ~* 'inventory\s*adjust'
   order by a.account_code, a.id
   limit 1;
  if v_offset is null then
    v_offset := acc_active_inventory_writedown_account();
  end if;
  if v_offset is null then
    select a.id into v_offset
      from acc_account a
     where a.account_type = 'cost_of_goods_sold' and a.is_posting_account and a.status = 'active'
     order by a.account_code, a.id
     limit 1;
  end if;

  return query select v_inventory, v_offset;
end;
$$;

-- ----------------------------------------------------------------------------
-- acc_create_stock_count — the open count if there is one, else a new draft
-- that starts as a copy of the previous count's lines.
-- ----------------------------------------------------------------------------
create or replace function acc_create_stock_count(p_as_of date) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid;
  v_prev uuid;
begin
  if not acc_is_staff() then raise exception 'Not authorized to create a stock count'; end if;
  if p_as_of is null then raise exception 'A stock count needs an as-of date'; end if;

  select id into v_id from acc_stock_count where status in ('draft', 'pending_approval') limit 1;
  if v_id is not null then return v_id; end if;

  -- The most recent posted count, or the most recent of any status when none is posted.
  select id into v_prev from acc_stock_count
   order by (status = 'posted') desc, posted_at desc nulls last, created_at desc, id desc
   limit 1;

  begin
    insert into acc_stock_count (count_number, as_of)
    values (acc_next_number('stock_count'), p_as_of)
    returning id into v_id;
  exception when unique_violation then
    -- Someone created the open count a moment ago; use theirs.
    select id into v_id from acc_stock_count where status in ('draft', 'pending_approval') limit 1;
    return v_id;
  end;

  if v_prev is not null then
    insert into acc_stock_count_line (stock_count_id, line_order, name, sku, quantity, unit_cost_minor, sells_for_minor)
    select v_id, l.line_order, l.name, l.sku, l.quantity, l.unit_cost_minor, l.sells_for_minor
      from acc_stock_count_line l
     where l.stock_count_id = v_prev
     order by l.line_order;
  end if;

  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- acc_save_stock_count — replace the whole set of lines of a draft in one
-- transaction. p_lines is a JSON array of
--   { name, sku, quantity, unit_cost_minor, sells_for_minor }.
-- Returns the number of lines saved.
-- ----------------------------------------------------------------------------
create or replace function acc_save_stock_count(
  p_id    uuid,
  p_as_of date,
  p_memo  text,
  p_lines jsonb
) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_count  acc_stock_count;
  v_el     jsonb;
  v_n      bigint;
  v_total  integer;
begin
  if not acc_is_staff() then raise exception 'Not authorized to save a stock count'; end if;
  if p_as_of is null then raise exception 'A stock count needs an as-of date'; end if;

  select * into v_count from acc_stock_count where id = p_id for update;
  if not found then raise exception 'Stock count not found'; end if;
  if v_count.status <> 'draft' then
    raise exception 'Only a draft count can be edited; % is %', v_count.count_number, v_count.status;
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'The count lines must be a list';
  end if;
  v_total := jsonb_array_length(p_lines);
  if v_total > 2000 then
    raise exception 'A count can hold at most 2,000 lines (this one has %)', v_total;
  end if;

  for v_el, v_n in select e.value, e.ordinality from jsonb_array_elements(p_lines) with ordinality as e loop
    if jsonb_typeof(v_el) <> 'object' then
      raise exception 'Line %: not a count line', v_n;
    end if;
    if btrim(coalesce(v_el ->> 'name', '')) = '' then
      raise exception 'Line %: a name is required', v_n;
    end if;
    if length(btrim(v_el ->> 'name')) > 200 then
      raise exception 'Line %: the name is too long (200 characters at most)', v_n;
    end if;
    if length(coalesce(v_el ->> 'sku', '')) > 100 then
      raise exception 'Line %: the SKU is too long (100 characters at most)', v_n;
    end if;
    if jsonb_typeof(v_el -> 'quantity') is distinct from 'number' then
      raise exception 'Line %: a quantity is required', v_n;
    end if;
    if (v_el ->> 'quantity')::numeric < 0 then
      raise exception 'Line %: the quantity cannot be negative', v_n;
    end if;
    if jsonb_typeof(v_el -> 'unit_cost_minor') is distinct from 'number'
       or (v_el ->> 'unit_cost_minor')::numeric <> trunc((v_el ->> 'unit_cost_minor')::numeric) then
      raise exception 'Line %: the cost each must be a whole number of minor units', v_n;
    end if;
    if (v_el ->> 'unit_cost_minor')::numeric < 0 then
      raise exception 'Line %: the cost each cannot be negative', v_n;
    end if;
    if jsonb_typeof(v_el -> 'sells_for_minor') = 'number' then
      if (v_el ->> 'sells_for_minor')::numeric <> trunc((v_el ->> 'sells_for_minor')::numeric) then
        raise exception 'Line %: sells for must be a whole number of minor units', v_n;
      end if;
      if (v_el ->> 'sells_for_minor')::numeric < 0 then
        raise exception 'Line %: sells for cannot be negative', v_n;
      end if;
    elsif jsonb_typeof(v_el -> 'sells_for_minor') is not null
          and jsonb_typeof(v_el -> 'sells_for_minor') <> 'null' then
      raise exception 'Line %: sells for must be a number or empty', v_n;
    end if;
  end loop;

  delete from acc_stock_count_line where stock_count_id = p_id;

  insert into acc_stock_count_line (stock_count_id, line_order, name, sku, quantity, unit_cost_minor, sells_for_minor)
  select p_id, e.ordinality::integer, btrim(e.value ->> 'name'),
         nullif(btrim(coalesce(e.value ->> 'sku', '')), ''),
         (e.value ->> 'quantity')::numeric,
         (e.value ->> 'unit_cost_minor')::bigint,
         case when jsonb_typeof(e.value -> 'sells_for_minor') = 'number'
              then (e.value ->> 'sells_for_minor')::bigint end
    from jsonb_array_elements(p_lines) with ordinality as e;

  update acc_stock_count
     set as_of = p_as_of, memo = nullif(btrim(coalesce(p_memo, '')), '')
   where id = p_id;

  return v_total;
end;
$$;

-- ----------------------------------------------------------------------------
-- acc_post_stock_count — post the difference between the counted value and the
-- books as one adjusting entry. Returns the journal entry id.
-- ----------------------------------------------------------------------------
create or replace function acc_post_stock_count(
  p_id                   uuid,
  p_inventory_account_id uuid,
  p_offset_account_id    uuid
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_count   acc_stock_count;
  v_counted bigint;
  v_book    bigint;
  v_diff    bigint;
  v_amount  bigint;
  v_desc    text;
  v_currency text;
  v_lines   jsonb;
  v_entry   uuid;
begin
  if not acc_is_staff() then raise exception 'Not authorized to post a stock count'; end if;
  if not acc_has_permission('inventory.adjust') then
    raise exception 'You do not have permission to adjust inventory';
  end if;

  select * into v_count from acc_stock_count where id = p_id for update;
  if not found then raise exception 'Stock count not found'; end if;
  if v_count.status = 'pending_approval' and not acc_in_approval_dispatch() then
    raise exception 'Stock count % is waiting for approval', v_count.count_number;
  elsif v_count.status = 'posted' then
    raise exception 'Stock count % is already posted', v_count.count_number;
  end if;

  if exists (select 1 from acc_item where is_inventory and is_active) then
    raise exception 'This company tracks stock item by item; adjust items on the Products & Services page';
  end if;

  if p_inventory_account_id is null
     or p_inventory_account_id not in (select acc_inventory_account_ids()) then
    raise exception 'The inventory account is not one of this company''s inventory accounts';
  end if;
  if p_offset_account_id is null or not exists (
       select 1 from acc_account a
        where a.id = p_offset_account_id and a.account_type = 'cost_of_goods_sold'
          and a.is_posting_account and a.status = 'active') then
    raise exception 'The offset account must be an active cost of sales account';
  end if;
  if p_offset_account_id = p_inventory_account_id then
    raise exception 'The offset account must differ from the inventory account';
  end if;

  select coalesce(sum(round(l.quantity * l.unit_cost_minor)), 0)::bigint into v_counted
    from acc_stock_count_line l where l.stock_count_id = p_id;

  -- Base currency, signed by side, exactly as acc_ledger_balances (0009) reads a line.
  select coalesce(sum(case when jl.debit_minor > 0 then jl.amount_base_minor else 0 end), 0)::bigint
       - coalesce(sum(case when jl.credit_minor > 0 then jl.amount_base_minor else 0 end), 0)::bigint
    into v_book
    from acc_journal_line jl
    join acc_journal_entry e on e.id = jl.journal_entry_id
   where jl.account_id in (select acc_inventory_account_ids())
     and e.status = 'posted'
     and e.entry_date <= v_count.as_of;

  v_diff := v_counted - v_book;
  if v_diff = 0 then raise exception 'The count already agrees with the books.'; end if;
  v_amount := abs(v_diff);

  if acc_approval_required('inventory_adjustment', v_amount) and not acc_in_approval_dispatch() then
    raise exception 'A stock count of this size requires approval; submit it for approval instead';
  end if;

  select code into v_currency from acc_currency where is_base limit 1;
  v_desc := 'Stock count ' || v_count.count_number || ' as of ' || v_count.as_of;

  if v_diff > 0 then
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', p_inventory_account_id, 'debit_minor', v_amount, 'credit_minor', 0,
                         'amount_base_minor', v_amount, 'memo', 'Stock count'),
      jsonb_build_object('account_id', p_offset_account_id, 'debit_minor', 0, 'credit_minor', v_amount,
                         'amount_base_minor', v_amount, 'memo', 'Stock count'));
  else
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', p_offset_account_id, 'debit_minor', v_amount, 'credit_minor', 0,
                         'amount_base_minor', v_amount, 'memo', 'Stock count'),
      jsonb_build_object('account_id', p_inventory_account_id, 'debit_minor', 0, 'credit_minor', v_amount,
                         'amount_base_minor', v_amount, 'memo', 'Stock count'));
  end if;

  perform acc_assert_postable(v_lines);
  v_entry := acc_post_entry(v_count.as_of, v_desc, 'stock_count', p_id, v_currency, v_lines);

  -- Adjusting, as depreciation is (0124): it shows in the Working Trial Balance's adjustments column.
  insert into acc_adjusting_entry (journal_entry_id, note, marked_by)
  values (v_entry, left(v_desc, 500), auth.uid())
  on conflict (journal_entry_id) do nothing;

  update acc_stock_count
     set status = 'posted', counted_minor = v_counted, book_minor = v_book, difference_minor = v_diff,
         inventory_account_id = p_inventory_account_id, offset_account_id = p_offset_account_id,
         journal_entry_id = v_entry, posted_by = auth.uid(), posted_at = now()
   where id = p_id;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
  values ('acc_journal_entry', v_entry, 'post', auth.uid(),
          jsonb_build_object('stock_count_id', p_id, 'count_number', v_count.count_number,
                             'as_of', v_count.as_of, 'counted_minor', v_counted,
                             'book_minor', v_book, 'difference_minor', v_diff));

  return v_entry;
end;
$$;

-- ----------------------------------------------------------------------------
-- acc_mark_stock_count_pending — the app calls this once a count has been sent
-- for approval. It checks that the request really is this count's, then freezes
-- the count (a pending count cannot be edited) and links the request.
-- ----------------------------------------------------------------------------
create or replace function acc_mark_stock_count_pending(p_id uuid, p_request_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_count acc_stock_count;
  v_req   acc_approval_request;
begin
  if not acc_is_staff() then raise exception 'Not authorized to submit a stock count'; end if;

  select * into v_count from acc_stock_count where id = p_id for update;
  if not found then raise exception 'Stock count not found'; end if;
  if v_count.status <> 'draft' then
    raise exception 'Only a draft count can be sent for approval; % is %', v_count.count_number, v_count.status;
  end if;

  select * into v_req from acc_approval_request where id = p_request_id;
  if not found
     or v_req.action_key <> 'inventory_adjustment'
     or v_req.status <> 'pending'
     or v_req.payload ->> 'stock_count_id' is distinct from p_id::text then
    raise exception 'That approval request is not a pending request for this stock count';
  end if;

  update acc_stock_count
     set status = 'pending_approval', approval_request_id = p_request_id
   where id = p_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- A request that is rejected (or cancelled) returns its count to draft. An
-- AFTER UPDATE trigger on the request leaves acc_reject_request,
-- acc_cancel_request and every other approval function untouched.
-- ----------------------------------------------------------------------------
create or replace function acc_stock_count_request_closed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.action_key = 'inventory_adjustment'
     and old.status = 'pending'
     and new.status in ('rejected', 'cancelled')
     and new.payload ->> 'stock_count_id' is not null then
    update acc_stock_count
       set status = 'draft', approval_request_id = null
     where id = (new.payload ->> 'stock_count_id')::uuid
       and status = 'pending_approval'
       and approval_request_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists acc_approval_request_stock_count on acc_approval_request;
create trigger acc_approval_request_stock_count
  after update on acc_approval_request
  for each row execute function acc_stock_count_request_closed();

-- ----------------------------------------------------------------------------
-- acc_approve_request — body from 0039_vendor_tax_functions.sql with one extra
-- branch: an inventory_adjustment request whose payload carries stock_count_id
-- posts that count. It sits before the item branch, which is unchanged.
-- Copied mechanically so none of the existing dispatcher can be lost in a retype.
-- ----------------------------------------------------------------------------
create or replace function acc_approve_request(p_request_id uuid, p_note text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_req    acc_approval_request;
  v_policy acc_approval_policy;
  v_p      jsonb;
  v_result uuid;
begin
  if not acc_has_permission('approval.decide') then
    raise exception 'You do not have permission to decide approval requests';
  end if;

  select * into v_req from acc_approval_request where id = p_request_id for update;
  if not found then raise exception 'Approval request not found'; end if;
  if v_req.status <> 'pending' then raise exception 'Request is already %', v_req.status; end if;

  select * into v_policy from acc_approval_policy where action_key = v_req.action_key;
  if v_policy.require_segregation and v_req.requested_by = auth.uid() then
    raise exception 'You cannot approve your own request while segregation of duties is enabled';
  end if;

  v_p := v_req.payload;
  perform set_config('acc.approval_dispatch', 'on', true);

  if v_req.action_key = 'manual_journal' then
    v_result := acc_post_manual_journal(
      (v_p ->> 'entry_date')::date, v_p ->> 'description', v_p ->> 'source_ref',
      v_p ->> 'currency', v_p -> 'lines');
  elsif v_req.action_key = 'write_off' then
    v_result := acc_write_off(
      v_p ->> 'side', (v_p ->> 'target_id')::uuid, (v_p ->> 'offset_account_id')::uuid,
      (v_p ->> 'amount_minor')::bigint, (v_p ->> 'date')::date, v_req.reason);
  elsif v_req.action_key = 'inventory_adjustment' and v_p ->> 'stock_count_id' is not null then
    v_result := acc_post_stock_count(
      (v_p ->> 'stock_count_id')::uuid, (v_p ->> 'inventory_account_id')::uuid,
      (v_p ->> 'offset_account_id')::uuid);
  elsif v_req.action_key = 'inventory_adjustment' then
    v_result := acc_adjust_inventory(
      (v_p ->> 'item_id')::uuid, (v_p ->> 'date')::date, (v_p ->> 'qty_delta')::numeric,
      (v_p ->> 'unit_cost_minor')::bigint, (v_p ->> 'value_delta_minor')::bigint,
      (v_p ->> 'offset_account_id')::uuid, v_req.reason);
  elsif v_req.action_key = 'period_reopen' then
    perform acc_reopen_period((v_p ->> 'period_id')::uuid, v_req.reason);
    v_result := (v_p ->> 'period_id')::uuid;
  elsif v_req.action_key = 'reconciliation_reopen' then
    perform acc_reopen_reconciliation((v_p ->> 'reconciliation_id')::uuid, v_req.reason);
    v_result := (v_p ->> 'reconciliation_id')::uuid;
  elsif v_req.action_key = 'vendor_tax_profile' then
    v_result := acc_save_vendor_tax_profile(
      (v_p ->> 'vendor_id')::uuid,
      (v_p ->> 'w9_status')::acc_w9_status,
      nullif(v_p ->> 'w9_received_date', '')::date,
      nullif(v_p ->> 'w9_expires_date', '')::date,
      nullif(v_p ->> 'classification', '')::acc_tax_classification,
      v_p ->> 'reporting_name',
      v_p ->> 'tin_ref',
      nullif(v_p ->> 'tin_type', '')::acc_tin_type,
      v_p ->> 'address_line1', v_p ->> 'address_line2', v_p ->> 'city',
      v_p ->> 'region', v_p ->> 'postal_code', v_p ->> 'country',
      (v_p ->> 'is_1099_eligible')::boolean,
      v_p ->> 'box_code',
      (v_p ->> 'eligibility_override')::boolean,
      v_p ->> 'override_reason',
      v_req.reason);
  else
    raise exception 'No dispatch defined for %', v_req.action_key;
  end if;

  perform set_config('acc.approval_dispatch', 'off', true);

  update acc_approval_request
     set status = 'approved', decided_by = auth.uid(), decided_at = now(),
         decision_note = p_note, result_id = v_result
   where id = p_request_id;

  insert into acc_audit_log (table_name, record_id, action, actor_id, after_json)
    values ('acc_approval_request', p_request_id, 'post', auth.uid(),
            jsonb_build_object('status', 'approved', 'result_id', v_result, 'note', p_note));
  return v_result;
end;
$$;

-- ----------------------------------------------------------------------------
-- Who may call what
-- ----------------------------------------------------------------------------
revoke all on function acc_inventory_account_ids() from public, anon;
revoke all on function acc_stock_count_default_accounts() from public, anon;
revoke all on function acc_create_stock_count(date) from public, anon;
revoke all on function acc_save_stock_count(uuid, date, text, jsonb) from public, anon;
revoke all on function acc_post_stock_count(uuid, uuid, uuid) from public, anon;
revoke all on function acc_mark_stock_count_pending(uuid, uuid) from public, anon;
revoke all on function acc_stock_count_request_closed() from public, anon, authenticated;
grant execute on function acc_inventory_account_ids() to authenticated, service_role;
grant execute on function acc_stock_count_default_accounts() to authenticated, service_role;
grant execute on function acc_create_stock_count(date) to authenticated, service_role;
grant execute on function acc_save_stock_count(uuid, date, text, jsonb) to authenticated, service_role;
grant execute on function acc_post_stock_count(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function acc_mark_stock_count_pending(uuid, uuid) to authenticated, service_role;
