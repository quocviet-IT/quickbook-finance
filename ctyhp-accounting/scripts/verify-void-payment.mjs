/**
 * Behavioural verification of acc_void_payment.
 *
 * Everything happens inside ONE transaction that is always rolled back: the
 * migration is applied, real receipts are recorded through acc_record_payment,
 * real invoices move, and none of it survives. That is what makes this safe to
 * run against a database holding real books — unlike the destructive
 * end-to-end suites, it leaves nothing behind, not even a consumed number.
 *
 * The RPC authorises through acc_is_staff(), so the transaction sets an admin's
 * id as the JWT subject the way PostgREST would. Pass one with ADMIN_USER_ID,
 * or let it pick the first active admin.
 *
 * Run: node --env-file=.env.local scripts/verify-void-payment.mjs
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

/** Run a case inside a savepoint that is always released back to the start. */
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

/** Attempt a void and return the refusal message, or null when it succeeded. */
async function attemptVoid(paymentId, reason) {
  try {
    await client.query("select acc_void_payment($1, $2)", [paymentId, reason]);
    return null;
  } catch (error) {
    // The failed statement poisons the transaction; step back to a clean point.
    await client.query("rollback to savepoint before_void");
    return error.message;
  }
}

/** A fresh receipt allocated to an open invoice, recorded the ordinary way. */
async function recordPaymentOnOpenInvoice(paymentDate = TODAY, depositAccountId = null) {
  const invoice = await one(
    `select id, customer_id, currency_code, balance_due_minor, total_minor, status
       from acc_invoice
      where status in ('issued', 'partial') and balance_due_minor > 0
      order by balance_due_minor asc
      limit 1`,
  );
  if (!invoice) throw new Error("no issued/partial invoice to work with");
  const deposit = depositAccountId
    ? { id: depositAccountId }
    : await one(
        `select id from acc_account
          where (account_type = 'bank' or account_code = '1210')
            and is_posting_account and status = 'active'
          order by account_code
          limit 1`,
      );
  if (!deposit) throw new Error("no active deposit account");

  // Deliberately small: a partial settlement proves the balance arithmetic
  // better than paying an invoice off exactly.
  const amount = Math.max(1, Math.floor(Number(invoice.balance_due_minor) / 2));
  const paymentId = (
    await one(`select acc_record_payment($1, $2, $3, $4, $5, $6, $7, $8, $9) as id`, [
      invoice.customer_id,
      paymentDate,
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

  await client.query("begin");
  try {
    const migration = await readFile(
      new URL("../supabase/migrations/0095_void_customer_payments.sql", import.meta.url),
      "utf8",
    );
    await client.query(migration);
    console.log("Applied 0095 inside the transaction (never committed).");
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: admin, role: "authenticated" }),
    ]);

    // --- 1. The void itself -------------------------------------------------
    await scenario("voiding restores the invoice and retires the journal entry", async () => {
      const { invoiceAfterPayment, payment, amount } = await recordPaymentOnOpenInvoice();
      const postedBefore = await one(
        `select coalesce(sum(debit_minor), 0) as debit, coalesce(sum(credit_minor), 0) as credit
           from acc_journal_line l
           join acc_journal_entry e on e.id = l.journal_entry_id
          where e.id = $1 and e.status = 'posted'`,
        [payment.journal_entry_id],
      );
      check("the receipt posted a balanced entry", Number(postedBefore.debit) === Number(postedBefore.credit) && Number(postedBefore.debit) > 0);

      await client.query("savepoint before_void");
      const refusal = await attemptVoid(payment.id, "Rollback verification");
      check("the void succeeded", refusal === null, refusal ?? "");
      if (refusal) return;

      const invoice = await one(`select * from acc_invoice where id = $1`, [
        invoiceAfterPayment.id,
      ]);
      check(
        "the invoice balance came back exactly",
        Number(invoice.balance_due_minor) === Number(invoiceAfterPayment.balance_due_minor) + amount,
        `${invoice.balance_due_minor} vs ${Number(invoiceAfterPayment.balance_due_minor) + amount}`,
      );
      check(
        "the invoice is outstanding again",
        invoice.status === "issued" || invoice.status === "partial",
        invoice.status,
      );

      const voided = await one(`select * from acc_payment where id = $1`, [payment.id]);
      check("the payment reads as void", voided.status === "void");
      check("the payment keeps its number", voided.payment_number === payment.payment_number);
      check("nothing is left unapplied", Number(voided.unapplied_minor) === 0);
      check("the void is attributed", voided.voided_at !== null && voided.voided_by === admin);
      check("the reason is recorded", voided.void_reason === "Rollback verification");

      const allocations = await all(
        `select 1 from acc_payment_allocation where payment_id = $1`,
        [payment.id],
      );
      check("the allocation history survives", allocations.length === 1);

      const entry = await one(`select status from acc_journal_entry where id = $1`, [
        payment.journal_entry_id,
      ]);
      check("the journal entry is void, not deleted", entry?.status === "void");
      const postedAfter = await one(
        `select coalesce(sum(debit_minor), 0) as debit
           from acc_journal_line l
           join acc_journal_entry e on e.id = l.journal_entry_id
          where e.id = $1 and e.status = 'posted'`,
        [payment.journal_entry_id],
      );
      check("it no longer contributes to the ledger", Number(postedAfter.debit) === 0);

      await client.query("savepoint before_void");
      const second = await attemptVoid(payment.id, "Second attempt");
      check("a second void is refused", /already void/i.test(second ?? ""), second ?? "none");
    });

    // --- 2. A reason is not optional ---------------------------------------
    await scenario("a void without a reason is refused", async () => {
      const { payment } = await recordPaymentOnOpenInvoice();
      await client.query("savepoint before_void");
      const blank = await attemptVoid(payment.id, "   ");
      check("blank reason refused", /reason is required/i.test(blank ?? ""), blank ?? "none");
      await client.query("savepoint before_void");
      const long = await attemptVoid(payment.id, "x".repeat(501));
      check("over-long reason refused", /500 characters/i.test(long ?? ""), long ?? "none");
      const untouched = await one(`select status from acc_payment where id = $1`, [payment.id]);
      check("the payment is untouched", untouched.status !== "void", untouched.status);
    });

    // --- 3. A refund out of this receipt blocks it --------------------------
    await scenario("a posted customer refund blocks the void", async () => {
      const { payment, invoiceAfterPayment } = await recordPaymentOnOpenInvoice();
      const bankAccount = await one(
        `select id from acc_account where account_type = 'bank' and is_posting_account limit 1`,
      );
      await client.query(
        `insert into acc_customer_refund
           (customer_id, refund_date, currency_code, amount_minor, source_type, payment_id,
            bank_account_id, status)
         values ($1, current_date, $2, $3, 'payment', $4, $5, 'posted')`,
        [payment.customer_id, payment.currency_code, payment.amount_minor, payment.id, bankAccount.id],
      );

      await client.query("savepoint before_void");
      const refusal = await attemptVoid(payment.id, "Rollback verification");
      check("the void is refused", /refund/i.test(refusal ?? ""), refusal ?? "none");
      const state = await one(
        `select p.status as payment_status, i.balance_due_minor, e.status as entry_status
           from acc_payment p
           join acc_invoice i on i.id = $2
           left join acc_journal_entry e on e.id = p.journal_entry_id
          where p.id = $1`,
        [payment.id, invoiceAfterPayment.id],
      );
      check("nothing moved", state.payment_status !== "void" && state.entry_status === "posted");
      check(
        "the invoice balance is unchanged",
        Number(state.balance_due_minor) === Number(invoiceAfterPayment.balance_due_minor),
      );
    });

    // --- 4. A live bank match blocks it -------------------------------------
    await scenario("a suggested bank match blocks the void", async () => {
      const { payment, invoiceAfterPayment } = await recordPaymentOnOpenInvoice();
      const bankAccount = await one(`select id from acc_bank_account limit 1`);
      if (!bankAccount) {
        console.log("  SKIP  no bank account configured to attach a transaction to");
        return;
      }
      const txn = await one(
        `insert into acc_bank_transaction (bank_account_id, txn_date, description, amount_minor, raw_hash)
         values ($1, current_date, 'void verification', $2, $3)
         returning id`,
        [bankAccount.id, payment.amount_minor, `void-verify-${payment.id}`],
      );
      await client.query(
        `insert into acc_reconciliation (bank_transaction_id, payment_id, status)
         values ($1, $2, 'suggested')`,
        [txn.id, payment.id],
      );

      await client.query("savepoint before_void");
      const refusal = await attemptVoid(payment.id, "Rollback verification");
      check("the void is refused", /bank match/i.test(refusal ?? ""), refusal ?? "none");
      const invoice = await one(`select balance_due_minor from acc_invoice where id = $1`, [
        invoiceAfterPayment.id,
      ]);
      check(
        "the invoice balance is unchanged",
        Number(invoice.balance_due_minor) === Number(invoiceAfterPayment.balance_due_minor),
      );
    });

    // --- 5. A cleared statement line blocks it ------------------------------
    await scenario("a cleared statement line blocks the void", async () => {
      // Deposited into the account a statement is actually reconciled against,
      // so the cleared line belongs to this payment's own journal entry.
      const bankAccount = await one(`select id, account_id from acc_bank_account limit 1`);
      if (!bankAccount) {
        console.log("  SKIP  no bank account configured to reconcile against");
        return;
      }
      const { payment } = await recordPaymentOnOpenInvoice(TODAY, bankAccount.account_id);
      // At most one session per account may be open, so reuse the live one.
      const session =
        (await one(
          `select id from acc_statement_reconciliation
            where bank_account_id = $1 and status = 'in_progress' limit 1`,
          [bankAccount.id],
        )) ??
        (await one(
          `insert into acc_statement_reconciliation
             (bank_account_id, statement_ending_date, statement_ending_balance_minor, status)
           values ($1, current_date, 0, 'in_progress')
           returning id`,
          [bankAccount.id],
        ));
      const line = await one(
        `select id from acc_journal_line where journal_entry_id = $1 order by line_order limit 1`,
        [payment.journal_entry_id],
      );
      await client.query(
        `insert into acc_reconciliation_line (reconciliation_id, journal_line_id) values ($1, $2)`,
        [session.id, line.id],
      );

      await client.query("savepoint before_void");
      const refusal = await attemptVoid(payment.id, "Rollback verification");
      check(
        "the void is refused",
        /statement reconciliation/i.test(refusal ?? ""),
        refusal ?? "none",
      );
    });

    // --- 6. A closed period blocks it, and rolls back what came before ------
    await scenario("a closed accounting period blocks the void atomically", async () => {
      const { payment, invoiceAfterPayment } = await recordPaymentOnOpenInvoice();
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

      await client.query("savepoint before_void");
      const refusal = await attemptVoid(payment.id, "Rollback verification");
      check("the void is refused", /closed period/i.test(refusal ?? ""), refusal ?? "none");
      const state = await one(
        `select p.status as payment_status, i.balance_due_minor
           from acc_payment p join acc_invoice i on i.id = $2 where p.id = $1`,
        [payment.id, invoiceAfterPayment.id],
      );
      check("the payment is untouched", state.payment_status !== "void");
      check(
        "the invoice restoration rolled back with it",
        Number(state.balance_due_minor) === Number(invoiceAfterPayment.balance_due_minor),
        `${state.balance_due_minor} vs ${invoiceAfterPayment.balance_due_minor}`,
      );
    });

    // --- 7. The attribution constraint is real ------------------------------
    await scenario("a void row cannot exist without its attribution", async () => {
      const { payment } = await recordPaymentOnOpenInvoice();
      let refused = null;
      await client.query("savepoint before_void");
      try {
        await client.query(`update acc_payment set status = 'void' where id = $1`, [payment.id]);
      } catch (error) {
        refused = error.message;
        await client.query("rollback to savepoint before_void");
      }
      check(
        "a bare status flip is rejected by the constraint",
        /acc_payment_void_metadata_ck/i.test(refused ?? ""),
        refused ?? "none",
      );
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
