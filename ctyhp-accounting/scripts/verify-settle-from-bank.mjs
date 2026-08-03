/**
 * Behavioural verification of acc_settle_from_bank_transaction.
 *
 * Every scenario runs inside its own transaction and is ROLLED BACK. The ledger
 * is exercised for real -- documents settle, entries post, audit rows are
 * written -- and none of it survives the scenario. That is what makes this
 * runnable against a database holding real books, unlike the destructive
 * end-to-end suites next to it.
 *
 * The RPC authorises through auth.uid(), so each transaction sets an admin's id
 * as the JWT subject the way PostgREST would. Pass one with ADMIN_USER_ID, or
 * let it pick the first active admin.
 *
 * Run: node --env-file=.env.local scripts/verify-settle-from-bank.mjs
 *
 * It caught a real defect on first run: 0090 resolved the customer or vendor
 * with min(uuid), which does not exist. Structural checks of the deployed
 * function had passed. Only calling it found that.
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

/** Run body inside a rolled-back transaction, authenticated as an admin. */
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

// --- 1. Money out settles a bill -------------------------------------------
await scenario("money out settles a bill and links through bill_payment_id", async () => {
  const bill = await one(
    `select id, balance_due_minor, vendor_id from acc_bill
      where status in ('open','partial') and balance_due_minor > 0
      order by balance_due_minor asc limit 1`,
  );
  const txn = await one(
    `select t.id, t.amount_minor from acc_bank_transaction t
      where t.status = 'unmatched' and t.amount_minor < 0
        and abs(t.amount_minor) >= $1
      order by abs(t.amount_minor) asc limit 1`,
    [bill.balance_due_minor],
  );

  const settlement = await one(
    `select acc_settle_from_bank_transaction($1, $2::jsonb, 'bank_transfer', 'rollback probe') as id`,
    [txn.id, JSON.stringify([{ document_id: bill.id, amount_minor: Number(bill.balance_due_minor) }])],
  );
  check("returned a settlement id", Boolean(settlement.id));

  const after = await one(`select status, balance_due_minor from acc_bill where id = $1`, [bill.id]);
  check("bill balance cleared", Number(after.balance_due_minor) === 0, `balance=${after.balance_due_minor}`);
  check("bill marked paid", after.status === "paid", `status=${after.status}`);

  const line = await one(`select status from acc_bank_transaction where id = $1`, [txn.id]);
  check("bank line marked matched", line.status === "matched", `status=${line.status}`);

  const rec = await one(
    `select bill_payment_id, status, rule_applied, confidence from acc_reconciliation
      where bank_transaction_id = $1 and bill_payment_id is not null`,
    [txn.id],
  );
  check("reconciliation links the bill payment", rec?.bill_payment_id === settlement.id);
  check("reconciliation is approved", rec?.status === "approved");
  check("rule recorded as manual_settlement", rec?.rule_applied === "manual_settlement");

  const entry = await one(
    `select count(*)::int as n from acc_journal_line jl
       join acc_bill_payment bp on bp.journal_entry_id = jl.journal_entry_id
      where bp.id = $1`,
    [settlement.id],
  );
  check("the payment posted journal lines", entry.n > 0, `lines=${entry.n}`);

  const audit = await one(
    `select count(*)::int as n from acc_audit_log
      where table_name = 'acc_bank_transaction' and record_id = $1`,
    [txn.id],
  );
  check("audit row written", audit.n > 0);
});

// --- 2. Money in settles an invoice ----------------------------------------
await scenario("money in settles an invoice and links through payment_id", async () => {
  const invoice = await one(
    `select id, balance_due_minor, currency_code from acc_invoice
      where status in ('issued','partial') and balance_due_minor > 0
      order by balance_due_minor asc limit 1`,
  );
  const bank = await one(`select id from acc_bank_account limit 1`);
  const txn = await one(
    `insert into acc_bank_transaction
       (bank_account_id, txn_date, description, amount_minor, raw_hash, status)
     values ($1, current_date, 'Rollback probe deposit', $2, 'probe-' || gen_random_uuid()::text, 'unmatched')
     returning id`,
    [bank.id, Number(invoice.balance_due_minor)],
  );

  const settlement = await one(
    `select acc_settle_from_bank_transaction($1, $2::jsonb, 'bank_transfer', 'rollback probe') as id`,
    [txn.id, JSON.stringify([{ document_id: invoice.id, amount_minor: Number(invoice.balance_due_minor) }])],
  );
  check("returned a settlement id", Boolean(settlement.id));

  const after = await one(`select status, balance_due_minor from acc_invoice where id = $1`, [invoice.id]);
  check("invoice balance cleared", Number(after.balance_due_minor) === 0, `balance=${after.balance_due_minor}`);
  check("invoice marked paid", after.status === "paid", `status=${after.status}`);

  const line = await one(`select status from acc_bank_transaction where id = $1`, [txn.id]);
  check("bank line marked matched", line.status === "matched");

  const rec = await one(
    `select payment_id, status from acc_reconciliation
      where bank_transaction_id = $1 and payment_id is not null`,
    [txn.id],
  );
  check("reconciliation links the receipt", rec?.payment_id === settlement.id);
  check("reconciliation is approved", rec?.status === "approved");
});

