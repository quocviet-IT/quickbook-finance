/**
 * Behavioural verification of migration 0143 (Statement proof, 2.04) on every
 * company.
 *
 * Every schema gets ONE short transaction that is ALWAYS rolled back, with
 * lock_timeout and statement_timeout set. 0143 is applied inside it (retargeted
 * to the schema, as scripts/migrate.mjs does), so nothing is left behind.
 *
 *  - In every schema: structure only. The seven proof columns and their checks,
 *    the guard trigger, the two functions with their result types, security
 *    definer, pinned search path and grants, read in one query; and
 *    acc_import_bank_statement read before and after 0143, to show it is the
 *    same function.
 *  - In co_pc (the sample company) only: the behaviour. One bank account is
 *    made inside the transaction, so no existing line can interfere. The
 *    administrator acts as an accountant (staff, not an administrator), then as
 *    an administrator, then as a viewer, by changing their role inside the
 *    same transaction; an outsider is a user with no role.
 *      refusals      out (both ways), a missing opening or closing, a basis
 *                    outside its list, a line with no amount, an unknown
 *                    account, a missing proof
 *      accepted      a statement that adds up, its proof kept on the batch
 *      repeats       three identical lines with one already present import
 *                    two; importing the file again imports nothing
 *      skip          lines marked skip count in the proof but are not
 *                    imported; a statement whose lines are all skip, or that
 *                    has none, writes nothing
 *      override      refused for staff, refused without a reason, kept on the
 *                    batch with one audit row for an administrator, ignored
 *                    when the statement adds up
 *      guard         the proof cannot be written or changed directly; Undo and
 *                    the old import still work
 *      lines         acc_bank_lines_on names each source (books, feed, import,
 *                    other), leaves out a withdrawn feed line, keeps to the
 *                    range and pages in a stable order
 *      who may       a viewer reads the lines and cannot import; an outsider
 *                    can do neither
 *
 * 0143 adds columns to acc_bank_import_batch, which takes that table's
 * strongest lock until the transaction ends. The migration is sent in one round
 * trip and the structure read in one more, so a real company's imports are held
 * for as little time as possible.
 *
 * Prints counts and pass/fail lines only: no names, no amounts.
 *
 * Run alone, never beside another database script:
 *   node --env-file=.env.local scripts/verify-statement-proof.mjs
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { statementLineHashes } from "../lib/domain/banking-import.ts";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0143_statement_proof.sql";
const MIGRATION = readFileSync(new URL(`../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const SAMPLE = "co_pc";
const OUTSIDER = "00000000-0000-0000-0000-000000000000";
const FUNCTIONS = {
  "acc_import_bank_statement_proved(uuid,text,jsonb,jsonb)": "TABLE(inserted integer, skipped integer, batch_id uuid)",
  "acc_bank_lines_on(uuid,date,date)":
    "TABLE(id uuid, txn_date date, amount_minor bigint, raw_hash text, source_kind text, import_batch_id uuid)",
};
const COLUMNS = {
  statement_opening_minor: "bigint",
  statement_closing_minor: "bigint",
  opening_basis: "text",
  closing_basis: "text",
  out_by_minor: "bigint",
  override_reason: "text",
  overridden_by: "uuid",
};
const CHECKS = {
  acc_bank_import_batch_opening_basis_ck: ["'printed'", "'running'", "'prior'", "'typed'"],
  acc_bank_import_batch_closing_basis_ck: ["'printed'", "'running'", "'ledger'", "'typed'"],
  acc_bank_import_batch_override_reason_ck: ["char_length(override_reason) <= 500"],
};
const MESSAGES = {
  noOpening: "The statement has no opening balance; enter the one printed on the statement",
  noClosing: "The statement has no closing balance; enter the one printed on the statement",
  out: (amount) => `The statement does not add up: out by ${amount}. Only an administrator can import it anyway, with a reason.`,
  notAdmin: "Only an administrator can import a statement that does not add up",
  noReason: "Give a reason for importing a statement that does not add up",
  guard: "A statement's proof is kept with its import only through OneBook's own steps",
};

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
/** Runs `sql`, expecting a refusal holding `expect`; the savepoint puts everything back as it was. */
async function refused(label, sql, params, expect) {
  await client.query("savepoint refusal");
  try {
    await client.query(sql, params);
    check(label, false, "it was accepted");
  } catch (error) {
    const ok = expect instanceof RegExp ? expect.test(error.message) : error.message.includes(expect);
    // The message is printed only when it is not the one expected; every amount here is invented.
    check(label, ok, ok ? "" : error.message);
  } finally {
    await client.query("rollback to savepoint refusal");
  }
}
/** Runs `body` as the database owner, then goes back to being `userId`. */
async function asOwner(userId, body) {
  await client.query("reset role");
  try {
    return await body();
  } finally {
    await client.query("set local role authenticated");
    await as(userId);
  }
}
const sha = (text) => createHash("sha256").update(text).digest("hex");

