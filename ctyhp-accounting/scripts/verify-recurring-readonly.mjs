// Read-only verification for the deployed Recurring Transactions schema.
// Run: node --env-file=.env.local scripts/verify-recurring-readonly.mjs
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
  const tables = await db.query(`
      select table_name
        from information_schema.tables
       where table_schema = 'public'
         and table_name in ('acc_recurring_template', 'acc_recurring_run')
       order by table_name
    `);
  const functions = await db.query(`
      select proname
        from pg_proc
       where pronamespace = 'public'::regnamespace
         and proname in (
           'acc_claim_recurring_run',
           'acc_complete_recurring_run',
           'acc_fail_recurring_run',
           'acc_post_recurring_expense',
           'acc_post_recurring_journal',
           'acc_mark_recurring_approval'
         )
       order by proname
    `);
  const permissions = await db.query(`
      select role::text, allowed
        from acc_role_permission
       where permission_key = 'recurring.manage'
       order by role
    `);
  const links = await db.query(`
      select table_name, column_name
        from information_schema.columns
       where table_schema = 'public'
         and column_name = 'recurring_run_id'
         and table_name in ('acc_invoice', 'acc_bill', 'acc_expense', 'acc_journal_entry')
       order by table_name
    `);
  const dates = await db.query(`
      select
        acc_recurring_next_date('2026-01-31', '2026-01-31', 'monthly', 1)::text as feb,
        acc_recurring_next_date('2026-02-28', '2026-01-31', 'monthly', 1)::text as mar,
        acc_recurring_next_date('2026-07-27', '2026-07-27', 'weekly', 2)::text as fortnight
    `);
  const counts = await db.query(`
      select
        (select count(*)::int from acc_recurring_template) as templates,
        (select count(*)::int from acc_recurring_run) as runs
    `);

  assert(tables.rowCount === 2, "Recurring tables are missing");
  assert(functions.rowCount === 6, "Recurring execution functions are missing");
  assert(links.rowCount === 4, "Typed document links are incomplete");
  assert(permissions.rowCount === 3, "Role permissions are incomplete");
  const rolePermission = Object.fromEntries(
    permissions.rows.map((row) => [row.role, row.allowed]),
  );
  assert(rolePermission.admin === true, "Admin recurring permission is missing");
  assert(rolePermission.accountant === true, "Accountant recurring permission is missing");
  assert(rolePermission.viewer === false, "Viewer must not manage recurring schedules");
  assert(dates.rows[0].feb === "2026-02-28", "Month-end calculation is incorrect");
  assert(dates.rows[0].mar === "2026-03-31", "Month-end anchor drifted");
  assert(dates.rows[0].fortnight === "2026-08-10", "Weekly interval calculation is incorrect");

  console.log(
    JSON.stringify(
      {
        verified: true,
        tables: tables.rows.map((row) => row.table_name),
        functions: functions.rows.map((row) => row.proname),
        linkedDocumentTables: links.rows.map((row) => row.table_name),
        permissions: rolePermission,
        dateCalculation: dates.rows[0],
        liveCounts: counts.rows[0],
        persisted: false,
      },
      null,
      2,
    ),
  );
} finally {
  await db.end();
}
