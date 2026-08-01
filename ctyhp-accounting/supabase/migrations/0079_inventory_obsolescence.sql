-- ============================================================================
-- 0079 — Slow-moving stock, and writing it down when it is worth less than it
-- cost.
--
-- Two things, and the second depends on the first: you cannot review stock for
-- obsolescence without a report that shows how long it has sat, and a review
-- that finds something is only worth doing if the finding can be posted.
--
-- The measurement is **lower of cost and net realisable value** (ASC
-- 330-10-35-1B, as amended by ASU 2015-11). This company is on weighted average
-- cost, so the older lower-of-cost-or-market test with its market ceiling and
-- floor does not apply — that survives only for LIFO and the retail method.
--
-- ASC 330-10-35-14 forbids reversing a write-down in a later period. The
-- database enforces that rather than trusting anyone to remember it.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Where a write-down lands.
--
-- The loss belongs in cost of sales, not below the line: it is a cost of the
-- goods, recognised when their value fell rather than when they sell.
-- ----------------------------------------------------------------------------
insert into acc_account (account_code, name, account_type, is_posting_account, status, currency_code)
select '5090', 'Inventory Write-down', 'cost_of_goods_sold', true, 'active',
       (select code from acc_currency where is_base limit 1)
 where not exists (select 1 from acc_account where account_code = '5090');

create or replace function acc_active_inventory_writedown_account() returns uuid
language sql stable as $$
  select id from acc_account
   where is_posting_account and status = 'active'
     and (account_code = '5090'
          or (account_type = 'cost_of_goods_sold' and name ilike 'inventory write-down%'))
   order by account_code
   limit 1;
$$;

-- ----------------------------------------------------------------------------
-- 2. The write-downs already taken, so none is ever taken twice.
-- ----------------------------------------------------------------------------
create table if not exists acc_inventory_writedown (
  id                uuid primary key default gen_random_uuid(),
  item_id           uuid not null references acc_item (id),
  written_down_on   date not null default current_date,
  qty_on_hand       numeric(20, 4) not null,
  cost_before_minor bigint not null,
  nrv_minor         bigint not null check (nrv_minor >= 0),
  amount_minor      bigint not null check (amount_minor > 0),
  reason            text not null check (length(btrim(reason)) >= 10),
  journal_entry_id  uuid references acc_journal_entry (id),
  created_by        uuid references auth.users (id),
  created_at        timestamptz not null default now()
);
create index if not exists acc_inv_writedown_item_idx on acc_inventory_writedown (item_id);

alter table acc_inventory_writedown enable row level security;
drop policy if exists acc_inv_writedown_sel on acc_inventory_writedown;
create policy acc_inv_writedown_sel on acc_inventory_writedown
  for select using (acc_current_role() is not null);

drop trigger if exists acc_inv_writedown_audit on acc_inventory_writedown;
create trigger acc_inv_writedown_audit
  after insert or update or delete on acc_inventory_writedown
  for each row execute function acc_audit_row_change();

-- ----------------------------------------------------------------------------
-- 3. What a quarterly review reads.
--
-- Every fact the reviewer needs about a line of stock, and nothing derived:
-- how much is on hand, what it cost, when it last moved, how fast it is
-- selling, and what it would fetch. Whether that adds up to "obsolete" is a
-- judgement, and judgements live in lib/domain/inventory-review.ts.
-- ----------------------------------------------------------------------------
create or replace function acc_inventory_review(p_as_of date, p_window_days int default 90)
returns table (
  item_id             uuid,
  item_code           text,
  name                text,
  qty_on_hand         numeric,
  value_minor         bigint,
  unit_cost_minor     bigint,
  sales_price_minor   bigint,
  last_movement_on    date,
  last_sale_on        date,
  qty_sold_in_window  numeric,
  written_down_minor  bigint
)
language sql stable security definer set search_path = public as $$
  with valuation as (
    select * from acc_inventory_valuation(p_as_of)
  )
  select v.item_id, v.item_code, v.name, v.qty_on_hand, v.value_minor, v.unit_cost_minor,
         i.sales_price_minor,
         (select max(t.txn_date) from acc_inventory_txn t
           where t.item_id = v.item_id and t.txn_date <= p_as_of),
         (select max(t.txn_date) from acc_inventory_txn t
           where t.item_id = v.item_id and t.source = 'sale' and t.txn_date <= p_as_of),
         coalesce((select -sum(t.qty_delta) from acc_inventory_txn t
                    where t.item_id = v.item_id and t.source = 'sale'
                      and t.txn_date <= p_as_of
                      and t.txn_date > p_as_of - p_window_days), 0)::numeric,
         coalesce((select sum(w.amount_minor) from acc_inventory_writedown w
                    where w.item_id = v.item_id and w.written_down_on <= p_as_of), 0)::bigint
    from valuation v
    join acc_item i on i.id = v.item_id
   order by v.value_minor desc;
