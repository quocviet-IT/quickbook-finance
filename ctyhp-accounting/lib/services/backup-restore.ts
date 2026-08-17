import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { strFromU8, unzipSync } from "fflate";
import { restoreCompatibility, snapshotDescription, snapshotHash } from "@/lib/domain/backup";
import {
  archivePathFor,
  EXPORT_TABLES,
  FORMULA_LEAD,
  SENSITIVE_TABLE,
  sha256Hex,
  type ExportControlTotals,
} from "@/lib/domain/company-export";
import { createSupabaseAutomationClient } from "@/lib/db/automation";
import { loadMigrationSources, type MigrationSource } from "@/lib/db/migration-sources";
import { createProvisioningClient } from "@/lib/db/provisioning-client";
import { createBackupStorageClient } from "@/lib/db/storage-admin";
import { BACKUP_BUCKET } from "@/lib/services/backup";
import { readControlTotals, type ExportManifest } from "@/lib/services/company-export";
import {
  provisionCompany,
  type PgLike,
  type ProvisionCompanyInput,
  type ProvisionCompanyResult,
} from "@/lib/services/company-provisioning";

export class RestoreError extends Error {}

/**
 * Tables a restore deliberately leaves behind.
 *
 * The first two grant access. Loading them into the copy would hand a set of
 * books to whoever happened to be listed in the snapshot, without anybody
 * deciding that; the person who ran the restore is the copy's only user.
 *
 * The last two describe the code, not the books. acc_permission is the
 * catalog today's migrations just seeded — and acc_role_permission cascades
 * from it (`on delete cascade`, migration 0036), so replacing the catalog
 * would silently wipe the very role matrix the exclusion above kept.
 * acc_schema_migrations records which migrations built this schema; loading
 * the snapshot's older list would make the next migration run replay files
 * into a schema that already has them.
 */
export const RESTORE_EXCLUDED_TABLES = [
  "acc_app_user",
  "acc_role_permission",
  "acc_permission",
  "acc_schema_migrations",
] as const;

/**
 * Whether the restored books add up to the snapshot they came from.
 *
 * Names each figure that disagrees. "The restore failed" tells nobody where to
 * look; "journalLineCount: expected 3, got 2" does.
 */
export function compareControlTotals(
  expected: ExportControlTotals,
  actual: ExportControlTotals,
): { controlTotalsMatch: boolean; differences: string[] } {
  const differences: string[] = [];
  for (const key of Object.keys(expected) as Array<keyof ExportControlTotals>) {
    if (expected[key] !== actual[key]) {
      differences.push(`${key}: expected ${expected[key]}, got ${actual[key]}`);
    }
  }
  return { controlTotalsMatch: differences.length === 0, differences };
}

// ---------------------------------------------------------------------------
// Reading the archive's CSV back. toCsv (lib/domain/company-export.ts) is the
// writer; this is its inverse, and the two encodings it must undo are the
// formula guard and the empty cell.
// ---------------------------------------------------------------------------

export interface ParsedCsvTable {
  columns: string[];
  /** Cell order follows `columns`. Null is an empty, unquoted cell. */
  rows: Array<Array<string | null>>;
}

interface RawCell {
  text: string;
  /** Whether any part of the cell sat inside quotes — see decodeCell. */
  quoted: boolean;
}

