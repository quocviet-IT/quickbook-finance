/**
 * Behavioural verification that an attachment can be filed outside the first
 * company.
 *
 * Everything happens inside ONE transaction that is always rolled back: 0122 is
 * applied, real attachment rows are written into real companies, and none of it
 * survives.
 *
 * This is the check that did not exist when the bug was written. 0104 fixed the
 * same defect for feedback screenshots and the evidence there was a count — 22
 * of 22 in `public` had a file, 0 of 4 elsewhere. Nobody had a script that would
 * have caught it first, so the second instance of the bug sat in the documents
 * bucket until somebody went looking.
 *
 * Run: node --env-file=.env.local scripts/verify-document-files-every-company.mjs
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
    console.log(`  FAIL  scenario threw — ${error.message.split("\n")[0]}`);
  } finally {
    await client.query("rollback to savepoint case_start");
  }
}

const asUser = (id) =>
  client.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub: id, role: "authenticated" }),
  ]);

/** An administrator who exists in one company's books but not another's. */
async function adminIn(schema) {
  return one(
    `select id from ${schema}.acc_app_user
      where role = 'admin' and status = 'active' order by created_at limit 1`,
  );
}

/** Any record of a type the documents feature attaches to. */
async function entityIn(schema, table) {
  return one(
    `select id from ${schema}.${table}
      where id::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4' order by created_at limit 1`,
  );
}

const objectPath = (entityType, entityId) =>
  `${entityType}/${entityId}/${crypto.randomUUID()}.pdf`;

/**
 * A company other than the first one that can actually be tested against.
 *
 * Picking the first non-`public` schema is not enough: a company on the register
 * with no invoice or no active administrator skips every assertion that matters,
 * and a run of skips reads as a pass. This looks until it finds one that can
 * answer, and the caller fails loudly when none can.
 */
async function otherCompany(companies) {
  for (const schema of companies) {
    if (schema === "public") continue;
    const entity = await entityIn(schema, "acc_invoice");
    const admin = await adminIn(schema);
    if (entity && admin) return { schema, entity, admin };
  }
  return null;
}

