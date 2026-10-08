/**
 * Behavioural verification of migration 0137 on every company's books.
 *
 * Each company runs inside its own transaction that is ALWAYS rolled back.
 * When 0137 has not been applied it is applied first, inside that transaction,
 * and the simulated bank connection, its syncs and their lines are made there
 * too — through the same functions the app calls — so nothing is left behind
 * and Plaid is never called. A refusal is tried inside a savepoint, so the
 * books it is tried on stay as they were.
 *
 * Run: node --env-file=.env.local scripts/verify-bank-feed-undo.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0137_bank_feed_disconnect_undo.sql";
const MIGRATION = readFileSync(new URL(`../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const OUTSIDER = "00000000-0000-0000-0000-000000000000";

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const killer = setTimeout(() => {
  console.error("HARD TIMEOUT");
  process.exit(2);
}, 15 * 60 * 1000);
await client.connect();

let passed = 0;
let failed = 0;
function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
const one = async (sql, params) => (await client.query(sql, params)).rows[0];
const all = async (sql, params) => (await client.query(sql, params)).rows;
const as = (userId) =>
  client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
/** Runs `sql`, expecting the database to refuse it with a message holding `expect`; the books are left as they were. */
async function refused(label, sql, params, expect) {
  await client.query("savepoint refusal");
  try {
    await client.query(sql, params);
    check(label, false, "it was accepted");
  } catch (error) {
    check(label, error.message.includes(expect), error.message);
  } finally {
    await client.query("rollback to savepoint refusal");
  }
}
/** Runs `body` as the database owner, then goes back to being `userId`. */
async function asOwner(userId, body) {
  await client.query("reset role");
  try {
    await body();
  } finally {
    await client.query("set local role authenticated");
    await as(userId);
  }
}

const { rows: companies } = await client.query(
  `select schema_name from onebook.company where status = 'active' order by display_order, schema_name`,
);

const line = (id, date, minor, description, account = "acc-verify-1") => ({
  external_transaction_id: id,
  provider_account_id: account,
  txn_date: date,
  description,
  reference: "",
  amount_minor: minor,
  running_balance_minor: "",
  raw_line: description,
  raw_hash: `verify-0137-${id}-${minor}`,
  pending: false,
});