// ---------------------------------------------------------------------------
// Structure, in every schema: one query, and the old import read before and after.
// ---------------------------------------------------------------------------
const FACTS = `
select jsonb_build_object(
  'columns', (
    select jsonb_object_agg(a.attname, jsonb_build_object(
             'type', format_type(a.atttypid, a.atttypmod), 'not_null', a.attnotnull,
             'default', pg_get_expr(d.adbin, d.adrelid)))
      from pg_attribute a
      left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
     where a.attrelid = to_regclass($1::text || '.acc_bank_import_batch')
       and a.attname = any ($2::text[]) and not a.attisdropped),
  'checks', (
    select jsonb_object_agg(c.conname, pg_get_constraintdef(c.oid))
      from pg_constraint c
     where c.conrelid = to_regclass($1::text || '.acc_bank_import_batch')
       and c.conname = any ($3::text[])),
  'trigger', (
    select jsonb_build_object(
             'enabled', t.tgenabled <> 'D',
             'function', p.proname,
             'definer', p.prosecdef,
             'path', (select s from unnest(p.proconfig) s where s like 'search_path=%'),
             'columns', (select array_agg(a.attname::text order by a.attname)
                           from pg_attribute a
                          where a.attrelid = t.tgrelid and a.attnum = any (t.tgattr::int2[])),
             'definition', pg_get_triggerdef(t.oid))
      from pg_trigger t join pg_proc p on p.oid = t.tgfoid
     where t.tgrelid = to_regclass($1::text || '.acc_bank_import_batch')
       and t.tgname = 'acc_bank_import_batch_proof_guard'),
  'functions', (
    select jsonb_object_agg(f.sig, case when p.oid is null then null else jsonb_build_object(
             'definer', p.prosecdef,
             'path', (select s from unnest(p.proconfig) s where s like 'search_path=%'),
             'result', pg_get_function_result(p.oid),
             'calls_import', p.prosrc like '%acc_import_bank_statement(%',
             'anon', has_function_privilege('anon', p.oid, 'execute'),
             'member', has_function_privilege('authenticated', p.oid, 'execute'),
             'service', has_function_privilege('service_role', p.oid, 'execute'),
             'public', exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                                where x.grantee = 0 and x.privilege_type = 'EXECUTE')) end)
      from unnest($4::text[]) as f(sig)
      left join pg_proc p on p.oid = to_regprocedure($1::text || '.' || f.sig))
) as facts`;

const OLD_IMPORT = `
select md5(p.prosrc) as body, pg_get_function_result(p.oid) as result, p.prosecdef as definer,
       array_to_string(p.proconfig, ',') as config, coalesce(p.proacl::text, '') as acl
  from pg_proc p where p.oid = to_regprocedure($1::text || '.acc_import_bank_statement(uuid,text,jsonb)')`;

