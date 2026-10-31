// Seal every stored bank feed token again with the current key (2.96).
//
// Bank feed tokens are sealed with BANK_FEED_ENCRYPTION_KEY and name the key
// that sealed them (lib/domain/bank-token-seal.ts). This opens each one, in
// every company, with the current key or a previous one, and seals it again
// with the current key for its own Plaid item. Run it:
//
//   * once after 2.96 is deployed, to move the v1 tokens to v2;
//   * after rotating: new key in BANK_FEED_ENCRYPTION_KEY, the old one in
//     BANK_FEED_ENCRYPTION_KEY_PREVIOUS, deploy, run this, then remove the
//     previous key everywhere.
//
// Without --commit it only reports what it would do. With it, all companies
// are written in one transaction: either every token is resealed or none is.
// A token no key opens stops the run and changes nothing; it is reported by
// company and connection id, never by its contents.
//
// Run: node --env-file=.env.local scripts/reseal-bank-tokens.mjs [--commit]
import pg from "pg";
import { needsReseal, openBankToken, sealBankToken } from "../lib/domain/bank-token-seal.ts";

const commit = process.argv.includes("--commit");
const url = process.env.SUPABASE_DB_URL;
const current = process.env.BANK_FEED_ENCRYPTION_KEY?.trim() ?? "";
const previous = (process.env.BANK_FEED_ENCRYPTION_KEY_PREVIOUS ?? "")
  .split(",")
  .map((secret) => secret.trim())
  .filter((secret) => secret.length >= 32);

if (!url) {
  console.error("SUPABASE_DB_URL is not set (use node --env-file=.env.local).");
  process.exit(1);
}
if (current.length < 32) {
  console.error("BANK_FEED_ENCRYPTION_KEY must be set, at least 32 characters, to the key tokens should be sealed with.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30_000 });
await client.connect();
let failed = false;
try {
  await client.query("begin");
  await client.query("set local statement_timeout = '60s'");
  await client.query("set local idle_in_transaction_session_timeout = '60s'");
  const schemas = (
    await client.query("select schema_name from onebook.company where status = 'active' order by display_order")
  ).rows.map((row) => row.schema_name);

  let total = 0;
  let resealed = 0;
  for (const schema of schemas) {
    const exists = (await client.query("select to_regclass($1) is not null as ok", [`${schema}.acc_bank_connection_secret`])).rows[0].ok;
    if (!exists) continue;
    const rows = (
      await client.query(
        `select c.id, c.provider_item_id, s.encrypted_access_token
           from ${schema}.acc_bank_connection c
           join ${schema}.acc_bank_connection_secret s on s.connection_id = c.id
          order by c.created_at
          for update of s`,
      )
    ).rows;
    let here = 0;
    for (const row of rows) {
      total++;
      if (!needsReseal(row.encrypted_access_token, current)) continue;
      let plain;
      try {
        plain = openBankToken(row.encrypted_access_token, [current, ...previous], row.provider_item_id);
      } catch (error) {
        failed = true;
        console.error(`FAIL ${schema} connection ${row.id}: ${error.message}`);
        continue;
      }
      const sealed = sealBankToken(plain, current, row.provider_item_id);
      // Proved before it is written: the new token opens to the same value.
      if (openBankToken(sealed, [current], row.provider_item_id) !== plain) {
        failed = true;
        console.error(`FAIL ${schema} connection ${row.id}: the resealed token did not open`);
        continue;
      }
      await client.query(
        `update ${schema}.acc_bank_connection_secret
            set encrypted_access_token = $2, token_version = 2, updated_at = now()
          where connection_id = $1`,
        [row.id, sealed],
      );
      here++;
    }
    resealed += here;
    if (rows.length) console.log(`${schema.padEnd(14)} ${rows.length} connection(s), ${here} to reseal`);
  }

  if (failed) {
    await client.query("rollback");
    console.error("\nNothing was changed: at least one token could not be opened. Is the key that sealed it in BANK_FEED_ENCRYPTION_KEY_PREVIOUS?");
    process.exitCode = 1;
  } else if (commit) {
    await client.query("commit");
    console.log(`\nResealed ${resealed} of ${total} token(s) with the current key.`);
  } else {
    await client.query("rollback");
    console.log(`\nDry run: ${resealed} of ${total} token(s) would be resealed. Run again with --commit to write them.`);
  }
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  console.error(`Stopped, nothing changed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