await client.connect();
await client.query("begin");
try {
  const before = {};
  for (const schema of ["public", "co_pc"]) {
    const entity = await entityIn(schema, "acc_invoice");
    if (!entity) continue;
    const answer = await one(`select acc_document_storage_path_allowed($1) as allowed`, [
      objectPath("invoice", entity.id),
    ]);
    before[schema] = answer.allowed;
  }
  console.log("Before 0122, asking the guard in public about each company's invoice:");
  console.log(" ", JSON.stringify(before));

  const migration = await readFile(
    join(projectRoot, "supabase", "migrations", "0122_document_files_every_company.sql"),
    "utf8",
  );
  await client.query(migration);
  console.log("\nApplied 0122 inside the transaction (never committed).");

  const companies = (
    await client.query(
      `select schema_name from onebook.company where status = 'active' order by display_order`,
    )
  ).rows.map((row) => row.schema_name);
  console.log(`Companies on the register: ${companies.join(", ")}`);

  await scenario("a path is resolved to the company that actually holds the record", async () => {
    let checked = 0;
    for (const schema of companies) {
      const entity = await entityIn(schema, "acc_invoice");
      if (!entity) continue;
      checked += 1;
      const owner = await one(`select onebook.document_path_owner($1) as owner`, [
        objectPath("invoice", entity.id),
      ]);
      check(`${schema}: its own invoice resolves to ${schema}`, owner.owner === schema, String(owner.owner));
    }
    check("more than one company was actually exercised", checked >= 2, `${checked} checked`);
  });

  await scenario("the shape of a path is still refused when it is wrong", async () => {
    const bad = [
      ["two segments", "invoice/not-a-uuid.pdf"],
      ["a filename that is not a v4 uuid", "invoice/00000000-0000-4000-8000-000000000000/report.pdf"],
      ["an unknown entity type", "shopping-list/00000000-0000-4000-8000-000000000000/00000000-0000-4000-8000-000000000000.pdf"],
      ["a record nobody holds", "invoice/00000000-0000-4000-8000-000000000000/00000000-0000-4000-8000-000000000000.pdf"],
    ];
    for (const [why, path] of bad) {
      const owner = await one(`select onebook.document_path_owner($1) as owner`, [path]);
      check(`refused: ${why}`, owner.owner === null, String(owner.owner));
    }
  });

  // Resolved once, and asserted: a run where every interesting scenario skipped
  // would otherwise report twelve passes and prove nothing.
  const other = await otherCompany(companies);
  check(
    "a second company with an invoice and an admin was found to test against",
    other !== null,
    "no company besides public could answer",
  );
  if (other) console.log(`  Testing the cross-company rules against ${other.schema}.`);

  await scenario("uploading is answered by the company that owns the record", async () => {
    if (!other) return;
    const { schema: target, entity, admin } = other;
    await asUser(admin.id);
    const path = objectPath("invoice", entity.id);
    const allowed = await one(`select onebook.document_upload_allowed($1) as ok`, [path]);
    // The measurement this whole migration exists for: before it, this was false.
    check(`an admin of ${target} may file evidence against ${target}'s invoice`, allowed.ok === true);

    // And the converse: somebody with no membership there may not.
    const outsider = await one(
      `select id from auth.users
        where id not in (select id from ${target}.acc_app_user where status = 'active')
        order by created_at limit 1`,
    );
    if (outsider) {
      await asUser(outsider.id);
      const refused = await one(`select onebook.document_upload_allowed($1) as ok`, [path]);
      check(
        `somebody who is not a member of ${target} may not`,
        refused.ok === false,
        String(refused.ok),
      );
    } else {
      console.log("  SKIP  every user is a member of that company");
    }
  });

  await scenario("reading is refused until a file has passed a scan", async () => {
    if (!other) return;
    const { schema: target, entity, admin } = other;
    await asUser(admin.id);
    const path = objectPath("invoice", entity.id);
    await client.query(
      `insert into ${target}.acc_document_attachment
         (entity_type, entity_id, file_name, storage_path, mime_type, size_bytes,
          sha256, scan_status, uploaded_by)
       values ('invoice', $1, 'statement.pdf', $2, 'application/pdf', 1024,
               repeat('a', 64), 'pending', $3)`,
      [entity.id, path, admin.id],
    );

    const pending = await one(`select onebook.document_object_readable($1) as ok`, [path]);
    check("a pending file cannot be read", pending.ok === false, String(pending.ok));

    await client.query(
      `update ${target}.acc_document_attachment set scan_status = 'blocked' where storage_path = $1`,
      [path],
    );
    const blocked = await one(`select onebook.document_object_readable($1) as ok`, [path]);
    check("a blocked file cannot be read", blocked.ok === false, String(blocked.ok));

    await client.query(
      `update ${target}.acc_document_attachment set scan_status = 'clean' where storage_path = $1`,
      [path],
    );
    const clean = await one(`select onebook.document_object_readable($1) as ok`, [path]);
    check(`a clean file in ${target} can be read by ${target}'s admin`, clean.ok === true);

    await client.query(
      `update ${target}.acc_document_attachment set status = 'archived',
              archived_by = $2, archived_at = now(), archive_reason = 'verification'
        where storage_path = $1`,
      [path, admin.id],
    );
    const archived = await one(`select onebook.document_object_readable($1) as ok`, [path]);
    check("an archived file drops out of reach", archived.ok === false, String(archived.ok));
  });

  await scenario("one company's evidence cannot be deleted from another", async () => {
    if (!other) return;
    const { schema: target, entity, admin } = other;
    const path = objectPath("invoice", entity.id);

    const orphan = await one(`select onebook.document_object_registered($1) as registered`, [path]);
    check("an unregistered object reads as unclaimed", orphan.registered === false);

    await client.query(
      `insert into ${target}.acc_document_attachment
         (entity_type, entity_id, file_name, storage_path, mime_type, size_bytes,
          sha256, scan_status, uploaded_by)
       values ('invoice', $1, 'statement.pdf', $2, 'application/pdf', 1024,
               repeat('b', 64), 'clean', $3)`,
      [entity.id, path, admin.id],
    );

    // The hole this closes: asking only `public` would say "unclaimed" here, and
    // the delete policy would have let somebody remove the bytes behind another
    // company's audited accounting evidence.
    const publicOnly = await one(
      `select not exists (select 1 from public.acc_document_attachment where storage_path = $1) as looks_orphaned`,
      [path],
    );
    const everywhere = await one(`select onebook.document_object_registered($1) as registered`, [path]);
    check(
      `a file registered in ${target} looks unclaimed to the old public-only check`,
      publicOnly.looks_orphaned === true,
    );
    check("and is correctly claimed once every company is asked", everywhere.registered === true);
  });

  await scenario("the storage policies now call the register", async () => {
    const rows = (
      await client.query(
        `select p.polname, pg_get_expr(coalesce(p.polqual, p.polwithcheck), p.polrelid) as expr
           from pg_policy p
           join pg_class c on c.oid = p.polrelid
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'storage' and c.relname = 'objects'
            and p.polname like 'acc_document%'
          order by p.polname`,
      )
    ).rows;
    check("all three policies are present", rows.length === 3, String(rows.length));
    for (const row of rows) {
      check(`${row.polname} asks onebook, not public`, /onebook\./.test(row.expr), row.expr);
    }
  });

  await scenario("the per-schema guard is deliberately left alone", async () => {
    // It backs the INSERT policy on the per-schema attachment table, where "does
    // this entity exist here" is the right question. Widening it would have let
    // a row into one company's table naming another company's invoice.
    const still = await one(
      `select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'acc_document_storage_path_allowed'`,
    );
    check("acc_document_storage_path_allowed still exists in public", still.n === 1, String(still.n));
  });
} catch (error) {
  failed += 1;
  console.log(`  FAIL  verification threw — ${error.message}`);
} finally {
  await client.query("rollback");
  console.log("\nROLLBACK — no attachment was kept.");
  await client.end();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