// --- 3. The same bank line cannot settle twice ------------------------------
await scenario("a bank line already matched is refused", async () => {
  const bill = await one(
    `select id, balance_due_minor from acc_bill
      where status in ('open','partial') and balance_due_minor > 0
      order by balance_due_minor asc limit 1`,
  );
  const txn = await one(
    `select id from acc_bank_transaction
      where status = 'unmatched' and amount_minor < 0 and abs(amount_minor) >= $1
      order by abs(amount_minor) asc limit 1`,
    [bill.balance_due_minor],
  );
  const alloc = JSON.stringify([{ document_id: bill.id, amount_minor: 1 }]);

  await client.query(`select acc_settle_from_bank_transaction($1, $2::jsonb, null, null)`, [txn.id, alloc]);
  let refused = false;
  let messageText = "";
  try {
    await client.query(`select acc_settle_from_bank_transaction($1, $2::jsonb, null, null)`, [txn.id, alloc]);
  } catch (error) {
    refused = true;
    messageText = error.message;
  }
  check("second settlement refused", refused, messageText);
  check("refusal names the state", /already matched/i.test(messageText), messageText);
});

// --- 4. Two customers in one call is refused --------------------------------
await scenario("invoices from two customers in one call are refused", async () => {
  const invoices = (
    await client.query(
      `select distinct on (customer_id) id, customer_id, balance_due_minor
         from acc_invoice where status in ('issued','partial') and balance_due_minor > 0
        order by customer_id, balance_due_minor asc limit 2`,
    )
  ).rows;
  const bank = await one(`select id from acc_bank_account limit 1`);
  const txn = await one(
    `insert into acc_bank_transaction
       (bank_account_id, txn_date, description, amount_minor, raw_hash, status)
     values ($1, current_date, 'Rollback probe deposit', 9999999, 'probe-' || gen_random_uuid()::text, 'unmatched')
     returning id`,
    [bank.id],
  );

  let refused = false;
  let messageText = "";
  try {
    await client.query(`select acc_settle_from_bank_transaction($1, $2::jsonb, null, null)`, [
      txn.id,
      JSON.stringify(invoices.map((i) => ({ document_id: i.id, amount_minor: 100 }))),
    ]);
  } catch (error) {
    refused = true;
    messageText = error.message;
  }
  check("refused", refused, messageText);
  check("refusal names the reason", /more than one customer/i.test(messageText), messageText);
});

// --- 5. Allocating more than the bank moved is refused ----------------------
await scenario("allocating more than the bank line is refused", async () => {
  const bill = await one(
    `select id, balance_due_minor from acc_bill
      where status in ('open','partial') and balance_due_minor > 0
      order by balance_due_minor desc limit 1`,
  );
  const txn = await one(
    `select id, amount_minor from acc_bank_transaction
      where status = 'unmatched' and amount_minor < 0
      order by abs(amount_minor) asc limit 1`,
  );

  let refused = false;
  let messageText = "";
  try {
    await client.query(`select acc_settle_from_bank_transaction($1, $2::jsonb, null, null)`, [
      txn.id,
      JSON.stringify([{ document_id: bill.id, amount_minor: Math.abs(Number(txn.amount_minor)) + 1 }]),
    ]);
  } catch (error) {
    refused = true;
    messageText = error.message;
  }
  check("refused", refused, messageText);
  check("refusal names the overage", /exceed/i.test(messageText), messageText);
});

// --- 6. Without the permission, nothing happens -----------------------------
console.log("\n== an unauthenticated caller is refused");
await client.query("begin");
try {
  await client.query(`select set_config('request.jwt.claims', '', true)`);
  const txn = await one(`select id from acc_bank_transaction where status = 'unmatched' limit 1`);
  let refused = false;
  let messageText = "";
  try {
    await client.query(`select acc_settle_from_bank_transaction($1, '[]'::jsonb, null, null)`, [txn.id]);
  } catch (error) {
    refused = true;
    messageText = error.message;
  }
  check("refused before touching anything", refused, messageText);
  check("refusal is the permission gate", /permission/i.test(messageText), messageText);
} finally {
  await client.query("rollback");
}

console.log(`\n${passed} passed, ${failed} failed`);
await client.end();
process.exit(failed === 0 ? 0 : 1);
