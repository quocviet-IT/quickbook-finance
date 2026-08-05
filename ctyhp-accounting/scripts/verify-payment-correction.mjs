/**
 * Behavioural verification of acc_update_payment_details and acc_correct_payment.
 *
 * Everything happens inside ONE transaction that is always rolled back: 0096 is
 * applied, real receipts are recorded through acc_record_payment, real invoices
 * move, and none of it survives. That is what makes this safe to run against a
 * database holding real books.
 *
 * The RPCs authorise through acc_is_staff(), so the transaction sets an admin's
 * id as the JWT subject the way PostgREST would. Pass one with ADMIN_USER_ID,
 * or let it pick the first active admin.
 *
 * Run: node --env-file=.env.local scripts/verify-payment-correction.mjs
 */
import { readFile } from "node:fs/promises";
import pg from "pg";

const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30_000,
});

/** acc_record_payment writes this straight onto the journal entry. */
const TODAY = new Date().toISOString().slice(0, 10);

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
const all = async (sql, params = []) => (await client.query(sql, params)).rows;

/** Run a case inside a savepoint that is always rolled back to its start. */
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

/** Attempt a call and return the refusal message, or null when it succeeded. */
async function attempt(sql, params) {
  try {
    await client.query(sql, params);
    return null;
  } catch (error) {
    // The failed statement poisons the transaction; step back to a clean point.
    await client.query("rollback to savepoint before_call");
    return error.message;
  }
}

/** A fresh receipt allocated to an open invoice, recorded the ordinary way. */
async function recordPaymentOnOpenInvoice() {
  const invoice = await one(
    `select id, customer_id, currency_code, balance_due_minor, total_minor, status
       from acc_invoice
      where status in ('issued', 'partial') and balance_due_minor > 0
      order by balance_due_minor asc
      limit 1`,
  );
  if (!invoice) throw new Error("no issued/partial invoice to work with");
  const deposit = await one(
    `select id from acc_account
      where (account_type = 'bank' or account_code = '1210')
        and is_posting_account and status = 'active'
      order by account_code
      limit 1`,
  );
  if (!deposit) throw new Error("no active deposit account");

  const amount = Math.max(2, Math.floor(Number(invoice.balance_due_minor) / 2));
  const paymentId = (
    await one(`select acc_record_payment($1, $2, $3, $4, $5, $6, $7, $8, $9) as id`, [
      invoice.customer_id,
      TODAY,
      invoice.currency_code,
      amount,
      deposit.id,
      "check",
      "Rollback verification",
      JSON.stringify([{ invoice_id: invoice.id, amount_minor: amount }]),
      "VOID-VERIFY",
    ])
  ).id;

  const payment = await one(`select * from acc_payment where id = $1`, [paymentId]);
  const after = await one(`select * from acc_invoice where id = $1`, [invoice.id]);
  return { invoiceBefore: invoice, invoiceAfterPayment: after, payment, amount, deposit };
}

