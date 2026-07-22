-- ============================================================================
-- Products & Services: reusable item catalog that prefills invoice/bill lines.
-- Dual-purpose items (sales side and/or purchase side). No inventory tracking.
-- Prices are base-currency (USD) minor-unit amounts. Lines keep their own
-- snapshot; item_id is a nullable link only (no posting/ledger impact).
-- ============================================================================

create table acc_item (
  id                 uuid primary key default gen_random_uuid(),
  item_code          text unique,
  name               text not null,
  description        text not null default '',
  is_sold            boolean not null default true,
  sales_price_minor  bigint not null default 0,
  income_account_id  uuid references acc_account (id),
  sales_tax_code_id  uuid references acc_tax_code (id),
  is_purchased       boolean not null default false,
  purchase_cost_minor bigint not null default 0,
  expense_account_id uuid references acc_account (id),
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index acc_item_active_idx on acc_item (is_active);

alter table acc_invoice_line add column item_id uuid references acc_item (id);
alter table acc_bill_line    add column item_id uuid references acc_item (id);

alter table acc_item enable row level security;
create policy acc_item_read  on acc_item for select using (acc_current_role() is not null);
create policy acc_item_write on acc_item for all using (acc_is_staff()) with check (acc_is_staff());
