// End-to-end Fixed Assets posting verification. All writes run inside one
// transaction and are rolled back, leaving the live database unchanged.
// Run: node --env-file=.env.local scripts/verify-fixed-assets-lifecycle-rollback.mjs
import pg from "pg";

const db = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  await db.connect();
  await db.query("begin");

  const admin = await db.query(`
    select id
      from acc_app_user
     where role = 'admin' and status = 'active'
     order by created_at
     limit 1
  `);
  assert(admin.rowCount === 1, "No active admin user is available for the rollback test");
  await db.query(
    `select set_config(
      'request.jwt.claims',
      json_build_object('sub', $1::text, 'role', 'authenticated')::text,
      true
    )`,
    [admin.rows[0].id],
  );

  const accounts = await db.query(`
    select account_code, id
      from acc_account
     where account_code in ('1000', '1500', '1590', '6800', '7990', '8990')
       and status = 'active'
       and is_posting_account
  `);
  const account = Object.fromEntries(accounts.rows.map((row) => [row.account_code, row.id]));
  for (const code of ["1000", "1500", "1590", "6800", "7990", "8990"]) {
    assert(account[code], `Required test account ${code} is missing`);
  }

  const dates = await db.query(`
    select
      to_char(date_trunc('month', current_date) - interval '2 months', 'YYYY-MM-DD') as in_service,
      to_char(date_trunc('month', current_date) - interval '1 month' - interval '1 day', 'YYYY-MM-DD') as opening_as_of,
      to_char(date_trunc('month', current_date) - interval '1 day', 'YYYY-MM-DD') as posting_through
  `);
  const { in_service: inService, opening_as_of: openingAsOf, posting_through: postingThrough } =
    dates.rows[0];

  // Open only the two historical periods inside this throwaway transaction.
  await db.query(
    `update acc_accounting_period
        set status = 'open'
      where period_start <= $2::date
        and period_end >= $1::date`,
    [inService, postingThrough],
  );

  const importRows = [
    {
      name: "ROLLBACK TEST — Jewelry Workshop Equipment",
      description: "End-to-end Fixed Assets verification; transaction is rolled back",
      category: "Jewelry Production Equipment",
      serial_number: "ROLLBACK-TEST",
      location: "Test workshop",
      acquisition_date: inService,
      in_service_date: inService,
      currency_code: "USD",
      cost_minor: 120_000,
      salvage_value_minor: 0,
      useful_life_months: 12,
      depreciation_method: "straight_line",
      asset_account_id: account["1500"],
      accumulated_depreciation_account_id: account["1590"],
      depreciation_expense_account_id: account["6800"],
      vendor_id: null,
      opening_accumulated_depreciation_minor: 10_000,
      opening_as_of_date: openingAsOf,
      notes: "Rollback verification",
    },
  ];
  const imported = await db.query(
    `select * from acc_import_fixed_assets($1::jsonb, true)`,
    [JSON.stringify(importRows)],
  );
  assert(Number(imported.rows[0].imported_count) === 1, "Asset import did not create one asset");
  assert(
    Number(imported.rows[0].opening_journal_count) === 1,
    "Opening balance journal was not posted",
  );

  const asset = await db.query(`
    select *
      from acc_fixed_asset
     where serial_number = 'ROLLBACK-TEST'
  `);
  assert(asset.rowCount === 1, "Imported rollback-test asset was not found");
  const assetId = asset.rows[0].id;
  const scheduleAfterImport = await db.query(
    `select sequence_number, period_end, planned_amount_minor, posted_amount_minor, status
       from acc_asset_depreciation_schedule
      where asset_id = $1::uuid
      order by sequence_number`,
    [assetId],
  );

  const batch = await db.query(
    `select * from acc_post_asset_depreciation_batch(array[$1::uuid], $2::date)`,
    [assetId, postingThrough],
  );
  assert(Number(batch.rows[0].posted_asset_count) === 1, "Batch did not post the asset");
  assert(
    Number(batch.rows[0].posted_period_count) === 1,
    `Batch did not post one period: ${JSON.stringify({
      dates: { inService, openingAsOf, postingThrough },
      batch: batch.rows[0],
      scheduleAfterImport: scheduleAfterImport.rows.slice(0, 3),
    })}`,
  );
  assert(
    Number(batch.rows[0].posted_total_minor) === 10_000,
    `Batch amount is incorrect: ${JSON.stringify(batch.rows[0])}`,
  );

  const disposal = await db.query(
    `select * from acc_dispose_fixed_asset(
      $1::uuid, $2::date, 95000, 5000, $3::uuid, $4::uuid, $5::uuid,
      'Rollback lifecycle verification'
    )`,
    [assetId, postingThrough, account["1000"], account["7990"], account["8990"]],
  );
  assert(Number(disposal.rows[0].net_book_value_minor) === 100_000, "Net book value is incorrect");
  assert(Number(disposal.rows[0].net_proceeds_minor) === 90_000, "Net proceeds are incorrect");
  assert(Number(disposal.rows[0].gain_loss_minor) === -10_000, "Disposal loss is incorrect");

  const checks = await db.query(
    `
      select
        a.status,
        a.disposal_journal_entry_id is not null as has_disposal_journal,
        count(*) filter (where s.status = 'opening')::int as opening_rows,
        count(*) filter (where s.status = 'posted')::int as posted_rows,
        count(*) filter (where s.status = 'cancelled')::int as cancelled_rows
      from acc_fixed_asset a
      join acc_asset_depreciation_schedule s on s.asset_id = a.id
      where a.id = $1::uuid
      group by a.id
    `,
    [assetId],
  );
  assert(checks.rows[0].status === "disposed", "Asset status was not changed to disposed");
  assert(checks.rows[0].has_disposal_journal, "Disposal journal link is missing");
  assert(Number(checks.rows[0].opening_rows) === 1, "Opening schedule allocation is incorrect");
  assert(Number(checks.rows[0].posted_rows) === 1, "Posted schedule count is incorrect");
  assert(Number(checks.rows[0].cancelled_rows) === 10, "Future schedule cancellation is incorrect");

  const unbalanced = await db.query(
    `
      select count(*)::int as count
        from (
          select e.id
            from acc_journal_entry e
            join acc_journal_line l on l.journal_entry_id = e.id
           where e.source_id = $1::uuid
           group by e.id
          having sum(l.debit_minor) <> sum(l.credit_minor)
        ) bad
    `,
    [assetId],
  );
  assert(Number(unbalanced.rows[0].count) === 0, "A lifecycle journal entry is unbalanced");

  console.log(
    JSON.stringify(
      {
        verified: true,
        lifecycle: {
          importedAssets: Number(imported.rows[0].imported_count),
          openingJournals: Number(imported.rows[0].opening_journal_count),
          batchPeriods: Number(batch.rows[0].posted_period_count),
          batchTotalMinor: Number(batch.rows[0].posted_total_minor),
          netBookValueMinor: Number(disposal.rows[0].net_book_value_minor),
          netProceedsMinor: Number(disposal.rows[0].net_proceeds_minor),
          gainLossMinor: Number(disposal.rows[0].gain_loss_minor),
          finalStatus: checks.rows[0].status,
          futurePeriodsCancelled: Number(checks.rows[0].cancelled_rows),
          unbalancedEntries: Number(unbalanced.rows[0].count),
        },
        persisted: false,
      },
      null,
      2,
    ),
  );
  await db.query("rollback");
} catch (error) {
  try {
    await db.query("rollback");
  } catch {
    // Ignore rollback errors and preserve the original failure.
  }
  throw error;
} finally {
  await db.end();
}