function structure(schema, facts, oldBefore, oldAfter) {
  for (const [column, type] of Object.entries(COLUMNS)) {
    const c = facts.columns?.[column];
    check(`acc_bank_import_batch.${column} is a nullable ${type} with no default`,
      Boolean(c) && c.type === type && c.not_null === false && c.default === null, JSON.stringify(c));
  }
  for (const [name, words] of Object.entries(CHECKS)) {
    const def = facts.checks?.[name];
    check(`${name} checks ${words.length === 1 ? "the length" : "the list"}`,
      typeof def === "string" && words.every((w) => def.includes(w)), def ?? "missing");
  }
  const t = facts.trigger;
  check("the proof guard is a trigger on acc_bank_import_batch, enabled, watching exactly the seven columns",
    Boolean(t) && t.enabled && t.function === "acc_statement_proof_guard" &&
      JSON.stringify(t.columns) === JSON.stringify(Object.keys(COLUMNS).sort()) && /BEFORE INSERT OR UPDATE OF/i.test(t.definition),
    JSON.stringify(t && { enabled: t.enabled, columns: t.columns }));
  check(`the guard runs as the caller, search_path pinned to ${schema}`,
    Boolean(t) && t.definer === false && t.path === `search_path=${schema}`, JSON.stringify(t && { definer: t.definer, path: t.path }));
  for (const [sig, result] of Object.entries(FUNCTIONS)) {
    const f = facts.functions?.[sig];
    check(`${sig} exists, returns what parts 2 and 3 expect`, Boolean(f) && f.result === result, JSON.stringify(f?.result));
    check(`${sig} is security definer, search_path pinned to ${schema}`,
      Boolean(f) && f.definer && f.path === `search_path=${schema}`, JSON.stringify(f && { definer: f.definer, path: f.path }));
    check(`${sig} is closed to anon and public, open to signed-in users and the service role`,
      Boolean(f) && !f.anon && !f.public && f.member && f.service,
      JSON.stringify(f && { anon: f.anon, public: f.public, member: f.member, service: f.service }));
  }
  check("acc_import_bank_statement_proved imports through acc_import_bank_statement",
    facts.functions?.["acc_import_bank_statement_proved(uuid,text,jsonb,jsonb)"]?.calls_import === true);
  check("acc_import_bank_statement is still there, and 0143 left it exactly as it was (body, result, security, grants)",
    Boolean(oldBefore) && JSON.stringify(oldBefore) === JSON.stringify(oldAfter));
}