async function main() {
  await client.connect();

  const admin =
    process.env.ADMIN_USER_ID ??
    (
      await one(
        `select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`,
      )
    )?.id;
  if (!admin) {
    console.error("No active admin to authenticate as; set ADMIN_USER_ID.");
    process.exit(1);
  }
  const asAdmin = () =>
    client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: admin, role: "authenticated" }),
    ]);

  await client.query("begin");
  try {
    const migration = await readFile(
      new URL("../supabase/migrations/0096_payment_details_and_correction.sql", import.meta.url),
      "utf8",
    );
    await client.query(migration);
    console.log("Applied 0096 inside the transaction (never committed).");
    await asAdmin();

    // --- 1. A correction replaces the receipt -------------------------------
    await scenario("correcting a receipt voids it and posts its replacement", async () => {
      const { payment, invoiceAfterPayment, amount } = await recordPaymentOnOpenInvoice();
      const corrected = Math.max(1, Math.floor(amount / 2));
      await client.query("savepoint before_call");
      const created = await one(
        `select acc_correct_payment($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) as id`,
        [
          payment.id,
          "Amount was entered ten times too high",
          payment.customer_id,
          TODAY,
          payment.currency_code,
          corrected,
          payment.deposit_account_id,
          "wire",
          "REF-CORRECTED",
          "Corrected receipt",
          JSON.stringify([{ invoice_id: invoiceAfterPayment.id, amount_minor: corrected }]),
        ],
      );
      check("a new payment id came back", Boolean(created?.id));

      const original = await one(`select * from acc_payment where id = $1`, [payment.id]);
      check("the original is void", original.status === "void");
      check("its number is unchanged", original.payment_number === payment.payment_number);
      check("the reason is recorded", /ten times too high/.test(original.void_reason ?? ""));

      const replacement = await one(`select * from acc_payment where id = $1`, [created.id]);
      check(
        "the replacement holds the corrected amount",
        Number(replacement.amount_minor) === corrected,
      );
      check("it has its own number", replacement.payment_number !== payment.payment_number);
      check("it is not void", replacement.status !== "void");

      const invoice = await one(`select balance_due_minor from acc_invoice where id = $1`, [
        invoiceAfterPayment.id,
      ]);
      check(
        "the invoice reflects the corrected amount only",
        Number(invoice.balance_due_minor) ===
          Number(invoiceAfterPayment.balance_due_minor) + amount - corrected,
        `${invoice.balance_due_minor}`,
      );

      const entries = await all(`select id, status from acc_journal_entry where id in ($1, $2)`, [
        payment.journal_entry_id,
        replacement.journal_entry_id,
      ]);
      const byId = new Map(entries.map((row) => [row.id, row.status]));
      check("the old entry is void", byId.get(payment.journal_entry_id) === "void");
      check("the new entry is posted", byId.get(replacement.journal_entry_id) === "posted");
    });

    // --- 2. A description edit touches nothing else -------------------------
    await scenario("editing the description leaves every posting field alone", async () => {
      const { payment } = await recordPaymentOnOpenInvoice();
      await client.query("savepoint before_call");
      const refusal = await attempt(`select acc_update_payment_details($1, $2, $3, $4)`, [
        payment.id,
        "wire",
        "REF-9",
        "Deposited Monday",
      ]);
      check("the edit succeeded", refusal === null, refusal ?? "");

      const after = await one(`select * from acc_payment where id = $1`, [payment.id]);
      check("method changed", after.method === "wire");
      check("reference changed", after.reference === "REF-9");
      check("memo changed", after.memo === "Deposited Monday");
      for (const column of [
        "amount_minor",
        "payment_date",
        "customer_id",
        "deposit_account_id",
        "status",
      ]) {
        check(`${column} is untouched`, String(after[column]) === String(payment[column]));
      }
    });

    // --- 3. A void receipt refuses the edit ---------------------------------
    await scenario("a void receipt cannot be edited", async () => {
      const { payment } = await recordPaymentOnOpenInvoice();
      await client.query(`select acc_void_payment($1, $2)`, [payment.id, "Rollback verification"]);
      await client.query("savepoint before_call");
      const refusal = await attempt(`select acc_update_payment_details($1, $2, $3, $4)`, [
        payment.id,
        "wire",
        null,
        null,
      ]);
      check("the edit is refused", /cannot be edited/i.test(refusal ?? ""), refusal ?? "none");
    });

    // --- 4. A closed period refuses the correction atomically ---------------
    await scenario("a closed period refuses the correction and leaves no new receipt", async () => {
      const { payment, invoiceAfterPayment } = await recordPaymentOnOpenInvoice();
      const before = await one(`select count(*)::int as n from acc_payment`);
      const entry = await one(`select entry_date from acc_journal_entry where id = $1`, [
        payment.journal_entry_id,
      ]);
      const period = await one(
        `select id from acc_accounting_period where $1 between period_start and period_end`,
        [entry.entry_date],
      );
      if (period) {
        await client.query(
          `update acc_accounting_period set status = 'closed', closed_at = now() where id = $1`,
          [period.id],
        );
      } else {
        await client.query(
          `insert into acc_accounting_period
             (fiscal_year, period_month, period_start, period_end, label, status, closed_at)
           values (extract(year from $1::date)::int, extract(month from $1::date)::int,
                   date_trunc('month', $1::date)::date,
                   (date_trunc('month', $1::date) + interval '1 month - 1 day')::date,
                   to_char($1::date, 'Mon YYYY'), 'closed', now())`,
          [entry.entry_date],
        );
      }

      await client.query("savepoint before_call");
      const refusal = await attempt(
        `select acc_correct_payment($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          payment.id,
          "Wrong amount",
          payment.customer_id,
          TODAY,
          payment.currency_code,
          100,
          payment.deposit_account_id,
          null,
          null,
          null,
          JSON.stringify([]),
        ],
      );
      check("the correction is refused", /closed period/i.test(refusal ?? ""), refusal ?? "none");
      const state = await one(
        `select p.status, i.balance_due_minor from acc_payment p
           join acc_invoice i on i.id = $2 where p.id = $1`,
        [payment.id, invoiceAfterPayment.id],
      );
      check("the original is still live", state.status !== "void");
      check(
        "the invoice is unchanged",
        Number(state.balance_due_minor) === Number(invoiceAfterPayment.balance_due_minor),
      );
      const after = await one(`select count(*)::int as n from acc_payment`);
      check("no replacement was created", after.n === before.n, `${before.n} -> ${after.n}`);
    });

    // --- 5. Authorization belongs to the database --------------------------
    await scenario("a viewer cannot edit or correct anything", async () => {
      const { payment } = await recordPaymentOnOpenInvoice();
      const viewer = await one(
        `select id from acc_app_user where role = 'viewer' and status = 'active' limit 1`,
      );
      if (!viewer) {
        console.log("  SKIP  no active viewer to authenticate as");
        return;
      }
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: viewer.id, role: "authenticated" }),
      ]);
      await client.query("savepoint before_call");
      const edit = await attempt(`select acc_update_payment_details($1, $2, $3, $4)`, [
        payment.id,
        "wire",
        null,
        null,
      ]);
      check("the edit is refused", /Not authorized/i.test(edit ?? ""), edit ?? "none");
      await client.query("savepoint before_call");
      const correct = await attempt(
        `select acc_correct_payment($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          payment.id,
          "Wrong amount",
          payment.customer_id,
          TODAY,
          payment.currency_code,
          100,
          payment.deposit_account_id,
          null,
          null,
          null,
          JSON.stringify([]),
        ],
      );
      check("the correction is refused", /Not authorized/i.test(correct ?? ""), correct ?? "none");
      await asAdmin();
    });
  } finally {
    await client.query("rollback");
    console.log("\nROLLBACK — nothing above was kept.");
    await client.end();
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

await main();
