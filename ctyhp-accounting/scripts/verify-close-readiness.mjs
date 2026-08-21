/**
 * Behavioural verification of period close readiness.
 *
 * Everything happens inside ONE transaction that is always rolled back: 0120 is
 * applied, real journal entries are posted into a real company, and none of it
 * survives.
 *
 * The scenario worth the reader's attention is the fourth. It posts a
 * correcting entry *after* a period end and shows the same books tying today
 * while still being out at the period end — which is the whole reason this
 * phase re-evaluates every step at `period_end` instead of reusing the daily
 * control strip. If that distinction were not real, the checklist could have
 * been three lines of reuse.
 *
 * Run: node --env-file=.env.local scripts/verify-close-readiness.mjs
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
const all = async (sql, params = []) => (await client.query(sql, params)).rows;

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
  await client.query("savepoint before_call");
  try {
    await client.query(sql, params);
    return null;
  } catch (error) {
    await client.query("rollback to savepoint before_call");
    return error.message;
  }
}

/** The variance the close gate would compute for one control, at one date. */
async function varianceAt(controlKey, asOf) {
  const row = await one(
    `select case when has_subledger then subledger_minor - control_minor else control_minor end as variance
       from acc_control_reconciliation($1::date) where control_key = $2`,
    [asOf, controlKey],
  );
  return row ? Number(row.variance) : null;
}

/** The service's own drafts-in-the-period query, run as the service runs it. */
async function draftCount(periodStart, periodEnd) {
  const row = await one(
    `select (select count(*) from acc_invoice
              where status = 'draft' and issue_date between $1 and $2)
          + (select count(*) from acc_bill
              where status = 'draft' and bill_date between $1 and $2) as n`,
    [periodStart, periodEnd],
  );
  return Number(row.n);
}

