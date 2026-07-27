// Read-only deployment check for bank feeds and the complete Fixed Assets
// lifecycle (migrations 0045-0050).
// Run: node --env-file=.env.local scripts/verify-bank-feed-assets-readonly.mjs
import pg from "pg";

const db = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

try {
  await db.connect();
  await db.query("begin read only");
  const counts = await db.query(`
    select
      (select count(*) from acc_bank_connection) as bank_connections,
      (select count(*) from acc_fixed_asset) as fixed_assets,
      (select count(*) from acc_asset_depreciation_schedule) as schedules,
      (select count(*) from acc_bank_transaction where source = 'file_upload') as migrated_file_rows,
      (
        select count(*)
          from acc_journal_entry e
          join (
            select journal_entry_id, sum(debit_minor) as debit, sum(credit_minor) as credit
              from acc_journal_line
             group by journal_entry_id
          ) lines on lines.journal_entry_id = e.id
         where lines.debit <> lines.credit
      ) as unbalanced_entries
  `);
  const accounts = await db.query(`
    select account_code, name, account_type
      from acc_account
     where account_code in ('1590', '6800', '7990', '8990')
     order by account_code
  `);
  const migrations = await db.query(`
    select filename
      from acc_schema_migrations
     where filename >= '0045'
     order by filename
  `);
  const policies = await db.query(`
    select tablename, count(*)::int as policy_count
      from pg_policies
     where tablename in (
       'acc_bank_connection',
       'acc_bank_connection_secret',
       'acc_bank_feed_account',
       'acc_bank_feed_sync_run',
       'acc_fixed_asset',
       'acc_asset_depreciation_schedule'
     )
     group by tablename
     order by tablename
  `);
  const fixedAssetLedger = await db.query(`
    select a.account_code, a.name,
           coalesce(sum(case when e.status = 'posted' then l.debit_minor - l.credit_minor else 0 end), 0) as balance_minor
      from acc_account a
      left join acc_journal_line l on l.account_id = a.id
      left join acc_journal_entry e on e.id = l.journal_entry_id
     where a.account_type = 'fixed_asset'
     group by a.id, a.account_code, a.name
     order by a.account_code
  `);
  const fixedAssetRegister = await db.query(`
    select
      coalesce(sum(cost_minor), 0) as register_cost_minor,
      coalesce((
        select sum(posted_amount_minor)
          from acc_asset_depreciation_schedule
      ), 0) as accumulated_depreciation_minor,
      coalesce(sum(cost_minor), 0) - coalesce((
        select sum(posted_amount_minor)
          from acc_asset_depreciation_schedule
      ), 0) as net_book_value_minor,
      count(*) filter (where status = 'disposed') as disposed_assets,
      count(*) filter (
        where opening_accumulated_depreciation_minor > 0
          and opening_as_of_date is null
      ) as invalid_opening_assets,
      count(*) filter (
        where status = 'disposed'
          and disposal_journal_entry_id is null
      ) as invalid_disposals
    from acc_fixed_asset
  `);
  const grants = await db.query(`
    select
      has_function_privilege('anon', 'acc_get_bank_connection_token(uuid)', 'EXECUTE') as anon_can_read_token,
      has_function_privilege('authenticated', 'acc_get_bank_connection_token(uuid)', 'EXECUTE') as user_can_read_encrypted_token,
      has_function_privilege('anon', 'acc_post_asset_depreciation(uuid,date)', 'EXECUTE') as anon_can_post_depreciation,
      has_function_privilege('authenticated', 'acc_post_asset_depreciation(uuid,date)', 'EXECUTE') as user_can_request_depreciation,
      has_function_privilege('anon', 'acc_post_asset_depreciation_batch(uuid[],date)', 'EXECUTE') as anon_can_post_batch,
      has_function_privilege('authenticated', 'acc_post_asset_depreciation_batch(uuid[],date)', 'EXECUTE') as user_can_request_batch,
      has_function_privilege('anon', 'acc_import_fixed_assets(jsonb,boolean)', 'EXECUTE') as anon_can_import_assets,
      has_function_privilege('authenticated', 'acc_import_fixed_assets(jsonb,boolean)', 'EXECUTE') as user_can_request_import,
      has_function_privilege('anon', 'acc_dispose_fixed_asset(uuid,date,bigint,bigint,uuid,uuid,uuid,text)', 'EXECUTE') as anon_can_dispose_assets,
      has_function_privilege('authenticated', 'acc_dispose_fixed_asset(uuid,date,bigint,bigint,uuid,uuid,uuid,text)', 'EXECUTE') as user_can_request_disposal,
      has_function_privilege('authenticated', 'acc_apply_asset_opening(uuid,bigint,date,boolean)', 'EXECUTE') as user_can_call_private_opening_helper
  `);
  const permissions = await db.query(`
    select role, permission_key, allowed
      from acc_role_permission
     where permission_key in (
       'fixed_assets.manage',
       'fixed_assets.post',
       'fixed_assets.import',
       'fixed_assets.dispose'
     )
     order by permission_key, role
  `);
  console.log(JSON.stringify({
    counts: counts.rows[0],
    accounts: accounts.rows,
    migrations: migrations.rows,
    policies: policies.rows,
    fixedAssetLedger: fixedAssetLedger.rows,
    fixedAssetRegister: fixedAssetRegister.rows[0],
    grants: grants.rows[0],
    permissions: permissions.rows,
  }, null, 2));
  await db.query("rollback");
} finally {
  await db.end();
}