function splitRecords(content: string): RawCell[][] {
  const records: RawCell[][] = [];
  let record: RawCell[] = [];
  let text = "";
  let quoted = false;
  let inQuotes = false;
  const pushCell = () => {
    record.push({ text, quoted });
    text = "";
    quoted = false;
  };
  const pushRecord = () => {
    pushCell();
    records.push(record);
    record = [];
  };
  let i = 0;
  while (i < content.length) {
    const ch = content[i];
    if (inQuotes) {
      if (ch === '"') {
        if (content[i + 1] === '"') {
          text += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      text += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      quoted = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      pushCell();
      i += 1;
      continue;
    }
    if (ch === "\r" && content[i + 1] === "\n") {
      pushRecord();
      i += 2;
      continue;
    }
    if (ch === "\n") {
      pushRecord();
      i += 1;
      continue;
    }
    text += ch;
    i += 1;
  }
  if (inQuotes) {
    throw new Error("The file ends inside an unterminated quote — it is truncated or corrupt");
  }
  pushRecord();
  // toCsv writes no trailing newline; if some other writer added one, the
  // spurious final record is a single empty unquoted cell, not data.
  const last = records[records.length - 1];
  if (records.length > 1 && last.length === 1 && !last[0].quoted && last[0].text === "") {
    records.pop();
  }
  return records;
}

function decodeCell(cell: RawCell): string | null {
  // toCsv writes both null and "" as an empty unquoted cell; the load step is
  // what resolves the ambiguity, using the column's nullability (cellSql).
  if (!cell.quoted && cell.text === "") return null;
  // The formula guard: cell() prefixed a leading =, +, - or @ with a quote so
  // a spreadsheet cannot execute the value, and always quoted the result.
  // "-42" travelled as "'-42"; without this line every negative number in the
  // books would fail its bigint cast on the way back in.
  if (cell.quoted && cell.text.startsWith("'") && FORMULA_LEAD.has(cell.text[1] ?? "")) {
    return cell.text.slice(1);
  }
  return cell.text;
}

export function parseCsvTable(content: string): ParsedCsvTable {
  // An empty table exports as an empty file: no rows means no columns either
  // (the export derives columns from the rows it saw).
  if (content === "") return { columns: [], rows: [] };
  const records = splitRecords(content);
  const columns = records[0].map((cell) => cell.text);
  const rows = records.slice(1).map((record, index) => {
    if (record.length !== columns.length) {
      throw new Error(
        `Row ${index + 1} has ${record.length} cells where the header names ${columns.length} columns`,
      );
    }
    return record.map(decodeCell);
  });
  return { columns, rows };
}

// ---------------------------------------------------------------------------
// The restore.
// ---------------------------------------------------------------------------

export interface RestoreOutcome {
  companyId: string;
  controlTotalsMatch: boolean;
  differences: string[];
  slug: string;
  legalName: string;
  /** The snapshot's own reporting date — the date both sides were measured at. */
  comparedAsOf: string;
  expected: ExportControlTotals;
  actual: ExportControlTotals;
}

export interface RestoreDependencies {
  createClient?: () => Promise<PgLike & { end(): Promise<void> }>;
  provision?: (
    client: PgLike,
    input: ProvisionCompanyInput,
    sources: readonly MigrationSource[],
  ) => Promise<ProvisionCompanyResult>;
  loadSources?: () => MigrationSource[];
  download?: (path: string) => Promise<Uint8Array>;
  readTotals?: (schema: string, asOf: string) => Promise<ExportControlTotals>;
}

interface TablePlan {
  table: string;
  columns: string[];
  rows: Array<Array<string | null>>;
}

async function downloadBackupArchive(path: string): Promise<Uint8Array> {
  const admin = createBackupStorageClient();
  const { data, error } = await admin.storage.from(BACKUP_BUCKET).download(path);
  if (error || !data) {
    throw new RestoreError(
      `The snapshot file could not be fetched from ${BACKUP_BUCKET}/${path}: ${error?.message ?? "no data"}`,
    );
  }
  return new Uint8Array(await data.arrayBuffer());
}

/**
 * Control totals for the freshly committed schema.
 *
 * PostgREST learns about a new schema from the NOTIFY that provisioning sends,
 * and it reloads asynchronously — the first request can arrive before the
 * reload lands. Only that specific refusal is retried; any other failure
 * surfaces immediately, because retrying it would just repeat it slower.
 */
async function readRestoredTotals(schema: string, asOf: string): Promise<ExportControlTotals> {
  const sb = createSupabaseAutomationClient(schema);
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      return await readControlTotals(sb, asOf);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const schemaNotExposedYet = /schema must be one of|PGRST106/i.test(message);
      if (!schemaNotExposedYet || Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
}

function ident(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/**
 * One cell of the INSERT.
 *
 * The CSV writes null and '' identically, so an empty cell is decided by the
 * column: a nullable column gets null back, a NOT NULL one gets '' — the only
 * value the empty cell can have meant there. For a NOT NULL non-text column
 * the '' then fails its cast loudly, which is right: the export cannot have
 * written an empty cell from a NOT NULL numeric column, so the file is wrong.
 */
function cellSql(cell: string | null, nullable: boolean): string {
  if (cell === null) return nullable ? "null" : "''";
  return sqlLiteral(cell);
}

/**
 * One INSERT per table, deliberately not chunked: acc_account references
 * itself and the export orders rows by uuid, so a child can precede its
 * parent. Foreign keys are checked at the end of the statement, which makes
 * the one-statement load order-proof; splitting it would make the restore
 * depend on an order the data never promised.
 */
function insertStatement(
  schema: string,
  plan: TablePlan,
  nullability: Map<string, boolean>,
): string {
  const columnList = plan.columns.map(ident).join(", ");
  const values = plan.rows
    .map(
      (row) =>
        `(${row.map((cell, i) => cellSql(cell, nullability.get(plan.columns[i]) ?? true)).join(", ")})`,
    )
    .join(",\n");
  return `insert into ${ident(schema)}.${ident(plan.table)} (${columnList})\nvalues\n${values}`;
}

async function readNullability(
  client: PgLike,
  schema: string,
): Promise<Map<string, Map<string, boolean>>> {
  const { rows } = await client.query(
    `select table_name, column_name, is_nullable
       from information_schema.columns
      where table_schema = $1`,
    [schema],
  );
  const bySchema = new Map<string, Map<string, boolean>>();
  for (const row of rows) {
    const table = row.table_name as string;
    const columns = bySchema.get(table) ?? new Map<string, boolean>();
    columns.set(row.column_name as string, row.is_nullable === "YES");
    bySchema.set(table, columns);
  }
  return bySchema;
}

/**
 * Refuse, before any book data moves, a snapshot column the schema no longer
 * has. An older snapshot can carry a column a later migration removed or
 * moved elsewhere; loading everything else and dropping that column would
 * lose data in silence — the exact failure the version gate exists to
 * prevent, arriving through a different door.
 */
function refuseUnknownColumns(
  plans: readonly TablePlan[],
  nullability: Map<string, Map<string, boolean>>,
  snapshotVersion: string,
): void {
  const complaints: string[] = [];
  for (const plan of plans) {
    if (plan.columns.length === 0) continue;
    const known = nullability.get(plan.table);
    if (!known) {
      complaints.push(`${plan.table} (the whole table)`);
      continue;
    }
    const missing = plan.columns.filter((column) => !known.has(column));
    if (missing.length > 0) complaints.push(`${plan.table}: ${missing.join(", ")}`);
  }
  if (complaints.length > 0) {
    throw new RestoreError(
      `This snapshot (taken under ${snapshotVersion}) carries data today's schema has no place for — ` +
        `${complaints.join("; ")}. A migration since then moved or removed it, and loading the rest ` +
        `would drop that data in silence, so the restore is refused.`,
    );
  }
}

function slugCandidate(name: string, suffix: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24)
    .replace(/_+$/, "");
  const lead = /^[a-z]/.test(base) ? base : ["restored", base].filter(Boolean).join("_");
  return `${lead}_${suffix}`.slice(0, 41);
}

/**
 * A free company key derived from the name. The random suffix keeps two
 * restores of the same snapshot from colliding; the register's own unique
 * constraint on slug is what makes the remaining race window fail loudly
 * instead of overwriting anything.
 */
async function claimSlug(client: PgLike, name: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 6);
    const slug = slugCandidate(name, suffix);
    const { rows } = await client.query(
      `select 1 from onebook.company where slug = $1
       union all
       select 1 from onebook.company_request where slug = $1 and status in ('pending', 'running')`,
      [slug],
    );
    if (rows.length === 0) return slug;
  }
  throw new RestoreError("Could not find a free company key for the copy after five attempts.");
}

interface BackupRegisterRow {
  id: string;
  taken_at: string;
  status: string;
  storage_path: string | null;
  content_hash: string;
  schema_version: string;
  control_totals: ExportControlTotals;
}

/**
 * Load a stored snapshot into a brand-new company beside the running books,
 * and say whether the books came back whole.
 *
 * `sb` is the caller's own session client, scoped to the source company. It is
 * used for exactly two things — proving the acc_backup row is theirs to read,
 * and naming who ran the restore — and never for a write: no path from this
 * function reaches the source company's tables. The copy is built over a
 * direct Postgres connection in one transaction, so it either exists
 * completely or was never started.
 *
 * A control-totals mismatch is a *finding*, not a failure: the copy is kept
 * and handed back with each disagreeing figure named, because the whole point
 * of restoring beside the books is seeing which figures moved and by how much.
 */
export async function restoreBackupIntoNewCompany(
  sb: SupabaseClient,
  backupId: string,
  name: string,
  deps: RestoreDependencies = {},
): Promise<RestoreOutcome> {
  const createClient = deps.createClient ?? createProvisioningClient;
  const provision = deps.provision ?? provisionCompany;
  const loadSources = deps.loadSources ?? loadMigrationSources;
  const download = deps.download ?? downloadBackupArchive;
  const readTotals = deps.readTotals ?? readRestoredTotals;

  const legalName = name.trim();
  if (!legalName) throw new RestoreError("The new company needs a name.");

  // Read the register row through the caller's own client: row-level security
  // is what proves this snapshot belongs to the company they are working in.
  const { data, error } = await sb
    .from("acc_backup")
    .select("id,taken_at,status,storage_path,content_hash,schema_version,control_totals")
    .eq("id", backupId)
    .maybeSingle();
  if (error) {
    throw new RestoreError(`Reading the snapshot's register row failed: ${error.message}`);
  }
  if (!data) throw new RestoreError("That snapshot does not exist in this company's register.");
  const row = data as unknown as BackupRegisterRow;
  if (row.status !== "stored" || !row.storage_path) {
    throw new RestoreError(
      `Only a stored snapshot can be restored; this one is "${row.status}" and holds no file.`,
    );
  }

  const sources = loadSources();
  const currentVersion = sources[sources.length - 1]?.file ?? "unknown";
  if (restoreCompatibility(row.schema_version, currentVersion) === "snapshot-is-newer") {
    if (row.schema_version === "unknown") {
      throw new RestoreError(
        "This snapshot does not say which schema it was taken under, so it cannot be loaded safely.",
      );
    }
    throw new RestoreError(
      `This snapshot was taken under ${row.schema_version}, which is newer than this deployment's ` +
        `${currentVersion}. It holds columns this code does not know about, and loading it anyway ` +
        `would drop them without a word — take the restore to a deployment at least that new.`,
    );
  }

  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) throw new RestoreError("Your session has expired. Sign in again.");

  const bytes = await download(row.storage_path);
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (cause) {
    throw new RestoreError(
      `The snapshot file could not be unzipped: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  const manifestBytes = entries["manifest.json"];
  if (!manifestBytes) {
    throw new RestoreError("The archive holds no manifest.json, so it is not a One Book snapshot.");
  }
  const manifest = JSON.parse(strFromU8(manifestBytes)) as ExportManifest;

  // Prove the file is the snapshot the register recorded — same hash, same
  // derivation the nightly job used when it wrote the row — before a single
  // byte of it is treated as books.
  const actualHash = await snapshotHash(snapshotDescription(manifest));
  if (actualHash !== row.content_hash) {
    throw new RestoreError(
      `The file at ${row.storage_path} is not the snapshot this register row recorded: its content ` +
        `hashes to ${actualHash}, but the register says ${row.content_hash}.`,
    );
  }
  // And prove the bytes match the manifest that hash was derived from.
  for (const file of manifest.files) {
    const entry = entries[file.path];
    if (entry === undefined) {
      throw new RestoreError(`The archive is missing ${file.path}, which its own manifest lists.`);
    }
    const digest = await sha256Hex(strFromU8(entry));
    if (digest !== file.sha256) {
      throw new RestoreError(
        `${file.path} does not match the checksum the manifest recorded for it — the archive is corrupt.`,
      );
    }
  }

  // A table the snapshot holds but this list no longer restores would vanish
  // without these lines — same rule as refuseUnknownColumns, at table grain.
  const knownTables = new Set<string>([...EXPORT_TABLES, SENSITIVE_TABLE]);
  const orphanTables = manifest.tables
    .map((table) => table.table)
    .filter((table) => !knownTables.has(table));
  if (orphanTables.length > 0) {
    throw new RestoreError(
      `This snapshot holds tables today's schema no longer restores: ${orphanTables.join(", ")}. ` +
        `Loading the rest would drop their data in silence, so the restore is refused.`,
    );
  }

  const excluded = RESTORE_EXCLUDED_TABLES as readonly string[];
  const restorable = [...EXPORT_TABLES, SENSITIVE_TABLE].filter(
    (table) => !excluded.includes(table),
  );
  const plans: TablePlan[] = [];
  for (const table of restorable) {
    // archivePathFor, not `data/${table}.csv`: vendor tax profiles live under
    // sensitive/ and the attachment inventory is attachments.csv — a data/-only
    // read would silently leave both behind.
    const entry = entries[archivePathFor(table)];
    // A table added since the snapshot has no file; it stays as provisioned,
    // the table-level twin of "columns added since take their defaults".
    if (entry === undefined) continue;
    try {
      const parsed = parseCsvTable(strFromU8(entry));
      plans.push({ table, ...parsed });
    } catch (cause) {
      throw new RestoreError(
        `${archivePathFor(table)}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }

  const client = await createClient();
  let provisioned: ProvisionCompanyResult;
  let slug: string;
  try {
    slug = await claimSlug(client, legalName);
    await client.query("begin");
    try {
      provisioned = await provision(
        client,
        {
          slug,
          legalName,
          isSample: false,
          displayOrder: 100,
          // The one and only user of the copy. The snapshot's own user list
          // stays in the archive, deliberately.
          adminUserIds: [user.id],
        },
        sources,
      );
      const schema = provisioned.schema;

      const nullability = await readNullability(client, schema);
      refuseUnknownColumns(plans, nullability, row.schema_version);

      // The schema's own triggers — closed-period guards, actor stamps, audit
      // writers — are all correct for bookkeeping and all wrong for a
      // byte-faithful restore: they would refuse entries in closed periods,
      // stamp the restorer over every historical actor, and bury the restored
      // audit log under fabricated rows. Foreign keys are system triggers and
      // stay on. Owner privilege makes this possible; the DDL is transactional,
      // so a failure re-enables everything by rollback.
      for (const plan of plans) {
        await client.query(`alter table ${ident(schema)}.${ident(plan.table)} disable trigger user`);
      }
      // Provisioning seeds reference rows (currencies, sequences, approval
      // policies…). The copy's books must be exactly the snapshot's, so every
      // restored table is emptied first — dependents before what they
      // reference, which is the export's dependency order read backwards.
      for (const plan of [...plans].reverse()) {
        await client.query(`delete from ${ident(schema)}.${ident(plan.table)}`);
      }
      for (const plan of plans) {
        if (plan.rows.length === 0) continue;
        await client.query(insertStatement(schema, plan, nullability.get(plan.table)!));
      }
      // The copy must never masquerade as the source: its audit log ends with
      // a row saying where these books came from. Written while triggers are
      // still off so nothing rewrites it.
      await client.query(
        `insert into ${ident(schema)}.${ident("acc_audit_log")}
           (table_name, record_id, action, actor_id, after_json)
         values ('acc_backup', $1, 'company.restore', $2, $3::jsonb)`,
        [
          row.id,
          user.id,
          JSON.stringify({
            restored_from_path: row.storage_path,
            content_hash: row.content_hash,
            snapshot_taken_at: row.taken_at,
            snapshot_schema_version: row.schema_version,
            restored_into_slug: slug,
            excluded_tables: RESTORE_EXCLUDED_TABLES,
            included_sensitive: true,
          }),
        ],
      );
      for (const plan of plans) {
        await client.query(`alter table ${ident(schema)}.${ident(plan.table)} enable trigger user`);
      }
      await client.query("commit");
    } catch (cause) {
      await client.query("rollback");
      throw cause;
    }
  } finally {
    await client.end();
  }

  // Measured at the snapshot's own reporting date: balances move with the
  // date (a future-dated entry is excluded until its date arrives), so any
  // other date would report a difference that says nothing about the restore.
  const comparedAsOf = manifest.controlTotalsAsOf ?? row.taken_at;
  const actual = await readTotals(provisioned.schema, comparedAsOf);
  const comparison = compareControlTotals(manifest.controlTotals, actual);

  return {
    companyId: provisioned.companyId,
    controlTotalsMatch: comparison.controlTotalsMatch,
    differences: comparison.differences,
    slug,
    legalName,
    comparedAsOf,
    expected: manifest.controlTotals,
    actual,
  };
}
