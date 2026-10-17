/**
 * Behavioural verification of migration 0150 (what changed after a
 * reconciliation was signed off, and the legs of each transfer, 2.12) on every
 * company.
 *
 * Every schema gets ONE short transaction that is ALWAYS rolled back, with
 * lock_timeout and statement_timeout set. 0150 is applied inside it (retargeted
 * to the schema, as scripts/migrate.mjs does), so nothing is left behind.
 *
 *  - In every schema: structure only. Both functions are stable security
 *    definers with a pinned search path, closed to anon and public, open to
 *    signed-in users and the service role, checking the role inside, and
 *    returning the agreed columns.
 *  - In co_pc (the sample company) only: the behaviour, on invented bank
 *    accounts, invented amounts and dates in 2099, all made inside the
 *    transaction. Entries are posted with acc_post_entry, reversed with
 *    acc_reverse_entry, ticked with acc_set_cleared and signed off with
 *    acc_create_reconciliation and acc_complete_reconciliation, as an active
 *    administrator. A void, a back-dated sign-off time and a tampered saved
 *    ending are written as the owner, because the app has no function for them.
 *
 * Prints counts and pass/fail lines only: no names, no amounts.
 *
 * Run alone, never beside another database script:
 *   node --env-file=.env.local scripts/verify-reconcile-integrity.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0150_reconcile_integrity.sql";
const FILE2 = "0151_reversed_change_settles.sql";
const MIGRATION = readFileSync(new URL(`../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const MIGRATION2 = readFileSync(new URL(`../supabase/migrations/${FILE2}`, import.meta.url), "utf8");
const SAMPLE = "co_pc";
const OUTSIDER = "00000000-0000-0000-0000-000000000000";
const CHANGES_COLUMNS =
  "change_key text, reconciliation_id uuid, bank_account_id uuid, statement_ending_date date, " +
  "completed_at timestamp with time zone, kind text, entry_id uuid, entry_number text, entry_date date, " +
  "signed_minor bigint, reversal_entry_id uuid, reversal_entry_number text, difference_minor bigint";
const LEGS_COLUMNS =
  "row_key text, row_kind text, entry_id uuid, entry_number text, entry_date date, bank_account_id uuid, " +
  "journal_line_id uuid, signed_minor bigint, ticked_reconciliation_id uuid, ticked_statement_date date, " +
  "covered_through date, reversed_by_entry_id uuid, reversed_by_entry_number text, reversal_of_entry_id uuid, " +
  "reversal_of_entry_number text, candidate_source text, candidate_id uuid, candidate_bank_account_id uuid, " +
  "candidate_date date, candidate_entry_id uuid, candidate_entry_number text";

pg.types.setTypeParser(1082, (value) => value); // dates stay as YYYY-MM-DD text
const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const killer = setTimeout(() => {
  console.error("HARD TIMEOUT");
  process.exit(2);
}, 5 * 60 * 1000);
await client.connect();

const totals = [];
let passed = 0;
let failed = 0;
function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}
const one = async (sql, params) => (await client.query(sql, params)).rows[0];
const all = async (sql, params) => (await client.query(sql, params)).rows;
const as = (userId) =>
  client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })]);
async function refused(label, sql, params, expect) {
  await client.query("savepoint refusal");
  try {
    await client.query(sql, params);
    check(label, false, "it was accepted");
  } catch (error) {
    const ok = expect instanceof RegExp ? expect.test(error.message) : error.message.includes(expect);
    check(label, ok, ok ? "" : error.message);
  } finally {
    await client.query("rollback to savepoint refusal");
  }
}
async function asOwner(userId, body) {
  await client.query("reset role");
  try {
    return await body();
  } finally {
    await client.query("set local role authenticated");
    await as(userId);
  }
}
const byC = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const factsFor = (signature) => `
select case when p.oid is null then null else jsonb_build_object(
         'definer', p.prosecdef,
         'stable', p.provolatile = 's',
         'path', (select s from unnest(p.proconfig) s where s like 'search_path=%'),
         'result', pg_get_function_result(p.oid),
         'anon', has_function_privilege('anon', p.oid, 'execute'),
         'member', has_function_privilege('authenticated', p.oid, 'execute'),
         'service', has_function_privilege('service_role', p.oid, 'execute'),
         'public', exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                            where x.grantee = 0 and x.privilege_type = 'EXECUTE'),
         'roleCheck', pg_get_functiondef(p.oid) ~* 'acc_is_staff[(][)] or coalesce[(]acc_current_role[(][)] = ''viewer''') end as facts
  from (select to_regprocedure($1::text || '.${signature}') as oid) f
  left join pg_proc p on p.oid = f.oid`;

function structure(schema, name, columns, f) {
  check(`${name} exists with the agreed columns`, Boolean(f) && f.result === `TABLE(${columns})`, JSON.stringify(f?.result));
  check(`…is a stable security definer with search_path pinned to ${schema}`,
    Boolean(f) && f.definer && f.stable && f.path === `search_path=${schema}`, JSON.stringify(f && { definer: f.definer, stable: f.stable, path: f.path }));
  check("…is closed to anon and public, open to signed-in users and the service role",
    Boolean(f) && !f.anon && !f.public && f.member && f.service, JSON.stringify(f && { anon: f.anon, public: f.public, member: f.member, service: f.service }));
  check("…and checks the role inside: staff or viewer", Boolean(f) && f.roleCheck === true);
}

async function behaviour(base) {
  const admin = (await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`))?.id;
  if (!admin) {
    console.log("  (no active administrator; behaviour checks skipped)");
    return;
  }

  // ---- the books: bank accounts and one offset account, all invented
  const makeGl = async (code, name, type) =>
    (await one(
      `insert into acc_account (account_code, name, account_type, currency_code, is_posting_account)
       values ($1, $2, $3::acc_account_type, $4, true) returning id`,
      [code, name, type, base],
    )).id;
  const banks = {};
  for (const key of ["V", "R2", "D", "K", "F", "P", "S", "R", "Y", "Z"]) {
    const gl = await makeGl(`ZZ-VERIFY-RI-${key}`, `Verify integrity bank ${key}`, "bank");
    const id = (await one(`insert into acc_bank_account (account_id, bank_name, currency_code) values ($1, $2, $3) returning id`,
      [gl, `Verify integrity bank ${key}`, base])).id;
    banks[key] = { id, gl };
  }
  const offset = await makeGl("ZZ-VERIFY-RI-OFF", "Verify integrity offset", "expense");

  await client.query("set local role authenticated");
  await as(admin);

  /** Posts an entry; each leg is [glAccountId, signedMinor] (positive = debit). Returns the entry id. */
  const post = async (date, legs) =>
    (await one(
      `select acc_post_entry($1, 'Verify integrity', 'manual'::acc_journal_source, null, $2, $3::jsonb) as id`,
      [date, base, JSON.stringify(legs.map(([account_id, amount]) => ({
        account_id,
        debit_minor: amount > 0 ? amount : 0,
        credit_minor: amount < 0 ? -amount : 0,
        amount_base_minor: Math.abs(amount),
      })))],
    )).id;
  const lineOf = async (entry, gl) =>
    (await one(`select id from acc_journal_line where journal_entry_id = $1 and account_id = $2`, [entry, gl])).id;
  const numberOf = async (entry) => (await one(`select entry_number from acc_journal_entry where id = $1`, [entry])).entry_number;
  /** A single bank line against the offset account, signed from the bank's side. */
  const bankEntry = (date, bank, amount) => post(date, [[bank.gl, amount], [offset, -amount]]);
  const postedAt = (entry, when) =>
    asOwner(admin, () => client.query(`update acc_journal_entry set posted_at = $2 where id = $1`, [entry, when]));
  const BEFORE = "2025-12-31T12:00:00Z";
  const SIGNED = "2026-01-01T12:00:00Z";
  const SIGNED2 = "2026-02-01T12:00:00Z";
  /** Creates, ticks, completes a reconciliation and dates its sign-off, so "posted after" is real. */
  const signOff = async (bank, ending, lines, endingBalance, completedAt = SIGNED) => {
    const rec = (await one(`select acc_create_reconciliation($1, $2, $3) as id`, [bank.id, ending, endingBalance])).id;
    for (const line of lines) await one(`select acc_set_cleared($1, $2, true) as r`, [rec, line]);
    await one(`select acc_complete_reconciliation($1) as r`, [rec]);
    await asOwner(admin, () => client.query(`update acc_statement_reconciliation set completed_at = $2 where id = $1`, [rec, completedAt]));
    return rec;
  };
  const mine = new Set(Object.values(banks).map((b) => b.id));
  const changes = async () => (await all(`select * from acc_reconciliation_changes()`)).filter((r) => mine.has(r.bank_account_id));
  const forRec = (rows, rec) => rows.filter((r) => r.reconciliation_id === rec);

  // ============ Part 1: changes after sign-off ============
  console.log("  changes after sign-off");

  // V: ticked, signed off, then voided
  const v1 = await bankEntry("2099-03-10", banks.V, 10000);
  await postedAt(v1, BEFORE);
  const recV = await signOff(banks.V, "2099-03-31", [await lineOf(v1, banks.V.gl)], 10000);
  // R2: ticked, signed off, then reversed
  const r1 = await bankEntry("2099-03-12", banks.R2, 20000);
  await postedAt(r1, BEFORE);
  const recR2 = await signOff(banks.R2, "2099-03-31", [await lineOf(r1, banks.R2.gl)], 20000);
  // D: three kinds of entry around a sign-off, then a second sign-off
  const d1 = await bankEntry("2099-03-10", banks.D, 30000);
  const dC = await bankEntry("2099-03-20", banks.D, 300); // inside the period, posted before sign-off, never ticked
  await postedAt(d1, BEFORE);
  await postedAt(dC, BEFORE);
  const recD1 = await signOff(banks.D, "2099-03-31", [await lineOf(d1, banks.D.gl)], 30000);
  const dA = await bankEntry("2099-03-15", banks.D, 400); // inside the period, posted after sign-off
  const dB = await bankEntry("2099-04-02", banks.D, 500); // after the statement date
  await postedAt(dB, "2026-01-15T12:00:00Z");
  const recD2 = await signOff(banks.D, "2099-04-30", [await lineOf(dB, banks.D.gl)], 30500, SIGNED2);
  const dE = await bankEntry("2099-04-15", banks.D, 600); // inside the second period, posted after its sign-off
  // K: clean
  const k1 = await bankEntry("2099-03-10", banks.K, 1000);
  await postedAt(k1, BEFORE);
  const recK = await signOff(banks.K, "2099-03-31", [await lineOf(k1, banks.K.gl)], 1000);
  // F: saved ending later disagrees with its ticks
  const f1 = await bankEntry("2099-03-10", banks.F, 2000);
  await postedAt(f1, BEFORE);
  const recF = await signOff(banks.F, "2099-03-31", [await lineOf(f1, banks.F.gl)], 2000);
  // P: ticked on a reconciliation still in progress, then voided
  const p1 = await bankEntry("2099-03-10", banks.P, 700);
  const recP = (await one(`select acc_create_reconciliation($1, '2099-03-31', 700) as id`, [banks.P.id])).id;
  await one(`select acc_set_cleared($1, $2, true) as r`, [recP, await lineOf(p1, banks.P.gl)]);

  const quiet = await changes();
  check("a clean reconciliation produces no row", forRec(quiet, recK).length === 0, String(forRec(quiet, recK).length));
  check("before any change, the others signed off clean show nothing",
    [recV, recR2, recF, recP].every((r) => forRec(quiet, r).length === 0), JSON.stringify(quiet.map((r) => r.kind)));

  // the changes
  await asOwner(admin, () => client.query(`update acc_journal_entry set status = 'void', voided_at = now() where id = $1`, [v1]));
  await asOwner(admin, () => client.query(`update acc_journal_entry set status = 'void', voided_at = now() where id = $1`, [p1]));
  const reversal = await one(`select acc_reverse_entry($1, 'verify reversal', '2099-04-05') as id`, [r1]);
  await asOwner(admin, () => client.query(`update acc_statement_reconciliation set statement_ending_balance_minor = 2700 where id = $1`, [recF]));
  const rows = await changes();
  const kinds = (rec) => forRec(rows, rec).map((r) => r.kind).sort();

  const voided = forRec(rows, recV).find((r) => r.kind === "voided");
  check("a ticked entry that was voided gives a voided row", Boolean(voided));
  check("…naming the entry, its date and its signed amount on the bank account",
    voided?.entry_id === v1 && voided.entry_number === (await numberOf(v1)) && voided.entry_date === "2099-03-10" && Number(voided.signed_minor) === 10000);
  check("…with the reconciliation, bank account and the sign-off time",
    voided?.bank_account_id === banks.V.id && voided.statement_ending_date === "2099-03-31" && voided.completed_at.toISOString() === SIGNED.replace("Z", ".000Z"));
  check("…and, since the void takes it out of the sum, a drift row as well", kinds(recV).join() === "drift,voided", kinds(recV).join());
  const driftV = forRec(rows, recV).find((r) => r.kind === "drift");
  check("…whose difference is what the void removed", Number(driftV?.difference_minor) === 10000, String(driftV?.difference_minor));

  const reversed = forRec(rows, recR2).find((r) => r.kind === "reversed");
  check("a ticked entry that was reversed gives a reversed row", Boolean(reversed));
  check("…naming the entry and the reversing entry",
    reversed?.entry_id === r1 && reversed.reversal_entry_id === reversal.id && reversed.reversal_entry_number === (await numberOf(reversal.id)));
  check("…and nothing else: the original stays posted, so the sum still adds up", kinds(recR2).join() === "reversed", kinds(recR2).join());
  check("a reversal dated after the statement is not reported as added", !rows.some((r) => r.kind === "added" && r.entry_id === reversal.id));

  const addedD1 = forRec(rows, recD1).filter((r) => r.kind === "added");
  check("an entry posted after sign-off, dated inside the period, gives an added row",
    addedD1.length === 1 && addedD1[0].entry_id === dA && addedD1[0].entry_date === "2099-03-15" && Number(addedD1[0].signed_minor) === 400,
    JSON.stringify(addedD1.map((r) => r.entry_date)));
  check("…not an entry posted before sign-off, nor one dated after the statement", !addedD1.some((r) => r.entry_id === dC || r.entry_id === dB));
  check("…and nothing else on that reconciliation", kinds(recD1).join() === "added", kinds(recD1).join());
  const addedD2 = forRec(rows, recD2).filter((r) => r.kind === "added");
  check("…the next reconciliation reports only what falls after the previous statement date",
    addedD2.length === 1 && addedD2[0].entry_id === dE && !addedD2.some((r) => r.entry_id === dA), JSON.stringify(addedD2.map((r) => r.entry_date)));

  const drift = forRec(rows, recF).find((r) => r.kind === "drift");
  check("a saved ending that no longer equals beginning plus ticks gives a drift row", kinds(recF).join() === "drift", kinds(recF).join());
  const rF = await one(`select beginning_balance_minor b, statement_ending_balance_minor e, acc_recon_cleared_total(id) c from acc_statement_reconciliation where id = $1`, [recF]);
  check("…whose difference is the amount sign-off would have refused (ending - (beginning + ticks))",
    Number(drift?.difference_minor) === Number(rF.e) - (Number(rF.b) + Number(rF.c)) && Number(drift.difference_minor) === 700);
  check("…and carries no entry", drift?.entry_id === null && drift.entry_number === null && drift.signed_minor === null);
  check("a reconciliation still in progress is never reported", forRec(rows, recP).length === 0);
  check("a clean reconciliation still produces none", forRec(rows, recK).length === 0);

  check("every row has a distinct change_key", new Set(rows.map((r) => r.change_key)).size === rows.length);
  const everything = await all(`select * from acc_reconciliation_changes()`);
  const expectedOrder = [...everything].sort((a, b) => byC(a.reconciliation_id, b.reconciliation_id) || byC(a.change_key, b.change_key));
  check("rows come ordered by reconciliation, then change_key",
    JSON.stringify(everything.map((r) => r.change_key)) === JSON.stringify(expectedOrder.map((r) => r.change_key)));

  // ---- 0151: a reversed row settles once the reversal is itself reconciled
  console.log("  a reversal that is reconciled settles the reversed row");
  check("a ticked entry reversed, the reversal ticked nowhere, still gives a reversed row",
    forRec(rows, recR2).some((r) => r.kind === "reversed" && r.reversal_entry_id === reversal.id));
  const reversalLine = await lineOf(reversal.id, banks.R2.gl);
  const recR2b = await signOff(banks.R2, "2099-04-30", [reversalLine], 0, SIGNED2);
  const settled = await changes();
  check("once the reversal is ticked on a later completed reconciliation of the account, the reversed row is gone",
    !settled.some((r) => r.kind === "reversed" && r.entry_id === r1), JSON.stringify(forRec(settled, recR2).map((r) => r.kind)));
  check("…nothing else changes for the old reconciliation", forRec(settled, recR2).length === 0);
  check("…and the later one is clean: no drift, nothing added", forRec(settled, recR2b).length === 0, JSON.stringify(forRec(settled, recR2b).map((r) => r.kind)));

  // ============ Part 2: transfer legs ============
  console.log("  transfer legs");
  const { S, R, Y, Z } = banks;
  const t1 = await post("2099-02-01", [[R.gl, 25000], [S.gl, -25000]]); // S ticked, R open, money went to Y
  const t2 = await post("2099-02-10", [[Z.gl, 20000], [S.gl, -20000]]); // Z's statements stop before this
  const t3 = await post("2099-02-12", [[R.gl, 10000], [Z.gl, 20000], [S.gl, -30000]]); // three bank lines
  const t4 = await post("2099-02-14", [[Y.gl, 5000], [S.gl, -5000]]); // cleared on both sides
  const t5 = await post("2099-02-16", [[Z.gl, 700], [R.gl, -700]]); // neither side ticked, then reversed
  const reversal5 = (await one(`select acc_reverse_entry($1, 'verify reversal', '2099-02-17') as id`, [t5])).id;
  const ye = await bankEntry("2099-02-01", Y, 25000); // a ledger line elsewhere with the same amount that day
  const re = await bankEntry("2099-02-03", R, 25000); // the open leg's own account never counts as evidence
  void re;

  const recS = await signOff(S, "2099-02-28", [await lineOf(t1, S.gl), await lineOf(t2, S.gl), await lineOf(t4, S.gl)], -50000);
  const recR = await signOff(R, "2099-02-28", [], 0);
  const recZ = await signOff(Z, "2099-02-05", [], 0);
  const recY = await signOff(Y, "2099-02-28", [await lineOf(ye, Y.gl), await lineOf(t4, Y.gl)], 30000);
  // statement lines the reconciliations hold: the same amount on Y near t1, a copy that was set aside on Z,
  // one on Y too far away, and one the other way round on Y
  const stmt = (rec, no, date, amount, aside = false) =>
    asOwner(admin, () => client.query(
      `insert into acc_reconciliation_statement_line (reconciliation_id, line_no, txn_date, description, amount_minor, set_aside)
       values ($1, $2, $3, 'VERIFY', $4, $5)`, [rec, no, date, amount, aside]));
  await stmt(recY, 0, "2099-02-02", 25000);
  await stmt(recY, 1, "2099-02-12", 25000);
  await stmt(recY, 2, "2099-02-02", -25000);
  await stmt(recZ, 0, "2099-02-04", 25000, true);
  void recR;

  const legsAll = await all(`select * from acc_transfer_legs()`);
  const ids = new Set([t1, t2, t3, t4, t5, reversal5]);
  const legs = legsAll.filter((r) => r.row_kind === "leg" && ids.has(r.entry_id));
  const leg = (entry, bank) => legs.find((r) => r.entry_id === entry && r.bank_account_id === bank.id);
  check("each two-bank-line entry gives two legs (t1, t2, t4, t5 and its reversal)", legs.length === 10, String(legs.length));
  check("an entry with three bank lines gives no leg", !legs.some((r) => r.entry_id === t3));
  const skipped = legsAll.filter((r) => r.row_kind === "skipped" && r.entry_id === t3);
  check("…and is returned as skipped, with its number", skipped.length === 1 && skipped[0].entry_number === (await numberOf(t3)) && skipped[0].journal_line_id === null);
  check("an entry with one bank line is neither", !legsAll.some((r) => r.entry_id === ye && r.row_kind !== "candidate"));
  const l1s = leg(t1, S);
  const l1r = leg(t1, R);
  check("a leg carries its account, signed amount, entry number and date",
    l1s?.signed_minor !== undefined && Number(l1s.signed_minor) === -25000 && Number(l1r.signed_minor) === 25000
      && l1s.entry_number === (await numberOf(t1)) && l1s.entry_date === "2099-02-01" && l1s.journal_line_id === (await lineOf(t1, S.gl)));
  check("the ticked leg names its reconciliation and statement date", l1s.ticked_reconciliation_id === recS && l1s.ticked_statement_date === "2099-02-28");
  check("the other leg is not ticked", l1r.ticked_reconciliation_id === null && l1r.ticked_statement_date === null);
  check("a leg says how far its account's completed statements reach",
    l1r.covered_through === "2099-02-28" && leg(t2, Z).covered_through === "2099-02-05", `${l1r.covered_through} ${leg(t2, Z).covered_through}`);
  check("a transfer cleared on both sides shows both ticks",
    leg(t4, S).ticked_reconciliation_id === recS && leg(t4, Y).ticked_reconciliation_id === recY && leg(t4, Y).ticked_statement_date === "2099-02-28");
  check("the original of a reversed transfer names its reversal", leg(t5, Z).reversed_by_entry_id === reversal5 && leg(t5, Z).reversed_by_entry_number === (await numberOf(reversal5)));
  check("…and the reversal names its original", leg(reversal5, Z).reversal_of_entry_id === t5 && leg(reversal5, Z).reversed_by_entry_id === null);
  check("a transfer with no reversal carries no link", l1s.reversed_by_entry_id === null && l1s.reversal_of_entry_id === null);

  const cands = legsAll.filter((r) => r.row_kind === "candidate" && ids.has(r.entry_id));
  const forOpen = cands.filter((r) => r.entry_id === t1);
  check("the open leg of t1 gets its evidence", forOpen.length === 2, String(forOpen.length));
  check("…every row is for the unticked leg", forOpen.every((r) => r.journal_line_id === l1r.journal_line_id && r.bank_account_id === R.id));
  const sl = forOpen.find((r) => r.candidate_source === "statement_line");
  const ll = forOpen.find((r) => r.candidate_source === "ledger_line");
  check("a statement line held by another account's completed reconciliation, same amount within 7 days, is evidence",
    sl?.candidate_bank_account_id === Y.id && sl.candidate_date === "2099-02-02" && sl.candidate_entry_id === null);
  check("a posted ledger line on another account, same amount within 7 days, is evidence",
    ll?.candidate_bank_account_id === Y.id && ll.candidate_entry_id === ye && ll.candidate_entry_number === (await numberOf(ye)) && ll.candidate_date === "2099-02-01");
  check("…not a line too far away, the opposite way round, set aside, or on the open leg's own account",
    forOpen.length === 2 && !forOpen.some((r) => r.candidate_bank_account_id === R.id || r.candidate_bank_account_id === Z.id));
  check("a leg whose account's statements stop before the entry date has no evidence", !cands.some((r) => r.entry_id === t2));
  check("a transfer ticked on neither side has none", !cands.some((r) => r.entry_id === t5 || r.entry_id === reversal5));
  check("a transfer cleared on both sides has none", !cands.some((r) => r.entry_id === t4));

  check("every row has a distinct row_key", new Set(legsAll.map((r) => r.row_key)).size === legsAll.length);
  const expectedLegs = [...legsAll].sort((a, b) => byC(a.row_kind, b.row_kind) || byC(a.entry_date, b.entry_date) || byC(a.row_key, b.row_key));
  check("rows come ordered by kind, entry date, then row_key",
    JSON.stringify(legsAll.map((r) => r.row_key)) === JSON.stringify(expectedLegs.map((r) => r.row_key)));

  // ============ who may read ============
  console.log("  who may read");
  const seen = (await changes()).length;
  await client.query("savepoint as_viewer");
  await asOwner(admin, () => client.query(`update acc_app_user set role = 'viewer' where id = $1`, [admin]));
  check("a viewer may read both", (await changes()).length === seen && (await all(`select 1 from acc_transfer_legs() limit 1`)).length >= 0);
  await client.query("rollback to savepoint as_viewer");
  await as(OUTSIDER);
  await refused("an outsider may not read changes", `select * from acc_reconciliation_changes()`, [], "Not authorized to read changes to reconciliations");
  await refused("…nor transfers", `select * from acc_transfer_legs()`, [], "Not authorized to read transfers");
  await as(admin);
  check("an administrator still may", (await changes()).length === seen);

  await client.query("reset role");
}

