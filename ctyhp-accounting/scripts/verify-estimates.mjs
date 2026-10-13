/**
 * Behavioural verification of migration 0141 (Estimates) on every company.
 *
 * Every schema gets ONE short transaction that is ALWAYS rolled back, with
 * lock_timeout and statement_timeout set. 0141 is applied inside it (retargeted
 * to the schema, as scripts/migrate.mjs does), so nothing is left behind.
 *
 *  - In every schema: structure only. The tables, columns, checks, indexes,
 *    policies, grants, triggers, the EST- sequence and its registry row, and
 *    the four functions, read in one query.
 *  - In co_pc (the sample company) only: the behaviour. Estimates are saved,
 *    edited, declined, reopened, turned into invoices, voided and deleted there,
 *    for invented customers and tax codes, on dates in 2099. Nothing posts.
 *
 * 0141 adds a column to acc_invoice, which takes that table's strongest lock
 * until the transaction ends. The migration is therefore sent in one round trip
 * and the structure read in one more, so a real company's invoices are held
 * for as little time as possible. The behaviour, which takes longer, runs only
 * on the sample company.
 *
 * Prints counts and pass/fail lines only.
 *
 * Run alone, never beside another database script:
 *   node --env-file=.env.local scripts/verify-estimates.mjs
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { planCompanySchema } from "../lib/domain/schema-template.ts";

const FILE = "0141_estimates.sql";
const MIGRATION = readFileSync(new URL(`../supabase/migrations/${FILE}`, import.meta.url), "utf8");
const SAMPLE = "co_pc";
const OUTSIDER = "00000000-0000-0000-0000-000000000000";
const FUNCTIONS = [
  "acc_save_estimate(uuid,uuid,date,date,text,text,jsonb)",
  "acc_set_estimate_declined(uuid,boolean)",
  "acc_delete_estimate(uuid)",
  "acc_create_invoice_from_estimate(uuid,uuid,date,date,text,text,jsonb)",
];

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
    check(label, expect instanceof RegExp ? expect.test(error.message) : error.message.includes(expect), error.message);
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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------------------
// Structure, in every schema: one query, so a real company's acc_invoice is
// locked for as short a time as possible.
// ---------------------------------------------------------------------------
const FACTS = `
select jsonb_build_object(
  'tables', (
    select jsonb_object_agg(c.relname, jsonb_build_object(
             'rls', c.relrowsecurity,
             'read', has_table_privilege('authenticated', c.oid, 'select'),
             'write', has_table_privilege('authenticated', c.oid, 'insert')
                   or has_table_privilege('authenticated', c.oid, 'update')
                   or has_table_privilege('authenticated', c.oid, 'delete')
                   or has_table_privilege('authenticated', c.oid, 'truncate'),
             'anon', has_table_privilege('anon', c.oid, 'select')
                  or has_table_privilege('anon', c.oid, 'insert')
                  or has_table_privilege('anon', c.oid, 'update')
                  or has_table_privilege('anon', c.oid, 'delete'),
             'service', has_table_privilege('service_role', c.oid, 'select')
                    and has_table_privilege('service_role', c.oid, 'insert')
                    and has_table_privilege('service_role', c.oid, 'update')
                    and has_table_privilege('service_role', c.oid, 'delete'),
             'columns', (select jsonb_agg(a.attname order by a.attnum)
                           from pg_attribute a
                          where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped)))
      from pg_class c
     where c.relnamespace = $1::text::regnamespace and c.relname in ('acc_estimate', 'acc_estimate_line')),
  'checks', (
    select jsonb_agg(k.conname order by k.conname)
      from pg_constraint k
     where k.conrelid = to_regclass($1::text || '.acc_estimate') and k.contype = 'c'),
  'link', (
    select jsonb_build_object('nullable', not a.attnotnull,
                              'references', k.confrelid = to_regclass($1::text || '.acc_estimate'))
      from pg_attribute a
      left join pg_constraint k
        on k.conrelid = a.attrelid and k.contype = 'f' and k.conkey = array[a.attnum]
     where a.attrelid = to_regclass($1::text || '.acc_invoice') and a.attname = 'estimate_id' and not a.attisdropped),
  'cascade', (
    select k.confdeltype::text
      from pg_constraint k
     where k.conrelid = to_regclass($1::text || '.acc_estimate_line')
       and k.confrelid = to_regclass($1::text || '.acc_estimate') and k.contype = 'f'),
  'indexes', (
    select jsonb_object_agg(c.relname, jsonb_build_object(
             'table', t.relname, 'unique', i.indisunique, 'pred', pg_get_expr(i.indpred, i.indrelid)))
      from pg_index i
      join pg_class c on c.oid = i.indexrelid
      join pg_class t on t.oid = i.indrelid
     where c.relnamespace = $1::text::regnamespace
       and c.relname in ('acc_invoice_estimate_live_uq', 'acc_invoice_estimate_idx',
                         'acc_estimate_customer_idx', 'acc_estimate_date_idx')),
  'policies', (
    select jsonb_agg(p.policyname || ':' || p.cmd order by p.policyname)
      from pg_policies p
     where p.schemaname = $1::text and p.tablename in ('acc_estimate', 'acc_estimate_line')),
  'triggers', (
    select jsonb_agg(t.tgname order by t.tgname)
      from pg_trigger t
     where t.tgrelid = to_regclass($1::text || '.acc_estimate') and not t.tgisinternal),
  'sequence', (select prefix from acc_sequence where key = 'estimate'),
  'source', (
    select jsonb_build_array(label, table_name, number_column, date_column, status_column)
      from acc_number_source where sequence_key = 'estimate'),
  'functions', (
    select jsonb_object_agg(f.sig, case when p.oid is null then null else jsonb_build_object(
             'definer', p.prosecdef,
             'path', (select s from unnest(p.proconfig) s where s like 'search_path=%'),
             'anon', has_function_privilege('anon', p.oid, 'execute'),
             'member', has_function_privilege('authenticated', p.oid, 'execute'),
             'service', has_function_privilege('service_role', p.oid, 'execute'),
             'public', exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                                where x.grantee = 0 and x.privilege_type = 'EXECUTE')) end)
      from unnest($2::text[]) as f(sig)
      left join pg_proc p on p.oid = to_regprocedure($1::text || '.' || f.sig))
) as facts`;

function structure(schema, facts) {
  const tables = facts.tables ?? {};
  const columns = {
    acc_estimate: [
      "id", "estimate_number", "customer_id", "estimate_date", "expiry_date", "currency_code", "memo",
      "subtotal_minor", "tax_minor", "total_minor", "declined_at", "status", "created_by", "created_at", "updated_by",
      "updated_at",
    ],
    acc_estimate_line: [
      "id", "estimate_id", "line_order", "item_id", "description", "quantity", "unit_price_minor",
      "income_account_id", "tax_code_id", "line_subtotal_minor", "line_tax_minor", "line_total_minor",
    ],
  };
  for (const [table, expected] of Object.entries(columns)) {
    const t = tables[table];
    check(`${table} exists with row-level security on`, Boolean(t) && t.rls === true);
    check(`${table} has its ${expected.length} columns`, Boolean(t) && same(t.columns, expected), JSON.stringify(t?.columns));
    check(`${table}: signed-in users may only read, the service role keeps everything, anon nothing`,
      Boolean(t) && t.read && !t.write && t.service && !t.anon,
      JSON.stringify(t && { read: t.read, write: t.write, service: t.service, anon: t.anon }));
  }
  check("the estimate's checks: Valid until, status held to declined_at, totals that add up, USD",
    same(facts.checks, ["acc_estimate_expiry_ck", "acc_estimate_status_ck", "acc_estimate_totals_ck", "acc_usd_currency_check"]),
    JSON.stringify(facts.checks));
  check("acc_invoice.estimate_id is nullable and references acc_estimate",
    facts.link?.nullable === true && facts.link?.references === true, JSON.stringify(facts.link));
  check("an estimate's lines go with it", facts.cascade === "c", JSON.stringify(facts.cascade));

  const idx = facts.indexes ?? {};
  const live = idx.acc_invoice_estimate_live_uq;
  check("at most one invoice that is not void per estimate (partial unique index)",
    Boolean(live) && live.table === "acc_invoice" && live.unique &&
      /estimate_id IS NOT NULL/i.test(live.pred ?? "") && /status <> 'void'/i.test(live.pred ?? ""), JSON.stringify(live));
  check("every link is indexed, void ones included",
    idx.acc_invoice_estimate_idx?.table === "acc_invoice" && !idx.acc_invoice_estimate_idx.unique, JSON.stringify(idx.acc_invoice_estimate_idx));
  check("the estimate list's customer and date indexes exist",
    idx.acc_estimate_customer_idx?.table === "acc_estimate" && idx.acc_estimate_date_idx?.table === "acc_estimate");

  check("a read policy and no write policy, on both tables",
    same(facts.policies, ["acc_estimate_line_read:SELECT", "acc_estimate_read:SELECT"]), JSON.stringify(facts.policies));
  check("the header has its actor-stamp, audit and number-guard triggers",
    same(facts.triggers, ["acc_estimate_actor_stamp", "acc_estimate_atomic_audit", "acc_estimate_number_guard"]), JSON.stringify(facts.triggers));
  check("the EST- sequence row exists", facts.sequence === "EST-", JSON.stringify(facts.sequence));
  check("the sequence is registered for the Number Sequence report, with status as its status column",
    same(facts.source, ["Estimates", "acc_estimate", "estimate_number", "estimate_date", "status"]), JSON.stringify(facts.source));

  for (const sig of FUNCTIONS) {
    const f = facts.functions?.[sig];
    check(`${sig} exists, security definer, search_path pinned to ${schema}`,
      Boolean(f) && f.definer && f.path === `search_path=${schema}`, JSON.stringify(f));
    check(`${sig} is closed to anon and public, open to signed-in users and the service role`,
      Boolean(f) && !f.anon && !f.public && f.member && f.service, JSON.stringify(f));
  }
}

// ---------------------------------------------------------------------------
// Behaviour, in the sample company only
// ---------------------------------------------------------------------------
async function behaviour() {
  const admin = await one(`select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`);
  const income = await one(
    `select id from acc_account where account_type = 'income' and is_posting_account and status = 'active' order by account_code limit 1`,
  );
  const expense = await one(
    `select id from acc_account where account_type = 'expense' and is_posting_account and status = 'active' order by account_code limit 1`,
  );
  if (!admin || !income || !expense) {
    console.log("  (no active administrator, income account or expense account; behaviour checks skipped)");
    return;
  }

  // Invented customers and tax codes, made as the owner inside this rolled-back transaction.
  await as(admin.id);
  const stamp = Date.now();
  const customerA = (await one(`insert into acc_customer (name) values ('Verify Estimate Customer A') returning id`)).id;
  const customerB = (await one(`insert into acc_customer (name) values ('Verify Estimate Customer B') returning id`)).id;
  const salesTax = (await one(
    `insert into acc_tax_code (code, name, rate_percent, direction) values ($1, 'Verify estimate sales tax', 8.25, 'sales') returning id`,
    [`VERIFY-EST-S-${stamp}`],
  )).id;
  const purchaseTax = (await one(
    `insert into acc_tax_code (code, name, rate_percent, direction) values ($1, 'Verify estimate purchase tax', 5, 'purchase') returning id`,
    [`VERIFY-EST-P-${stamp}`],
  )).id;
  await client.query("set local role authenticated");
  await as(admin.id);

  const SAVE = `select acc_save_estimate($1, $2, $3::date, $4::date, 'USD', $5, $6::jsonb) as r`;
  const DECLINE = `select acc_set_estimate_declined($1, $2) as r`;
  const DELETE = `select acc_delete_estimate($1) as r`;
  const CONVERT = `select acc_create_invoice_from_estimate($1, $2, $3::date, $4::date, 'USD', $5, $6::jsonb) as id`;
  const save = (id, customer, date, expiry, memo, lines) =>
    one(SAVE, [id, customer, date, expiry, memo, JSON.stringify(lines)]).then((x) => x.r);
  const decline = (id, declined) => one(DECLINE, [id, declined]).then((x) => x.r);
  const convert = (id, customer, lines, memo = "Verify invoice from an estimate") =>
    one(CONVERT, [id, customer, "2099-01-15", "2099-02-14", memo, JSON.stringify(lines)]).then((x) => x.id);
  const line = (quantity, price, tax = null, description = "Verify estimate line") => ({
    description, quantity, unit_price_minor: price, income_account_id: income.id, tax_code_id: tax, item_id: null,
  });
  const header = (id) =>
    one(
      `select estimate_number, customer_id, estimate_date::text as estimate_date, expiry_date::text as expiry_date,
              memo, currency_code, subtotal_minor::text as sub, tax_minor::text as tax, total_minor::text as total,
              declined_at is not null as declined, status, created_by
         from acc_estimate where id = $1`,
      [id],
    );
  const LINE_FIELDS = `description, quantity::text as quantity, unit_price_minor::text as price, income_account_id,
                       tax_code_id, item_id, line_subtotal_minor::text as sub, line_tax_minor::text as tax,
                       line_total_minor::text as total`;
  const estimateLines = (id) =>
    all(`select id, line_order, ${LINE_FIELDS} from acc_estimate_line where estimate_id = $1 order by line_order`, [id]);
  /** The estimate's lines as the New invoice form would hand them over. */
  const asForm = async (id) =>
    (await one(
      `select jsonb_agg(jsonb_build_object('description', description, 'quantity', quantity,
                'unit_price_minor', unit_price_minor, 'income_account_id', income_account_id,
                'tax_code_id', tax_code_id, 'item_id', item_id) order by line_order) as lines
         from acc_estimate_line where estimate_id = $1`,
      [id],
    )).lines;
  const nextValue = () =>
    asOwner(admin.id, async () => Number((await one(`select next_value::text as v from acc_sequence where key = 'estimate'`)).v));
  const liveInvoices = async (id) =>
    (await one(`select count(*)::int as n from acc_invoice where estimate_id = $1 and status <> 'void'`, [id])).n;
  const auditRows = (id, action) =>
    asOwner(admin.id, async () =>
      (await one(`select count(*)::int as n from acc_audit_log where table_name = 'acc_estimate' and record_id = $1 and action = $2`, [id, action])).n);

  // ---- 1. save
  console.log("  saving");
  const start = await nextValue();
  const threeLines = [line(2, 12345, salesTax), line(1.5, 1000), line(1, 200, salesTax)];
  const first = await save(null, customerA, "2099-01-10", null, "  Verify note printed at the foot  ", threeLines);
  const num = first.estimate_number;
  check("a new estimate is numbered from the EST- sequence", num === `EST-${String(start).padStart(6, "0")}`);
  check("…and the sequence moves on by one", (await nextValue()) === start + 1);
  check("the totals are worked out line by line with the invoice's rounding (8.25% on 24,690 and on 200)",
    Number(first.subtotal_minor) === 26390 && Number(first.tax_minor) === 2054 && Number(first.total_minor) === 28444,
    JSON.stringify([first.subtotal_minor, first.tax_minor, first.total_minor]));
  let h = await header(first.id);
  check("the stored header holds the same totals", h.sub === "26390" && h.tax === "2054" && h.total === "28444");
  check("Valid until defaults to the estimate date plus 30 days", h.expiry_date === "2099-02-09", h.expiry_date);
  check("the note is kept, trimmed; USD; created by the person saving", h.memo === "Verify note printed at the foot" &&
    h.currency_code === "USD" && h.created_by === admin.id && h.customer_id === customerA && !h.declined);
  check("a new estimate's status is open", h.status === "open", h.status);
  const savedLines = await estimateLines(first.id);
  check("the lines are stored in order with their amounts and tax",
    same(savedLines.map((l) => [l.line_order, l.quantity, l.sub, l.tax, l.total]), [
      [0, "2.0000", "24690", "2037", "26727"],
      [1, "1.5000", "1500", "0", "1500"],
      [2, "1.0000", "200", "17", "217"],
    ]), JSON.stringify(savedLines.map((l) => [l.line_order, l.quantity, l.sub, l.tax, l.total])));
  check("creating the estimate is in the audit trail, for recent activity", (await auditRows(first.id, "insert")) === 1);

  // ---- 2. edit
  console.log("  editing");
  const oldIds = savedLines.map((l) => l.id);
  const edited = await save(first.id, customerA, "2099-01-10", "2099-03-01", "Verify note, edited", [line(4, 2500, salesTax, "Verify edited line")]);
  check("an edit keeps the id and the number", edited.id === first.id && edited.estimate_number === num);
  check("…takes no new number", (await nextValue()) === start + 1);
  const editedLines = await estimateLines(first.id);
  check("…replaces the lines",
    editedLines.length === 1 && editedLines[0].description === "Verify edited line" && !oldIds.includes(editedLines[0].id));
  check("…and works the totals out again",
    Number(edited.subtotal_minor) === 10000 && Number(edited.tax_minor) === 825 && Number(edited.total_minor) === 10825);
  h = await header(first.id);
  check("…keeping the Valid until it was given", h.expiry_date === "2099-03-01" && h.memo === "Verify note, edited");

  console.log("  refusals on save");
  const saveArgs = (lines, overrides = {}) => {
    const a = { id: null, customer: customerA, date: "2099-01-10", expiry: null, ...overrides };
    return [a.id, a.customer, a.date, a.expiry, null, JSON.stringify(lines)];
  };
  await refused("Valid until before the estimate date", SAVE, saveArgs([line(1, 100)], { expiry: "2099-01-09" }),
    "Valid until cannot be before the estimate date.");
  await refused("no lines", SAVE, saveArgs([]), "An estimate needs at least one line.");
  await refused("a quantity of zero", SAVE, saveArgs([line(0, 100)]), "Line 1: the quantity must be more than zero.");
  await refused("a negative unit price", SAVE, saveArgs([line(1, 100), line(1, -1)]), "Line 2: the unit price cannot be negative.");
  await refused("an account that is not income", SAVE, saveArgs([{ ...line(1, 100), income_account_id: expense.id }]),
    "Line 1: the account must be an active income account.");
  await refused("a purchase tax code", SAVE, saveArgs([line(1, 100, purchaseTax)]), "Line 1: the tax code must be an active sales tax code.");
  await refused("an unknown customer", SAVE, saveArgs([line(1, 100)], { customer: OUTSIDER }), "Choose an active customer for the estimate.");
  await refused("an unknown estimate", SAVE, saveArgs([line(1, 100)], { id: OUTSIDER }), "Estimate not found");
  check("…and no refusal took a number", (await nextValue()) === start + 1);

  // ---- 3. decline and reopen
  console.log("  declining and reopening");
  const declined = await decline(first.id, true);
  check("marking declined sets the time and names the estimate", declined.declined_at !== null && declined.estimate_number === num);
  check("…and its status reads declined", (await header(first.id)).status === "declined");
  const updatesBefore = await auditRows(first.id, "update");
  await decline(first.id, true);
  check("declining again changes nothing", (await auditRows(first.id, "update")) === updatesBefore);
  const whileDeclined = await save(first.id, customerA, "2099-01-10", null, null, threeLines);
  h = await header(first.id);
  check("a declined estimate can still be edited, and stays declined",
    Number(whileDeclined.total_minor) === 28444 && h.declined && h.expiry_date === "2099-02-09");
  await refused("a declined estimate cannot be turned into an invoice", CONVERT,
    [first.id, customerA, "2099-01-15", "2099-02-14", null, JSON.stringify(threeLines)],
    `${num} is marked declined. Reopen it before turning it into an invoice.`);
  const reopened = await decline(first.id, false);
  h = await header(first.id);
  check("reopening clears it, and its status reads open again", reopened.declined_at === null && !h.declined && h.status === "open");
  await client.query("reset role");
  await refused("the status cannot drift from declined_at, even for the owner",
    `update acc_estimate set status = 'declined' where id = $1`, [first.id], "acc_estimate_status_ck");
  await client.query("set local role authenticated");
  await as(admin.id);

  // ---- 4. convert
  console.log("  turning it into an invoice");
  const form = await asForm(first.id);
  const invoiceId = await convert(first.id, customerA, form);
  const inv = await one(
    `select status::text as status, customer_id, estimate_id, invoice_number, created_by,
            subtotal_minor::text as sub, tax_total_minor::text as tax, total_minor::text as total,
            balance_due_minor::text as due
       from acc_invoice where id = $1`,
    [invoiceId],
  );
  h = await header(first.id);
  check("a draft invoice is made, linked to the estimate, with no number yet",
    inv.status === "draft" && inv.estimate_id === first.id && inv.invoice_number === null, JSON.stringify([inv.status, inv.invoice_number]));
  check("…for the estimate's customer, by the person converting it", inv.customer_id === customerA && inv.created_by === admin.id);
  check("…with the estimate's subtotal, tax and total",
    inv.sub === h.sub && inv.tax === h.tax && inv.total === h.total && inv.due === h.total, JSON.stringify([inv.sub, inv.tax, inv.total]));
  const invoiceLines = await all(`select ${LINE_FIELDS} from acc_invoice_line where invoice_id = $1 order by line_order`, [invoiceId]);
  const fromEstimate = await all(`select ${LINE_FIELDS} from acc_estimate_line where estimate_id = $1 order by line_order`, [first.id]);
  check("…and the estimate's lines, field for field", invoiceLines.length === 3 && same(invoiceLines, fromEstimate));
  check("the estimate now has one live invoice", (await liveInvoices(first.id)) === 1);

  // ---- 5. a second conversion
  await refused("a second conversion is refused, naming the draft", CONVERT,
    [first.id, customerA, "2099-01-15", "2099-02-14", null, JSON.stringify(form)],
    `${num} has already been turned into an invoice (a draft invoice).`);
  await client.query("savepoint numbered");
  // Issuing would post; the number is set as the owner instead, to see the refusal name it.
  await asOwner(admin.id, () => client.query(`update acc_invoice set invoice_number = 'INV-VERIFY-EST' where id = $1`, [invoiceId]));
  await refused("…and names the invoice once it has a number", CONVERT,
    [first.id, customerA, "2099-01-15", "2099-02-14", null, JSON.stringify(form)],
    `${num} has already been turned into an invoice (INV-VERIFY-EST).`);
  await client.query("rollback to savepoint numbered");
  const other = (await one(
    `select acc_create_draft_invoice($1, '2099-01-15'::date, '2099-02-14'::date, 'USD', null, $2::jsonb) as id`,
    [customerA, JSON.stringify([line(1, 100)])],
  )).id;
  await refused("the index refuses a second live invoice on one estimate", `update acc_invoice set estimate_id = $1 where id = $2`,
    [first.id, other], "acc_invoice_estimate_live_uq");

  // ---- 6. converted locks the estimate
  console.log("  converted locks it");
  await refused("an edit is refused", SAVE, [first.id, customerA, "2099-01-10", null, null, JSON.stringify(threeLines)],
    `${num} has been turned into an invoice (a draft invoice), so it can no longer be edited.`);
  await refused("declining is refused", DECLINE, [first.id, true],
    `${num} has been turned into an invoice (a draft invoice), so it cannot be marked declined.`);
  await refused("reopening is refused", DECLINE, [first.id, false],
    `${num} has been turned into an invoice (a draft invoice), so it cannot be reopened.`);
  await refused("deleting is refused", DELETE, [first.id],
    `${num} has been turned into an invoice (a draft invoice), so it cannot be deleted.`);
  // A staff member, signed in, writing the tables directly instead of through the functions.
  await refused("a staff member cannot insert into acc_estimate directly",
    `insert into acc_estimate (estimate_number, customer_id, estimate_date, expiry_date) values ('EST-DIRECT', $1, '2099-01-01', '2099-01-02')`,
    [customerA], "permission denied");
  await refused("…nor update it directly", `update acc_estimate set memo = 'Verify direct write' where id = $1`, [first.id],
    "permission denied");
  await refused("…nor delete it directly", `delete from acc_estimate where id = $1`, [first.id], "permission denied");
  await refused("…nor write its lines directly", `delete from acc_estimate_line where estimate_id = $1`, [first.id],
    "permission denied");
  // Were direct writes ever opened up again, the number guard would still hold.
  await client.query("savepoint opened_up");
  await asOwner(admin.id, () =>
    client.query(`grant update, delete on acc_estimate to authenticated;
                  create policy acc_estimate_verify_open on acc_estimate for all using (true) with check (true)`));
  await refused("…and behind that, the number guard stops a direct delete", `delete from acc_estimate where id = $1`, [first.id],
    "has been numbered and cannot be deleted");
  await refused("…and a direct change of number", `update acc_estimate set estimate_number = 'EST-999999' where id = $1`, [first.id],
    "cannot be changed");
  await client.query("rollback to savepoint opened_up");

  // ---- 7. void the invoice: Open again
  console.log("  voiding the invoice");
  await one(`select acc_void_invoice($1)`, [invoiceId]);
  check("with the invoice void, no live invoice is linked: the estimate reads Open", (await liveInvoices(first.id)) === 0);
  check("…the void invoice keeps its link",
    (await one(`select estimate_id from acc_invoice where id = $1`, [invoiceId])).estimate_id === first.id);
  const reEdited = await save(first.id, customerA, "2099-01-10", null, "Verify note after the void", threeLines);
  check("…it can be edited again", reEdited.estimate_number === num);
  const declinedAgain = await decline(first.id, true);
  await decline(first.id, false);
  check("…declined and reopened again", declinedAgain.declined_at !== null);
  const secondInvoice = await convert(first.id, customerA, await asForm(first.id));
  check("…and turned into an invoice again", secondInvoice !== invoiceId && (await liveInvoices(first.id)) === 1);

  // ---- 8. delete
  console.log("  deleting");
  await one(`select acc_void_invoice($1)`, [secondInvoice]);
  await refused("an estimate that has had an invoice cannot be deleted", DELETE, [first.id],
    `${num} has had an invoice made from it. Mark it declined instead.`);
  const fresh = await save(null, customerA, "2099-01-20", null, null, [line(1, 5000), line(2, 75, salesTax)]);
  const gone = await one(DELETE, [fresh.id]).then((x) => x.r);
  check("a fresh estimate deletes, and says which", gone.estimate_number === fresh.estimate_number);
  check("…with its lines",
    (await one(`select (select count(*) from acc_estimate where id = $1)::int + (select count(*) from acc_estimate_line where estimate_id = $1)::int as n`,
      [fresh.id])).n === 0);
  const noted = await asOwner(admin.id, () =>
    one(`select reason from acc_number_gap_note where sequence_key = 'estimate' and number_value = $1`,
      [Number(fresh.estimate_number.slice("EST-".length))]));
  check("…and its number is written to the gap notes, so the Number Sequence report adds up",
    Boolean(noted) && noted.reason.includes(fresh.estimate_number));
  check("…and the delete is in the audit trail", (await auditRows(fresh.id, "delete")) === 1);
  const catalog = await one(`select label, prefix from acc_sequence_catalog() where sequence_key = 'estimate'`);
  const reportStatus = async () => {
    const documents = await all(`select number_value::text as n, document_status from acc_sequence_documents('estimate')`);
    return new Map(documents.map((d) => [Number(d.n), d.document_status]));
  };
  let statuses = await reportStatus();
  check("the Number Sequence report lists estimates, without the deleted one",
    catalog?.label === "Estimates" && catalog?.prefix === "EST-" &&
      statuses.has(Number(num.slice(4))) && !statuses.has(Number(fresh.estimate_number.slice(4))),
    JSON.stringify(catalog));
  check("…and its Status reads open", statuses.get(Number(num.slice(4))) === "open", String(statuses.get(Number(num.slice(4)))));
  await decline(first.id, true);
  statuses = await reportStatus();
  check("…or declined, never a raw time", statuses.get(Number(num.slice(4))) === "declined", String(statuses.get(Number(num.slice(4)))));
  await decline(first.id, false);
  await refused("an unknown estimate cannot be deleted", DELETE, [OUTSIDER], "Estimate not found");

  // ---- 9. another customer
  console.log("  another customer");
  const third = await save(null, customerA, "2099-02-01", null, null, [line(1, 700)]);
  await refused("an invoice for another customer is refused", CONVERT,
    [third.id, customerB, "2099-02-02", "2099-03-04", null, JSON.stringify(await asForm(third.id))],
    `${third.estimate_number} is for Verify Estimate Customer A. The invoice made from it must be for the same customer.`);
  check("…and nothing was made", (await liveInvoices(third.id)) === 0);
  await refused("an unknown estimate cannot be turned into an invoice", CONVERT,
    [OUTSIDER, customerA, "2099-02-02", "2099-03-04", null, JSON.stringify([line(1, 700)])], "Estimate not found");

  // ---- 10. who may
  console.log("  who may");
  // A viewer made out of the administrator inside this rolled-back transaction.
  await client.query("savepoint as_viewer");
  await asOwner(admin.id, () => client.query(`update acc_app_user set role = 'viewer' where id = $1`, [admin.id]));
  check("a viewer can read estimates", (await one(`select count(*)::int as n from acc_estimate where id = $1`, [third.id])).n === 1);
  await refused("a viewer cannot save", SAVE, saveArgs([line(1, 100)]), "Not authorized to save estimates");
  await refused("a viewer cannot decline", DECLINE, [third.id, true], "Not authorized to change estimates");
  await refused("a viewer cannot delete", DELETE, [third.id], "Not authorized to delete estimates");
  await refused("a viewer cannot turn one into an invoice", CONVERT,
    [third.id, customerA, "2099-02-02", "2099-03-04", null, JSON.stringify([line(1, 700)])], "Not authorized to create invoices");
  await refused("a viewer cannot write the table directly",
    `insert into acc_estimate (estimate_number, customer_id, estimate_date, expiry_date) values ('EST-VIEWER', $1, '2099-01-01', '2099-01-02')`,
    [customerA], "permission denied");
  await client.query("rollback to savepoint as_viewer");
  await as(OUTSIDER);
  check("an outsider reads no estimates", (await one(`select count(*)::int as n from acc_estimate`)).n === 0);
  await refused("an outsider cannot save", SAVE, saveArgs([line(1, 100)]), "Not authorized");
  await refused("an outsider cannot turn one into an invoice", CONVERT,
    [third.id, customerA, "2099-02-02", "2099-03-04", null, JSON.stringify([line(1, 700)])], "Not authorized");
  await as(admin.id);
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
      // One round trip each. A newline before every semicolon, so a statement
      // ending in a line comment cannot swallow the next one.
      const sql = schema === "public"
        ? MIGRATION
        : planCompanySchema([{ file: FILE, sql: MIGRATION }], schema).statements.join("\n;\n");
      await client.query(sql);
      console.log("  (0141 applied inside the transaction, never committed)");
      await client.query(sql);
      check("applying 0141 a second time is harmless", true);
      await client.query(`set local search_path = ${schema}, extensions`);
      const { facts } = await one(FACTS, [schema, FUNCTIONS]);
      structure(schema, facts);
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
