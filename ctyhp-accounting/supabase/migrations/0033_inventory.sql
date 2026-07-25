-- ============================================================================
-- Module G2 — Inventory quantity and valuation (schema).
--
-- Costing method: weighted average cost (moving average), derived from the
-- subledger below. Receiving an inventory item recognizes an asset before the
-- vendor's bill exists, so it credits GRNI (Goods Received Not Invoiced); the
-- bill then debits GRNI at the SAME purchase-order cost, which is why GRNI
-- carries only genuinely un-billed receipts and never a price difference.
--
-- Enum values are added here and first used by the functions in 0034 (a new
-- enum value cannot be used in the transaction that adds it).
-- ============================================================================

create type acc_inventory_source as enum ('receipt', 'bill_variance', 'sale', 'adjustment', 'reversal');

alter type acc_journal_source add value if not exists 'goods_receipt';
alter type acc_journal_source add value if not exists 'inventory';
alter type acc_journal_source add value if not exists 'inventory_adjustment';

-- ----------------------------------------------------------------------------
-- Inventory items. An inventory item must be both purchased and sold and must
-- carry an asset account and a COGS account (enforced by the Zod schema and by
-- the posting functions, which refuse to post without them).
-- ----------------------------------------------------------------------------
alter table acc_item add column is_inventory        boolean not null default false;
alter table acc_item add column inventory_account_id uuid references acc_account (id);
alter table acc_item add column cogs_account_id      uuid references acc_account (id);

-- ----------------------------------------------------------------------------
-- The inventory subledger: every movement, with the running pair it produced.
-- Insert-only, and only through acc_add_inventory_txn (SECURITY DEFINER) — there
-- is deliberately no client write policy. `seq` is the order movements were
-- applied in; the as-of valuation sums by txn_date instead, so a back-dated
-- movement still reports correctly.
-- ----------------------------------------------------------------------------
create table acc_inventory_txn (
  id                  uuid primary key default gen_random_uuid(),
  seq                 bigserial not null,
  item_id             uuid not null references acc_item (id),
  txn_date            date not null default current_date,
  source              acc_inventory_source not null,
  source_id           uuid,
  qty_delta           numeric(20, 4) not null,
  cost_delta_minor    bigint not null,             -- base currency, signed
  running_qty         numeric(20, 4) not null check (running_qty >= 0),
  running_value_minor bigint not null,
  journal_entry_id    uuid references acc_journal_entry (id),
  reversal_of         uuid references acc_inventory_txn (id),
  memo                text,
  created_by          uuid references auth.users (id),
  created_at          timestamptz not null default now()
);
create index acc_inventory_txn_item_seq_idx  on acc_inventory_txn (item_id, seq);
create index acc_inventory_txn_item_date_idx on acc_inventory_txn (item_id, txn_date);
create index acc_inventory_txn_entry_idx     on acc_inventory_txn (journal_entry_id);

-- The explicit marker that tells acc_post_bill a line is a correction to an
-- item's cost rather than an expense.
alter table acc_bill_line add column is_inventory_variance boolean not null default false;

-- ----------------------------------------------------------------------------
-- Goods Received Not Invoiced: the accrual a receipt credits and its bill
-- debits. Seeded only if the chart does not already have the code.
-- ----------------------------------------------------------------------------
insert into acc_account (account_code, name, account_type, currency_code, is_posting_account, status)
select '2150', 'Goods Received Not Invoiced', 'current_liability'::acc_account_type,
       (select code from acc_currency where is_base), true, 'active'::acc_account_status
on conflict (account_code) do nothing;

-- ----------------------------------------------------------------------------
-- RLS: read for any role. No write policy on the subledger at all.
-- ----------------------------------------------------------------------------
alter table acc_inventory_txn enable row level security;
create policy acc_inventory_txn_read on acc_inventory_txn
  for select using (acc_current_role() is not null);
