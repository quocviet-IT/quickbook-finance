/**
 * Behavioural verification of the fixed asset register.
 *
 * The module has never held a single asset in any company, which means its
 * depreciation engine has never produced a number anyone relied on. Before
 * anyone enters real property against real tax reporting, the arithmetic and
 * the postings should be shown to work rather than assumed to.
 *
 * Every scenario runs inside its own transaction and is ROLLED BACK, so real
 * assets are registered, real schedules are built and real journal entries post
 * — and none of it survives. Safe against a database holding real books.
 *
 * Run: node --env-file=.env.local scripts/verify-fixed-assets.mjs
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

/** The three accounts a depreciating asset posts against. */
async function accounts() {
  const asset = await one(
    `select id from acc_account where account_type = 'fixed_asset' and is_posting_account and status='active' limit 1`,
  );
  const accum = await one(
    `select id from acc_account where account_type = 'fixed_asset' and is_posting_account and status='active'
      order by account_code desc limit 1`,
  );
  const expense = await one(
    `select id from acc_account where account_type = 'expense' and is_posting_account and status='active' limit 1`,
  );
  return { asset: asset?.id, accum: accum?.id, expense: expense?.id };
}

/** A laptop: the example the report itself leads with. */
async function registerLaptop(over = {}) {
  const a = await accounts();
  const cost = over.cost ?? 240_000; // $2,400.00
  const life = over.life ?? 36;
  return one(
    `select acc_register_fixed_asset(
       $1,'Verification probe','Computer equipment',null,'Head office',
       $2::date, $2::date, 'USD', $3, $4, $5, 'straight_line',
       $6, $7, $8, null, null, 'rollback probe') as id`,
    [
      over.name ?? "Probe laptop",
      over.inService ?? "2026-01-01",
      cost,
      over.salvage ?? 0,
      life,
      a.asset,
      a.accum,
      a.expense,
    ],
  );
}

// --- 1. Registering builds a schedule that adds up ---------------------------
await scenario("a straight-line asset gets a schedule that totals its depreciable cost", async () => {
  const asset = await registerLaptop({ cost: 240_000, salvage: 24_000, life: 36 });
  check("registration returned an id", Boolean(asset.id));

  const head = await one(
    `select asset_number, cost_minor, salvage_value_minor, useful_life_months, status
       from acc_fixed_asset where id = $1`,
    [asset.id],
  );
  check("asset numbered", Boolean(head.asset_number), JSON.stringify(head));
  check("cost stored in minor units", Number(head.cost_minor) === 240_000);

  const sched = await one(
    `select count(*)::int periods, coalesce(sum(planned_amount_minor),0)::bigint total,
            to_char(min(period_start), 'YYYY-MM-DD') first_start,
            to_char(max(period_end), 'YYYY-MM-DD') last_end
       from acc_asset_depreciation_schedule where asset_id = $1`,
    [asset.id],
  );
  check("one row per month of useful life", sched.periods === 36, `periods=${sched.periods}`);
  check(
    "schedule totals cost less salvage",
    Number(sched.total) === 240_000 - 24_000,
    `total=${sched.total} expected=${240_000 - 24_000}`,
  );
  check("schedule starts in the in-service month", sched.first_start === "2026-01-01", sched.first_start);
  check("schedule ends 36 months later", sched.last_end === "2028-12-31", sched.last_end);
});

// --- 2. Rounding leaves no orphan cent --------------------------------------
await scenario("a cost that does not divide evenly still totals exactly", async () => {
  // 100,000 over 3 months is 33,333.33 a month; the schedule must still sum to
  // the whole amount rather than lose a cent to rounding.
  const asset = await registerLaptop({ cost: 100_000, salvage: 0, life: 3, name: "Probe indivisible" });
  const sched = await one(
    `select count(*)::int periods, sum(planned_amount_minor)::bigint total
       from acc_asset_depreciation_schedule where asset_id = $1`,
    [asset.id],
  );
  check("three periods", sched.periods === 3);
  check("totals exactly the cost", Number(sched.total) === 100_000, `total=${sched.total}`);
});

