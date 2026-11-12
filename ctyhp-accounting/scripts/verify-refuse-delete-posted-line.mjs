/**
 * Behavioural verification of migration 0192 on every company's books: a
 * posted, matched or reconciled bank line is not deleted; an unposted one is,
 * with the whole row kept in the audit log; a match can be taken back; and
 * deleting asks for a permission of its own.
 *
 * Each company runs inside its own transaction that is ALWAYS rolled back.
 * When 0192 has not been applied it is applied first, inside that transaction.
 *
 * Only a company marked is_sample has entries posted in it. Posting takes the
 * company's next entry number, and holds it until the transaction ends, so in
 * a company people work in the run would make anyone posting wait for it. In
 * those companies the run applies 0192, reads how existing lines stand, tries
 * a delete that must be refused, and changes nothing anyone else needs.
 *
 * A refusal is tried inside a savepoint. A lock wanted for more than five
 * seconds stops the run rather than making anyone wait.
 *
 * Run: node --env-file=.env.local scripts/verify-refuse-delete-posted-line.mjs
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0192_refuse_delete_posted_bank_line.sql";
const MIGRATION = readFileSync(new URL(`../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const OUTSIDER = "00000000-0000-0000-0000-000000000000";
const WHY = "Imported twice by mistake";
const KINDS = ["deletable", "suggested", "ignored", "settled", "reconciled", "import_batch", "posted", "matched"];

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const killer = setTimeout(() => {
  console.error("HARD TIMEOUT");
  process.exit(2);
}, 5 * 60 * 1000);
await client.connect();

let passed = 0;
let failed = 0;
function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
const one = async (sql, params = []) => (await client.query(sql, params)).rows[0];
const as = (userId) =>
  client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: "authenticated" })]);

/** Why a call is refused, or null when it is not. A refusal leaves the transaction usable; a call that goes through is kept. */
async function refusal(sql, params) {
  await client.query("savepoint trial");
  try {
    await client.query(sql, params);
    await client.query("release savepoint trial");
    return null;
  } catch (error) {
    await client.query("rollback to savepoint trial");
    return error.message;
  }
}
const refused = async (label, sql, params, pattern) => {
  const why = await refusal(sql, params);
  check(label, why !== null && pattern.test(why), why ?? "not refused");
};

const DELETE = `select acc_delete_bank_transaction($1, $2)`;
const DELETE_OLD = `select acc_delete_bank_transaction_with_void($1, $2)`;
const UNMATCH = `select acc_unmatch_bank_transaction($1, $2)`;
const state = async (id) => (await one(`select acc_bank_line_delete_state($1) as s`, [id])).s;
const lineStatus = async (id) => (await one(`select status::text from acc_bank_transaction where id = $1`, [id]))?.status ?? "gone";

/** The permission, as the migration leaves it. */
async function checkPermission() {
  const permission = await one(`select category, min_role, is_enforced from acc_permission where key = 'banking.delete_line'`);
  check(
    "banking.delete_line is a permission of its own, under Banking, for staff",
    permission?.category === "Banking" && permission?.min_role === "staff" && permission?.is_enforced === true,
    JSON.stringify(permission),
  );
  const grants = await client.query(`select role::text, allowed from acc_role_permission where permission_key = 'banking.delete_line' order by role`);
  check(
    "it is given to admins and accountants, and to no other role",
    grants.rows.length > 0 && grants.rows.every((g) => g.allowed === ["admin", "accountant"].includes(g.role)),
    JSON.stringify(grants.rows),
  );
}

/** A company people work in: read how its lines stand, and try one delete that must be refused. Nothing is posted. */
async function readOnlyChecks(admin) {
  await client.query("set local role authenticated");
  await as(admin.id);
  const sample = await client.query(`
    (select id from acc_bank_transaction where status = 'matched' order by txn_date desc, id limit 3)
    union all
    (select id from acc_bank_transaction where status = 'unmatched' order by txn_date desc, id limit 2)`);
  if (!sample.rows.length) {
    console.log("  (no bank lines to read)");
    return;
  }
  const states = [];
  for (const { id } of sample.rows) states.push({ id, ...(await state(id)) });
  check(
    `every line read stands as one of the eight kinds (${states.map((s) => s.kind).join(", ")})`,
    states.every((s) => KINDS.includes(s.kind) && (s.kind === "deletable" || typeof s.message === "string")),
    JSON.stringify(states),
  );
  const kept = states.find((s) => s.kind !== "deletable");
  if (kept) {
    const before = await lineStatus(kept.id);
    const why = await refusal(DELETE, [kept.id, WHY]);
    check(`deleting a ${kept.kind} line is refused, in the words its state gives`, why === kept.message, why ?? "not refused");
    check("and the line is as it was", (await lineStatus(kept.id)) === before);
  }
}

