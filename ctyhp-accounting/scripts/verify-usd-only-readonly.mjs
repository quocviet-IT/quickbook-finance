// Read-only audit for the single-currency USD policy.
// Run: node --env-file=.env.local scripts/verify-usd-only-readonly.mjs
import pg from "pg";

const db = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

try {
  await db.connect();
  await db.query("begin read only");
  const columns = await db.query(`
    select table_name, column_name, is_nullable
      from information_schema.columns
     where table_schema = 'public'
       and column_name in ('currency_code', 'base_currency_code')
     order by table_name, column_name
  `);
  const nonUsd = [];
  const nullCurrencies = [];
  for (const column of columns.rows) {
    const table = db.escapeIdentifier(column.table_name);
    const field = db.escapeIdentifier(column.column_name);
    const values = await db.query(`
      select ${field} as currency, count(*)::int as count
        from ${table}
       where ${field} is not null and ${field} <> 'USD'
       group by ${field}
       order by ${field}
    `);
    if (values.rowCount) {
      nonUsd.push({
        table: column.table_name,
        column: column.column_name,
        values: values.rows,
      });
    }
    const nulls = await db.query(`select count(*)::int as count from ${table} where ${field} is null`);
    if (Number(nulls.rows[0].count) > 0) {
      nullCurrencies.push({
        table: column.table_name,
        column: column.column_name,
        count: Number(nulls.rows[0].count),
      });
    }
  }
  const catalog = await db.query(`
    select code, name, is_base
      from acc_currency
     order by code
  `);
  const constraints = await db.query(`
    select count(*)::int as count
      from pg_constraint
     where conname = 'acc_usd_currency_check'
  `);
  console.log(
    JSON.stringify(
      {
        currencyColumns: columns.rowCount,
        columns: columns.rows,
        nonUsd,
        nullCurrencies,
        currencyCatalog: catalog.rows,
        usdConstraints: Number(constraints.rows[0].count),
      },
      null,
      2,
    ),
  );
  await db.query("rollback");
} finally {
  await db.end();
}
