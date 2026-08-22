/**
 * Proof that the one aggregate call answers exactly what twelve calls did.
 *
 * A performance change that quietly alters a figure is not a performance
 * change, it is a defect with a stopwatch attached. So this compares the new
 * `acc_monthly_ledger_balances` against the `acc_ledger_balances` calls it
 * replaces, month by month and account by account, on the company's real books.
 *
 * Read-only: it runs two queries and compares them. Nothing is written, and
 * there is nothing to roll back.
 *
 * Run: node --env-file=.env.local scripts/verify-monthly-ledger.mjs
 */
import pg from "pg";

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

const MONTHS = 12;

/** The month ranges the dashboard asks for, matching trailingMonthRanges. */
function ranges(asOf, count) {
  const [year, month, day] = asOf.split("-").map(Number);
  return Array.from({ length: count }, (_, index) => {
    const offset = index - (count - 1);
    const start = new Date(Date.UTC(year, month - 1 + offset, 1));
    const isCurrent = offset === 0;
    const end = isCurrent
      ? new Date(Date.UTC(year, month - 1, day))
      : new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    const key = start.toISOString().slice(0, 7);
    return { key, from: `${key}-01`, to: end.toISOString().slice(0, 10) };
  });
}

await client.connect();
try {
  const asOf = (await client.query(`select current_date::text as d`)).rows[0].d;
  console.log(`Comparing as of ${asOf}, ${MONTHS} months.\n`);

  // The new way: one call.
  const started = Date.now();
  const aggregate = (
    await client.query(`select * from acc_monthly_ledger_balances($1::date, $2)`, [asOf, MONTHS])
  ).rows;
  const aggregateMs = Date.now() - started;

  // The old way: one call per month.
  const windows = ranges(asOf, MONTHS);
  const perMonthStarted = Date.now();
  const perMonth = new Map();
  for (const range of windows) {
    const rows = (
      await client.query(`select * from acc_ledger_balances($1::date, $2::date)`, [
        range.from,
        range.to,
      ])
    ).rows;
    perMonth.set(range.key, rows);
  }
  const perMonthMs = Date.now() - perMonthStarted;

  console.log(`  one aggregate call: ${aggregateMs} ms`);
  console.log(`  ${MONTHS} separate calls: ${perMonthMs} ms\n`);

  const byMonth = new Map();
  for (const row of aggregate) {
    const list = byMonth.get(row.month_key) ?? [];
    list.push(row);
    byMonth.set(row.month_key, list);
  }

  let mismatches = 0;
  let comparedAccounts = 0;
  let monthsWithActivity = 0;

  for (const range of windows) {
    const oldRows = perMonth.get(range.key) ?? [];
    const newRows = byMonth.get(range.key) ?? [];
    const newByAccount = new Map(newRows.map((r) => [r.account_id, r]));

    let monthHadActivity = false;
    for (const oldRow of oldRows) {
      const oldDebit = Number(oldRow.debit_base);
      const oldCredit = Number(oldRow.credit_base);
      // The old call returns every posting account, including untouched ones;
      // the new one returns only accounts with rows. Absent must equal zero.
      const fresh = newByAccount.get(oldRow.account_id);
      const newDebit = fresh ? Number(fresh.debit_base) : 0;
      const newCredit = fresh ? Number(fresh.credit_base) : 0;
      if (oldDebit !== 0 || oldCredit !== 0) monthHadActivity = true;
      comparedAccounts += 1;
      if (oldDebit !== newDebit || oldCredit !== newCredit) {
        mismatches += 1;
        if (mismatches <= 5) {
          console.log(
            `  DIFF  ${range.key} ${oldRow.account_code}: was ${oldDebit}/${oldCredit}, now ${newDebit}/${newCredit}`,
          );
        }
      }
    }
    // And nothing invented: every account the new call returns must have been
    // in the old answer too.
    for (const freshRow of newRows) {
      if (!oldRows.some((r) => r.account_id === freshRow.account_id)) {
        mismatches += 1;
        console.log(`  DIFF  ${range.key} ${freshRow.account_code}: appears only in the new call`);
      }
    }
    if (monthHadActivity) monthsWithActivity += 1;
  }

  check(
    `every account in every month agrees (${comparedAccounts} account-months compared)`,
    mismatches === 0,
    `${mismatches} mismatched`,
  );
  check(
    "the comparison saw real activity, so agreement means something",
    monthsWithActivity > 0,
    `${monthsWithActivity} of ${MONTHS} months had postings`,
  );
  check(
    "the window covers the months asked for and no more",
    [...byMonth.keys()].every((key) => windows.some((w) => w.key === key)),
    [...byMonth.keys()].join(", "),
  );
  check(
    "one call is not slower than twelve",
    aggregateMs <= perMonthMs,
    `${aggregateMs} ms vs ${perMonthMs} ms`,
  );
} catch (error) {
  failed += 1;
  console.log(`  FAIL  verification threw — ${error.message}`);
} finally {
  await client.end();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