/** A sample company: every case, on lines and entries made here and rolled back. */
async function fullChecks(admin, base) {
  const account = async (code, name, type) =>
    (await one(
      `insert into acc_account (account_code, name, account_type, currency_code, is_posting_account)
       values ($1, $2, $3, $4, true) returning id`,
      [code, name, type, base.code],
    )).id;
  const gl = await account("ZZ-VERIFY-DL-B", "Verify delete-line bank", "bank");
  const charges = await account("ZZ-VERIFY-DL-X", "Verify delete-line charges", "expense");
  const sales = await account("ZZ-VERIFY-DL-I", "Verify delete-line sales", "income");
  const bank = (await one(`insert into acc_bank_account (account_id, bank_name, currency_code) values ($1, 'Verify Bank', $2) returning id`, [gl, base.code])).id;
  const newLine = async (tag, amount) =>
    (await one(
      `insert into acc_bank_transaction (bank_account_id, txn_date, description, reference, amount_minor, raw_line, raw_hash, status, source)
       values ($1, '2026-07-15', $2, 'REF-0192', $3, $4, $5, 'unmatched', 'file_upload') returning id`,
      [bank, `Delete-line probe ${tag}`, amount, `2026-07-15,probe ${tag},${amount}`, createHash("sha256").update(`0192:${tag}`).digest("hex")],
    )).id;
  const lines = {
    plain: await newLine("plain", -1100),
    coded: await newLine("coded", -2200),
    match: await newLine("match", 3300),
    signed: await newLine("signed", -4400),
    held: await newLine("held", -5500),
  };
  const asAdmin = async () => {
    await client.query("set local role authenticated");
    await as(admin.id);
  };
  const entryStatus = async (number) => (await one(`select status::text from acc_journal_entry where entry_number = $1`, [number]))?.status;
  await asAdmin();

  // ---- an unposted, unmatched line: deleted, and the whole row kept
  check("an unposted, unmatched line is deletable", (await state(lines.plain)).kind === "deletable");
  await refused("deleting it without a reason is refused", DELETE, [lines.plain, "oops"], /Say why this line is being deleted/);
  check("deleting it with a reason goes through", (await refusal(DELETE, [lines.plain, WHY])) === null && (await lineStatus(lines.plain)) === "gone");
  const kept = await one(`select before_json, actor_id from acc_audit_log where table_name = 'acc_bank_transaction' and record_id = $1 and action = 'delete'`, [lines.plain]);
  const was = kept?.before_json ?? {};
  check(
    "the audit log keeps the whole line: enough to put it back by hand",
    was.bank_account_id === bank && was.txn_date === "2026-07-15" && Number(was.amount_minor) === -1100 && was.description === "Delete-line probe plain" &&
      was.reference === "REF-0192" && typeof was.raw_hash === "string" && String(was.raw_line).includes("probe plain") && was.source === "file_upload" &&
      was.status === "unmatched" && was.reason === WHY && kept.actor_id === admin.id,
    JSON.stringify(was),
  );

  // ---- a line posted by coding it here: refused; its entry voided, then deleted
  const posted = (await one(`select acc_categorise_bank_transaction($1, $2) as r`, [lines.coded, charges])).r;
  const coded = await state(lines.coded);
  check("a line coded here stands as posted, with its entry's number", coded.kind === "posted" && coded.entry_number === posted.entry_number, JSON.stringify(coded));
  await refused("deleting it is refused, naming the entry and the way out", DELETE, [lines.coded, WHY], /posted to the ledger as .+, so it is not deleted\. Void that entry first/);
  await refused("the old void-and-delete is refused the same way", DELETE_OLD, [lines.coded, WHY], /posted to the ledger as .+, so it is not deleted/);
  check("and voided nothing on the way", (await entryStatus(posted.entry_number)) === "posted" && (await lineStatus(lines.coded)) === "matched");
  await refused("unmatching it is refused: it was posted here, not matched", UNMATCH, [lines.coded, WHY], /posted here as .+ Void that entry instead/);
  await one(`select acc_uncategorise_bank_transaction($1, $2)`, [lines.coded, WHY]);
  check("voiding its entry keeps the entry in the journal, marked void", (await entryStatus(posted.entry_number)) === "void" && (await lineStatus(lines.coded)) === "unmatched");
  check("the line is then deletable, and is deleted", (await state(lines.coded)).kind === "deletable" && (await refusal(DELETE, [lines.coded, WHY])) === null && (await lineStatus(lines.coded)) === "gone");

  // ---- a line matched to an entry posted elsewhere: refused; unmatched, then deletable
  const journal = (await one(`select acc_post_manual_journal('2026-07-15', 'Verify deposit', null, $1, $2::jsonb) as id`, [
    base.code,
    JSON.stringify([
      { account_id: gl, debit_minor: 3300, credit_minor: 0 },
      { account_id: sales, debit_minor: 0, credit_minor: 3300 },
    ]),
  ])).id;
  const journalNumber = (await one(`select entry_number from acc_journal_entry where id = $1`, [journal])).entry_number;
  const bookLine = (await one(`select id from acc_journal_line where journal_entry_id = $1 and account_id = $2`, [journal, gl])).id;
  const suggest = () =>
    one(`select acc_upsert_bank_match_suggestions($1::jsonb)`, [
      JSON.stringify([{ bank_transaction_id: lines.match, journal_line_id: bookLine, rule_applied: "verify", confidence: 1 }]),
    ]);
  await suggest();
  const suggestion = (await one(`select id from acc_reconciliation where bank_transaction_id = $1`, [lines.match])).id;
  check("a line with a match on offer says so", (await state(lines.match)).kind === "suggested");
  await refused("deleting it is refused until the match is decided", DELETE, [lines.match, WHY], /Reject the match first/);
  await refused("unmatching a suggestion is refused", UNMATCH, [lines.match, WHY], /only suggested/);
  await one(`select acc_decide_bank_match($1, 'approved')`, [suggestion]);
  const matched = await state(lines.match);
  check("once approved it stands as matched, to that entry", matched.kind === "matched" && matched.entry_number === journalNumber, JSON.stringify(matched));
  await refused("deleting it is refused, naming the entry and Unmatch", DELETE, [lines.match, WHY], /matched to .+, an entry posted elsewhere, so it is not deleted\. Unmatch it first/);
  await refused("unmatching it without a reason is refused", UNMATCH, [lines.match, "no"], /Say why this line is being unmatched/);
  check("unmatching it goes through", (await refusal(UNMATCH, [lines.match, "Matched to the wrong deposit"])) === null);
  check(
    "the entry stays posted, the line waits for review again, and the match is gone",
    (await entryStatus(journalNumber)) === "posted" && (await lineStatus(lines.match)) === "unmatched" &&
      (await one(`select count(*)::int as n from acc_reconciliation where bank_transaction_id = $1`, [lines.match])).n === 0,
  );
  const unmatched = (await one(`select before_json from acc_audit_log where table_name = 'acc_bank_transaction' and record_id = $1 and action = 'unmatch'`, [lines.match]))?.before_json ?? {};
  check(
    "the audit log keeps what was matched, and why it was taken back",
    unmatched.journal_line_id === bookLine && unmatched.entry_number === journalNumber && unmatched.reason === "Matched to the wrong deposit",
    JSON.stringify(unmatched),
  );
  await suggest();
  check("the same match can be suggested again afterwards", (await state(lines.match)).kind === "suggested");

  // ---- a line of a reconciled month: refused whatever is asked of it
  const signedEntry = (await one(`select acc_categorise_bank_transaction($1, $2) as r`, [lines.signed, charges])).r;
  const signedLine = (await one(
    `select l.id from acc_journal_line l join acc_journal_entry e on e.id = l.journal_entry_id where e.entry_number = $1 and l.account_id = $2`,
    [signedEntry.entry_number, gl],
  )).id;
  await client.query("reset role");
  const month = (await one(
    `insert into acc_statement_reconciliation (bank_account_id, statement_ending_date, beginning_balance_minor, statement_ending_balance_minor, status)
     values ($1, '2026-07-31', 0, 0, 'completed') returning id`,
    [bank],
  )).id;
  await client.query(`insert into acc_reconciliation_line (reconciliation_id, journal_line_id) values ($1, $2)`, [month, signedLine]);
  await asAdmin();
  const signed = await state(lines.signed);
  check(
    "a line ticked on a completed reconciliation stands as reconciled, to that month",
    signed.kind === "reconciled" && signed.reconciliation_id === month && signed.reconciled_to === "2026-07-31",
    JSON.stringify(signed),
  );
  await refused("deleting it is refused outright, naming the month and what to do", DELETE, [lines.signed, WHY], /reconciled to Jul 31, 2026, so it is not deleted\. Reopen that reconciliation/);
  await refused("the old void-and-delete is refused too", DELETE_OLD, [lines.signed, WHY], /reconciled to Jul 31, 2026/);
  await refused("unmatching it is refused the same way", UNMATCH, [lines.signed, WHY], /reconciled to Jul 31, 2026, so it is not unmatched/);
  check("its entry is untouched", (await entryStatus(signedEntry.entry_number)) === "posted" && (await lineStatus(lines.signed)) === "matched");

  // ---- Remove these N entries (0140): still takes a coded line out, with the line kept whole
  await client.query("reset role");
  const removable = await newLine("balance", -6600);
  const another = await newLine("balance-2", -7700);
  await asAdmin();
  const balanceEntry = (await one(`select acc_categorise_bank_transaction($1, $2) as r`, [removable, charges])).r;
  const REMOVE = `select acc_remove_balance_entries($1, $2::uuid[], $3)`;
  check("Remove these N entries still removes a coded line", (await refusal(REMOVE, [bank, [balanceEntry.entry_id], "A balance read as a payment"])) === null);
  check("its entry is voided and kept, and the line is gone", (await entryStatus(balanceEntry.entry_number)) === "void" && (await lineStatus(removable)) === "gone");
  const removed = (await one(`select before_json from acc_audit_log where table_name = 'acc_bank_transaction' and record_id = $1 and action = 'delete'`, [removable]))?.before_json ?? {};
  check(
    "and the audit log keeps that line whole, with the reason",
    Number(removed.amount_minor) === -6600 && removed.description === "Delete-line probe balance" && removed.reason === "A balance read as a payment" &&
      removed.removed_with === "balance entries" && removed.journal_entry_id === balanceEntry.entry_id,
    JSON.stringify(removed),
  );

  // ---- the permission withheld: nobody of that role deletes, whatever the line, from wherever
  const anotherEntry = (await one(`select acc_categorise_bank_transaction($1, $2) as r`, [another, charges])).r;
  await client.query("reset role");
  await client.query(`update acc_role_permission set allowed = false where permission_key = 'banking.delete_line'`);
  await asAdmin();
  await refused("with the permission taken away, an unposted line is not deleted either", DELETE, [lines.held, WHY], /You do not have permission to delete bank lines/);
  await refused("nor through the old name", DELETE_OLD, [lines.held, WHY], /You do not have permission to delete bank lines/);
  await refused("nor by Remove these N entries", REMOVE, [bank, [anotherEntry.entry_id], "A balance read as a payment"], /You do not have permission to delete bank lines/);
  check("and that refusal changed nothing: the entry is posted, the line is there", (await entryStatus(anotherEntry.entry_number)) === "posted" && (await lineStatus(another)) === "matched");
  check("the line is still there, and its state can still be read", (await lineStatus(lines.held)) === "unmatched" && (await state(lines.held)).kind === "deletable");

  // ---- someone who is not staff
  await as(OUTSIDER);
  await refused("someone who is not staff cannot read a line's state", `select acc_bank_line_delete_state($1)`, [lines.held], /Not authorized to read bank lines/);
  await refused("nor delete", DELETE, [lines.held, WHY], /You do not have permission to delete bank lines/);
  await refused("nor unmatch", UNMATCH, [lines.match, WHY], /You do not have permission to review bank matches/);
}

