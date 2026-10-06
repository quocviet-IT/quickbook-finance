/**
 * Behavioural verification of migration 0134 on every company's books.
 *
 * Each company runs inside its own transaction that is ALWAYS rolled back.
 * When 0134 has not been applied it is applied first, inside that transaction,
 * and every account, bank line, entry and reconciliation the checks need is
 * made there too — so nothing is left behind. A refusal is tried inside a
 * savepoint, so the books it is tried on stay as they were.
 *
 * Run: node --env-file=.env.local scripts/verify-add-missing-lines.mjs
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0134_add_missing_statement_lines.sql";
const MIGRATION = readFileSync(new URL(`../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const OUTSIDER = "00000000-0000-0000-0000-000000000000";
const HOLDING = ["uncategorized_income", "uncategorized_expense"];

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
/** Runs `body` and puts the books back afterwards. */
async function thenUndo(body) {
  await client.query("savepoint trial");
  try {
    await body();
  } finally {
    await client.query("rollback to savepoint trial");
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
        console.log("  (0134 applied inside the transaction, never committed)");
      }
      const admin = await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`);
      const base = await one(`select code from acc_currency where is_base limit 1`);
      if (!admin || !base) {
        console.log("  (no active administrator or base currency; skipped)");
        continue;
      }

      // ---- the two holding accounts
      const holding = async () =>
        all(
          `select detail_type, account_type::text as type, account_code from acc_account
            where detail_type = any($1) and status = 'active' order by detail_type`,
          [HOLDING],
        );
      const held = await holding();
      check(
        "one Uncategorized Income and one Uncategorized Expense, of the right types",
        held.length === 2 && held[0].detail_type === "uncategorized_expense" && held[0].type === "expense" &&
          held[1].detail_type === "uncategorized_income" && held[1].type === "income",
        JSON.stringify(held),
      );
      console.log(`  (codes: income ${held.find((h) => h.type === "income")?.account_code}, expense ${held.find((h) => h.type === "expense")?.account_code})`);
      for (const statement of statements) await client.query(statement);
      check("applying 0134 again changes nothing", JSON.stringify(await holding()) === JSON.stringify(held));
      const uncatIn = (await one(`select id from acc_account where detail_type = 'uncategorized_income' and status = 'active'`)).id;
      const uncatOut = (await one(`select id from acc_account where detail_type = 'uncategorized_expense' and status = 'active'`)).id;

      // ---- the books: a bank account, a deposit in them, and a July statement
      //      with three lines they do not have and one after the statement date
      const account = async (code, name, type) =>
        (await one(
          `insert into acc_account (account_code, name, account_type, currency_code, is_posting_account)
           values ($1, $2, $3, $4, true) returning id`,
          [code, name, type, base.code],
        )).id;
      const gl = await account("ZZ-VERIFY-AM-B", "Verify add-missing bank", "bank");
      const gl2 = await account("ZZ-VERIFY-AM-B2", "Verify add-missing other bank", "bank");
      const charges = await account("ZZ-VERIFY-AM-X", "Verify add-missing charges", "expense");
      const sales = await account("ZZ-VERIFY-AM-I", "Verify add-missing sales", "income");
      const bankAccount = async (ledger) =>
        (await one(`insert into acc_bank_account (account_id, bank_name, currency_code) values ($1, 'Verify Bank', $2) returning id`, [
          ledger, base.code,
        ])).id;
      const bank = await bankAccount(gl);
      const otherBank = await bankAccount(gl2);

      await client.query("set local role authenticated");
      await as(admin.id);
      await one(`select acc_post_manual_journal('2026-07-05', 'Client deposit', null, $1, $2::jsonb) as id`, [
        base.code,
        JSON.stringify([
          { account_id: gl, debit_minor: 50000, credit_minor: 0 },
          { account_id: sales, debit_minor: 0, credit_minor: 50000 },
        ]),
      ]);
      const LINES = [
        { txn_date: "2026-07-05", description: "DEPOSIT 0041", reference: null, amount_minor: 50000 },
        { txn_date: "2026-07-15", description: "INCOMING WIRE EXAMPLE", reference: null, amount_minor: 3000 },
        { txn_date: "2026-07-28", description: "POS EXAMPLE SHOP", reference: null, amount_minor: -4200 },
        { txn_date: "2026-07-30", description: "SERVICE FEE", reference: null, amount_minor: -1500 },
        { txn_date: "2026-08-02", description: "AFTER THE STATEMENT", reference: null, amount_minor: -700 },
      ];
      const importLines = (bankId, lines) =>
        one(`select * from acc_import_bank_statement($1, 'verify.csv', $2::jsonb)`, [
          bankId,
          JSON.stringify(lines.map((l, i) => ({
            ...l,
            raw_line: l.description,
            raw_hash: createHash("sha256").update(`verify-am-${bankId}-${i}`).digest("hex"),
            source: "file_upload",
          }))),
        ]);
      await importLines(bank, LINES);
      await importLines(otherBank, [LINES[2]]);
      const txnOf = async (bankId, description) =>
        (await one(`select id from acc_bank_transaction where bank_account_id = $1 and description = $2`, [bankId, description])).id;
      const wire = await txnOf(bank, "INCOMING WIRE EXAMPLE");
      const shop = await txnOf(bank, "POS EXAMPLE SHOP");
      const fee = await txnOf(bank, "SERVICE FEE");
      const after = await txnOf(bank, "AFTER THE STATEMENT");
      const elsewhere = await txnOf(otherBank, "POS EXAMPLE SHOP");
      const rec = (await one(
        `select acc_create_reconciliation_from_statement($1, '2026-07-31', 47300, 'verify.csv', 0, $2::jsonb) as id`,
        [bank, JSON.stringify(LINES.map((l) => ({ ...l, balance_minor: null })))],
      )).id;
      const lineNo = async (description) =>
        Number((await one(`select line_no from acc_reconciliation_statement_line where reconciliation_id = $1 and description = $2`, [rec, description])).line_no);
      const items = {
        wire: { line_no: await lineNo("INCOMING WIRE EXAMPLE"), bank_transaction_id: wire, account_id: uncatIn },
        shop: { line_no: await lineNo("POS EXAMPLE SHOP"), bank_transaction_id: shop, account_id: uncatOut },
        fee: { line_no: await lineNo("SERVICE FEE"), bank_transaction_id: fee, account_id: charges },
        after: { line_no: await lineNo("AFTER THE STATEMENT"), bank_transaction_id: after, account_id: charges },
      };
      const ADD = `select acc_add_statement_lines_to_books($1, $2::jsonb) as out`;
      const add = (list) => [rec, JSON.stringify(list)];

      // ---- what adding refuses: every refusal posts nothing
      await refused("a statement line paired with another line's bank transaction is refused", ADD,
        add([items.wire, { ...items.shop, bank_transaction_id: fee }]), "does not agree with its bank transaction");
      await refused("another bank account's transaction is refused", ADD,
        add([{ ...items.shop, bank_transaction_id: elsewhere }]), "is not among this bank account's transactions");
      await refused("a line dated after the statement is refused", ADD, add([items.after]), "is dated after the statement");
      await refused("a line listed twice is refused", ADD, add([items.fee, items.fee]), "listed twice");
      await refused("more than 500 lines are refused", ADD,
        add(Array.from({ length: 501 }, (_, i) => ({ ...items.fee, line_no: i }))), "At most 500");
      await refused("an empty list is refused", ADD, add([]), "nothing to add");
      await refused("an item missing its bank line is refused, said as such", ADD,
        add([{ line_no: items.fee.line_no, account_id: charges }]), "needs its line_no, bank_transaction_id and account_id");
      await thenUndo(async () => {
        await one(`select acc_categorise_bank_transaction($1, $2)`, [fee, charges]);
        await refused("a line already coded in Bank Transactions is refused, with the line named", ADD,
          add([items.shop, items.fee]), "The line Jul 30, 2026 SERVICE FEE -15.00 could not be added");
      });
      await thenUndo(async () => {
        await client.query("reset role");
        await client.query(
          `insert into acc_accounting_period (fiscal_year, period_month, period_start, period_end, label, status)
           values (2026, 7, '2026-07-01', '2026-07-31', 'Jul 2026', 'closed')
           on conflict (period_start) do update set status = 'closed'`,
        );
        await client.query("set local role authenticated");
        await as(admin.id);
        await refused("a closed period refuses the whole list", ADD, add([items.wire, items.fee]), "closed");
      });
      await thenUndo(async () => {
        await client.query("reset role");
        await client.query(`update acc_statement_reconciliation set status = 'completed' where id = $1`, [rec]);
        await client.query("set local role authenticated");
        await as(admin.id);
        await refused("a completed reconciliation is refused", ADD, add([items.fee]), "not in progress");
      });
      await thenUndo(async () => {
        await client.query("reset role");
        await client.query(`update acc_app_user set role = 'viewer' where id = $1`, [admin.id]);
        await client.query("set local role authenticated");
        await as(admin.id);
        await refused("a viewer cannot add lines", ADD, add([items.fee]), "Not authorized");
      });
      const posted = async () => Number((await one(`select count(*) as n from acc_journal_entry where status = 'posted' and source_type = 'bank'`)).n);
      const before = await posted();

      // ---- adding them
      const out = (await one(ADD, add([items.wire, items.shop, items.fee]))).out;
      check("three lines added, each with an entry", Array.isArray(out) && out.length === 3 && out.every((o) => o.entry_number), JSON.stringify(out));
      check("three entries posted", (await posted()) === before + 3);
      const statuses = await all(`select status::text from acc_bank_transaction where id = any($1)`, [[wire, shop, fee]]);
      check("their bank lines are matched", statuses.every((s) => s.status === "matched"), JSON.stringify(statuses));
      const entryOf = async (txn) =>
        one(
          `select e.id, e.entry_date::text, e.description, o.account_id, o.debit_minor, o.credit_minor
             from acc_reconciliation r
             join acc_journal_line l on l.id = r.journal_line_id
             join acc_journal_entry e on e.id = l.journal_entry_id
             join acc_journal_line o on o.journal_entry_id = e.id and o.account_id <> $2
            where r.bank_transaction_id = $1 and r.status = 'approved'`,
          [txn, gl],
        );
      const shopEntry = await entryOf(shop);
      const wireEntry = await entryOf(wire);
      check("money out with no place goes to Uncategorized Expense, dated as the bank has it",
        shopEntry.account_id === uncatOut && Number(shopEntry.debit_minor) === 4200 && shopEntry.entry_date === "2026-07-28", JSON.stringify(shopEntry));
      check("money in with no place goes to Uncategorized Income",
        wireEntry.account_id === uncatIn && Number(wireEntry.credit_minor) === 3000, JSON.stringify(wireEntry));
      check("a line with a place goes there", (await entryOf(fee)).account_id === charges);
      const audit = await one(`select after_json from acc_audit_log where table_name = 'acc_statement_reconciliation' and record_id = $1 and action = 'add_statement_lines'`, [rec]);
      check("the addition is in the audit log", audit?.after_json?.lines === 3, JSON.stringify(audit));

      // ---- ticked, then: taking a line back still works while the month is open
      const bookLines = (await all(
        `select l.id from acc_journal_line l join acc_journal_entry e on e.id = l.journal_entry_id
          where l.account_id = $1 and e.status = 'posted' and e.entry_date <= '2026-07-31'`,
        [gl],
      )).map((r) => r.id);
      await one(`select acc_set_cleared_many($1, $2::uuid[], true)`, [rec, bookLines]);
      const cleared = async () => Number((await one(`select acc_recon_cleared_total($1) as n`, [rec])).n);
      check("ticked, the month reaches its statement's 47,300", (await cleared()) === 47300, String(await cleared()));
      await thenUndo(async () => {
        const voided = Number((await one(`select acc_uncategorise_bank_transaction($1) as n`, [fee])).n);
        check("a line ticked in a reconciliation still in progress can still be taken back", voided === 1);
      });
      await thenUndo(async () => {
        await one(`select acc_recode_uncategorized($1, $2)`, [wire, sales]);
        await one(`select acc_uncategorise_bank_transaction($1)`, [wire]);
        const left = Number((await one(`select count(*) as n from acc_journal_entry where source_type = 'bank' and source_id = $1 and status = 'posted'`, [wireEntry.id])).n);
        check("taking a recoded line back takes its recode too", left === 0, String(left));
      });

      // ---- history before any recode: a line in Uncategorized teaches nothing
      const history = async (entryId) => (await all(`select account_id from acc_coding_history() where entry_id = $1`, [entryId]))[0]?.account_id ?? null;
      check("coding history leaves out a line still in Uncategorized", (await history(shopEntry.id)) === null);
      check("coding history still holds an ordinary coded line", (await history((await entryOf(fee)).id)) === charges);

      // ---- the month is signed off
      await one(`select acc_complete_reconciliation($1)`, [rec]);
      await refused("taking back a coded line in a signed-off month is refused", `select acc_uncategorise_bank_transaction($1)`, [fee],
        "This line is reconciled to Jul 31, 2026. Reopen that reconciliation to change it.");
      await refused("taking back an Uncategorized line in a signed-off month points to Recode", `select acc_uncategorise_bank_transaction($1)`, [shop],
        "This line is reconciled to Jul 31, 2026. Recode it instead, or reopen that reconciliation.");
      const signedTotal = await cleared();

      // ---- recoding
      const RECODE = `select acc_recode_uncategorized($1, $2) as out`;
      await refused("recoding a line not in Uncategorized is refused", RECODE, [fee, charges], "not to Uncategorized");
      await refused("recoding into an Uncategorized account is refused", RECODE, [shop, uncatIn], "not an Uncategorized one");
      await refused("recoding into a bank account is refused", RECODE, [shop, gl2], "A bank account is not a category");
      await thenUndo(async () => {
        await client.query("reset role");
        const batch = (await one(
          `insert into acc_import_batch (source, mode, file_name, sha256, entry_count, line_count, total_minor)
           values ('wave_ledger', 'history', 'verify.csv', $1, 0, 0, 0) returning id`,
          [createHash("sha256").update(`verify-am-batch-${bank}`).digest("hex")],
        )).id;
        await client.query(`update acc_bank_transaction set transaction_batch_id = $1 where id = $2`, [batch, shop]);
        await client.query("set local role authenticated");
        await as(admin.id);
        await refused("a line a transactions import owns is not recoded", RECODE, [shop, charges], "came from a transactions import");
      });
      const recoded = (await one(RECODE, [shop, charges])).out;
      check("recoding returns its entry", Boolean(recoded?.entry_number), JSON.stringify(recoded));
      const recodeLines = await all(
        `select l.account_id, l.debit_minor, l.credit_minor, e.entry_date::text, e.source_type::text, e.source_id, e.description
           from acc_journal_entry e join acc_journal_line l on l.journal_entry_id = e.id
          where e.id = $1 order by l.debit_minor desc`,
        [recoded.entry_id],
      );
      check(
        "money out is recoded Dr the account, Cr Uncategorized Expense, same day, tied to the entry it recodes",
        recodeLines.length === 2 && recodeLines[0].account_id === charges && Number(recodeLines[0].debit_minor) === 4200 &&
          recodeLines[1].account_id === uncatOut && Number(recodeLines[1].credit_minor) === 4200 &&
          recodeLines[0].entry_date === "2026-07-28" && recodeLines[0].source_type === "bank" &&
          recodeLines[0].source_id === shopEntry.id && recodeLines[0].description === "Recode: POS EXAMPLE SHOP",
        JSON.stringify(recodeLines),
      );
      check("recoding leaves the signed-off month exactly as it was", (await cleared()) === signedTotal);
      await refused("a second recode is refused", RECODE, [shop, sales], "already recoded");
      const inRecode = (await one(RECODE, [wire, sales])).out;
      const inLines = await all(`select account_id, debit_minor, credit_minor from acc_journal_line where journal_entry_id = $1 order by debit_minor desc`, [inRecode.entry_id]);
      check("money in is recoded Dr Uncategorized Income, Cr the account",
        inLines[0].account_id === uncatIn && Number(inLines[0].debit_minor) === 3000 && inLines[1].account_id === sales && Number(inLines[1].credit_minor) === 3000,
        JSON.stringify(inLines));
      const recodes = await all(`select bank_transaction_id, account_id from acc_bank_recodes($1)`, [bank]);
      check("Bank Transactions can read both recodes and where they went",
        recodes.length === 2 && recodes.some((r) => r.bank_transaction_id === shop && r.account_id === charges) &&
          recodes.some((r) => r.bank_transaction_id === wire && r.account_id === sales),
        JSON.stringify(recodes));
      check("coding history learns the account a line was recoded to", (await history(shopEntry.id)) === charges);

      // ---- taking a recode back
      const UNDO = `select acc_undo_recode($1) as out`;
      const undone = (await one(UNDO, [shop])).out;
      const undoneStatus = (await one(`select status::text from acc_journal_entry where id = $1`, [undone.entry_id])).status;
      check("taking a recode back voids it", undone.entry_id === recoded.entry_id && undoneStatus === "void", undoneStatus);
      check("…and the line is back in Uncategorized", (await all(`select 1 from acc_bank_recodes($1) where bank_transaction_id = $2`, [bank, shop])).length === 0);
      check("…and history forgets it again", (await history(shopEntry.id)) === null);
      await refused("taking back a recode that is not there is refused", UNDO, [shop], "no recode to take back");
      check("it can be recoded again", Boolean((await one(RECODE, [shop, charges])).out?.entry_number));

      // ---- who may call what
      const grants = await one(
        `select has_function_privilege('anon', 'acc_add_statement_lines_to_books(uuid, jsonb)', 'execute')
             or has_function_privilege('anon', 'acc_recode_uncategorized(uuid, uuid)', 'execute')
             or has_function_privilege('anon', 'acc_undo_recode(uuid)', 'execute')
             or has_function_privilege('anon', 'acc_bank_recodes(uuid)', 'execute')
             or has_function_privilege('anon', 'acc_uncategorise_bank_transaction(uuid, text)', 'execute')
             or has_function_privilege('anon', 'acc_coding_history()', 'execute') as anon,
                has_function_privilege('authenticated', 'acc_add_statement_lines_to_books(uuid, jsonb)', 'execute')
            and has_function_privilege('authenticated', 'acc_recode_uncategorized(uuid, uuid)', 'execute')
            and has_function_privilege('authenticated', 'acc_undo_recode(uuid)', 'execute')
            and has_function_privilege('authenticated', 'acc_bank_recodes(uuid)', 'execute') as signed_in`,
      );
      check("closed to anon, open to signed-in users", grants.anon === false && grants.signed_in === true, JSON.stringify(grants));
      await as(OUTSIDER);
      check("someone outside the company reads no recodes", (await all(`select 1 from acc_bank_recodes($1)`, [bank])).length === 0);
      await refused("someone outside the company cannot recode", RECODE, [wire, charges], "Not authorized");
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
