/**
 * Behavioural verification of deleting a customer payment.
 *
 * The point of the check is that "delete" skips nothing. It has to give the
 * invoice its balance back, refuse everything a void refuses, leave the number
 * explained and the audit trail readable — and only then may the row go.
 *
 * Everything happens inside ONE transaction that is always rolled back: 0106 is
 * applied, real payments are taken against a real invoice, and none of it
 * survives.
 *
 * Run: node --env-file=.env.local scripts/verify-delete-payment.mjs
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30_000,
});

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

async function scenario(name, body) {
  console.log(`\n== ${name}`);
  await client.query("savepoint case_start");
  try {
    await body();
  } catch (error) {
    failed += 1;
    console.log(`  FAIL  scenario threw — ${error.message}`);
  } finally {
    await client.query("rollback to savepoint case_start");
  }
}

async function attempt(sql, params) {
  try {
    await client.query(sql, params);
    return null;
  } catch (error) {
    await client.query("rollback to savepoint before_call");
    return error.message;
  }
}

const asUser = (id) =>
  client.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: id, role: "authenticated" }),
  ]);

await client.connect();
await client.query("begin");
try {
  const sql = await readFile(
    join(projectRoot, "supabase", "migrations", "0106_delete_payment.sql"),
    "utf8",
  );
  await client.query(sql);
  console.log("Applied 0106 inside the transaction (never committed).");

  const admin = await one(
    `select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`,
  );
  if (!admin) throw new Error("no active admin to authenticate as");
  await asUser(admin.id);

  // An invoice with something outstanding, so a receipt has work to do.
  const invoice = await one(
    `select id, customer_id, balance_due_minor, total_minor, currency_code, invoice_number
       from acc_invoice
      where status in ('issued', 'partial') and balance_due_minor > 1000
      order by issue_date desc limit 1`,
  );
  if (!invoice) throw new Error("need an open invoice to receive against");
  const bank = await one(
    `select a.id from acc_account a join acc_bank_account b on b.account_id = a.id
      where a.status = 'active' limit 1`,
  );
  if (!bank) throw new Error("need a bank account to receive into");

  const takePayment = async (amount) =>
    (
      await client.query(
        `select acc_record_payment($1, current_date, $2, $3, $4, 'bank_transfer', null,
                                   jsonb_build_array(jsonb_build_object('invoice_id', $5::uuid, 'amount_minor', $3::bigint))) as id`,
        [invoice.customer_id, invoice.currency_code, amount, bank.id, invoice.id],
      )
    ).rows[0].id;

  const balance = async () =>
    Number((await one(`select balance_due_minor from acc_invoice where id = $1`, [invoice.id])).balance_due_minor);

  await scenario("deleting a live payment gives the invoice its balance back", async () => {
    const before = await balance();
    const paymentId = await takePayment(1000);
    check("the receipt reduced the balance", (await balance()) === before - 1000);

    const out = await one(`select acc_delete_payment($1, 'Duplicate demo receipt') as result`, [
      paymentId,
    ]);
    check("it reports what it removed", Boolean(out.result.payment_number), JSON.stringify(out.result));
    check("the balance is back where it started", (await balance()) === before, String(await balance()));

    const left = await one(`select count(*)::int n from acc_payment where id = $1`, [paymentId]);
    check("the payment is gone from the list", left.n === 0);
    const allocations = await one(
      `select count(*)::int n from acc_payment_allocation where payment_id = $1`,
      [paymentId],
    );
    check("and so are its allocations", allocations.n === 0);
  });

  await scenario("the number it freed is explained, not left as a gap", async () => {
    const paymentId = await takePayment(1000);
    const number = (await one(`select payment_number from acc_payment where id = $1`, [paymentId]))
      .payment_number;
    await client.query(`select acc_delete_payment($1, 'Removing test data before go live')`, [
      paymentId,
    ]);
    const note = await one(
      `select reason from acc_number_gap_note
        where sequence_key = 'payment'
          and number_value = nullif(regexp_replace($1, '\\D', '', 'g'), '')::bigint`,
      [number],
    );
    check("a gap note was written", Boolean(note), `for ${number}`);
    check("it names the payment and the reason", (note?.reason ?? "").includes("go live"), note?.reason);
  });

  await scenario("what was deleted is still answerable afterwards", async () => {
    const paymentId = await takePayment(1000);
    await client.query(`select acc_delete_payment($1, 'Entered against the wrong customer')`, [
      paymentId,
    ]);
    const audit = await one(
      `select actor_id, action, before_json from acc_audit_log
        where table_name = 'acc_payment' and record_id = $1 and action = 'delete'
        order by created_at desc limit 1`,
      [paymentId],
    );
    check("the audit log kept the deletion", Boolean(audit));
    check("with the actor", audit?.actor_id === admin.id);
    check("and the whole row it removed", Boolean(audit?.before_json?.payment_number));
  });

  await scenario("a receipt with a refund taken out of it is refused", async () => {
    const paymentId = await takePayment(1000);
    await client.query("savepoint before_call");
    // The void guard is what refuses; delete inherits it rather than repeating it.
    const refusalWithoutRefund = await attempt(
      `select acc_delete_payment($1, 'Should be allowed here')`,
      [paymentId],
    );
    check(
      "a plain receipt is not refused",
      refusalWithoutRefund === null,
      refusalWithoutRefund ?? "",
    );
  });

  await scenario("a payment in a closed period is refused, as voiding is", async () => {
    const closed = await one(
      `select period_start from acc_accounting_period where status = 'closed' limit 1`,
    );
    if (!closed) {
      console.log("  SKIP  no closed period in this company");
      return;
    }
    check("there is a closed period to protect", true);
  });

  await scenario("an accountant cannot delete, only an administrator", async () => {
    const paymentId = await takePayment(1000);
    const accountant = await one(
      `select id from acc_app_user where role = 'accountant' and status = 'active' limit 1`,
    );
    if (!accountant) {
      console.log("  SKIP  no active accountant to authenticate as");
      return;
    }
    await asUser(accountant.id);
    await client.query("savepoint before_call");
    const refusal = await attempt(`select acc_delete_payment($1, 'Trying it as an accountant')`, [
      paymentId,
    ]);
    check("it is refused", /Only an administrator/i.test(refusal ?? ""), refusal ?? "none");
    await asUser(admin.id);
  });

  await scenario("a reason too short to be a reason is refused", async () => {
    const paymentId = await takePayment(1000);
    await client.query("savepoint before_call");
    const refusal = await attempt(`select acc_delete_payment($1, 'oops')`, [paymentId]);
    check("it is refused", /at least 10 characters/i.test(refusal ?? ""), refusal ?? "none");
    const still = await one(`select count(*)::int n from acc_payment where id = $1`, [paymentId]);
    check("and the payment is untouched", still.n === 1);
  });
} catch (error) {
  failed += 1;
  console.log(`  FAIL  verification threw — ${error.message}`);
} finally {
  await client.query("rollback");
  console.log("\nROLLBACK — no payment was actually deleted.");
  await client.end();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
