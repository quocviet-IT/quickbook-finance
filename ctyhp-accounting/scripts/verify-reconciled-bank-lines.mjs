/**
 * Behavioural verification of migration 0136 on every company's books.
 *
 * Each company runs inside its own transaction that is ALWAYS rolled back.
 * When 0136 has not been applied it is applied first, inside that transaction,
 * and every account, entry, bank line, match and reconciliation the checks need
 * is made there too — so nothing is left behind. A refusal is tried inside a
 * savepoint, so the books it is tried on stay as they were.
 *
 * Run: node --env-file=.env.local scripts/verify-reconciled-bank-lines.mjs
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0136_match_reconciled_bank_lines.sql";
const MIGRATION = readFileSync(new URL(`../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const OUTSIDER = "00000000-0000-0000-0000-000000000000";

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const killer = setTimeout(() => {
  console.error("HARD TIMEOUT");
  process.exit(2);
}, 8 * 60 * 1000);
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
        console.log("  (0136 applied inside the transaction, never committed)");
      }
      for (const statement of statements) await client.query(statement);
      check("applying 0136 a second time is harmless", true);

      const admin = await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`);
      const viewer = await one(`select id from acc_app_user where role = 'viewer' and status = 'active' order by created_at limit 1`);
      const base = await one(`select code from acc_currency where is_base limit 1`);
      if (!admin || !base) {
        console.log("  (no active administrator or base currency; skipped)");
        continue;
      }

      // ---- the books: a bank account with eight entries on it, and another bank account
      const account = async (code, name, type) =>
        (await one(
          `insert into acc_account (account_code, name, account_type, currency_code, is_posting_account)
           values ($1, $2, $3, $4, true) returning id`,
          [code, name, type, base.code],
        )).id;
      const gl = await account("ZZ-VERIFY-RB-B", "Verify reconciled bank lines bank", "bank");
      const gl2 = await account("ZZ-VERIFY-RB-B2", "Verify reconciled bank lines other bank", "bank");
      const sales = await account("ZZ-VERIFY-RB-I", "Verify reconciled bank lines sales", "income");
      const bankAccount = async (ledger) =>
        (await one(`insert into acc_bank_account (account_id, bank_name, currency_code) values ($1, 'Verify Bank', $2) returning id`, [
          ledger, base.code,
        ])).id;
      const bank = await bankAccount(gl);
      const otherBank = await bankAccount(gl2);

      await client.query("set local role authenticated");
      await as(admin.id);
      /** Posts `minor` to the bank (positive in, negative out) on `day`; returns the bank's journal line. */
      const post = async (day, memo, minor) => {
        const entry = (await one(`select acc_post_manual_journal($1, $2, null, $3, $4::jsonb) as id`, [
          day, memo, base.code,
          JSON.stringify(minor > 0
            ? [{ account_id: gl, debit_minor: minor, credit_minor: 0 }, { account_id: sales, debit_minor: 0, credit_minor: minor }]
            : [{ account_id: gl, debit_minor: 0, credit_minor: -minor }, { account_id: sales, debit_minor: -minor, credit_minor: 0 }]),
        ])).id;
        return { entry, line: (await one(`select id from acc_journal_line where journal_entry_id = $1 and account_id = $2`, [entry, gl])).id };
      };
      const deposit = await post("2026-07-05", "Client deposit", 50000);
      const shop = await post("2026-07-10", "Card purchase", -4200);
      const wire = await post("2026-07-12", "Wire in", 3000);
      const wireTwin = await post("2026-07-12", "Wire in, the same again", 3000);
      const transfer = await post("2026-07-14", "Transfer in", 1500);
      const charge = await post("2026-07-16", "Charge refunded", 700);
      const reversed = await post("2026-07-18", "Refund", 900);
      const later = await post("2026-07-20", "Voided after the month was signed", 100);

      const LINES = [
        { txn_date: "2026-07-05", description: "DEPOSIT EXAMPLE", reference: null, amount_minor: 50000 },
        { txn_date: "2026-07-10", description: "POS EXAMPLE SHOP", reference: null, amount_minor: -4200 },
        { txn_date: "2026-07-12", description: "INCOMING WIRE EXAMPLE", reference: null, amount_minor: 3000 },
        { txn_date: "2026-07-14", description: "TRANSFER EXAMPLE", reference: null, amount_minor: 1500 },
        { txn_date: "2026-07-14", description: "TRANSFER OTHER EXAMPLE", reference: null, amount_minor: 1500 },
        { txn_date: "2026-07-16", description: "CHARGE EXAMPLE", reference: null, amount_minor: 700 },
        { txn_date: "2026-07-18", description: "REFUND EXAMPLE", reference: null, amount_minor: -900 },
        { txn_date: "2026-07-20", description: "LATER EXAMPLE", reference: null, amount_minor: 100 },
      ];
      const importLines = (bankId, lines) =>
        one(`select * from acc_import_bank_statement($1, 'verify.csv', $2::jsonb)`, [
          bankId,
          JSON.stringify(lines.map((l, i) => ({
            ...l,
            raw_line: l.description,
            raw_hash: createHash("sha256").update(`verify-rb-${bankId}-${i}`).digest("hex"),
            source: "file_upload",
          }))),
        ]);
      await importLines(bank, LINES);
      await importLines(otherBank, [LINES[0]]);
      const txnOf = async (bankId, description) =>
        (await one(`select id from acc_bank_transaction where bank_account_id = $1 and description = $2`, [bankId, description])).id;
      const t = {
        deposit: await txnOf(bank, "DEPOSIT EXAMPLE"),
        shop: await txnOf(bank, "POS EXAMPLE SHOP"),
        wire: await txnOf(bank, "INCOMING WIRE EXAMPLE"),
        transfer: await txnOf(bank, "TRANSFER EXAMPLE"),
        transferOther: await txnOf(bank, "TRANSFER OTHER EXAMPLE"),
        charge: await txnOf(bank, "CHARGE EXAMPLE"),
        reversed: await txnOf(bank, "REFUND EXAMPLE"),
        later: await txnOf(bank, "LATER EXAMPLE"),
        elsewhere: await txnOf(otherBank, "DEPOSIT EXAMPLE"),
      };

      // ---- Bank Transactions as a person left it: suggestions, decisions, an ignored line
      await asOwner(admin.id, async () => {
        const match = (txn, line, status, confidence) =>
          client.query(`insert into acc_reconciliation (bank_transaction_id, journal_line_id, status, confidence) values ($1, $2, $3, $4)`, [
            txn, line, status, confidence,
          ]);
        await match(t.deposit, deposit.line, "suggested", 0.9);
        await match(t.deposit, reversed.line, "suggested", 0.4);
        await match(t.shop, shop.line, "approved", 1);
        await match(t.wire, wireTwin.line, "approved", 1);
        await match(t.transferOther, transfer.line, "approved", 1);
        await client.query(`update acc_bank_transaction set status = 'matched' where id = any($1::uuid[])`, [[t.shop, t.wire, t.transferOther]]);
        await client.query(`update acc_bank_transaction set status = 'ignored' where id = $1`, [t.charge]);
      });

      // ---- a July reconciliation that ticks seven of the eight book lines
      const ticked = [deposit, shop, wire, transfer, charge, reversed, later];
      const ending = 50000 - 4200 + 3000 + 1500 + 700 + 900 + 100;
      const rec = (await one(
        `select acc_create_reconciliation_from_statement($1, '2026-07-31', $2, 'verify.csv', 0, $3::jsonb, null) as id`,
        [bank, ending, JSON.stringify(LINES.map((l) => ({ ...l, balance_minor: null })))],
      )).id;
      await one(`select acc_set_cleared_many($1, $2::uuid[], true) as n`, [rec, ticked.map((x) => x.line)]);

      const MATCH = `select acc_match_reconciled_bank_lines($1, $2::jsonb) as out`;
      const pair = (txn, line) => ({ bank_transaction_id: txn, journal_line_id: line });
      const PAIRS = [
        pair(t.deposit, deposit.line),
        pair(t.shop, shop.line),
        pair(t.wire, wire.line),
        pair(t.transfer, transfer.line),
        pair(t.charge, charge.line),
        pair(t.reversed, reversed.line),
      ];
      await refused("a reconciliation in progress is refused", MATCH, [rec, JSON.stringify(PAIRS)], "only once the reconciliation is completed");
      await one(`select acc_complete_reconciliation($1)`, [rec]);
      check("the reconciliation completes", (await one(`select status::text from acc_statement_reconciliation where id = $1`, [rec])).status === "completed");
      await asOwner(admin.id, () => client.query(`update acc_journal_entry set status = 'void', voided_at = now() where id = $1`, [later.entry]));

      // ---- what matching refuses: every refusal matches nothing
      await refused("an unknown reconciliation is refused", MATCH, [OUTSIDER, "[]"], "Reconciliation not found");
      await refused("a list that is not a list is refused", MATCH, [rec, "{}"], "must be a list");
      await refused("a pair missing a side is refused", MATCH, [rec, JSON.stringify([{ bank_transaction_id: t.deposit }])], "needs its bank_transaction_id and journal_line_id");
      await refused("a bank line listed twice is refused", MATCH,
        [rec, JSON.stringify([pair(t.deposit, deposit.line), pair(t.deposit, shop.line)])], "listed twice");
      await refused("a book line listed twice is refused", MATCH,
        [rec, JSON.stringify([pair(t.deposit, deposit.line), pair(t.shop, deposit.line)])], "listed twice");
      await refused("more than 5,000 pairs are refused", MATCH,
        [rec, JSON.stringify(Array.from({ length: 5001 }, (_, i) => pair(`${OUTSIDER.slice(0, -4)}${String(i).padStart(4, "0")}`, deposit.line)))],
        "At most 5,000");
      await refused("a book line not ticked in this reconciliation is refused", MATCH,
        [rec, JSON.stringify([pair(t.wire, wireTwin.line)])], "is not ticked in this reconciliation");
      await refused("another bank account's line is refused", MATCH,
        [rec, JSON.stringify([pair(t.elsewhere, deposit.line)])], "is not among this bank account's transactions");
      await refused("a book line whose entry was voided is refused", MATCH,
        [rec, JSON.stringify([pair(t.later, later.line)])], "is not part of a posted entry");
      if (viewer) {
        await as(viewer.id);
        await refused("a viewer cannot match", MATCH, [rec, JSON.stringify(PAIRS)], "Not authorized");
      }
      await as(OUTSIDER);
      await refused("someone outside the company cannot match", MATCH, [rec, JSON.stringify(PAIRS)], "Not authorized");
      await as(admin.id);

      // ---- matching
      const none = (await one(MATCH, [rec, "[]"])).out;
      check("nothing to match matches nothing",
        ["matched", "already", "elsewhere", "ignored", "differs"].every((k) => none[k] === 0) && Object.keys(none).length === 5,
        JSON.stringify(none));
      const first = (await one(MATCH, [rec, JSON.stringify(PAIRS)])).out;
      check("one matched, one already, two elsewhere, one ignored, one the other way around",
        first.matched === 1 && first.already === 1 && first.elsewhere === 2 && first.ignored === 1 && first.differs === 1,
        JSON.stringify(first));
      const matchesOf = (txn) =>
        all(`select journal_line_id, status::text, confidence::float as confidence, approved_by, rule_applied from acc_reconciliation
              where bank_transaction_id = $1 order by status`, [txn]);
      const depositMatches = await matchesOf(t.deposit);
      const approved = depositMatches.find((m) => m.status === "approved");
      check("the deposit is matched to its book line, by the person, with full confidence",
        approved?.journal_line_id === deposit.line && approved.approved_by === admin.id && approved.confidence === 1 &&
          approved.rule_applied === "statement_reconciliation",
        JSON.stringify(depositMatches));
      check("…its other suggestion is rejected",
        depositMatches.some((m) => m.journal_line_id === reversed.line && m.status === "rejected"), JSON.stringify(depositMatches));
      check("…and the bank line is matched", (await one(`select status::text from acc_bank_transaction where id = $1`, [t.deposit])).status === "matched");
      check("one audit line is written for the match", (await one(
        `select count(*)::int as n from acc_audit_log
          where table_name = 'acc_reconciliation' and action = 'match_from_reconciliation'
            and after_json->>'bank_transaction_id' = $1 and after_json->>'statement_reconciliation_id' = $2`,
        [t.deposit, rec],
      )).n === 1);
      const statuses = await all(`select id, status::text from acc_bank_transaction where id = any($1::uuid[])`,
        [[t.shop, t.wire, t.transfer, t.transferOther, t.charge, t.reversed]]);
      const statusOf = (id) => statuses.find((s) => s.id === id)?.status;
      check("the lines left as they were keep their status",
        statusOf(t.shop) === "matched" && statusOf(t.wire) === "matched" && statusOf(t.transfer) === "unmatched" &&
          statusOf(t.transferOther) === "matched" && statusOf(t.charge) === "ignored" && statusOf(t.reversed) === "unmatched",
        JSON.stringify(statuses));
      check("a match approved against another book line is not changed",
        JSON.stringify((await matchesOf(t.wire)).map((m) => [m.journal_line_id, m.status])) === JSON.stringify([[wireTwin.line, "approved"]]));
      check("a book line matched to another bank line stays with it",
        JSON.stringify((await matchesOf(t.transferOther)).map((m) => [m.journal_line_id, m.status])) === JSON.stringify([[transfer.line, "approved"]]) &&
          (await matchesOf(t.transfer)).length === 0);
      check("nothing is written for a line the other way around", (await matchesOf(t.reversed)).length === 0);

      const again = (await one(MATCH, [rec, JSON.stringify(PAIRS)])).out;
      check("matching again matches nothing new", again.matched === 0 && again.already === 2 && again.elsewhere === 2,
        JSON.stringify(again));

      // ---- who may call it
      await client.query("reset role");
      const grants = await one(
        `select has_function_privilege('anon', 'acc_match_reconciled_bank_lines(uuid, jsonb)', 'execute') as anon,
                has_function_privilege('authenticated', 'acc_match_reconciled_bank_lines(uuid, jsonb)', 'execute') as signed_in`,
      );
      check("closed to anon, open to signed-in users", grants.anon === false && grants.signed_in === true, JSON.stringify(grants));
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
