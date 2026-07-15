// One-off: remove any stray journal entries (e.g. created while verifying the
// role-guard bug) and reset the journal sequence. Safe only on a fresh DB with
// no real ledger data.
// Run: node --env-file=.env.local scripts/cleanup-test-ledger.mjs
import pg from "pg";

const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await client.connect();
  await client.query("begin");
  // Void first so the posted-line immutability trigger permits deletion.
  await client.query("update acc_journal_entry set status = 'void'");
  await client.query("delete from acc_journal_line");
  await client.query("delete from acc_journal_entry");
  await client.query("update acc_sequence set next_value = 1 where key = 'journal_entry'");
  await client.query("commit");
  const n = (await client.query("select count(*)::int c from acc_journal_entry")).rows[0].c;
  console.log(`Cleanup done. Journal entries remaining: ${n}`);
}

main()
  .catch(async (e) => {
    await client.query("rollback").catch(() => {});
    console.error("Cleanup error:", e.message);
    process.exitCode = 1;
  })
  .finally(() => client.end());
