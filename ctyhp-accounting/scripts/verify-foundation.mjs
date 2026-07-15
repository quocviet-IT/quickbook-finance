// Verify foundation integrity against the live DB.
// Run: node --env-file=.env.local scripts/verify-foundation.mjs
import pg from "pg";

const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
});

let pass = 0;
let fail = 0;
function check(name, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name} ${detail}`);
  }
}

async function expectThrow(name, fn, matcher) {
  try {
    await fn();
    check(name, false, "(expected an error, none thrown)");
  } catch (err) {
    check(name, matcher ? matcher.test(err.message) : true, `(got: ${err.message})`);
  }
}

async function main() {
  await client.connect();

  // --- Seed data ---
  const cur = await client.query("select code, is_base, decimal_places from acc_currency order by code");
  check("2 currencies seeded", cur.rows.length === 2);
  const usd = cur.rows.find((r) => r.code === "USD");
  check("USD is base with 2 decimals", usd?.is_base === true && usd?.decimal_places === 2);
  const bases = cur.rows.filter((r) => r.is_base).length;
  check("exactly one base currency", bases === 1, `(got ${bases})`);

  const acc = await client.query("select count(*)::int n from acc_account");
  check("chart of accounts seeded", acc.rows[0].n >= 17, `(got ${acc.rows[0].n})`);

  const tax = await client.query("select count(*)::int n from acc_tax_code");
  check("tax codes seeded", tax.rows[0].n === 5, `(got ${tax.rows[0].n})`);

  const ar = (await client.query("select id from acc_account where account_code='1100'")).rows[0].id;
  const sales = (await client.query("select id from acc_account where account_code='4000'")).rows[0].id;

  // --- One-sided line check (immediate CHECK constraint) ---
  await expectThrow(
    "rejects a line with both debit and credit",
    async () => {
      await client.query("begin");
      try {
        await client.query(
          `insert into acc_journal_entry (entry_number, entry_date, source_type, currency_code)
           values ('TEST-BOTH', current_date, 'manual', 'VND') returning id`,
        );
        const e = (await client.query("select id from acc_journal_entry where entry_number='TEST-BOTH'")).rows[0].id;
        await client.query(
          `insert into acc_journal_line (journal_entry_id, account_id, debit_minor, credit_minor)
           values ($1, $2, 100, 100)`,
          [e, ar],
        );
      } finally {
        await client.query("rollback");
      }
    },
    /one_sided|violates check/i,
  );

  // --- Balanced entry passes the deferred balance trigger ---
  await client.query("begin");
  try {
    const e = (
      await client.query(
        `insert into acc_journal_entry (entry_number, entry_date, source_type, currency_code)
         values ('TEST-BAL', current_date, 'manual', 'VND') returning id`,
      )
    ).rows[0].id;
    await client.query(
      `insert into acc_journal_line (journal_entry_id, account_id, debit_minor, credit_minor)
       values ($1,$2,1000,0), ($1,$3,0,1000)`,
      [e, ar, sales],
    );
    await client.query("set constraints all immediate");
    check("balanced entry accepted by balance trigger", true);
  } catch (err) {
    check("balanced entry accepted by balance trigger", false, `(${err.message})`);
  } finally {
    await client.query("rollback");
  }

  // --- Unbalanced entry rejected at constraint check ---
  await expectThrow(
    "unbalanced entry rejected by balance trigger",
    async () => {
      await client.query("begin");
      try {
        const e = (
          await client.query(
            `insert into acc_journal_entry (entry_number, entry_date, source_type, currency_code)
             values ('TEST-UNBAL', current_date, 'manual', 'VND') returning id`,
          )
        ).rows[0].id;
        await client.query(
          `insert into acc_journal_line (journal_entry_id, account_id, debit_minor, credit_minor)
           values ($1,$2,1000,0), ($1,$3,0,900)`,
          [e, ar, sales],
        );
        await client.query("set constraints all immediate");
      } finally {
        await client.query("rollback");
      }
    },
    /not balanced/i,
  );

  // --- Sequence increments (rolled back so it burns no numbers) ---
  await client.query("begin");
  try {
    const a = (await client.query("select acc_next_number('journal_entry') n")).rows[0].n;
    const b = (await client.query("select acc_next_number('journal_entry') n")).rows[0].n;
    check("sequence increments and formats", /^JE-\d{6}$/.test(a) && a !== b, `(${a}, ${b})`);
  } finally {
    await client.query("rollback");
  }

  // --- Posting function enforces authorization (no auth context here) ---
  await expectThrow(
    "acc_post_entry blocks unauthorized caller",
    async () => {
      await client.query(
        `select acc_post_entry(current_date, 'x', 'manual', null, 'VND',
           $1::jsonb)`,
        [JSON.stringify([
          { account_id: ar, debit_minor: 100, credit_minor: 0 },
          { account_id: sales, debit_minor: 0, credit_minor: 100 },
        ])],
      );
    },
    /not authorized/i,
  );

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main()
  .catch((e) => {
    console.error("Verify error:", e.message);
    process.exitCode = 1;
  })
  .finally(() => client.end());