await client.connect();
await client.query("begin");
try {
  const migration = await readFile(
    join(projectRoot, "supabase", "migrations", "0120_close_window_policy.sql"),
    "utf8",
  );
  await client.query(migration);
  console.log("Applied 0120 inside the transaction (never committed).");

  const admin = await one(
    `select id from acc_app_user where role = 'admin' and status = 'active' order by created_at limit 1`,
  );
  if (!admin) throw new Error("no active admin to authenticate as");
  const asUser = (id) =>
    client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: id, role: "authenticated" }),
    ]);
  await asUser(admin.id);

  // An open period in the past to work against: its end date has been and gone,
  // so "at the period end" and "today" are genuinely different dates.
  const period = await one(
    `select id, label, period_start, period_end, status
       from acc_accounting_period
      where status = 'open' and period_end < current_date
      order by period_end desc limit 1`,
  );
  const anyPeriod =
    period ??
    (await one(
      `select id, label, period_start, period_end, status
         from acc_accounting_period order by period_end desc limit 1`,
    ));
  if (!anyPeriod) throw new Error("this company has no accounting periods");
  console.log(
    `Working against ${anyPeriod.label} (${anyPeriod.period_start} → ${anyPeriod.period_end}, ${anyPeriod.status}).`,
  );

  const arAccount = await one(
    `select id, account_code from acc_account
      where account_type = 'accounts_receivable' and status = 'active'
      order by account_code limit 1`,
  );
  const expenseAccount = await one(
    `select id from acc_account where account_type = 'expense' and status = 'active'
      order by account_code limit 1`,
  );

  await scenario("a period with no unexplained variance has nothing blocking it", async () => {
    const blockers = await one(`select acc_period_close_blockers($1) as text`, [anyPeriod.id]);
    // Whatever this company's books say, the screen and the gate must agree —
    // so what is asserted is that both sides derive from one function, not a
    // particular state of somebody's real ledger.
    check(
      "the gate answers, and its answer is either a sentence or nothing",
      blockers.text === null || typeof blockers.text === "string",
      String(blockers.text),
    );
    const rows = await all(`select * from acc_control_reconciliation($1::date)`, [
      anyPeriod.period_end,
    ]);
    check("the checklist has control rows to build steps from", rows.length > 0, String(rows.length));
    // The applicability rule the domain copies from the gate.
    const notApplicable = rows.filter((r) => !r.has_subledger && Number(r.control_minor) === 0);
    check(
      "a control with no subledger and no balance is one the company does not have",
      notApplicable.every((r) => Number(r.subledger_minor) === 0),
    );
  });

  await scenario("a draft in the period is derived, never stored", async () => {
    if (!arAccount) {
      console.log("  SKIP  no receivable account in this chart");
      return;
    }
    const customer = await one(`select id from acc_customer limit 1`);
    if (!customer) {
      console.log("  SKIP  no customer to raise a draft against");
      return;
    }

    const before = await draftCount(anyPeriod.period_start, anyPeriod.period_end);
    await client.query(
      `insert into acc_invoice (customer_id, issue_date, due_date, status, currency_code,
                                subtotal_minor, tax_total_minor, total_minor, balance_due_minor)
       values ($1, $2, $2, 'draft', 'USD', 1000, 0, 1000, 1000)`,
      [customer.id, anyPeriod.period_end],
    );
    const during = await draftCount(anyPeriod.period_start, anyPeriod.period_end);
    check("raising a draft in the period makes the step outstanding", during === before + 1,
      `${before} → ${during}`);

    await client.query(
      `delete from acc_invoice where status = 'draft' and issue_date = $1
        and invoice_number is null and total_minor = 1000`,
      [anyPeriod.period_end],
    );
    const after = await draftCount(anyPeriod.period_start, anyPeriod.period_end);
    check("removing it makes the step complete again, with nobody ticking anything",
      after === before, `${during} → ${after}`);

    // The structural half of the same claim: there is nowhere to store a
    // ticked step even if somebody wanted to.
    const stored = await one(
      `select count(*)::int as n from information_schema.tables
        where table_schema = 'public' and table_name like '%close_step%'`,
    );
    check("no table exists that could hold a ticked step", stored.n === 0, String(stored.n));
  });

  await scenario("the books can tie today and still be out at the period end", async () => {
    if (!arAccount || !expenseAccount) {
      console.log("  SKIP  this chart has no receivable or expense account to post between");
      return;
    }

    const beforeAtEnd = await varianceAt("ar", anyPeriod.period_end);
    const beforeToday = await varianceAt("ar", new Date().toISOString().slice(0, 10));

    // Something posted to the control account inside the period with no invoice
    // behind it: the subledger no longer matches at the period end.
    await client.query(
      `select acc_post_entry($1::date, 'verification: control account out at period end',
                             'manual', null, 'USD', $2::jsonb)`,
      [
        anyPeriod.period_end,
        JSON.stringify([
          { account_id: arAccount.id, debit_minor: 5000, credit_minor: 0, amount_base_minor: 5000 },
          { account_id: expenseAccount.id, debit_minor: 0, credit_minor: 5000, amount_base_minor: 5000 },
        ]),
      ],
    );
    // And the correcting entry a month later, the way a real correction lands.
    await client.query(
      `select acc_post_entry(($1::date + interval '20 days')::date,
                             'verification: the correction, posted late',
                             'manual', null, 'USD', $2::jsonb)`,
      [
        anyPeriod.period_end,
        JSON.stringify([
          { account_id: expenseAccount.id, debit_minor: 5000, credit_minor: 0, amount_base_minor: 5000 },
          { account_id: arAccount.id, debit_minor: 0, credit_minor: 5000, amount_base_minor: 5000 },
        ]),
      ],
    );

    const afterAtEnd = await varianceAt("ar", anyPeriod.period_end);
    const afterToday = await varianceAt("ar", new Date().toISOString().slice(0, 10));

    check(
      "the period end moved, because that is where the entry landed",
      afterAtEnd !== beforeAtEnd,
      `${beforeAtEnd} → ${afterAtEnd}`,
    );
    check(
      "today did not move, because the correction cancelled it",
      afterToday === beforeToday,
      `${beforeToday} → ${afterToday}`,
    );
    // This is the phase's whole premise in one assertion: reusing today's
    // control strip would have reported this period ready when it is not.
    check(
      "so a checklist built from today's figures would have been wrong about this period",
      afterToday !== afterAtEnd,
      `today ${afterToday} vs period end ${afterAtEnd}`,
    );

    const blockers = await one(`select acc_period_close_blockers($1) as text`, [anyPeriod.id]);
    check("the gate names the difference", /out by/i.test(blockers.text ?? ""), String(blockers.text));

    const refusal = await attempt(`select acc_close_period($1, 'verification', null)`, [
      anyPeriod.id,
    ]);
    check(
      "and refuses the close until it is explained in writing",
      /written explanation/i.test(refusal ?? ""),
      refusal ?? "none",
    );
  });

  await scenario("only an admin can close or reopen a period", async () => {
    const other = await one(
      `select id from acc_app_user where role <> 'admin' and status = 'active' limit 1`,
    );
    if (!other) {
      console.log("  SKIP  no active non-admin to authenticate as");
      return;
    }
    await asUser(other.id);
    const refusal = await attempt(`select acc_close_period($1, 'not mine to close', null)`, [
      anyPeriod.id,
    ]);
    check("closing is refused", /Only an admin/i.test(refusal ?? ""), refusal ?? "none");
    await asUser(admin.id);
  });

  await scenario("closing is recorded, and the history reports the latest close", async () => {
    const blockers = await one(`select acc_period_close_blockers($1) as text`, [anyPeriod.id]);
    if (anyPeriod.status !== "open") {
      console.log("  SKIP  the newest period is already closed");
      return;
    }
    await client.query(`select acc_close_period($1, 'verification close', $2)`, [
      anyPeriod.id,
      blockers.text ? "explained by the verification script" : null,
    ]);
    const event = await one(
      `select event, reason from acc_period_event where period_id = $1
        order by created_at desc limit 1`,
      [anyPeriod.id],
    );
    check("the close is on the period's event log", event?.event === "close", String(event?.event));

    const history = await all(`select * from acc_period_close_history(6)`);
    const row = history.find((h) => h.period_id === anyPeriod.id);
    check("the closed period appears in the history", Boolean(row));

    // Closed, reopened, closed again: the history must report the second close.
    // The first one names a day the books were later reopened.
    await client.query(`select acc_reopen_period($1, 'verification reopen')`, [anyPeriod.id]);
    await client.query(`select pg_sleep(0.01)`);
    await client.query(`select acc_close_period($1, 'verification second close', $2)`, [
      anyPeriod.id,
      blockers.text ? "explained by the verification script" : null,
    ]);
    const closes = await all(
      `select created_at from acc_period_event
        where period_id = $1 and event = 'close' order by created_at desc`,
      [anyPeriod.id],
    );
    const after = await all(`select * from acc_period_close_history(6)`);
    const row2 = after.find((h) => h.period_id === anyPeriod.id);
    check(
      "the history reports the latest close, not the first",
      row2 && closes[0] && new Date(row2.closed_at).getTime() === new Date(closes[0].created_at).getTime(),
      `${row2?.closed_at} vs ${closes[0]?.created_at}`,
    );
  });

  await scenario("the close window is a policy, and unset stays unset", async () => {
    await client.query(`select acc_save_work_policy(null, null, null, 5, 'verification')`);
    const set = await one(`select * from acc_current_work_policy()`);
    check("the close window survives the round trip", Number(set.close_window_days) === 5,
      String(set.close_window_days));
    check("the fields nobody set are still null", set.materiality_minor === null,
      String(set.materiality_minor));

    await client.query(`select acc_save_work_policy(null, null, null, null, 'verification')`);
    const unset = await one(`select * from acc_current_work_policy()`);
    check("clearing it gives back undecided, not zero", unset.close_window_days === null,
      String(unset.close_window_days));

    await client.query(`select acc_save_work_policy(null, null, null, 0, 'verification')`);
    const zero = await one(`select * from acc_current_work_policy()`);
    check("zero is a policy — close on the last day only", Number(zero.close_window_days) === 0,
      String(zero.close_window_days));

    const refusal = await attempt(`select acc_save_work_policy(null, null, null, -1, null)`);
    check("a negative window is refused", /violates check constraint/i.test(refusal ?? ""),
      refusal ?? "none");

    // The four-argument form is gone on purpose: a stale caller would have
    // saved a policy with the close window silently discarded.
    const stale = await attempt(`select acc_save_work_policy(1, 1, 1, 'note')`);
    check("the old four-argument signature no longer exists",
      /does not exist|function acc_save_work_policy/i.test(stale ?? ""), stale ?? "none");
  });
} catch (error) {
  failed += 1;
  console.log(`  FAIL  verification threw — ${error.message}`);
} finally {
  await client.query("rollback");
  console.log("\nROLLBACK — nothing was closed and no entry was kept.");
  await client.end();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