const { rows: companies } = await client.query(
  `select schema_name, is_sample from onebook.company where status = 'active' order by display_order, schema_name`,
);

try {
  for (const { schema_name: schema, is_sample: sample } of companies) {
    console.log(`\n${schema}${sample ? " (sample: every case)" : " (read and refuse only)"}`);
    await client.query("begin");
    try {
      await client.query("set local lock_timeout = '5s'");
      await client.query("set local statement_timeout = '30s'");
      await client.query(`set local search_path = ${schema}, extensions`);
      const statements = schema === "public" ? [MIGRATION] : planCompanySchema([{ file: FILE, sql: MIGRATION }], schema).statements;
      const applied = (await client.query(`select 1 from acc_schema_migrations where filename = $1`, [FILE])).rowCount > 0;
      if (!applied) {
        for (const statement of statements) await client.query(statement);
        console.log("  (0192 applied inside the transaction, never committed)");
      }
      await checkPermission();
      const admin = await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`);
      const base = await one(`select code from acc_currency where is_base limit 1`);
      if (!admin || !base) {
        console.log("  (no active administrator or base currency; the rest skipped)");
        continue;
      }
      if (sample) await fullChecks(admin, base);
      else await readOnlyChecks(admin);
    } catch (error) {
      failed += 1;
      console.log(`  FAIL  the run threw — ${error.message}`);
    } finally {
      await client.query("rollback");
    }
  }
} finally {
  clearTimeout(killer);
  await client.end().catch(() => {});
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
