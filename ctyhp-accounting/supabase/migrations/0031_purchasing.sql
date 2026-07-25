-- ============================================================================
-- Module G1 — Purchase Orders, Receiving, Three-Way Matching (schema).
-- A purchase order is a commitment, not a transaction: nothing here posts to
-- the ledger. Receiving is quantity-only in G1; inventory asset/GRNI postings
-- arrive with Module G2 (inventory valuation).
-- Enums are created here and first used by the RPCs in 0032 (a new enum value
-- cannot be used in the same transaction that adds it).
-- ============================================================================

create type acc_po_status      as enum ('draft', 'open', 'partial', 'received', 'closed', 'cancelled');
create type acc_receipt_status as enum ('posted', 'void');
create type acc_variance_kind  as enum ('price', 'quantity');

-- ----------------------------------------------------------------------------
-- Purchase orders
-- ----------------------------------------------------------------------------
create table acc_purchase_order (
  id             uuid primary key default gen_random_uuid(),
  po_number      text unique,                    -- assigned on approve
  vendor_id      uuid not null references acc_vendor (id),
  order_date     date not null default current_date,
  expected_date  date,
  currency_code  text not null references acc_currency (code),
  ship_to        text,
  memo           text,
  total_minor    bigint not null default 0,
  status         acc_po_status not null default 'draft',
  close_reason   text,
  created_by     uuid references auth.users (id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index acc_po_vendor_idx on acc_purchase_order (vendor_id);
create index acc_po_status_idx on acc_purchase_order (status);

-- qty_received / qty_billed are derived counters maintained ONLY inside the
-- SECURITY DEFINER RPCs in 0032, under row locks. Never written from the app.
create table acc_purchase_order_line (
  id                 uuid primary key default gen_random_uuid(),
  purchase_order_id  uuid not null references acc_purchase_order (id) on delete cascade,
  line_order         int not null default 0,
  item_id            uuid references acc_item (id),
  description        text not null default '',
  quantity           numeric(20, 4) not null check (quantity > 0),
  unit_cost_minor    bigint not null default 0 check (unit_cost_minor >= 0),
  expense_account_id uuid not null references acc_account (id),
  line_total_minor   bigint not null default 0,
  qty_received       numeric(20, 4) not null default 0 check (qty_received >= 0),
  qty_billed         numeric(20, 4) not null default 0 check (qty_billed >= 0),
  is_closed          boolean not null default false
);
create index acc_po_line_po_idx on acc_purchase_order_line (purchase_order_id);

-- ----------------------------------------------------------------------------
-- Goods receipts (a receipt exists as a document; void keeps the history)
-- ----------------------------------------------------------------------------
create table acc_goods_receipt (
  id                uuid primary key default gen_random_uuid(),
  receipt_number    text unique,
  purchase_order_id uuid not null references acc_purchase_order (id),
  vendor_id         uuid not null references acc_vendor (id),
  receipt_date      date not null default current_date,
  memo              text,
  status            acc_receipt_status not null default 'posted',
  void_reason       text,
  created_by        uuid references auth.users (id),
  created_at        timestamptz not null default now()
);
create index acc_receipt_po_idx on acc_goods_receipt (purchase_order_id);

create table acc_goods_receipt_line (
  id                     uuid primary key default gen_random_uuid(),
  goods_receipt_id       uuid not null references acc_goods_receipt (id) on delete cascade,
  purchase_order_line_id uuid not null references acc_purchase_order_line (id),
  quantity               numeric(20, 4) not null check (quantity > 0),
  unit_cost_minor        bigint not null default 0   -- snapshot of PO cost at receipt
);
create index acc_receipt_line_receipt_idx on acc_goods_receipt_line (goods_receipt_id);
create index acc_receipt_line_po_line_idx on acc_goods_receipt_line (purchase_order_line_id);

-- ----------------------------------------------------------------------------
-- Three-way matching configuration (singleton) — tolerances in basis points.
-- Default: 2% price tolerance, 0% quantity tolerance (you may not bill more
-- than you received without an approved exception).
-- ----------------------------------------------------------------------------
create table acc_purchasing_config (
  singleton           boolean primary key default true check (singleton),
  price_tolerance_bps int not null default 200 check (price_tolerance_bps between 0 and 10000),
  qty_tolerance_bps   int not null default 0   check (qty_tolerance_bps between 0 and 10000),
  updated_by          uuid references auth.users (id),
  updated_at          timestamptz not null default now()
);
insert into acc_purchasing_config (singleton) values (true);

-- One row per out-of-tolerance line per conversion: the US-FR-073 audit trail.
-- expected_value/actual_value are unit costs in minor units for kind='price',
-- and quantities for kind='quantity' (received vs cumulative billed).
create table acc_po_variance_exception (
  id                     uuid primary key default gen_random_uuid(),
  bill_id                uuid not null references acc_bill (id) on delete cascade,
  purchase_order_id      uuid not null references acc_purchase_order (id),
  purchase_order_line_id uuid not null references acc_purchase_order_line (id),
  kind                   acc_variance_kind not null,
  expected_value         numeric(20, 4) not null default 0,
  actual_value           numeric(20, 4) not null default 0,
  variance_bps           int not null default 0,
  reason                 text not null,
  approved_by            uuid references auth.users (id),
  created_at             timestamptz not null default now()
);
create index acc_po_variance_bill_idx on acc_po_variance_exception (bill_id);
create index acc_po_variance_po_idx   on acc_po_variance_exception (purchase_order_id);

-- ----------------------------------------------------------------------------
-- PO -> receipt -> bill traceability on the existing bill tables.
-- All nullable: historical bills are unaffected. quantity/unit_cost_minor make
-- a price variance computable; amount_minor stays the posted amount.
-- ----------------------------------------------------------------------------
alter table acc_bill      add column purchase_order_id uuid references acc_purchase_order (id);
alter table acc_bill_line add column purchase_order_line_id uuid references acc_purchase_order_line (id);
alter table acc_bill_line add column goods_receipt_line_id  uuid references acc_goods_receipt_line (id);
alter table acc_bill_line add column quantity        numeric(20, 4);
alter table acc_bill_line add column unit_cost_minor bigint;
create index acc_bill_po_idx on acc_bill (purchase_order_id);
create index acc_bill_line_po_line_idx on acc_bill_line (purchase_order_line_id);

-- ----------------------------------------------------------------------------
-- Sequences
-- ----------------------------------------------------------------------------
insert into acc_sequence (key, prefix, next_value) values
  ('purchase_order', 'PO-', 1),
  ('goods_receipt',  'GR-', 1);

-- ----------------------------------------------------------------------------
-- RLS: read for any role, writes for staff (mutations go through the
-- SECURITY DEFINER RPCs in 0032). Config is admin-only. Variance exceptions
-- are insert-only via the conversion RPC and deliberately never deletable.
-- ----------------------------------------------------------------------------
alter table acc_purchase_order       enable row level security;
alter table acc_purchase_order_line  enable row level security;
alter table acc_goods_receipt        enable row level security;
alter table acc_goods_receipt_line   enable row level security;
alter table acc_purchasing_config    enable row level security;
alter table acc_po_variance_exception enable row level security;

create policy acc_po_read  on acc_purchase_order for select using (acc_current_role() is not null);
create policy acc_po_write on acc_purchase_order for all using (acc_is_staff()) with check (acc_is_staff());

create policy acc_po_line_read  on acc_purchase_order_line for select using (acc_current_role() is not null);
create policy acc_po_line_write on acc_purchase_order_line for all using (acc_is_staff()) with check (acc_is_staff());

create policy acc_receipt_read  on acc_goods_receipt for select using (acc_current_role() is not null);
create policy acc_receipt_write on acc_goods_receipt for all using (acc_is_staff()) with check (acc_is_staff());

create policy acc_receipt_line_read  on acc_goods_receipt_line for select using (acc_current_role() is not null);
create policy acc_receipt_line_write on acc_goods_receipt_line for all using (acc_is_staff()) with check (acc_is_staff());

create policy acc_purchasing_config_read  on acc_purchasing_config for select using (acc_current_role() is not null);
create policy acc_purchasing_config_write on acc_purchasing_config for all using (acc_is_admin()) with check (acc_is_admin());

create policy acc_po_variance_read on acc_po_variance_exception for select using (acc_current_role() is not null);