$$;

revoke all on function acc_inventory_review(date, int) from public;
grant execute on function acc_inventory_review(date, int) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 4. Taking the write-down.
--
--     Dr  Inventory Write-down (cost of sales)
--       Cr  Inventory
--
-- Quantity is untouched: the goods are still there, they are simply carried at
-- less. The movement is recorded as an adjustment so the subledger and the
-- control account move together and the reconciliation still ties.
-- ----------------------------------------------------------------------------
create or replace function acc_write_down_inventory(
  p_item_id   uuid,
  p_date      date,
  p_nrv_minor bigint,
  p_reason    text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_item      acc_item;
  v_qty       numeric;
  v_value     bigint;
  v_shortfall bigint;
  v_expense   uuid;
  v_entry     uuid;
begin
  if not acc_is_staff() then raise exception 'Not authorized to write down inventory'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'A reason is required to write down inventory'; end if;
  if p_nrv_minor < 0 then raise exception 'Net realisable value cannot be negative'; end if;

  select * into v_item from acc_item where id = p_item_id for update;
  if not found then raise exception 'Item not found'; end if;
  if not v_item.is_inventory then raise exception 'Item % does not carry inventory', v_item.name; end if;
  if v_item.inventory_account_id is null then
    raise exception 'Item % has no inventory account', v_item.name;
  end if;

  select qty, value_minor into v_qty, v_value from acc_item_on_hand(p_item_id);
  if coalesce(v_qty, 0) <= 0 then
    raise exception 'Item % has nothing on hand to write down', v_item.name;
  end if;

  -- The write-down is the amount by which carrying value exceeds what the
  -- goods would actually fetch. Never the other way round: ASC 330-10-35-14
  -- forbids writing inventory back up once it has been written down.
  v_shortfall := v_value - p_nrv_minor;
  if v_shortfall <= 0 then
    raise exception
      'Net realisable value (%) is not below the carrying value (%); inventory is never written up',
      p_nrv_minor, v_value;
  end if;

  v_expense := acc_active_inventory_writedown_account();
  if v_expense is null then raise exception 'No active Inventory Write-down account configured'; end if;

  v_entry := acc_post_entry(
    p_date,
    'Inventory write-down: ' || v_item.name,
    'inventory', p_item_id,
    (select code from acc_currency where is_base limit 1),
    jsonb_build_array(
      jsonb_build_object('account_id', v_expense, 'debit_minor', v_shortfall, 'credit_minor', 0,
        'amount_base_minor', v_shortfall, 'memo', btrim(p_reason)),
      jsonb_build_object('account_id', v_item.inventory_account_id,
        'debit_minor', 0, 'credit_minor', v_shortfall,
        'amount_base_minor', v_shortfall, 'memo', 'Lower of cost and net realisable value')
    ));

  -- Value falls, quantity does not.
  perform acc_add_inventory_txn(p_item_id, p_date, 'adjustment', p_item_id,
                               0, -v_shortfall, v_entry, null, btrim(p_reason));

  insert into acc_inventory_writedown
    (item_id, written_down_on, qty_on_hand, cost_before_minor, nrv_minor, amount_minor,
     reason, journal_entry_id, created_by)
  values
    (p_item_id, p_date, v_qty, v_value, p_nrv_minor, v_shortfall,
     btrim(p_reason), v_entry, auth.uid());

  return v_entry;
end;
$$;

revoke all on function acc_write_down_inventory(uuid, date, bigint, text) from public;
grant execute on function acc_write_down_inventory(uuid, date, bigint, text) to authenticated, service_role;
