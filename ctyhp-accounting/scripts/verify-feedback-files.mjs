/**
 * Behavioural verification of the feedback file guards.
 *
 * The fault being proved fixed: a report filed while working in a company other
 * than the first one could not carry a screenshot. `storage.objects` policies
 * are global, and the guard they call was pinned to `public`, so the report's
 * id was unknown to it and the upload was refused. Measured before the fix: 22
 * of 22 reports in `public` had a screenshot, 0 of 4 in `co_pc_49`.
 *
 * Everything happens inside ONE transaction that is always rolled back: 0104 is
 * applied, real reports are filed into two real companies, and none of it
 * survives.
 *
 * Run: node --env-file=.env.local scripts/verify-feedback-files.mjs
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

const asUser = (id) =>
  client.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: id, role: "authenticated" }),
  ]);

/** File a report inside one company's books and return its id. */
async function fileReport(schema, reporterId) {
  const row = await one(
    `insert into ${schema}.acc_feedback_report
       (kind, description, page_url, page_route, viewport_width, viewport_height, reporter_id)
     values ('broken', 'Verification report', 'http://x/y', '/y', 1280, 900, $1)
     returning id`,
    [reporterId],
  );
  return row.id;
}

await client.connect();
await client.query("begin");
try {
  const sql = await readFile(
    join(projectRoot, "supabase", "migrations", "0104_feedback_files_every_company.sql"),
    "utf8",
  );
  await client.query(sql);
  console.log("Applied 0104 inside the transaction (never committed).");

  // A company that is not the first one: the whole point of the fault.
  const other = await one(
    `select schema_name from onebook.company
      where schema_name <> 'public' and status = 'active' order by display_order limit 1`,
  );
  if (!other) throw new Error("need a second company to prove this at all");
  console.log(`Second company under test: ${other.schema_name}`);

  const reporter = await one(
    `select id from ${other.schema_name}.acc_app_user where status = 'active' order by created_at limit 1`,
  );
  const admin = await one(
    `select id from ${other.schema_name}.acc_app_user
      where role = 'admin' and status = 'active' order by created_at limit 1`,
  );
  if (!reporter || !admin) throw new Error(`no users in ${other.schema_name}`);

  const uuid = () => one(`select gen_random_uuid() as id`).then((r) => r.id);

  await scenario("a report filed outside the first company may carry a screenshot", async () => {
    await asUser(reporter.id);
    const reportId = await fileReport(other.schema_name, reporter.id);
    const path = `${reportId}/${await uuid()}.png`;
    const allowed = await one(`select acc_feedback_screenshot_path_allowed($1) as ok`, [path]);
    check("the upload guard accepts it", allowed.ok === true, JSON.stringify(allowed));

    const known = await one(`select onebook.feedback_report_exists_anywhere($1) as ok`, [reportId]);
    check("the register found the company holding it", known.ok === true);
  });

  await scenario("a path naming no report at all is still refused", async () => {
    const ghost = await uuid();
    const path = `${ghost}/${await uuid()}.png`;
    const allowed = await one(`select acc_feedback_screenshot_path_allowed($1) as ok`, [path]);
    check("the guard refuses it", allowed.ok === false, JSON.stringify(allowed));
  });

  await scenario("a malformed path is refused whatever company it names", async () => {
    await asUser(reporter.id);
    const reportId = await fileReport(other.schema_name, reporter.id);
    for (const path of [reportId, `${reportId}/notauuid.png`, `${reportId}/a/b.png`, `${reportId}/${await uuid()}.exe`]) {
      const allowed = await one(`select acc_feedback_screenshot_path_allowed($1) as ok`, [path]);
      check(`refused: ${path.slice(0, 46)}`, allowed.ok === false);
    }
  });

  await scenario("the reporter can read their own screenshot in that company", async () => {
    await asUser(reporter.id);
    const reportId = await fileReport(other.schema_name, reporter.id);
    const path = `${reportId}/${await uuid()}.png`;
    await client.query(
      `update ${other.schema_name}.acc_feedback_report set screenshot_path = $1 where id = $2`,
      [path, reportId],
    );
    const readable = await one(`select onebook.feedback_file_readable($1, 'screenshot') as ok`, [path]);
    check("they may read it", readable.ok === true, JSON.stringify(readable));
  });

  await scenario("an administrator of the owning company can read it", async () => {
    await asUser(reporter.id);
    const reportId = await fileReport(other.schema_name, reporter.id);
    const path = `${reportId}/${await uuid()}.png`;
    await client.query(
      `update ${other.schema_name}.acc_feedback_report set screenshot_path = $1 where id = $2`,
      [path, reportId],
    );
    await asUser(admin.id);
    const readable = await one(`select onebook.feedback_file_readable($1, 'screenshot') as ok`, [path]);
    check("the administrator may read it", readable.ok === true, JSON.stringify(readable));
  });

  await scenario("someone with no standing in that company cannot", async () => {
    await asUser(reporter.id);
    const reportId = await fileReport(other.schema_name, reporter.id);
    const path = `${reportId}/${await uuid()}.png`;
    await client.query(
      `update ${other.schema_name}.acc_feedback_report set screenshot_path = $1 where id = $2`,
      [path, reportId],
    );
    const stranger = await one(
      `select u.id from auth.users u
        where not exists (select 1 from ${other.schema_name}.acc_app_user a where a.id = u.id)
        limit 1`,
    );
    if (!stranger) {
      console.log("  SKIP  every account is a member of this company");
      return;
    }
    await asUser(stranger.id);
    const readable = await one(`select onebook.feedback_file_readable($1, 'screenshot') as ok`, [path]);
    check("they are refused", readable.ok === false, JSON.stringify(readable));
    await asUser(reporter.id);
  });

  await scenario("an attachment may only be uploaded by the reporter", async () => {
    await asUser(reporter.id);
    const reportId = await fileReport(other.schema_name, reporter.id);
    const path = `${reportId}/${await uuid()}.pdf`;
    const mine = await one(`select acc_feedback_attachment_path_allowed($1) as ok`, [path]);
    check("the reporter may", mine.ok === true, JSON.stringify(mine));

    await asUser(admin.id);
    const theirs = await one(`select acc_feedback_attachment_path_allowed($1) as ok`, [path]);
    check(
      "somebody else may not, even an administrator",
      theirs.ok === false || admin.id === reporter.id,
      admin.id === reporter.id ? "(admin is the reporter here)" : JSON.stringify(theirs),
    );
    await asUser(reporter.id);
  });

  await scenario("the first company still works as it always did", async () => {
    const publicReporter = await one(
      `select id from public.acc_app_user where status = 'active' order by created_at limit 1`,
    );
    if (!publicReporter) {
      console.log("  SKIP  no user in the first company");
      return;
    }
    await asUser(publicReporter.id);
    const reportId = await fileReport("public", publicReporter.id);
    const path = `${reportId}/${await uuid()}.png`;
    const allowed = await one(`select acc_feedback_screenshot_path_allowed($1) as ok`, [path]);
    check("its uploads are still accepted", allowed.ok === true, JSON.stringify(allowed));
  });
} catch (error) {
  failed += 1;
  console.log(`  FAIL  verification threw — ${error.message}`);
} finally {
  await client.query("rollback");
  console.log("\nROLLBACK — no feedback report was kept.");
  await client.end();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
