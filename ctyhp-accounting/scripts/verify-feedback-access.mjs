/**
 * Behavioural verification of who may read the feedback queue.
 *
 * Every scenario runs inside its own transaction and is ROLLED BACK -- including
 * the probe reports it files -- so this is safe against a database holding real
 * books and leaves neither rows nor audit trail behind.
 *
 * Two lines make it a real test rather than a green light:
 *
 *   set_config('request.jwt.claims', ...)  supplies auth.uid()
 *   set local role authenticated           stops the superuser bypassing RLS
 *
 * SUPABASE_DB_URL connects as a superuser, and a superuser ignores every policy
 * on the table. Without the second line this file would pass while proving
 * nothing at all.
 *
 * Run: node --env-file=.env.local scripts/verify-feedback-access.mjs
 */
import pg from "pg";

const client = new pg.Client({
  connectionString: process.env.SUPABASE_DB_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30_000,
});
await client.connect();

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

const pick = async (role) =>
  (
    await client.query(
      `select id from acc_app_user where role = $1 and status = 'active' order by created_at limit 1`,
      [role],
    )
  ).rows[0]?.id ?? null;

const ADMIN = await pick("admin");
if (!ADMIN) {
  console.error("No active admin to authenticate as.");
  process.exit(1);
}

/**
 * File a report as `reporterId`, from outside RLS.
 *
 * page_url, viewport_width and viewport_height are NOT NULL with no default --
 * the dialog always sends them. Omitting them fails on a constraint, which
 * would look like a permission failure and prove nothing.
 */
async function fileReport(reporterId, description, kind = "broken") {
  const { rows } = await client.query(
    `insert into acc_feedback_report
       (kind, description, page_url, page_route, viewport_width, viewport_height,
        reporter_id, impact, frequency, screenshot_path)
     values ($1, $2, 'http://localhost:3000/dashboard', '/dashboard', 1440, 900, $3,
             'blocking', 'every_time', gen_random_uuid()::text || '.png')
     returning id, screenshot_path`,
    [kind, description, reporterId],
  );
  return rows[0];
}

/**
 * Put a real object in each feedback bucket for a report.
 *
 * Counting zero rows for a path nobody ever created proves nothing — the count
 * would be zero with RLS switched off. The object has to exist for its absence
 * to mean "refused".
 */
async function attachFiles(report) {
  await client.query(
    `insert into storage.objects (bucket_id, name, owner) values ('feedback-screenshots', $1, null)`,
    [report.screenshot_path],
  );
  const attachmentPath = `${report.id}/probe.pdf`;
  await client.query(
    `insert into storage.objects (bucket_id, name, owner) values ('feedback-attachments', $1, null)`,
    [attachmentPath],
  );
  await client.query(
    `insert into acc_feedback_attachment (report_id, storage_path, file_name, mime_type, size_bytes)
     values ($1, $2, 'probe.pdf', 'application/pdf', 1024)`,
    [report.id, attachmentPath],
  );
  return attachmentPath;
}

/** Body runs authenticated as `userId` with RLS in force, then rolls back. */
async function scenario(name, userId, body) {
  console.log(`\n== ${name}`);
  await client.query("begin");
  try {
    // Seeded inside the transaction, before the role switch: the rows exist for
    // the reader to fail to see, and the rollback takes them away again.
    const report = await fileReport(ADMIN, "verify-feedback-access probe");
    const attachmentPath = await attachFiles(report);
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    await client.query("set local role authenticated");
    await body(report.id, { screenshot: report.screenshot_path, attachment: attachmentPath });
  } catch (error) {
    failed++;
    console.log(`  FAIL  scenario threw — ${error.message}`);
  } finally {
    await client.query("rollback");
  }
}

const count = async (sql, params = []) => Number((await client.query(sql, params)).rows[0].n);

await scenario("an administrator still sees the whole queue", ADMIN, async (theirs, files) => {
  check(
    "reads the seeded report",
    (await count(`select count(*)::int n from acc_feedback_report where id = $1`, [theirs])) === 1,
  );
  check(
    "acc_feedback_queue returns rows",
    (await count(`select count(*)::int n from acc_feedback_queue(null)`)) > 0,
  );
  // Positive control for the storage checks below: these objects ARE visible to
  // someone who holds feedback.read, so a zero for anyone else means refused
  // rather than absent.
  check(
    "reads the screenshot object",
    (await count(
      `select count(*)::int n from storage.objects where bucket_id = 'feedback-screenshots' and name = $1`,
      [files.screenshot],
    )) === 1,
  );
  check(
    "reads the attachment object",
    (await count(
      `select count(*)::int n from storage.objects where bucket_id = 'feedback-attachments' and name = $1`,
      [files.attachment],
    )) === 1,
  );
});

for (const role of ["accountant", "viewer", "sales"]) {
  const userId = await pick(role);
  if (!userId) {
    console.log(`\n== skipped ${role}: no active account`);
    continue;
  }
  await scenario(`a ${role} sees only their own`, userId, async (theirs, files) => {
    check(
      "cannot read someone else's report",
      (await count(`select count(*)::int n from acc_feedback_report where id = $1`, [theirs])) === 0,
    );
    check(
      "acc_feedback_queue returns nothing",
      (await count(`select count(*)::int n from acc_feedback_queue(null)`)) === 0,
    );
    check(
      "cannot read someone else's attachments",
      (await count(`select count(*)::int n from acc_feedback_attachment where report_id = $1`, [
        theirs,
      ])) === 0,
    );
    // The images are the thing the exposure was actually about, and they live
    // behind their own policies on storage.objects -- a different file, a
    // different predicate. Checking the tables and assuming the buckets follow
    // is the assumption a harness exists to remove.
    check(
      "cannot read someone else's screenshot object",
      (await count(
        `select count(*)::int n from storage.objects
          where bucket_id = 'feedback-screenshots' and name = $1`,
        [files.screenshot],
      )) === 0,
    );
    check(
      "cannot read someone else's attachment object",
      (await count(
        `select count(*)::int n from storage.objects
          where bucket_id = 'feedback-attachments' and name = $1`,
        [files.attachment],
      )) === 0,
    );

    // The clause that makes "My reports" work must still hold, or revoking the
    // permission would have closed the screen to the person it is built for.
    // Filed through RLS as this user, which also proves they may still report.
    const mine = (
      await client.query(
        `insert into acc_feedback_report
           (kind, description, page_url, page_route, viewport_width, viewport_height, reporter_id)
         values ('suggestion', 'my own probe', 'http://localhost:3000/dashboard', '/dashboard', 1440, 900, $1)
         returning id`,
        [userId],
      )
    ).rows[0].id;
    check(
      "still reads their own report",
      (await count(`select count(*)::int n from acc_feedback_report where id = $1`, [mine])) === 1,
    );
  });
}

await client.end();

console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