const { rows: companies } = await client.query(
  `select schema_name from onebook.company where status = 'active' order by display_order, schema_name`,
);

try {
  for (const { schema_name: schema } of companies) {
    console.log(`\n${schema}`);
    const before = { passed, failed };
    await client.query("begin");
    try {
      await client.query("set local lock_timeout = '3s'");
      await client.query("set local statement_timeout = '60s'");
      await client.query(`set local search_path = ${schema}, extensions`);
      const sql = schema === "public"
        ? MIGRATION
        : planCompanySchema([{ file: FILE, sql: MIGRATION }], schema).statements.join("\n;\n");
      const sql2 = schema === "public"
        ? MIGRATION2
        : planCompanySchema([{ file: FILE2, sql: MIGRATION2 }], schema).statements.join("\n;\n");
      await client.query(sql);
      await client.query(sql2);
      console.log("  (0150 and 0151 applied inside the transaction, never committed)");
      await client.query(sql);
      await client.query(sql2);
      check("applying 0150 and 0151 a second time is harmless", true);
      await client.query(`set local search_path = ${schema}, extensions`);
      structure(schema, "acc_reconciliation_changes", CHANGES_COLUMNS, (await one(factsFor("acc_reconciliation_changes()"), [schema])).facts);
      structure(schema, "acc_transfer_legs", LEGS_COLUMNS, (await one(factsFor("acc_transfer_legs()"), [schema])).facts);
      if (schema === SAMPLE) {
        const base = (await one(`select code from acc_currency where is_base limit 1`))?.code;
        if (base) await behaviour(base);
        else console.log("  (no base currency; behaviour checks skipped)");
      }
    } catch (error) {
      failed += 1;
      console.log(`  FAIL ${schema} stopped: ${error.message}`);
    } finally {
      await client.query("rollback");
    }
    totals.push({ schema, passed: passed - before.passed, failed: failed - before.failed });
  }
} finally {
  clearTimeout(killer);
  await client.end();
}
console.log("");
for (const t of totals) console.log(`${t.schema}: ${t.passed} passed, ${t.failed} failed`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
