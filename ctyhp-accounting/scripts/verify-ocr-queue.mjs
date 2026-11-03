/**
 * The OCR queue (0188), end to end, inside one transaction that is always
 * rolled back: nothing it does is left behind.
 *
 * Needs SUPABASE_DB_URL (the pooler) and 0188 applied to the database it points at.
 * Run: node --env-file=.env.local scripts/verify-ocr-queue.mjs
 */
import pg from "pg";

const client = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const checks = [];
const check = (name, ok, detail = "") => checks.push({ name, ok: Boolean(ok), detail });

async function as(user) {
  await client.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user, role: "authenticated" })]);
  await client.query("set local role authenticated");
}
async function asService() {
  await client.query("reset role");
  await client.query("select set_config('request.jwt.claims', '', true)");
}

// Runs one statement as `user` inside its own savepoint, so a refusal takes back only itself.
// Always leaves the session as the service role. Returns { ok, rows, message }.
// A success is taken back too, unless `keep` is set (the cap check needs the accepted jobs to stay).
async function attempt(user, sql, params = [], keep = false) {
  await asService();
  await client.query("savepoint x");
  let outcome;
  try {
    if (user) await as(user);
    outcome = { ok: true, rows: (await client.query(sql, params)).rows, message: "" };
  } catch (e) {
    outcome = { ok: false, rows: [], message: String(e.message) };
  }
  await client.query(outcome.ok && keep ? "release savepoint x" : "rollback to savepoint x");
  await asService();
  return outcome;
}

await client.connect();

// The script claims jobs; it must never take a real one.
const open = (await client.query("select count(*)::int as n from onebook.ocr_job where status in ('pending', 'running')")).rows[0].n;
if (open > 0) {
  console.log("The OCR queue has work in it; run this when it is empty");
  await client.end();
  process.exit(1);
}