// --- 3. Posting depreciation moves the ledger -------------------------------
await scenario("posting depreciation writes a balanced entry and accumulates", async () => {
  const asset = await registerLaptop({ cost: 360_000, salvage: 0, life: 36, name: "Probe posting" });

  const result = await one(
    `select * from acc_post_asset_depreciation($1, '2026-03-31'::date)`,
    [asset.id],
  );
  check("three months posted", Number(result.posted_count) === 3, JSON.stringify(result));
  check("posted total is three months of it", Number(result.posted_total_minor) === 30_000, JSON.stringify(result));

  const posted = await one(
    `select count(*)::int n from acc_asset_depreciation_schedule
      where asset_id = $1 and journal_entry_id is not null`,
    [asset.id],
  );
  check("posted rows carry a journal entry", posted.n === 3, `n=${posted.n}`);

  const balance = await one(
    `select coalesce(sum(jl.debit_minor),0)::bigint d, coalesce(sum(jl.credit_minor),0)::bigint c
       from acc_journal_line jl
      where jl.journal_entry_id in (
        select journal_entry_id from acc_asset_depreciation_schedule
         where asset_id = $1 and journal_entry_id is not null)`,
    [asset.id],
  );
  check("entries balance", Number(balance.d) === Number(balance.c) && Number(balance.d) > 0,
    `debit=${balance.d} credit=${balance.c}`);

  // Re-posting is refused outright rather than quietly posting zero, which is
  // the better of the two: a second click cannot double-count depreciation and
  // cannot look like it worked.
  let refused = false;
  let text = "";
  try {
    await client.query(`select * from acc_post_asset_depreciation($1, '2026-03-31'::date)`, [asset.id]);
  } catch (error) {
    refused = true;
    text = error.message;
  }
  check("re-posting the same period is refused", refused, text);
  check("refusal says nothing is due", /no unposted depreciation is due/i.test(text), text);
});

// --- 4. Disposal computes gain or loss from net book value -------------------
await scenario("disposing an asset computes gain against net book value", async () => {
  const asset = await registerLaptop({ cost: 360_000, salvage: 0, life: 36, name: "Probe disposal" });
  await client.query(`select * from acc_post_asset_depreciation($1, '2026-03-31'::date)`, [asset.id]);

  const bank = await one(
    `select id from acc_account where account_type = 'bank' and is_posting_account and status='active' limit 1`,
  );
  const gain = await one(`select id from acc_account where account_code = '7990'`);
  const loss = await one(
    `select id from acc_account where account_type in ('expense','other_expense') and is_posting_account and status='active' limit 1`,
  );

  const out = await one(
    `select * from acc_dispose_fixed_asset($1, '2026-04-01'::date, 400000, 0, $2, $3, $4, 'rollback probe')`,
    [asset.id, bank.id, gain.id, loss.id],
  );
  // Cost 360,000 less 30,000 depreciation = 330,000 net book value; sold for
  // 400,000, so a 70,000 gain.
  check("net book value after three months", Number(out.net_book_value_minor) === 330_000, JSON.stringify(out));
  check("gain is proceeds less net book value", Number(out.gain_loss_minor) === 70_000, JSON.stringify(out));
  check("disposal posted an entry", Boolean(out.journal_entry_id));

  const status = await one(`select status from acc_fixed_asset where id = $1`, [asset.id]);
  check("asset marked disposed", status.status === "disposed", `status=${status.status}`);
});

// --- 5. Guards ---------------------------------------------------------------
await scenario("a straight-line asset without a useful life is refused", async () => {
  const a = await accounts();
  let refused = false;
  let text = "";
  try {
    await client.query(
      `select acc_register_fixed_asset('Probe bad','','Computer equipment',null,null,
        '2026-01-01'::date,'2026-01-01'::date,'USD',100000,0,null,'straight_line',$1,$2,$3,null,null,null)`,
      [a.asset, a.accum, a.expense],
    );
  } catch (error) {
    refused = true;
    text = error.message;
  }
  check("refused", refused, text);
});

console.log("\n== an unauthenticated caller is refused");
await client.query("begin");
try {
  await client.query(`select set_config('request.jwt.claims', '', true)`);
  let refused = false;
  let text = "";
  try {
    await registerLaptop({ name: "Probe unauthorised" });
  } catch (error) {
    refused = true;
    text = error.message;
  }
  check("refused before touching anything", refused, text);
  check("refusal is the permission gate", /permission/i.test(text), text);
} finally {
  await client.query("rollback");
}

console.log(`\n${passed} passed, ${failed} failed`);
await client.end();
process.exit(failed === 0 ? 0 : 1);
