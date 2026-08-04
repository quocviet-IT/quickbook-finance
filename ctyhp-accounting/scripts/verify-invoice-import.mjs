/**
 * Behavioural verification of acc_import_invoices.
 *
 * It creates real draft invoices through acc_create_draft_invoice, so the only
 * safe way to exercise it against books that matter is inside a transaction that
 * rolls back. Every scenario does.
 *
 * Run: node --env-file=.env.local scripts/verify-invoice-import.mjs
 */
import pg from "pg";

const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const ADMIN =
  process.env.ADMIN_USER_ID ??
  (
    await client.query(
      `select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`,
    )
  ).rows[0]?.id;
if (!ADMIN) {
  console.error("No active admin to authenticate as; set ADMIN_USER_ID.");
  process.exit(1);
}

let passed = 0;
let failed = 0;
function check(label, condition, detail = "") {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function scenario(name, body) {
  console.log(`\n== ${name}`);
  await client.query("begin");
  try {
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: ADMIN, role: "authenticated" }),
    ]);
    await body();
  } catch (error) {
    failed++;
    console.log(`  FAIL  scenario threw — ${error.message}`);
  } finally {
    await client.query("rollback");
  }
}

const one = async (sql, params = []) => (await client.query(sql, params)).rows[0];

const CUSTOMER = (await one(`select name from acc_customer order by created_at limit 1`)).name;
const ACCOUNT = (
  await one(
    `select account_code from acc_account where account_type='income' and is_posting_account and status='active' order by account_code limit 1`,
  )
).account_code;

const doc = (over = {}) => ({
  external_reference: "IMP-0001",
  customer: CUSTOMER,
  issue_date: "2026-08-01",
  due_date: "2026-08-31",
  memo: null,
  lines: [
    { description: "Custom ring", quantity: 1, unit_price_minor: 350_000, income_account: ACCOUNT, tax_code: null },
  ],
  ...over,
});

const run = (docs) =>
  one(`select * from acc_import_invoices($1::jsonb)`, [JSON.stringify(docs)]);

// --- 1. A clean file lands as drafts -----------------------------------------
await scenario("a clean file creates drafts and nothing else", async () => {
  const before = Number((await one(`select count(*)::int n from acc_invoice`)).n);
  const out = await run([doc(), doc({ external_reference: "IMP-0002" })]);

  check("both created", Number(out.created) === 2, JSON.stringify(out));
  check("none skipped", Number(out.skipped) === 0, JSON.stringify(out));

  const after = Number((await one(`select count(*)::int n from acc_invoice`)).n);
  check("two invoices exist", after === before + 2, `${before} -> ${after}`);

  const states = await client.query(
    `select status, invoice_number, journal_entry_id from acc_invoice
      order by created_at desc limit 2`,
  );
  check("both are drafts", states.rows.every((r) => r.status === "draft"), JSON.stringify(states.rows));
  check(
    "no invoice number consumed",
    states.rows.every((r) => r.invoice_number === null),
    JSON.stringify(states.rows.map((r) => r.invoice_number)),
  );
  check(
    "nothing posted to the ledger",
    states.rows.every((r) => r.journal_entry_id === null),
    "a draft must carry no journal entry",
  );

  const memo = await one(`select memo from acc_invoice order by created_at desc limit 1`);
  check("the file's own number is kept in the memo", /IMP-000[12]/.test(memo.memo ?? ""), memo.memo);
});

// --- 2. Lines and totals survive the round trip ------------------------------
await scenario("a two-line invoice keeps both lines and its total", async () => {
  await run([
    doc({
      lines: [
        { description: "Ring", quantity: 2, unit_price_minor: 150_000, income_account: ACCOUNT, tax_code: null },
        { description: "Engraving", quantity: 1, unit_price_minor: 4_500, income_account: ACCOUNT, tax_code: null },
      ],
    }),
  ]);
  const inv = await one(`select id, subtotal_minor, total_minor from acc_invoice order by created_at desc limit 1`);
  const lines = Number((await one(`select count(*)::int n from acc_invoice_line where invoice_id = $1`, [inv.id])).n);
  check("two lines stored", lines === 2, `lines=${lines}`);
  check("subtotal is 2x150,000 + 4,500", Number(inv.subtotal_minor) === 304_500, JSON.stringify(inv));
});