try {
  await client.query("begin");

  // A member of the first company who may keep statement files.
  const members = await client.query(
    `select m.user_id from onebook.company_member m join onebook.company c on c.id = m.company_id
      where c.schema_name = 'public' order by m.added_at`,
  );
  let user = null;
  for (const { user_id } of members.rows) {
    await as(user_id);
    const { rows } = await client.query("select public.acc_has_permission('documents.manage') as ok");
    await asService();
    if (rows[0].ok) { user = user_id; break; }
  }
  if (!user) throw new Error("No member of the first company holds documents.manage");

  const report = await client.query(
    `insert into public.acc_saved_report (title, source, file_name, storage_path, mime_type, size_bytes, sha256, uploaded_by)
     values ('OCR verify', 'bank', 'scan.pdf', 'public/' || gen_random_uuid() || '.pdf', 'application/pdf', 1000, repeat('a', 64), $1)
     returning id`,
    [user],
  );
  const fileId = report.rows[0].id;

  await as(user);
  const first = (await client.query("select onebook.request_ocr_job('public', $1) as id", [fileId])).rows[0].id;
  const again = (await client.query("select onebook.request_ocr_job('public', $1) as id", [fileId])).rows[0].id;
  check("asking twice for one file returns the same job", first === again);
  const waiting = (await client.query("select * from onebook.ocr_job_status($1)", [first])).rows[0];
  check("the asker sees the job waiting", waiting?.status === "pending" && waiting.result === null);
  // A refused statement aborts the transaction; the savepoint takes back only the refusal.
  await client.query("savepoint probe");
  let denied = false;
  try { await client.query("select * from onebook.ocr_job"); } catch { denied = true; }
  await client.query("rollback to savepoint probe");
  check("a session cannot read the queue table", denied);
  await asService();

  // A signed-in user who is not a member of the first company.
  const outsider = (await client.query(
    `select u.id from auth.users u
      where u.id not in (select m.user_id from onebook.company_member m
                          join onebook.company c on c.id = m.company_id
                         where c.schema_name = 'public')
      order by u.created_at limit 1`,
  )).rows[0]?.id;
  if (!outsider) throw new Error("Every user is a member of the first company; add one who is not, to test the refusal");
  const outsiderAsk = await attempt(outsider, "select onebook.request_ocr_job('public', $1) as id", [fileId]);
  check("a user outside the company is refused", !outsiderAsk.ok && /not a member/.test(outsiderAsk.message), outsiderAsk.message);
  const outsiderSees = await attempt(outsider, "select * from onebook.ocr_job_status($1)", [first]);
  check("another user reads nothing of the job", outsiderSees.ok && outsiderSees.rows.length === 0);

  // A member without documents.manage. Prefer one who already lacks it.
  let limited = null;
  for (const { user_id } of members.rows) {
    const r = await attempt(user_id, "select public.acc_has_permission('documents.manage') as ok");
    if (r.ok && r.rows[0].ok === false) { limited = user_id; break; }
  }
  let limitedAsk;
  if (limited) {
    limitedAsk = await attempt(limited, "select onebook.request_ocr_job('public', $1) as id", [fileId]);
  } else {
    // None lacks it: take the member's role away for the length of the savepoint.
    // acc_current_role() reads public.acc_app_user.role, and acc_has_permission() looks that role up in
    // public.acc_role_permission; so set acc_app_user.role to a role with no allowed documents.manage row.
    const lacking = (await client.query(
      `select r::text as role from unnest(enum_range(null::public.acc_app_role)) r
        where not coalesce((select p.allowed from public.acc_role_permission p
                             where p.role = r and p.permission_key = 'documents.manage'), false)
        limit 1`,
    )).rows[0]?.role;
    if (!lacking) throw new Error("Every role holds documents.manage; cannot test the refusal");
    await client.query("savepoint role_change");
    await client.query("update public.acc_app_user set role = $1 where id = $2", [lacking, user]);
    limitedAsk = await attempt(user, "select onebook.request_ocr_job('public', $1) as id", [fileId]);
    await client.query("rollback to savepoint role_change");
  }
  check("a member without documents.manage is refused", !limitedAsk.ok && /permission/.test(limitedAsk.message), limitedAsk.message);

  // The worker's functions are not for a signed-in session.
  for (const [name, sql] of [
    ["claim_ocr_job", "select * from onebook.claim_ocr_job('x')"],
    ["report_ocr_progress", "select onebook.report_ocr_progress($1::uuid, 1, 1)"],
    ["complete_ocr_job", "select onebook.complete_ocr_job($1::uuid, '{}'::jsonb)"],
    ["fail_ocr_job", "select onebook.fail_ocr_job($1::uuid, 'x')"],
  ]) {
    const r = await attempt(user, sql, name === "claim_ocr_job" ? [] : [first]);
    check(`a signed-in session cannot run ${name}`, !r.ok && /permission denied/.test(r.message), r.message);
  }

  // At most three open jobs per company. The first job is one; two more fit, the next is refused.
  await asService();
  const more = [];
  for (const hex of ["c", "d", "e"]) {
    const r = await client.query(
      `insert into public.acc_saved_report (title, source, file_name, storage_path, mime_type, size_bytes, sha256, uploaded_by)
       values ('OCR verify', 'bank', 'scan.pdf', 'public/' || gen_random_uuid() || '.pdf', 'application/pdf', 1000, repeat($2, 64), $1)
       returning id`,
      [user, hex],
    );
    more.push(r.rows[0].id);
  }
  await client.query("savepoint cap");
  const accepted = [];
  for (const id of more.slice(0, 2)) {
    accepted.push(await attempt(user, "select onebook.request_ocr_job('public', $1) as id", [id], true));
  }
  check("up to three open jobs are accepted", accepted.every((r) => r.ok));
  const fourth = await attempt(user, "select onebook.request_ocr_job('public', $1) as id", [more[2]]);
  check("a job past the cap of three is refused", !fourth.ok && /three files/.test(fourth.message), fourth.message);
  await client.query("rollback to savepoint cap");

  const job = first;

  const claimed = (await client.query("select * from onebook.claim_ocr_job('verify')")).rows[0];
  check("the worker claims the waiting job", claimed?.id === job && claimed.attempts === 1);
  check("the claim names the kept file", claimed?.storage_path?.startsWith("public/"));
  const online = (await client.query("select onebook.ocr_worker_online() as ok")).rows[0].ok;
  check("claiming marks the worker online", online === true);
  const none = await client.query("select * from onebook.claim_ocr_job('verify')");
  check("a running job is not handed out twice", none.rows.length === 0);

  const progressed = (await client.query("select onebook.report_ocr_progress($1, 1, 2) as ok", [job])).rows[0].ok;
  check("progress is recorded", progressed === true);
  const done = (await client.query("select onebook.complete_ocr_job($1, $2) as ok", [job, { engine: "verify", pages: [{ page: 1, text: "x" }] }])).rows[0].ok;
  check("the job completes", done === true);

  await as(user);
  const finished = (await client.query("select * from onebook.ocr_job_status($1)", [job])).rows[0];
  check("the asker reads the text once done", finished?.status === "done" && finished.result?.pages?.length === 1);
  await asService();

  // A worker that stops: the lease runs out three times, then the job fails.
  const stuck = (await client.query(
    `insert into onebook.ocr_job (schema_name, saved_report_id, storage_path, mime_type, requested_by, status, attempts, lease_until)
     values ('public', gen_random_uuid(), 'public/x.pdf', 'application/pdf', $1, 'running', 3, now() - interval '1 minute') returning id`,
    [user],
  )).rows[0].id;
  await client.query("select * from onebook.claim_ocr_job('verify')");
  const failed = (await client.query("select status, error from onebook.ocr_job where id = $1", [stuck])).rows[0];
  check("a job whose worker stopped three times fails with a reason", failed.status === "failed" && /three times/.test(failed.error));
} finally {
  await client.query("rollback").catch(() => {});
  await client.end();
}

for (const c of checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}${c.detail ? `  (${c.detail})` : ""}`);
const failedCount = checks.filter((c) => !c.ok).length;
console.log(failedCount ? `${failedCount} of ${checks.length} checks failed` : `all ${checks.length} checks passed`);
process.exit(failedCount ? 1 : 0);