// ---------------------------------------------------------------------------
// Behaviour, in the sample company only
// ---------------------------------------------------------------------------
async function behaviour() {
  const admin = await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`);
  const base = await one(`select code from acc_currency where is_base limit 1`);
  if (!admin || !base) {
    console.log("  (no active administrator or base currency; behaviour checks skipped)");
    return;
  }

  // ---- a fresh bank account, made as the owner inside this rolled-back transaction
  const stamp = Date.now().toString(36).toUpperCase();
  const gl = (await one(
    `insert into acc_account (account_code, name, account_type, currency_code, is_posting_account)
     values ($1, 'Verify proof bank', 'bank', $2, true) returning id`,
    [`ZZ-VSP-${stamp}`, base.code],
  )).id;
  const K = (await one(
    `insert into acc_bank_account (account_id, bank_name, currency_code) values ($1, 'Verify Proof Bank', $2) returning id`,
    [gl, base.code],
  )).id;
  const entriesBefore = (await one(`select count(*)::int as n from acc_journal_entry`)).n;

  await client.query("set local role authenticated");
  await as(admin.id);
  /** The administrator, acting with another role inside this transaction. */
  const roleIs = (role) => {
    if (!["admin", "accountant", "viewer"].includes(role)) throw new Error(`unexpected role ${role}`);
    return asOwner(admin.id, () => client.query(`update acc_app_user set role = '${role}' where id = $1`, [admin.id]));
  };

  /** One invented statement line, shaped as the import service sends it. */
  const line = (date, minor, description, reference = null) => ({
    txn_date: date, description, reference, amount_minor: minor, running_balance_minor: null,
    raw_line: `${date},${description},${minor}`,
  });
  /** The lines with their real duplicate keys (the n-th identical line counted), the ones at `skips` marked skip. */
  const rowsOf = (lines, skips = []) => {
    const hashes = statementLineHashes(K, lines);
    return lines.map((l, i) => ({ ...l, raw_hash: hashes[i], source: "file_upload", ...(skips.includes(i) ? { skip: true } : {}) }));
  };
  const proof = (opening, closing, extra = {}) => ({
    opening_minor: opening, closing_minor: closing, opening_basis: "printed", closing_basis: "printed",
    set_aside: 0, override: null, ...extra,
  });
  const IMPORT = `select inserted, skipped, batch_id from acc_import_bank_statement_proved($1, $2, $3::jsonb, $4::jsonb)`;
  const args = (file, rows, p, account = K) => [account, file, JSON.stringify(rows), p === undefined ? null : JSON.stringify(p)];
  const importIt = async (file, rows, p) => {
    const r = await one(IMPORT, args(file, rows, p));
    return { inserted: Number(r.inserted), skipped: Number(r.skipped), batch: r.batch_id };
  };
  const linesOnK = async () => (await one(`select count(*)::int as n from acc_bank_transaction where bank_account_id = $1`, [K])).n;
  const batchesOnK = async () => (await one(`select count(*)::int as n from acc_bank_import_batch where bank_account_id = $1`, [K])).n;
  const batchOf = (id) => one(`select * from acc_bank_import_batch where id = $1`, [id]);
  const audit = (batch, action) =>
    asOwner(admin.id, () =>
      all(`select actor_id, after_json from acc_audit_log
            where table_name = 'acc_bank_import_batch' and record_id = $1 and action = $2 order by created_at, id`,
        [batch, action]));
  const hashHere = async (hash) =>
    (await one(`select count(*)::int as n from acc_bank_transaction where bank_account_id = $1 and raw_hash = $2`, [K, hash])).n;

  const PAYROLL = line("2026-03-31", -12345, "INVENTED PAYROLL CO PAYMENT", "PR-31");

  // ======================================================================
  // As staff: an accountant, not an administrator
  // ======================================================================
  await roleIs("accountant");
  const roles = await one(`select acc_is_staff() as staff, acc_is_admin() as admin`);
  check("acting as an accountant: staff, not an administrator", roles.staff === true && roles.admin === false);

  console.log("  refusals");
  const rent = rowsOf([line("2026-03-05", -30000, "INVENTED RENT")]);
  await refused("out by 50.00 (the lines come to less than the closing): refused, word for word", IMPORT,
    args("verify-out.csv", rent, proof(100000, 75000)), MESSAGES.out("50.00"));
  await refused("out by 50.00 the other way: the amount is never negative", IMPORT,
    args("verify-out.csv", rent, proof(100000, 65000)), MESSAGES.out("50.00"));
  await refused("a missing opening: refused", IMPORT, args("verify.csv", rent, proof(null, 70000)), MESSAGES.noOpening);
  await refused("an opening left out of the proof: refused the same way", IMPORT,
    args("verify.csv", rent, { closing_minor: 70000, opening_basis: "typed", closing_basis: "typed" }), MESSAGES.noOpening);
  await refused("a missing closing: refused", IMPORT, args("verify.csv", rent, proof(100000, null)), MESSAGES.noClosing);
  await refused("no proof at all: refused for its opening", IMPORT, args("verify.csv", rent, undefined), MESSAGES.noOpening);
  await refused("an opening basis outside printed, running, prior, typed: refused", IMPORT,
    args("verify.csv", rent, proof(100000, 70000, { opening_basis: "ledger" })), "Say where the opening balance came from");
  await refused("a closing basis outside printed, running, ledger, typed: refused", IMPORT,
    args("verify.csv", rent, proof(100000, 70000, { closing_basis: "prior" })), "Say where the closing balance came from");
  await refused("a line with no amount: refused", IMPORT,
    args("verify.csv", [{ ...rent[0], amount_minor: null }], proof(100000, 70000)), "Every statement line needs an amount");
  await refused("an unknown bank account: refused", IMPORT,
    [OUTSIDER, "verify.csv", JSON.stringify(rent), JSON.stringify(proof(100000, 70000))], "Bank account not found");
  check("refusals wrote nothing: no batch, no line", (await batchesOnK()) === 0 && (await linesOnK()) === 0);

  console.log("  a statement that adds up");
  const a = await importIt("verify-a.csv", rowsOf([PAYROLL]), proof(100000, 87655));
  check("accepted: one line imported, none skipped, a batch made", a.inserted === 1 && a.skipped === 0 && typeof a.batch === "string",
    JSON.stringify({ inserted: a.inserted, skipped: a.skipped }));
  const ba = await batchOf(a.batch);
  check("the proof is kept on the batch: opening, closing, both bases, out by 0",
    Number(ba.statement_opening_minor) === 100000 && Number(ba.statement_closing_minor) === 87655 &&
      ba.opening_basis === "printed" && ba.closing_basis === "printed" && Number(ba.out_by_minor) === 0);
  check("…with no override, and the batch is the one every import makes",
    ba.override_reason === null && ba.overridden_by === null && ba.row_count === 1 && ba.imported_by === admin.id &&
      ba.filename === "verify-a.csv" && ba.status === "active");
  const aInsert = await audit(a.batch, "insert");
  check("the import's own audit row is written, and no override row",
    aInsert.length === 1 && aInsert[0].after_json.inserted === 1 && aInsert[0].after_json.skipped === 0 &&
      (await audit(a.batch, "override")).length === 0);

  console.log("  repeated lines");
  const three = rowsOf([PAYROLL, PAYROLL, PAYROLL]);
  check("three identical lines carry three duplicate keys, the first the one already present",
    new Set(three.map((r) => r.raw_hash)).size === 3 && three[0].raw_hash === rowsOf([PAYROLL])[0].raw_hash);
  const b = await importIt("verify-b.csv", three, proof(100000, 62965, { opening_basis: "typed", closing_basis: "running" }));
  check("three identical lines with one already present: two imported, one skipped", b.inserted === 2 && b.skipped === 1,
    JSON.stringify({ inserted: b.inserted, skipped: b.skipped }));
  check("…so the account now holds the three", (await one(
    `select count(*)::int as n from acc_bank_transaction where bank_account_id = $1 and txn_date = '2026-03-31' and amount_minor = -12345`, [K])).n === 3);
  const bb = await batchOf(b.batch);
  check("…and the batch keeps the bases it was sent", bb.opening_basis === "typed" && bb.closing_basis === "running" && bb.row_count === 3);
  const again = await importIt("verify-b.csv", three, proof(100000, 62965, { opening_basis: "typed", closing_basis: "running" }));
  check("importing the file again imports nothing", again.inserted === 0 && again.skipped === 3 && (await linesOnK()) === 3,
    JSON.stringify({ inserted: again.inserted, skipped: again.skipped }));

  console.log("  lines marked skip");
  const cLines = [
    line("2026-04-02", 50000, "INVENTED DEPOSIT"),
    line("2026-04-03", -2000, "INVENTED SERVICE FEE"),
    line("2026-04-04", -1000, "INVENTED CARD PURCHASE"),
  ];
  const cRows = rowsOf(cLines, [1]);
  await refused("without the skipped line the statement is out by 20.00: a skipped line counts in the proof", IMPORT,
    args("verify-c.csv", [cRows[0], cRows[2]], proof(62965, 109965)), MESSAGES.out("20.00"));
  const c = await importIt("verify-c.csv", cRows, proof(62965, 109965, { set_aside: 1 }));
  check("with it, the statement adds up: two imported, none skipped", c.inserted === 2 && c.skipped === 0,
    JSON.stringify({ inserted: c.inserted, skipped: c.skipped }));
  check("the line marked skip is not imported, the others are",
    (await hashHere(cRows[1].raw_hash)) === 0 && (await hashHere(cRows[0].raw_hash)) === 1 && (await hashHere(cRows[2].raw_hash)) === 1);
  check("the batch counts the two lines it imported", (await batchOf(c.batch)).row_count === 2);
  const batchesNow = await batchesOnK();
  const linesNow = await linesOnK();
  const allSkip = await importIt("verify-skip.csv", rowsOf([line("2026-04-06", -700, "INVENTED TRANSFER")], [0]), proof(0, -700));
  check("every line marked skip: nothing imported, no batch", allSkip.inserted === 0 && allSkip.skipped === 0 && allSkip.batch === null);
  const empty = await importIt("verify-empty.csv", [], proof(500, 500));
  check("a statement with no lines that adds up: nothing imported, no batch", empty.inserted === 0 && empty.batch === null);
  check("…and neither wrote anything", (await batchesOnK()) === batchesNow && (await linesOnK()) === linesNow);
  await refused("a statement with no lines that does not add up: refused", IMPORT, args("verify-empty.csv", [], proof(500, 400)),
    MESSAGES.out("1.00"));

  console.log("  importing anyway");
  const dRows = rowsOf([line("2026-04-08", -4321, "INVENTED WIRE OUT")]);
  const outD = proof(109965, 105000);
  const reason = "Verify: one line on the invented statement is misread";
  await refused("staff, no override: refused with the amount out", IMPORT, args("verify-d.csv", dRows, outD), MESSAGES.out("6.44"));
  await refused("staff, with an override and a reason: refused", IMPORT,
    args("verify-d.csv", dRows, { ...outD, override: { reason } }), MESSAGES.notAdmin);
  await refused("staff, with an override and no reason: refused as staff first", IMPORT,
    args("verify-d.csv", dRows, { ...outD, override: { reason: " " } }), MESSAGES.notAdmin);
  const okWithOverride = await importIt("verify-e.csv", rowsOf([line("2026-04-09", -100, "INVENTED FEE")]),
    proof(109965, 109865, { override: { reason } }));
  const be = await batchOf(okWithOverride.batch);
  check("staff, an override on a statement that adds up: accepted, and the override is ignored",
    okWithOverride.inserted === 1 && be.override_reason === null && be.overridden_by === null && Number(be.out_by_minor) === 0 &&
      (await audit(okWithOverride.batch, "override")).length === 0);

  await roleIs("admin");
  check("acting as the administrator again", (await one(`select acc_is_admin() as a`)).a === true);
  await refused("an administrator still needs an override: refused without one", IMPORT, args("verify-d.csv", dRows, outD),
    MESSAGES.out("6.44"));
  await refused("an administrator, blank reason: refused", IMPORT,
    args("verify-d.csv", dRows, { ...outD, override: { reason: "   " } }), MESSAGES.noReason);
  await refused("an administrator, an override with no reason at all: refused", IMPORT,
    args("verify-d.csv", dRows, { ...outD, override: {} }), MESSAGES.noReason);
  await refused("an administrator, a reason over 500 characters: refused", IMPORT,
    args("verify-d.csv", dRows, { ...outD, override: { reason: "x".repeat(501) } }), "Keep the reason to 500 characters or fewer");
  const d = await importIt("verify-d.csv", dRows, { ...outD, set_aside: 2, override: { reason: `  ${reason}  ` } });
  check("an administrator with a reason: accepted", d.inserted === 1 && typeof d.batch === "string");
  const bd = await batchOf(d.batch);
  check("the override is kept on the batch: the amount out (signed), the reason trimmed, who",
    Number(bd.out_by_minor) === 644 && bd.override_reason === reason && bd.overridden_by === admin.id &&
      Number(bd.statement_opening_minor) === 109965 && Number(bd.statement_closing_minor) === 105000);
  const dOverride = await audit(d.batch, "override");
  const o = dOverride[0]?.after_json;
  check("one override audit row: the reason, the amount out, the account and the file name",
    dOverride.length === 1 && dOverride[0].actor_id === admin.id && o.reason === reason && Number(o.out_by_minor) === 644 &&
      o.bank_account_id === K && typeof o.account === "string" && o.filename === "verify-d.csv");
  check("…with the lines, the opening, the closing and the lines set aside",
    Boolean(o) && o.lines === 1 && o.already_present === 0 && o.set_aside === 2 && Number(o.opening_minor) === 109965 &&
      Number(o.closing_minor) === 105000 && Number(o.lines_minor) === -4321);

  console.log("  the proof cannot be written directly");
  await roleIs("accountant");
  await refused("staff cannot set an override reason on a batch", `update acc_bank_import_batch set override_reason = 'x' where id = $1`,
    [a.batch], MESSAGES.guard);
  await refused("staff cannot clear the amount out of an overridden batch", `update acc_bank_import_batch set out_by_minor = 0 where id = $1`,
    [d.batch], MESSAGES.guard);
  await refused("staff cannot insert a batch carrying a proof",
    `insert into acc_bank_import_batch (bank_account_id, filename, row_count, opening_basis) values ($1, 'verify-forged.csv', 0, 'typed')`,
    [K], MESSAGES.guard);
  await client.query("savepoint undo_still_works");
  const undone = (await one(`select acc_undo_bank_statement_import($1, 'Verify: undo still works') as n`, [c.batch])).n;
  check("Undo still works on a proved import, and the proof stays on the undone batch",
    undone === 2 && (await batchOf(c.batch)).status === "voided" && Number((await batchOf(c.batch)).statement_closing_minor) === 109965);
  await client.query("rollback to savepoint undo_still_works");
  const old = await one(`select inserted, skipped, batch_id from acc_import_bank_statement($1, 'verify-old.csv', $2::jsonb)`,
    [K, JSON.stringify(rowsOf([line("2026-04-15", -250, "INVENTED OLD IMPORT")]))]);
  const bo = await batchOf(old.batch_id);
  check("the old import still imports as it did, keeping no proof",
    Number(old.inserted) === 1 && bo.statement_opening_minor === null && bo.out_by_minor === null && bo.opening_basis === null);

  console.log("  reading an account's bank lines");
  await asOwner(admin.id, async () => {
    await client.query(
      `insert into acc_bank_transaction (bank_account_id, txn_date, description, amount_minor, raw_hash, status, source)
       values ($1, '2026-04-10', 'Verify: from the books', -1500, 'ledger:' || gen_random_uuid(), 'matched', 'file_upload')`, [K]);
    await client.query(
      `insert into acc_bank_transaction (bank_account_id, txn_date, description, amount_minor, raw_hash, source, external_transaction_id)
       values ($1, '2026-04-11', 'Verify: from a feed', -2500, $2, 'bank_feed', $3)`, [K, sha(`vsp-feed-${stamp}`), `vsp-feed-${stamp}`]);
    await client.query(
      `insert into acc_bank_transaction (bank_account_id, txn_date, description, amount_minor, raw_hash, source, external_transaction_id,
                                         provider_removed_at, status)
       values ($1, '2026-04-11', 'Verify: withdrawn by the bank', -2600, $2, 'bank_feed', $3, now(), 'ignored')`,
      [K, sha(`vsp-feed-old-${stamp}`), `vsp-feed-old-${stamp}`]);
    await client.query(
      `insert into acc_bank_transaction (bank_account_id, txn_date, description, amount_minor, raw_hash, source)
       values ($1, '2026-04-12', 'Verify: other', 900, $2, 'file_upload')`, [K, sha(`vsp-other-${stamp}`)]);
    const tb = (await one(
      `insert into acc_import_batch (source, mode, file_name, sha256, entry_count, line_count, total_minor)
       values ('transactions', 'history', 'verify-transactions.csv', $1, 0, 1, 0) returning id`, [sha(`vsp-tb-${stamp}`)])).id;
    await client.query(
      `insert into acc_bank_transaction (bank_account_id, txn_date, description, amount_minor, raw_hash, status, source, transaction_batch_id)
       values ($1, '2026-04-13', 'Verify: transactions file', -300, $2, 'matched', 'file_upload', $3)`, [K, sha(`vsp-tx-${stamp}`), tb]);
  });
  const LINES = `select id, txn_date::text as txn_date, amount_minor, raw_hash, source_kind, import_batch_id
                   from acc_bank_lines_on($1, $2::date, $3::date)`;
  const lines = await all(LINES, [K, "2026-03-01", "2026-04-30"]);
  const live = (await one(
    `select count(*)::int as n from acc_bank_transaction where bank_account_id = $1 and provider_removed_at is null`, [K])).n;
  const kinds = (kind) => lines.filter((l) => l.source_kind === kind);
  check("every line the account holds in the range comes back, and the withdrawn feed line does not",
    lines.length === live && !lines.some((l) => Number(l.amount_minor) === -2600), `${lines.length} of ${live}`);
  check("one line from the books, by its ledger: hash", kinds("books").length === 1 && kinds("books")[0].raw_hash.startsWith("ledger:"));
  check("one line from a bank feed", kinds("feed").length === 1 && Number(kinds("feed")[0].amount_minor) === -2500);
  check("one line of another kind", kinds("other").length === 1 && Number(kinds("other")[0].amount_minor) === 900);
  const statementLines = kinds("import").filter((l) => l.import_batch_id !== null);
  check("each statement import's line is an import, with its batch",
    statementLines.length === live - 4 && statementLines.every((l) => typeof l.import_batch_id === "string"),
    `${statementLines.length} of ${live - 4}`);
  check("a transactions file's line is an import too, with no statement batch",
    kinds("import").filter((l) => l.import_batch_id === null).length === 1 &&
      Number(kinds("import").find((l) => l.import_batch_id === null)?.amount_minor) === -300);
  check("no line has any other kind", lines.every((l) => ["books", "feed", "import", "other"].includes(l.source_kind)));
  const ordered = lines.every((l, i) =>
    i === 0 || lines[i - 1].txn_date < l.txn_date || (lines[i - 1].txn_date === l.txn_date && lines[i - 1].id < l.id));
  check("ordered by date, then id", ordered);
  const paged = [];
  for (let start = 0; start < lines.length + 2; start += 2) {
    paged.push(...(await all(`${LINES} limit 2 offset ${start}`, [K, "2026-03-01", "2026-04-30"])));
  }
  check("read two at a time, the pages give every line once, in the same order",
    JSON.stringify(paged.map((l) => l.id)) === JSON.stringify(lines.map((l) => l.id)));
  const narrow = await all(LINES, [K, "2026-04-10", "2026-04-11"]);
  check("a narrower range keeps to its dates", narrow.length === 2 &&
    narrow.every((l) => l.txn_date >= "2026-04-10" && l.txn_date <= "2026-04-11"));
  await refused("no dates: refused", LINES, [K, null, "2026-04-30"], "Choose the dates to read bank lines between");
  check("another account's lines never come back", (await all(LINES, [OUTSIDER, "2026-03-01", "2026-04-30"])).length === 0);

  console.log("  who may");
  await client.query("savepoint as_viewer");
  await roleIs("viewer");
  check("a viewer reads the lines", (await all(LINES, [K, "2026-03-01", "2026-04-30"])).length === lines.length);
  await refused("a viewer cannot import", IMPORT, args("verify-f.csv", rowsOf([line("2026-04-20", -1, "INVENTED")]), proof(1, 0)),
    "Not authorized to import bank statements");
  await client.query("rollback to savepoint as_viewer");
  await as(OUTSIDER);
  await refused("an outsider cannot read the lines", LINES, [K, "2026-03-01", "2026-04-30"], "Not authorized to read bank lines");
  await refused("an outsider cannot import", IMPORT, args("verify-f.csv", rowsOf([line("2026-04-20", -1, "INVENTED")]), proof(1, 0)),
    "Not authorized to import bank statements");
  await as(admin.id);

  const entriesAfter = await asOwner(admin.id, async () => (await one(`select count(*)::int as n from acc_journal_entry`)).n);
  check("nothing was posted to the books", entriesAfter === entriesBefore);
}

// ---------------------------------------------------------------------------
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
      const oldBefore = await one(OLD_IMPORT, [schema]);
      // One round trip each. A newline before every semicolon, so a statement
      // ending in a line comment cannot swallow the next one.
      const sql = schema === "public"
        ? MIGRATION
        : planCompanySchema([{ file: FILE, sql: MIGRATION }], schema).statements.join("\n;\n");
      await client.query(sql);
      console.log("  (0143 applied inside the transaction, never committed)");
      await client.query(sql);
      check("applying 0143 a second time is harmless", true);
      await client.query(`set local search_path = ${schema}, extensions`);
      const { facts } = await one(FACTS, [schema, Object.keys(COLUMNS), Object.keys(CHECKS), Object.keys(FUNCTIONS)]);
      const oldAfter = await one(OLD_IMPORT, [schema]);
      structure(schema, facts, oldBefore, oldAfter);
      if (schema === SAMPLE) await behaviour();
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
