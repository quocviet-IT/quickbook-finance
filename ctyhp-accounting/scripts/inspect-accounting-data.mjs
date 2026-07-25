// Read-only inventory of accounting data in the configured Supabase database.
// Run: node --env-file=.env.local scripts/inspect-accounting-data.mjs
import pg from "pg";

const db = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

const tables = [
  "acc_customer",
  "acc_vendor",
  "acc_item",
  "acc_purchase_order",
  "acc_goods_receipt",
  "acc_bill",
  "acc_bill_payment",
  "acc_expense",
  "acc_invoice",
  "acc_payment",
  "acc_credit_memo",
  "acc_vendor_credit",
  "acc_bank_account",
  "acc_bank_transaction",
  "acc_journal_entry",
  "acc_journal_line",
  "acc_inventory_txn",
  "acc_tax_payment",
  "acc_budget",
  "acc_budget_line",
];

async function main() {
  await db.connect();

  const existing = new Set(
    (
      await db.query(
        `select table_name
           from information_schema.tables
          where table_schema = 'public' and table_name = any($1::text[])`,
        [tables],
      )
    ).rows.map((row) => row.table_name),
  );

  console.log("Accounting data counts");
  for (const table of tables) {
    if (!existing.has(table)) continue;
    const result = await db.query(`select count(*)::int as count from ${table}`);
    console.log(`  ${table.padEnd(30)} ${result.rows[0].count}`);
  }

  const statuses = await db.query(`
    select 'invoice' as entity, status::text, count(*)::int
      from acc_invoice group by status
    union all
    select 'bill', status::text, count(*)::int
      from acc_bill group by status
    union all
    select 'purchase_order', status::text, count(*)::int
      from acc_purchase_order group by status
    order by entity, status
  `);
  console.log("\nDocument statuses");
  for (const row of statuses.rows) {
    console.log(`  ${row.entity.padEnd(18)} ${row.status.padEnd(12)} ${row.count}`);
  }

  const periods = await db.query(`
    select label, period_start, period_end, status::text
      from acc_accounting_period
     order by period_start
  `);
  console.log("\nAccounting periods");
  console.table(periods.rows);

  const ledger = await db.query(`
    select
      count(distinct e.id)::int as entries,
      coalesce(sum(case when l.debit_minor > 0 then l.amount_base_minor else 0 end), 0)::bigint as debits,
      coalesce(sum(case when l.credit_minor > 0 then l.amount_base_minor else 0 end), 0)::bigint as credits,
      min(e.entry_date) as first_date,
      max(e.entry_date) as last_date
    from acc_journal_entry e
    join acc_journal_line l on l.journal_entry_id = e.id
    where e.status = 'posted'
  `);
  console.log("\nPosted ledger");
  console.table(ledger.rows);

  const inventory = await db.query(`
    select i.item_code, i.name,
           coalesce(sum(t.qty_delta), 0) as quantity_on_hand,
           coalesce(sum(t.cost_delta_minor), 0)::bigint as value_minor
      from acc_item i
      left join acc_inventory_txn t on t.item_id = i.id
     where i.is_inventory
     group by i.id, i.item_code, i.name
     order by i.item_code
  `);
  console.log("\nInventory on hand");
  console.table(inventory.rows);

  const accounts = await db.query(`
    select account_code, name, account_type::text, is_posting_account
      from acc_account
     where status = 'active'
     order by account_code
  `);
  console.log("\nActive chart of accounts");
  console.table(accounts.rows);

  const taxCodes = await db.query(`
    select code, name, rate_percent, direction::text
      from acc_tax_code
     where is_active
     order by code
  `);
  console.log("\nActive tax codes");
  console.table(taxCodes.rows);

  const items = await db.query(`
    select item_code, name, is_sold, is_purchased, is_inventory
      from acc_item
     order by item_code nulls last, name
  `);
  console.log("\nItem catalog");
  console.table(items.rows);
}

main()
  .catch((error) => {
    console.error("Inspection failed:", error.message);
    process.exitCode = 1;
  })
  .finally(() => db.end());