try {
  for (const { schema_name: schema } of companies) {
    console.log(`\n${schema}`);
    await client.query("begin");
    try {
      await client.query("set local lock_timeout = '5s'");
      await client.query(`set local search_path = ${schema}, extensions`);
      const statements = schema === "public" ? [MIGRATION] : planCompanySchema([{ file: FILE, sql: MIGRATION }], schema).statements;
      const applied = (await client.query(`select 1 from acc_schema_migrations where filename = $1`, [FILE])).rowCount > 0;
      if (!applied) {
        for (const statement of statements) await client.query(statement);
        console.log("  (0137 applied inside the transaction, never committed)");
      }
      for (const statement of statements) await client.query(statement);
      check("applying 0137 a second time is harmless", true);

      const admin = await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`);
      const viewer = await one(`select id from acc_app_user where role = 'viewer' and status = 'active' order by created_at limit 1`);
      const base = await one(`select code from acc_currency where is_base limit 1`);
      if (!admin || !base) {
        console.log("  (no active administrator or base currency; skipped)");
        continue;
      }

      // ---- a bank account, connected through a simulated Plaid item
      const gl = (await one(
        `insert into acc_account (account_code, name, account_type, currency_code, is_posting_account)
         values ('ZZ-VERIFY-FEED', 'Verify bank feed', 'bank', $1, true) returning id`,
        [base.code],
      )).id;
      const bank = (await one(
        `insert into acc_bank_account (account_id, bank_name, currency_code) values ($1, 'Verify Feed Bank', $2) returning id`,
        [gl, base.code],
      )).id;

      await client.query("set local role authenticated");
      await as(admin.id);
      const mapping = (providerAccount) =>
        JSON.stringify([{ bank_account_id: bank, provider_account_id: providerAccount, account_name: "Verify checking", currency_code: base.code }]);
      const conn = (await one(`select acc_save_bank_connection('item-verify-1', 'ins_verify', 'Verify Institution', 'not-a-real-token', $1::jsonb) as id`, [
        mapping("acc-verify-1"),
      ])).id;

      const begin = async (connection = conn) => (await one(`select acc_begin_bank_feed_sync($1) as id`, [connection])).id;
      const APPLY = `select acc_apply_bank_feed_page($1, $2, $3::jsonb, $4::jsonb, $5::jsonb) as out`;
      const apply = async (run, added = [], modified = [], removed = [], connection = conn) =>
        (await one(APPLY, [connection, run, JSON.stringify(added), JSON.stringify(modified), JSON.stringify(removed)])).out;
      const finish = (run, error = null) => client.query(`select acc_finish_bank_feed_sync($1, 'cursor-after', 0, 0, 0, 0, $2)`, [run, error]);
      const txn = async (ext) =>
        one(`select id, status::text, provider_removed_at from acc_bank_transaction where external_transaction_id = $1 and bank_account_id = $2 order by provider_revision desc limit 1`, [ext, bank]);
      const activeLines = async () =>
        Number((await one(`select count(*) as n from acc_bank_transaction where bank_account_id = $1 and provider_removed_at is null`, [bank])).n);

      // ---- run 1 adds three lines
      const run1 = await begin();
      await refused("a page for another connection's run is refused", APPLY,
        [OUTSIDER, run1, "[]", "[]", "[]"], "is not running for this bank connection");
      const out1 = await apply(run1, [line("e1", "2026-09-01", 1000, "DEPOSIT ONE"), line("e2", "2026-09-02", -200, "CARD TWO"), line("e3", "2026-09-03", -300, "CARD THREE")]);
      await finish(run1);
      check("run 1 adds three lines", out1.added === 3, JSON.stringify(out1));
      const changes1 = await all(`select kind, count(*)::int as n from acc_bank_feed_sync_change where run_id = $1 group by kind`, [run1]);
      check("…and records three added lines", JSON.stringify(changes1) === JSON.stringify([{ kind: "added", n: 3 }]), JSON.stringify(changes1));
      await refused("a page for a finished run is refused", APPLY, [conn, run1, "[]", "[]", "[]"], "is not running for this bank connection");

      // A person ignores e3 before run 2.
      const e3 = await txn("e3");
      await asOwner(admin.id, () => client.query(`update acc_bank_transaction set status = 'ignored' where id = $1`, [e3.id]));

      // ---- run 2 modifies e2, removes e3, adds e4
      const run2 = await begin();
      const out2 = await apply(run2, [line("e4", "2026-09-04", 450, "DEPOSIT FOUR")], [line("e2", "2026-09-02", -250, "CARD TWO CORRECTED")], ["e3"]);
      await finish(run2);
      check("run 2 adds one, modifies one, removes one", out2.added === 1 && out2.modified === 1 && out2.removed === 1, JSON.stringify(out2));
      const changes2 = await all(
        `select c.kind, t.external_transaction_id as ext, c.prior_status::text as prior
           from acc_bank_feed_sync_change c join acc_bank_transaction t on t.id = c.bank_transaction_id
          where c.run_id = $1 order by c.kind, t.external_transaction_id, t.provider_revision`,
        [run2],
      );
      check(
        "…and records two added and two retired, each retired with its status before",
        JSON.stringify(changes2) ===
          JSON.stringify([
            { kind: "added", ext: "e2", prior: null },
            { kind: "added", ext: "e4", prior: null },
            { kind: "retired", ext: "e2", prior: "unmatched" },
            { kind: "retired", ext: "e3", prior: "ignored" },
          ]),
        JSON.stringify(changes2),
      );

      // ---- run 3 changes nothing
      const run3 = await begin();
      await apply(run3);
      await finish(run3);

      // ---- the list the screen shows
      const SYNCS = `select run_id, status, changes, is_newest, locked_lines from acc_bank_feed_syncs($1)`;
      const listed = await all(SYNCS, [bank]);
      check("the list shows the two syncs that changed something, newest first", listed.length === 2 && listed[0].run_id === run2 && listed[1].run_id === run1,
        JSON.stringify(listed.map((r) => r.run_id === run2 ? "run2" : r.run_id === run1 ? "run1" : r.run_id)));
      check("…run 2 is the one to undo, run 1 waits for it", listed[0].is_newest === true && listed[1].is_newest === false, JSON.stringify(listed));
      // e3, which a person ignored, was retired by run 2: it holds run 1 only once run 2 is undone and it is back.
      check("…and a line a later sync retired does not count against run 1 yet", listed[1].locked_lines === 0, JSON.stringify(listed[1]));

      // ---- what undo refuses
      const UNDO = `select acc_undo_bank_feed_sync($1, $2) as out`;
      await refused("undo without a reason is refused", UNDO, [run2, " "], "Say why this sync is being undone");
      await refused("an older sync waits for the newer one", UNDO, [run1, "verify"], "Undo the newer syncs of this bank connection first");
      await refused("a sync that changed nothing has nothing to undo", UNDO, [run3, "verify"], "changed nothing");
      await refused("an unknown sync is refused", UNDO, [OUTSIDER, "verify"], "Bank-feed sync not found");
      const e4 = await txn("e4");
      await client.query("savepoint coded");
      await asOwner(admin.id, () => client.query(`update acc_bank_transaction set status = 'matched' where id = $1`, [e4.id]));
      await refused("a sync whose line was coded is refused, with the count", UNDO, [run2, "verify"], "1 line(s) of this sync have been matched, coded or ignored");
      await client.query("rollback to savepoint coded");
      await client.query("savepoint approved");
      await asOwner(admin.id, () =>
        client.query(`insert into acc_reconciliation (bank_transaction_id, status, confidence) values ($1, 'approved', 1)`, [e4.id]),
      );
      await refused("a sync whose line has an approved match is refused", UNDO, [run2, "verify"], "1 line(s) of this sync");
      await client.query("rollback to savepoint approved");
      if (viewer) {
        await as(viewer.id);
        await refused("a viewer cannot undo", UNDO, [run2, "verify"], "permission");
      }
      await as(OUTSIDER);
      await refused("someone outside the company cannot undo", UNDO, [run2, "verify"], "permission");
      await as(admin.id);

      // ---- a sync still running blocks the undo of the one before it
      const runBusy = await begin();
      const busyListed = (await all(SYNCS, [bank])).find((r) => r.run_id === run2);
      check("while a newer sync runs, run 2 is no longer the one to undo", busyListed?.is_newest === false, JSON.stringify(busyListed));
      await refused("…and its undo waits for the running sync", UNDO, [run2, "verify"], "Undo the newer syncs of this bank connection first");
      await finish(runBusy);

      // ---- a sync that was cut off (still running 15 minutes on) counts as failed
      await client.query("savepoint cutoff");
      // Every earlier run moves two hours back, so the cut-off run below is the newest.
      await asOwner(admin.id, () =>
        client.query(`update acc_bank_feed_sync_run set started_at = started_at - interval '2 hours' where connection_id = $1`, [conn]),
      );
      const backdate = (run) =>
        asOwner(admin.id, () => client.query(`update acc_bank_feed_sync_run set started_at = clock_timestamp() - interval '20 minutes' where id = $1`, [run]));
      const CUT_OFF_MESSAGE = "The sync stopped before it finished";
      const runCut = await begin();
      await backdate(runCut);
      const cutListed = await all(SYNCS, [bank]);
      check("a run still running 20 minutes on does not block the undo of the one before it",
        cutListed.find((r) => r.run_id === run2)?.is_newest === true, JSON.stringify(cutListed.find((r) => r.run_id === run2)));
      const cutRow = (await all(`select status, error_message from acc_bank_feed_syncs($1) where run_id = $2`, [bank, runCut]))[0];
      check("…and the list reports it as failed, with the message",
        cutRow?.status === "failed" && cutRow?.error_message === CUT_OFF_MESSAGE, JSON.stringify(cutRow));
      await apply(runCut, [line("e7", "2026-09-07", 800, "DEPOSIT SEVEN")]);
      const afterCutApply = await all(SYNCS, [bank]);
      check("a cut-off run that changed something is the one to undo, and holds the older runs back",
        afterCutApply.find((r) => r.run_id === runCut)?.is_newest === true && afterCutApply.find((r) => r.run_id === run2)?.is_newest === false,
        JSON.stringify(afterCutApply));
      check("…it is undone from failed, and its added line is gone",
        (await one(UNDO, [runCut, "Verify: undo a run that was cut off"])).out.removed === 1 && !(await txn("e7")));
      const cutRun = await one(`select status, completed_at, error_message from acc_bank_feed_sync_run where id = $1`, [runCut]);
      check("…it ends undone, having been marked failed with the message on the way",
        cutRun.status === "undone" && cutRun.completed_at !== null && cutRun.error_message === CUT_OFF_MESSAGE, JSON.stringify(cutRun));
      check("…and the run before it can be undone again",
        (await all(SYNCS, [bank])).find((r) => r.run_id === run2)?.is_newest === true);
      const runCut2 = await begin();
      await backdate(runCut2);
      const runNext = await begin();
      const cutAfterBegin = await one(`select status, completed_at, error_message from acc_bank_feed_sync_run where id = $1`, [runCut2]);
      check("beginning a sync marks a cut-off run of the same connection failed",
        cutAfterBegin.status === "failed" && cutAfterBegin.completed_at !== null && cutAfterBegin.error_message === CUT_OFF_MESSAGE, JSON.stringify(cutAfterBegin));
      check("…and leaves the sync it began running",
        (await one(`select status from acc_bank_feed_sync_run where id = $1`, [runNext])).status === "running");
      await client.query("rollback to savepoint cutoff");

      // ---- undo run 2: its lines go, the lines it retired come back as they were
      await asOwner(admin.id, () =>
        client.query(`insert into acc_reconciliation (bank_transaction_id, status, confidence) values ($1, 'suggested', 0.5)`, [e4.id]),
      );
      const undo2 = (await one(UNDO, [run2, "Verify: the bank sent a correction we do not want"])).out;
      check("undoing run 2 removes its two lines and restores two", undo2.removed === 2 && undo2.restored === 2, JSON.stringify(undo2));
      const e2After = await all(`select provider_revision, status::text, provider_removed_at is null as active from acc_bank_transaction where external_transaction_id = 'e2' and bank_account_id = $1`, [bank]);
      check("…e2 is back as it was, its new revision gone", e2After.length === 1 && e2After[0].active && e2After[0].status === "unmatched", JSON.stringify(e2After));
      const e3After = await txn("e3");
      check("…e3 is back, still ignored as the person left it", e3After.provider_removed_at === null && e3After.status === "ignored", JSON.stringify(e3After));
      check("…e4 is gone, and its suggestion with it",
        !(await txn("e4")) && (await one(`select count(*)::int as n from acc_reconciliation where bank_transaction_id = $1`, [e4.id])).n === 0);
      check("…the sync is marked undone, by whom and why",
        (await one(`select status, undone_by, undo_reason from acc_bank_feed_sync_run where id = $1`, [run2])).undone_by === admin.id);
      check("…one audit line is written", (await one(
        `select count(*)::int as n from acc_audit_log where table_name = 'acc_bank_feed_sync_run' and record_id = $1 and action = 'undo'`, [run2])).n === 1);
      await refused("a sync undone once cannot be undone again", UNDO, [run2, "verify"], "already been undone");

      // ---- run 1 is next; the ignored line holds it until it is unmatched
      const run1Listed = (await all(SYNCS, [bank])).find((r) => r.run_id === run1);
      check("run 1 is now the one to undo, held by the line a person ignored", run1Listed?.is_newest === true && run1Listed?.locked_lines === 1,
        JSON.stringify(run1Listed));
      await refused("run 1 is held by the line a person ignored", UNDO, [run1, "verify"], "1 line(s) of this sync");
      await asOwner(admin.id, () => client.query(`update acc_bank_transaction set status = 'unmatched' where id = $1`, [e3.id]));
      const undo1 = (await one(UNDO, [run1, "Verify: these lines were imported from a CSV already"])).out;
      check("undoing run 1 removes its three lines", undo1.removed === 3 && undo1.restored === 0 && (await activeLines()) === 0, JSON.stringify(undo1));

      // ---- a failed sync that changed something can be undone; it never moved the cursor
      const cursorOf = async () => (await one(`select sync_cursor from acc_bank_connection where id = $1`, [conn])).sync_cursor;
      const cursorBefore = await cursorOf();
      const runFailed = await begin();
      await apply(runFailed, [line("e6", "2026-09-06", 600, "DEPOSIT SIX")]);
      await finish(runFailed, "verify failure");
      const failedListed = (await all(SYNCS, [bank])).find((r) => r.run_id === runFailed);
      check("a failed sync that changed something is listed, and is the one to undo",
        failedListed?.status === "failed" && failedListed?.is_newest === true && failedListed?.changes === 1, JSON.stringify(failedListed));
      check("…the failed sync's undo removes its line", (await one(UNDO, [runFailed, "Verify: undo what a failed sync added"])).out.removed === 1 && !(await txn("e6")));
      check("…and the connection's cursor is as it was: the next sync fetches those changes again",
        (await cursorOf()) === cursorBefore, `${cursorBefore} -> ${await cursorOf()}`);

      // ---- disconnect, with a sync running
      const run4 = await begin();
      await apply(run4, [line("e5", "2026-09-05", 700, "DEPOSIT FIVE")]);
      const DISCONNECT = `select acc_disconnect_bank_connection($1, $2, $3)`;
      await refused("disconnect without a reason is refused", DISCONNECT, [conn, "", null], "Say why this bank connection is being disconnected");
      if (viewer) {
        await as(viewer.id);
        await refused("a viewer cannot disconnect", DISCONNECT, [conn, "verify", null], "permission");
        await as(admin.id);
      }
      await client.query(DISCONNECT, [conn, "Verify: the bank closed this account", "Disconnected in OneBook only: Plaid did not confirm the removal (verify)"]);
      const after = await one(`select status, last_error from acc_bank_connection where id = $1`, [conn]);
      check("the connection is disconnected, with the note", after.status === "disconnected" && after.last_error.startsWith("Disconnected in OneBook only"), JSON.stringify(after));
      await asOwner(admin.id, async () => {
        check("…its token is deleted", (await one(`select count(*)::int as n from acc_bank_connection_secret where connection_id = $1`, [conn])).n === 0);
      });
      check("…its account mapping is no longer active", (await one(`select is_active from acc_bank_feed_account where connection_id = $1`, [conn])).is_active === false);
      check("…the line it brought in stays", Boolean(await txn("e5")));
      check("…one audit line is written", (await one(
        `select count(*)::int as n from acc_audit_log where table_name = 'acc_bank_connection' and record_id = $1 and action = 'disconnect'`, [conn])).n === 1);
      await refused("the running sync's next page is refused", APPLY, [conn, run4, "[]", "[]", "[]"], "was disconnected");
      await finish(run4, "This bank connection was disconnected");
      const stays = await one(`select status, last_error from acc_bank_connection where id = $1`, [conn]);
      check("a sync ending after the disconnect leaves it disconnected, its note kept", stays.status === "disconnected" && stays.last_error.startsWith("Disconnected in OneBook only"), JSON.stringify(stays));
      await refused("a disconnected connection cannot sync", `select acc_begin_bank_feed_sync($1)`, [conn], "Active bank connection was not found");
      await refused("it cannot be disconnected twice", DISCONNECT, [conn, "verify", null], "already disconnected");
      check("run 4 can still be undone after the disconnect",
        (await all(SYNCS, [bank])).find((r) => r.run_id === run4)?.is_newest === true);
      check("…and is", (await one(UNDO, [run4, "Verify: clean up after disconnecting"])).out.removed === 1);

      // ---- the bank account is free to connect again
      const conn2 = (await one(`select acc_save_bank_connection('item-verify-2', 'ins_verify', 'Verify Institution', 'not-a-real-token-2', $1::jsonb) as id`, [
        mapping("acc-verify-2"),
      ])).id;
      check("the same bank account can be connected again", Boolean(conn2) && conn2 !== conn);
      await refused("but not twice at once", `select acc_save_bank_connection('item-verify-3', 'ins_verify', 'Verify Institution', 'x', $1::jsonb)`,
        [mapping("acc-verify-3")], "duplicate key");
      check("the list keeps the old connection's syncs", (await all(SYNCS, [bank])).some((r) => r.run_id === run1));

      // ---- who may call what
      await client.query("reset role");
      const grants = await one(
        `select has_function_privilege('anon', 'acc_undo_bank_feed_sync(uuid, text)', 'execute')
             or has_function_privilege('anon', 'acc_disconnect_bank_connection(uuid, text, text)', 'execute')
             or has_function_privilege('anon', 'acc_bank_feed_syncs(uuid)', 'execute')
             or has_function_privilege('anon', 'acc_apply_bank_feed_page(uuid, uuid, jsonb, jsonb, jsonb)', 'execute') as anon,
                has_function_privilege('authenticated', 'acc_undo_bank_feed_sync(uuid, text)', 'execute')
            and has_function_privilege('authenticated', 'acc_disconnect_bank_connection(uuid, text, text)', 'execute')
            and has_function_privilege('authenticated', 'acc_bank_feed_syncs(uuid)', 'execute') as signed_in,
                to_regprocedure('acc_apply_bank_feed_page(uuid, jsonb, jsonb, jsonb)') is null as old_apply_gone`,
      );
      check("closed to anon, open to signed-in users; the old page function is gone",
        grants.anon === false && grants.signed_in === true && grants.old_apply_gone === true, JSON.stringify(grants));
      await client.query("set local role authenticated");
      await as(OUTSIDER);
      check("someone outside the company lists no syncs", (await all(SYNCS, [bank])).length === 0);
    } finally {
      await client.query("rollback");
    }
  }
} finally {
  clearTimeout(killer);
  await client.end();
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
