// End-to-end Recurring Transactions verification. All writes are rolled back.
// Run: node --env-file=.env.local scripts/verify-recurring-rollback.mjs
import pg from "pg";

const db = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function insertTemplate(documentType, name, payload, totalMinor) {
  const result = await db.query(
    `insert into acc_recurring_template (
       name, document_type, frequency, interval_count, start_date,
       next_run_date, payload, total_minor
     )
     values ($1, $2, 'monthly', 1, current_date, current_date, $3::jsonb, $4)
     returning id`,
    [name, documentType, JSON.stringify(payload), totalMinor],
  );
  return result.rows[0].id;
}

async function claim(templateId) {
  const result = await db.query(`select * from acc_claim_recurring_run($1::uuid)`, [templateId]);
  assert(result.rowCount === 1, "Recurring occurrence was not returned");
  return result.rows[0];
}

try {
  await db.connect();
  await db.query("begin");

  const admin = await db.query(`
    select id
      from acc_app_user
     where role = 'admin' and status = 'active'
     order by created_at
     limit 1
  `);
  assert(admin.rowCount === 1, "No active admin is available for the rollback test");
  await db.query(
    `select set_config(
      'request.jwt.claims',
      json_build_object('sub', $1::text, 'role', 'authenticated')::text,
      true
    )`,
    [admin.rows[0].id],
  );

  await db.query(`
    update acc_accounting_period
       set status = 'open'
     where period_start <= current_date and period_end >= current_date
  `);
  await db.query(`
    update acc_approval_policy set enabled = false where action_key = 'manual_journal'
  `);

  const customer = await db.query(
    `select id from acc_customer where is_active order by created_at limit 1`,
  );
  const vendor = await db.query(
    `select id from acc_vendor where is_active order by created_at limit 1`,
  );
  assert(customer.rowCount === 1, "An active customer is required");
  assert(vendor.rowCount === 1, "An active vendor is required");

  const accounts = await db.query(`
    select
      (select id from acc_account
        where account_type in ('income', 'other_income')
          and status = 'active' and is_posting_account limit 1) as income_id,
      (select id from acc_account
        where account_type in ('expense', 'cost_of_goods_sold', 'other_expense')
          and status = 'active' and is_posting_account limit 1) as expense_id,
      (select id from acc_account
        where account_type in ('bank', 'credit_card')
          and status = 'active' and is_posting_account limit 1) as payment_id
  `);
  const account = accounts.rows[0];
  assert(account.income_id && account.expense_id && account.payment_id, "Required accounts are missing");

  const invoiceTemplate = await insertTemplate(
    "invoice",
    "ROLLBACK — Monthly jewelry care plan",
    {
      customer_id: customer.rows[0].id,
      due_days: 30,
      memo: "Rollback verification",
      lines: [
        {
          description: "Monthly jewelry care plan",
          quantity: 1,
          unit_price_minor: 15000,
          income_account_id: account.income_id,
          tax_code_id: null,
          item_id: null,
        },
      ],
    },
    15000,
  );
  const invoiceRun = await claim(invoiceTemplate);
  assert(invoiceRun.claimed === true, "Invoice run was not claimed");
  const duplicateInvoiceClaim = await claim(invoiceTemplate);
  assert(duplicateInvoiceClaim.claimed === false, "Duplicate invoice occurrence was claimed");
  const invoice = await db.query(
    `insert into acc_invoice (
       customer_id, issue_date, due_date, currency_code,
       subtotal_minor, total_minor, balance_due_minor, recurring_run_id
     )
     values ($1, current_date, current_date + 30, 'USD', 15000, 15000, 15000, $2)
     returning id`,
    [customer.rows[0].id, invoiceRun.run_id],
  );
  await db.query(
    `insert into acc_invoice_line (
       invoice_id, description, quantity, unit_price_minor, income_account_id,
       line_subtotal_minor, line_total_minor
     )
     values ($1, 'Monthly jewelry care plan', 1, 15000, $2, 15000, 15000)`,
    [invoice.rows[0].id, account.income_id],
  );
  await db.query(
    `select acc_complete_recurring_run($1, 'generated', $2)`,
    [invoiceRun.run_id, invoice.rows[0].id],
  );

  const billTemplate = await insertTemplate(
    "bill",
    "ROLLBACK — Security monitoring bill",
    {
      vendor_id: vendor.rows[0].id,
      vendor_ref: null,
      due_days: 15,
      memo: "Rollback verification",
      lines: [
        {
          description: "Showroom security monitoring",
          expense_account_id: account.expense_id,
          amount_minor: 30000,
          item_id: null,
        },
      ],
    },
    30000,
  );
  const billRun = await claim(billTemplate);
  const bill = await db.query(
    `insert into acc_bill (
       vendor_id, bill_date, due_date, currency_code,
       total_minor, balance_due_minor, recurring_run_id
     )
     values ($1, current_date, current_date + 15, 'USD', 30000, 30000, $2)
     returning id`,
    [vendor.rows[0].id, billRun.run_id],
  );
  await db.query(
    `insert into acc_bill_line (bill_id, description, expense_account_id, amount_minor)
     values ($1, 'Showroom security monitoring', $2, 30000)`,
    [bill.rows[0].id, account.expense_id],
  );
  await db.query(
    `select acc_complete_recurring_run($1, 'generated', $2)`,
    [billRun.run_id, bill.rows[0].id],
  );

  const expenseTemplate = await insertTemplate(
    "expense",
    "ROLLBACK — Jewelry workshop utilities",
    {
      vendor_id: vendor.rows[0].id,
      payment_account_id: account.payment_id,
      memo: "Rollback verification",
      lines: [
        {
          description: "Workshop utilities",
          expense_account_id: account.expense_id,
          amount_minor: 20000,
        },
      ],
    },
    20000,
  );
  const expenseRun = await claim(expenseTemplate);
  await db.query(
    `select acc_complete_recurring_run($1, 'pending_review', null)`,
    [expenseRun.run_id],
  );
  const expense = await db.query(
    `select acc_post_recurring_expense($1::uuid) as id`,
    [expenseRun.run_id],
  );

  const journalTemplate = await insertTemplate(
    "journal",
    "ROLLBACK — Monthly allocation",
    {
      description: "Monthly allocation",
      source_ref: "ROLLBACK",
      lines: [
        { account_id: account.expense_id, debit_minor: 10000, credit_minor: 0 },
        { account_id: account.payment_id, debit_minor: 0, credit_minor: 10000 },
      ],
    },
    10000,
  );
  const journalRun = await claim(journalTemplate);
  await db.query(
    `select acc_complete_recurring_run($1, 'pending_review', null)`,
    [journalRun.run_id],
  );
  const journal = await db.query(
    `select acc_post_recurring_journal($1::uuid) as id`,
    [journalRun.run_id],
  );

  const checks = await db.query(
    `select
       (select count(*)::int from acc_recurring_run
         where template_id in ($1, $2, $3, $4) and status = 'generated') as generated_runs,
       (select count(*)::int from acc_invoice
         where recurring_run_id = $5) as linked_invoices,
       (select count(*)::int from acc_bill
         where recurring_run_id = $6) as linked_bills,
       (select count(*)::int from acc_expense
         where recurring_run_id = $7) as linked_expenses,
       (select count(*)::int from acc_journal_entry
         where recurring_run_id = $8) as linked_journals,
       (select count(*)::int from acc_recurring_template
         where id in ($1, $2, $3, $4) and next_run_date > current_date) as advanced_schedules`,
    [
      invoiceTemplate,
      billTemplate,
      expenseTemplate,
      journalTemplate,
      invoiceRun.run_id,
      billRun.run_id,
      expenseRun.run_id,
      journalRun.run_id,
    ],
  );
  const check = checks.rows[0];
  assert(Number(check.generated_runs) === 4, "Not every occurrence completed");
  assert(Number(check.linked_invoices) === 1, "Invoice link is missing");
  assert(Number(check.linked_bills) === 1, "Bill link is missing");
  assert(Number(check.linked_expenses) === 1, "Expense link is missing");
  assert(Number(check.linked_journals) === 1, "Journal link is missing");
  assert(Number(check.advanced_schedules) === 4, "Schedule advancement is incomplete");

  console.log(
    JSON.stringify(
      {
        verified: true,
        generatedRuns: Number(check.generated_runs),
        linkedDocuments: {
          invoice: invoice.rows[0].id,
          bill: bill.rows[0].id,
          expense: expense.rows[0].id,
          journal: journal.rows[0].id,
        },
        duplicateOccurrencePrevented: duplicateInvoiceClaim.claimed === false,
        advancedSchedules: Number(check.advanced_schedules),
        persisted: false,
      },
      null,
      2,
    ),
  );
  await db.query("rollback");
} catch (error) {
  try {
    await db.query("rollback");
  } catch {
    // Preserve the original verification failure.
  }
  throw error;
} finally {
  await db.end();
}
