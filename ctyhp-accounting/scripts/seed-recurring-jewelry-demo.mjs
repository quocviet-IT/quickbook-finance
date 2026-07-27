// Idempotent linked demo schedules for the jewelry accounting dataset.
// Every schedule is paused so seeding never causes an automated transaction.
// Run: node --env-file=.env.local scripts/seed-recurring-jewelry-demo.mjs
import pg from "pg";

const db = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function one(sql, params = []) {
  const result = await db.query(sql, params);
  assert(result.rowCount === 1, `Expected one row: ${sql.slice(0, 80)}`);
  return result.rows[0];
}

async function upsertSchedule(actorId, startDate, schedule) {
  const existing = await db.query(
    `select id from acc_recurring_template where name = $1 limit 1`,
    [schedule.name],
  );
  let row;
  let action;
  if (existing.rowCount) {
    row = (
      await db.query(
        `update acc_recurring_template
            set document_type = $2,
                frequency = 'monthly',
                interval_count = 1,
                start_date = $3,
                next_run_date = $3,
                end_date = null,
                payload = $4::jsonb,
                total_minor = $5,
                status = 'paused',
                last_error = null,
                updated_by = $6,
                updated_at = now()
          where id = $1
          returning *`,
        [
          existing.rows[0].id,
          schedule.documentType,
          startDate,
          JSON.stringify(schedule.payload),
          schedule.totalMinor,
          actorId,
        ],
      )
    ).rows[0];
    action = "update";
  } else {
    row = (
      await db.query(
        `insert into acc_recurring_template (
           name, document_type, frequency, interval_count,
           start_date, next_run_date, payload, total_minor, status,
           created_by, updated_by
         )
         values ($1, $2, 'monthly', 1, $3, $3, $4::jsonb, $5, 'paused', $6, $6)
         returning *`,
        [
          schedule.name,
          schedule.documentType,
          startDate,
          JSON.stringify(schedule.payload),
          schedule.totalMinor,
          actorId,
        ],
      )
    ).rows[0];
    action = "insert";
  }

  await db.query(
    `insert into acc_audit_log (
       table_name, record_id, action, actor_id, after_json
     )
     values ('acc_recurring_template', $1, $2, $3, $4::jsonb)`,
    [row.id, action, actorId, JSON.stringify(row)],
  );
  return { id: row.id, action, name: row.name, status: row.status };
}

try {
  await db.connect();
  await db.query("begin");

  const admin = await one(`
    select id
      from acc_app_user
     where role = 'admin' and status = 'active'
     order by created_at
     limit 1
  `);
  const customer = await one(`
    select c.id, c.name
      from acc_customer c
      left join acc_invoice i on i.customer_id = c.id
     where c.is_active
     group by c.id
     order by count(i.id) desc, c.name
     limit 1
  `);
  const insuranceVendor = await one(`
    select v.id, v.name
      from acc_vendor v
      left join acc_bill b on b.vendor_id = v.id
     where v.is_active
     group by v.id
     order by
       case when v.name ~* '(insurance|insur)' then 0 else 1 end,
       count(b.id) desc,
       v.name
     limit 1
  `);
  const securityVendor = await one(`
    select v.id, v.name
      from acc_vendor v
      left join acc_expense e on e.vendor_id = v.id
     where v.is_active
     group by v.id
     order by
       case when v.name ~* '(security|alarm|monitor)' then 0 else 1 end,
       count(e.id) desc,
       v.name
     limit 1
  `);

  const accounts = await db.query(`
    select account_code, id, name
      from acc_account
     where account_code in ('1010', '4100', '6000', '6010', '6030')
       and status = 'active'
       and is_posting_account
  `);
  const account = Object.fromEntries(
    accounts.rows.map((row) => [row.account_code, row]),
  );
  for (const code of ["1010", "4100", "6000", "6010", "6030"]) {
    assert(account[code], `Required account ${code} is missing`);
  }

  const taxCode = await db.query(
    `select id, code from acc_tax_code where code = 'TAX' and is_active limit 1`,
  );
  const careItem = await db.query(
    `select id, item_code
       from acc_item
      where item_code = 'JEWELRY-DEMO-CLEAN-001' and is_active
      limit 1`,
  );

  const now = new Date();
  const firstNextMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  )
    .toISOString()
    .slice(0, 10);

  const schedules = [
    {
      name: "JEWELRY DEMO — Monthly jewelry care plan invoices",
      documentType: "invoice",
      totalMinor: 7900,
      payload: {
        customer_id: customer.id,
        due_days: 30,
        memo: "Recurring priority jewelry care membership",
        lines: [
          {
            description: "Priority jewelry care membership",
            quantity: 1,
            unit_price_minor: 7900,
            income_account_id: account["4100"].id,
            tax_code_id: taxCode.rows[0]?.id ?? null,
            item_id: careItem.rows[0]?.id ?? null,
          },
        ],
      },
    },
    {
      name: "JEWELRY DEMO — Monthly jewelry inventory insurance",
      documentType: "bill",
      totalMinor: 42500,
      payload: {
        vendor_id: insuranceVendor.id,
        vendor_ref: null,
        due_days: 15,
        memo: "Monthly coverage for showroom and jewelry inventory",
        lines: [
          {
            description: "Jewelry inventory insurance premium",
            expense_account_id: account["6030"].id,
            amount_minor: 42500,
            item_id: null,
          },
        ],
      },
    },
    {
      name: "JEWELRY DEMO — Monthly showroom security monitoring",
      documentType: "expense",
      totalMinor: 18900,
      payload: {
        vendor_id: securityVendor.id,
        payment_account_id: account["1010"].id,
        memo: "Showroom alarm and surveillance monitoring",
        lines: [
          {
            description: "Showroom security monitoring",
            expense_account_id: account["6000"].id,
            amount_minor: 18900,
          },
        ],
      },
    },
    {
      name: "JEWELRY DEMO — Monthly showroom rent reclassification",
      documentType: "journal",
      totalMinor: 150000,
      payload: {
        description: "Reclassify showroom rent from general operating expenses",
        source_ref: "MONTHLY-RECLASS",
        lines: [
          {
            account_id: account["6010"].id,
            debit_minor: 150000,
            credit_minor: 0,
          },
          {
            account_id: account["6000"].id,
            debit_minor: 0,
            credit_minor: 150000,
          },
        ],
      },
    },
  ];

  const results = [];
  for (const schedule of schedules) {
    results.push(await upsertSchedule(admin.id, firstNextMonth, schedule));
  }

  await db.query("commit");
  console.log(
    JSON.stringify(
      {
        seeded: true,
        firstOccurrence: firstNextMonth,
        schedules: results,
        linkedReferences: {
          customer: customer.name,
          insuranceVendor: insuranceVendor.name,
          securityVendor: securityVendor.name,
          careItem: careItem.rows[0]?.item_code ?? null,
          taxCode: taxCode.rows[0]?.code ?? null,
          accounts: Object.fromEntries(
            Object.entries(account).map(([code, row]) => [code, row.name]),
          ),
        },
      },
      null,
      2,
    ),
  );
} catch (error) {
  try {
    await db.query("rollback");
  } catch {
    // Preserve the original seed failure.
  }
  throw error;
} finally {
  await db.end();
}