// --- 3. An unknown customer is reported, never created -----------------------
await scenario("an unknown customer is reported and no customer is created", async () => {
  const before = Number((await one(`select count(*)::int n from acc_customer`)).n);
  const out = await run([doc({ customer: "Nobody By That Name Ltd" })]);

  check("skipped", Number(out.skipped) === 1, JSON.stringify(out));
  check("nothing created", Number(out.created) === 0);
  check("the problem names the customer", /Nobody By That Name/.test(JSON.stringify(out.problems)), JSON.stringify(out.problems));

  const after = Number((await one(`select count(*)::int n from acc_customer`)).n);
  check("no customer invented", after === before, `${before} -> ${after}`);
});

// --- 4. A non-operating income account is refused ----------------------------
await scenario("an other_income account is refused", async () => {
  // 7000 Other Income is where the earlier fix stopped sales being billed. The
  // importer must not be the way around it.
  const other = await one(`select account_code from acc_account where account_code = '7000'`);
  const out = await run([
    doc({ lines: [{ description: "Ring", quantity: 1, unit_price_minor: 1000, income_account: other.account_code, tax_code: null }] }),
  ]);
  check("skipped", Number(out.skipped) === 1, JSON.stringify(out));
  check("the problem names the account", /7000/.test(JSON.stringify(out.problems)), JSON.stringify(out.problems));
});

// --- 5. One bad document does not cost the good ones -------------------------
await scenario("a broken document is skipped and the rest still import", async () => {
  const out = await run([
    doc({ external_reference: "GOOD-1" }),
    doc({ external_reference: "BAD-1", customer: "Nobody At All" }),
    doc({ external_reference: "GOOD-2" }),
  ]);
  check("two created", Number(out.created) === 2, JSON.stringify(out));
  check("one skipped", Number(out.skipped) === 1, JSON.stringify(out));
  check("the problem names the broken one", /BAD-1/.test(JSON.stringify(out.problems)), JSON.stringify(out.problems));
});

// --- 6. An unknown tax code is refused rather than dropped -------------------
await scenario("an unknown tax code is refused, not silently ignored", async () => {
  const out = await run([
    doc({ lines: [{ description: "Ring", quantity: 1, unit_price_minor: 1000, income_account: ACCOUNT, tax_code: "NOPE" }] }),
  ]);
  check("skipped", Number(out.skipped) === 1, JSON.stringify(out));
  check("the problem names the code", /NOPE/.test(JSON.stringify(out.problems)), JSON.stringify(out.problems));
});

// --- 7. Audit ----------------------------------------------------------------
await scenario("the import writes one audit row describing the run", async () => {
  await run([doc()]);
  const audit = await one(
    `select after_json from acc_audit_log
      where table_name = 'acc_invoice' and after_json->>'source' = 'invoice_import'
      order by created_at desc limit 1`,
  );
  check("audit row written", Boolean(audit), "none found");
  check("it records the counts", Number(audit?.after_json?.created) === 1, JSON.stringify(audit?.after_json));
});

console.log("\n== an unauthenticated caller is refused");
await client.query("begin");
try {
  await client.query(`select set_config('request.jwt.claims', '', true)`);
  let refused = false;
  let text = "";
  try {
    await run([doc()]);
  } catch (error) {
    refused = true;
    text = error.message;
  }
  check("refused before creating anything", refused, text);
  check("refusal is the authorisation gate", /not authorized/i.test(text), text);
} finally {
  await client.query("rollback");
}

console.log(`\n${passed} passed, ${failed} failed`);
await client.end();
process.exit(failed === 0 ? 0 : 1);
