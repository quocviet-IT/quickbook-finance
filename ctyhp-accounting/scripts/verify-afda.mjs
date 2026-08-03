/**
 * Behavioural verification of the Allowance for Doubtful Accounts.
 *
 * This estimate reduces what the balance sheet says receivables are worth, so
 * the arithmetic has to be reproducible and the posting has to be a difference
 * rather than a fresh layer each month. Every scenario runs inside its own
 * transaction and is ROLLED BACK, so entries post for real and none survive.
 *
 * Run: node --env-file=.env.local scripts/verify-afda.mjs
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
const all = async (sql, params = []) => (await client.query(sql, params)).rows;
const TODAY = "2026-08-03";

// --- 1. The evaluation matches the aging it is derived from ------------------
await scenario("the evaluation buckets the same receivables the aging report does", async () => {
  const rows = await all(`select * from acc_afda_evaluation($1::date)`, [TODAY]);
  check("one row per bucket", rows.length === 5, `rows=${rows.length}`);
  check(
    "buckets in aging order",
    rows.map((r) => r.bucket_key).join(",") === "current,d1_30,d31_60,d61_90,d90_plus",
    rows.map((r) => r.bucket_key).join(","),
  );

  const evaluated = rows.reduce((sum, r) => sum + Number(r.balance_minor), 0);
  const open = Number(
    (
      await one(
        `select coalesce(sum(balance_due_minor),0)::bigint n from acc_invoice
          where status in ('issued','partial') and balance_due_minor > 0 and issue_date <= $1::date`,
        [TODAY],
      )
    ).n,
  );
  check("bucket balances add up to open receivables", evaluated === open, `${evaluated} vs ${open}`);

  const badRate = rows.find((r) => Number(r.rate_bps) < 0 || Number(r.rate_bps) > 10000);
  check("every rate is a sane percentage", !badRate, JSON.stringify(badRate ?? {}));

  for (const r of rows) {
    const expected = Math.round((Number(r.balance_minor) * Number(r.rate_bps)) / 10000);
    if (Number(r.required_minor) !== expected) {
      check(`bucket ${r.bucket_key} reserve is balance x rate`, false, `${r.required_minor} vs ${expected}`);
      return;
    }
  }
  check("every bucket reserve is balance x rate", true);
});

// --- 2. Posting moves the allowance to the computed target -------------------
await scenario("posting takes the allowance to the target and balances", async () => {
  const before = Number((await one(`select acc_afda_balance($1::date) n`, [TODAY])).n);
  check("nothing reserved yet", before === 0, `before=${before}`);

  const out = await one(`select * from acc_post_afda_adjustment($1::date, null)`, [TODAY]);
  const required = Number(out.required_minor);
  check("posted an entry", Boolean(out.journal_entry_id));
  check("adjustment is target less what was carried", Number(out.adjustment_minor) === required - before);
  check("required is above zero on this data", required > 0, `required=${required}`);

  const after = Number((await one(`select acc_afda_balance($1::date) n`, [TODAY])).n);
  check("allowance now equals the target", after === required, `${after} vs ${required}`);

  const entry = await one(
    `select coalesce(sum(debit_minor),0)::bigint d, coalesce(sum(credit_minor),0)::bigint c
       from acc_journal_line where journal_entry_id = $1`,
    [out.journal_entry_id],
  );
  check("the entry balances", Number(entry.d) === Number(entry.c) && Number(entry.d) === required,
    `debit=${entry.d} credit=${entry.c}`);

  const sides = await all(
    `select a.account_code, l.debit_minor, l.credit_minor
       from acc_journal_line l join acc_account a on a.id = l.account_id
      where l.journal_entry_id = $1 order by a.account_code`,
    [out.journal_entry_id],
  );
  check("allowance 1190 is credited", sides.some((s) => s.account_code === "1190" && Number(s.credit_minor) === required));
  check("bad debt expense 6900 is debited", sides.some((s) => s.account_code === "6900" && Number(s.debit_minor) === required));
});

// --- 3. Running it twice tops up rather than doubling ------------------------
await scenario("a second run with nothing changed is refused", async () => {
  await client.query(`select * from acc_post_afda_adjustment($1::date, null)`, [TODAY]);
  let refused = false;
  let text = "";
  try {
    await client.query(`select * from acc_post_afda_adjustment($1::date, null)`, [TODAY]);
  } catch (error) {
    refused = true;
    text = error.message;
  }
  check("refused", refused, text);
  check("refusal says the allowance already stands there", /already stands/i.test(text), text);
});

// --- 4. A rate change moves only the difference ------------------------------
await scenario("raising a rate posts only the increment", async () => {
  const first = await one(`select * from acc_post_afda_adjustment($1::date, null)`, [TODAY]);
  const firstTarget = Number(first.required_minor);

  await client.query(`update acc_afda_rate set rate_bps = rate_bps + 1000 where bucket_key = 'd1_30'`);

  const second = await one(`select * from acc_post_afda_adjustment($1::date, null)`, [TODAY]);
  const secondTarget = Number(second.required_minor);
  check("target rose", secondTarget > firstTarget, `${firstTarget} -> ${secondTarget}`);
  check("only the difference posted", Number(second.adjustment_minor) === secondTarget - firstTarget);
  check("carried allowance was recognised", Number(second.previous_minor) === firstTarget);

  const balance = Number((await one(`select acc_afda_balance($1::date) n`, [TODAY])).n);
  check("allowance equals the new target, not the sum of both runs", balance === secondTarget,
    `${balance} vs ${secondTarget}`);
});

// --- 5. Releasing works too --------------------------------------------------
await scenario("lowering every rate releases the excess", async () => {
  await client.query(`select * from acc_post_afda_adjustment($1::date, null)`, [TODAY]);
  await client.query(`update acc_afda_rate set rate_bps = 0`);

  const out = await one(`select * from acc_post_afda_adjustment($1::date, null)`, [TODAY]);
  check("target is now nothing", Number(out.required_minor) === 0);
  check("the adjustment is negative", Number(out.adjustment_minor) < 0, JSON.stringify(out));

  const balance = Number((await one(`select acc_afda_balance($1::date) n`, [TODAY])).n);
  check("allowance is back to zero", balance === 0, `balance=${balance}`);

  const sides = await all(
    `select a.account_code, l.debit_minor, l.credit_minor
       from acc_journal_line l join acc_account a on a.id = l.account_id
      where l.journal_entry_id = $1`,
    [out.journal_entry_id],
  );
  check("the release debits 1190", sides.some((s) => s.account_code === "1190" && Number(s.debit_minor) > 0));
});

// --- 6. The allowance must not be mistaken for a receivable ------------------
await scenario("the allowance account cannot become the AR control account", async () => {
  const control = await one(`select account_code from acc_account where id = acc_active_ar_account()`);
  check("control account is still 1100", control.account_code === "1100", control.account_code);

  const type = await one(`select account_type from acc_account where account_code = '1190'`);
  check("1190 is a current asset, not a receivable", type.account_type === "current_asset", type.account_type);
});

console.log("\n== an unauthenticated caller is refused");
await client.query("begin");
try {
  await client.query(`select set_config('request.jwt.claims', '', true)`);
  let refused = false;
  let text = "";
  try {
    await client.query(`select * from acc_post_afda_adjustment($1::date, null)`, [TODAY]);
  } catch (error) {
    refused = true;
    text = error.message;
  }
  check("refused before posting anything", refused, text);
  check("refusal is the permission gate", /permission/i.test(text), text);
} finally {
  await client.query("rollback");
}

console.log(`\n${passed} passed, ${failed} failed`);
await client.end();
process.exit(failed === 0 ? 0 : 1);
