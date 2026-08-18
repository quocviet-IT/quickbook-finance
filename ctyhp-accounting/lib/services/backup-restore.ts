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
import { restoreOrder, type ForeignKeyConstraint } from "@/lib/domain/restore-order";
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

/**
 * What the post-restore check concluded. "unverified" is not a fourth kind of
 * success or failure — it means the copy exists and is fully loaded, but its
 * figures could not be read, so nothing has been proved either way.
 */
export type RestoreVerdict = "matched" | "mismatched" | "unverified";

/**
 * One column a restore nulled because its snapshot value named a row in a
 * table this restore never loaded — an old snapshot missing a table added
 * since, or a table the export never carries at all. Named on the outcome
 * rather than dropped in silence: silently discarding a reference is the
 * quiet data loss the byte-faithful restore exists to prevent, arriving
 * through a different door.
 */
export interface NulledReferenceOutcome {
  /** The table the nulled column belongs to. */
  table: string;
  /** The column (columns, comma-joined, for a composite key) that was nulled. */
  column: string;
  /** The table the column names as its parent, which this restore never loaded. */
  referencedTable: string;
  /** How many rows had a value here that could not be kept. */
  rowsAffected: number;
  /** Why the parent table was never loaded. */
  reason: string;
}

export interface RestoreOutcome {
  companyId: string;
  slug: string;
  legalName: string;
  /**
   * The register row's own reporting date — the date both sides were measured
   * at. Taken from `acc_backup.taken_at`, not the manifest: the manifest's
   * copy sits outside the hashed file list and is only accepted after it has
   * been checked against this one.
   */
  comparedAsOf: string;
  /** The register row's control totals — the copy row-level security protects. */
  expected: ExportControlTotals;
  /** The restored company's totals, or null when reading them failed. */
  actual: ExportControlTotals | null;
  verdict: RestoreVerdict;
  /** Each figure that disagreed, named. Empty unless the verdict is "mismatched". */
  differences: string[];
  /** Why the figures remain unproven, when the verdict is "unverified". */
  unverifiedReason: string | null;
  /** Whether the verdict row landed durably in the copy's own audit log. */
  verdictRecorded: boolean;
  /** Why it did not, when it did not. */
  verdictRecordError: string | null;
  /** Every reference this restore nulled rather than drop in silence. Empty when nothing needed it. */
  nulledReferences: NulledReferenceOutcome[];
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
 * Whether a failed read is PostgREST still warming up to a schema that was
 * just committed, rather than anything wrong with the schema itself.
 *
 * The commit's NOTIFY makes PostgREST reload asynchronously, in two steps,
 * and a request can land between them: before the config reload the schema
 * is refused outright (PGRST106, "schema must be one of…"); after it, the
 * schema is served from a cache that has not learned its functions yet
 * (PGRST202, "Could not find the function … in the schema cache"). The first
 * live restore hit the second shape — the copy was complete and correct, and
 * verification reported it unverified over a condition that clears itself in
 * seconds. Both shapes are worth the same retry; anything else surfaces
 * immediately, because retrying it would just repeat it slower.
 */
export function isSchemaCacheWarming(message: string): boolean {
  return /schema must be one of|PGRST106|Could not find the function|PGRST202/i.test(message);
}

/**
 * Control totals for the freshly committed schema, retried while PostgREST
 * warms up to it (see isSchemaCacheWarming), up to a 30-second ceiling.
 */
async function readRestoredTotals(schema: string, asOf: string): Promise<ExportControlTotals> {
  const sb = createSupabaseAutomationClient(schema);
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      return await readControlTotals(sb, asOf);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isSchemaCacheWarming(message) || Date.now() >= deadline) throw error;
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
 *
 * Columns in `suspendedColumns` load as null whatever the snapshot says:
 * they belong to a constraint caught in a reference cycle, and their values
 * point at rows that do not exist yet. suspendedWriteBack restores them once
 * every table is in place.
 */
function insertStatement(
  schema: string,
  plan: TablePlan,
  nullability: Map<string, boolean>,
  suspendedColumns?: ReadonlySet<string>,
): string {
  const columnList = plan.columns.map(ident).join(", ");
  const values = plan.rows
    .map(
      (row) =>
        `(${row
          .map((cell, i) =>
            suspendedColumns?.has(plan.columns[i])
              ? "null"
              : cellSql(cell, nullability.get(plan.columns[i]) ?? true),
          )
          .join(", ")})`,
    )
    .join(",\n");
  return `insert into ${ident(schema)}.${ident(plan.table)} (${columnList})\nvalues\n${values}`;
}

/**
 * The snapshot's values for a suspended constraint's columns, written back
 * row by row once every table is loaded — where the constraint itself checks
 * them. Returns null when the snapshot never carried the columns (they then
 * keep the schema default, same as any column added since the snapshot).
 */
function suspendedWriteBack(
  schema: string,
  plan: TablePlan,
  primaryKey: string[] | undefined,
  suspendedColumns: string[],
): string | null {
  const columnIndex = new Map(plan.columns.map((column, i) => [column, i]));
  const present = suspendedColumns.filter((column) => columnIndex.has(column));
  if (present.length === 0 || plan.rows.length === 0) return null;
  if (!primaryKey || primaryKey.some((column) => !columnIndex.has(column))) {
    throw new RestoreError(
      `${plan.table} needs ${suspendedColumns.join(", ")} written back after the load, but its ` +
        `primary key (${primaryKey?.join(", ") ?? "none found"}) is not among the snapshot's ` +
        `columns, so its rows cannot be addressed.`,
    );
  }
  const statements: string[] = [];
  for (const row of plan.rows) {
    const sets = present
      .filter((column) => row[columnIndex.get(column)!] !== null)
      .map((column) => `${ident(column)} = ${sqlLiteral(row[columnIndex.get(column)!]!)}`);
    if (sets.length === 0) continue;
    const where = primaryKey
      .map((column) => `${ident(column)} = ${cellSql(row[columnIndex.get(column)!], false)}`)
      .join(" and ");
    statements.push(
      `update ${ident(schema)}.${ident(plan.table)} set ${sets.join(", ")} where ${where}`,
    );
  }
  return statements.length > 0 ? statements.join(";\n") : null;
}

async function readNullability(
  client: PgLike,
  schema: string,
): Promise<Map<string, Map<string, boolean>>> {
  const { rows } = await client.query(
    `select table_name, column_name, is_nullable
       from information_schema.columns
      where table_schema = $1
      order by table_name, ordinal_position`,
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

interface SchemaForeignKey extends ForeignKeyConstraint {
  /** pg_constraint.confdeltype: 'a' no action, 'r' restrict, 'c' cascade, 'n' set null, 'd' set default. */
  onDelete: string;
  /**
   * The referenced columns on `toTable`, same order as `columns`. Not always
   * `id`: acc_tax_code.state_code references acc_us_state(code). Needed to
   * check a dangling edge's columns against the parent's actual rows (see
   * nullDanglingReferences) without assuming the primary key's name.
   */
  referencedColumns: string[];
}

/**
 * Every foreign key whose two sides both live in `schema`, read from the
 * catalog of the copy the transaction just built — the exact constraint set
 * the deletes and inserts below must satisfy, seen on the same connection so
 * the uncommitted DDL is visible. Edges into other schemas (auth.users) are
 * left out: their parent rows are never touched here — auth.users is a
 * single project-wide table, so the original actor's row is still there
 * regardless of which company schema is being restored.
 */
async function readSchemaForeignKeys(client: PgLike, schema: string): Promise<SchemaForeignKey[]> {
  const { rows } = await client.query(
    `select con.conname as constraint_name,
            child.relname as from_table,
            parent.relname as to_table,
            (select array_agg(att.attname::text order by u.ord)
               from unnest(con.conkey) with ordinality as u(attnum, ord)
               join pg_attribute att on att.attrelid = con.conrelid and att.attnum = u.attnum
            ) as columns,
            (select array_agg(att.attname::text order by u.ord)
               from unnest(con.confkey) with ordinality as u(attnum, ord)
               join pg_attribute att on att.attrelid = con.confrelid and att.attnum = u.attnum
            ) as referenced_columns,
            (select bool_and(not att.attnotnull)
               from unnest(con.conkey) as k(attnum)
               join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum
            ) as all_nullable,
            con.confdeltype as on_delete
       from pg_constraint con
       join pg_class child on child.oid = con.conrelid
       join pg_namespace child_ns on child_ns.oid = child.relnamespace
       join pg_class parent on parent.oid = con.confrelid
       join pg_namespace parent_ns on parent_ns.oid = parent.relnamespace
      where con.contype = 'f'
        and child_ns.nspname = $1
        and parent_ns.nspname = $1
      order by child.relname, con.conname`,
    [schema],
  );
  return rows.map((row) => ({
    constraintName: row.constraint_name as string,
    fromTable: row.from_table as string,
    toTable: row.to_table as string,
    columns: row.columns as string[],
    referencedColumns: (row.referenced_columns as string[] | null) ?? (row.columns as string[]),
    allNullable: row.all_nullable as boolean,
    onDelete: row.on_delete as string,
  }));
}

/** Primary-key columns per table, for addressing rows in the write-back. */
async function readPrimaryKeyColumns(
  client: PgLike,
  schema: string,
): Promise<Map<string, string[]>> {
  const { rows } = await client.query(
    `select rel.relname as table_name,
            (select array_agg(att.attname::text order by u.ord)
               from unnest(con.conkey) with ordinality as u(attnum, ord)
               join pg_attribute att on att.attrelid = con.conrelid and att.attnum = u.attnum
            ) as columns
       from pg_constraint con
       join pg_class rel on rel.oid = con.conrelid
       join pg_namespace ns on ns.oid = rel.relnamespace
      where con.contype = 'p' and ns.nspname = $1`,
    [schema],
  );
  return new Map(rows.map((row) => [row.table_name as string, row.columns as string[]]));
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
 * The verdict — matched, mismatched, or unverified — is also written into the
 * copy's own audit log, so it outlives the browser tab that watched the
 * restore; and once the transaction has committed, nothing here throws:
 * a verification problem after that point rides on the outcome, because the
 * company exists and "the restore did not finish" would be a lie that invites
 * a retry and a second copy.
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
  // The hash above covers only manifest.files — the path→sha256 pairs. The
  // control totals and their measurement date sit outside that hashed set, so
  // anyone able to write to the bucket could edit them to whatever a broken
  // restore happens to produce, and every check so far would still pass. The
  // register row carries the nightly job's own copy of both, written behind
  // row-level security where the bucket cannot reach (`control_totals` and
  // `taken_at` are NOT NULL since the table's creation in 0114, so that copy
  // always exists). The two copies must agree; a file that disagrees with its
  // register row is refused rather than trusted over it — the disagreement
  // means the stored file was altered after the register recorded it, or the
  // job that wrote both is broken, and either one is worth a refusal, not a
  // proof run against figures nothing vouches for.
  // Compared over the union of both sides' keys, not compareControlTotals:
  // that helper walks only the expected side's keys, so a copy missing a
  // figure entirely (a tampered manifest with controlTotals deleted, or a
  // job bug writing a partial register row) would slip through a one-sided
  // walk without a word.
  const manifestTotals: Partial<ExportControlTotals> = manifest.controlTotals ?? {};
  const registerTotals: Partial<ExportControlTotals> = row.control_totals ?? {};
  const totalKeys = new Set<keyof ExportControlTotals>([
    ...(Object.keys(registerTotals) as Array<keyof ExportControlTotals>),
    ...(Object.keys(manifestTotals) as Array<keyof ExportControlTotals>),
  ]);
  const registerDisagreements: string[] = [];
  for (const key of totalKeys) {
    if (registerTotals[key] !== manifestTotals[key]) {
      registerDisagreements.push(
        `${key}: the register says ${registerTotals[key]}, the manifest says ${manifestTotals[key]}`,
      );
    }
  }
  if (manifest.controlTotalsAsOf !== row.taken_at) {
    registerDisagreements.push(
      `controlTotalsAsOf: the register's taken_at says ${row.taken_at}, the manifest says ${manifest.controlTotalsAsOf}`,
    );
  }
  if (registerDisagreements.length > 0) {
    throw new RestoreError(
      `The archive's manifest does not agree with this snapshot's register row — ` +
        `${registerDisagreements.join("; ")}. The register's copy is the one the storage bucket ` +
        `cannot touch, so a manifest that contradicts it cannot be trusted, and the restore is refused.`,
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
  // The loop above walks the manifest's list; this one walks the zip's. The
  // loader below reads entries[archivePathFor(table)] for every restorable
  // table, so an entry the manifest never listed would load with no digest
  // ever checked — the exact shape of a data/T.csv smuggled into the stored
  // file after a later migration added T to EXPORT_TABLES. Only manifest.json
  // and README.txt legitimately live outside files[].
  const vouchedFor = new Set(manifest.files.map((file) => file.path));
  const unlisted = Object.keys(entries).filter(
    (path) => path !== "manifest.json" && path !== "README.txt" && !vouchedFor.has(path),
  );
  if (unlisted.length > 0) {
    throw new RestoreError(
      `The archive holds files its own manifest does not list, so nothing vouches for their ` +
        `content: ${unlisted.join(", ")}. They can only have been added after the snapshot was ` +
        `taken, and the restore refuses to load anything unverified.`,
    );
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

  // Measured at the snapshot's own reporting date: balances move with the
  // date (a future-dated entry is excluded until its date arrives), so any
  // other date would report a difference that says nothing about the restore.
  // Both the date and the expected side come from the register row — the
  // copies row-level security protects — which the agreement check above
  // proved the manifest matches.
  const comparedAsOf = row.taken_at;
  const expected = row.control_totals;

  const client = await createClient();
  let provisioned: ProvisionCompanyResult;
  let slug: string;
  let verdict: RestoreVerdict = "unverified";
  let actual: ExportControlTotals | null = null;
  let differences: string[] = [];
  let unverifiedReason: string | null = null;
  let verdictRecorded = false;
  let verdictRecordError: string | null = null;
  const nulledReferences: NulledReferenceOutcome[] = [];
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

      // The load order comes from the copy's own catalog, not from
      // EXPORT_TABLES: that list is maintained by hand, and the schema's real
      // graph holds over two hundred foreign keys — the first live restore
      // proved the two disagree (acc_account is listed before the
      // acc_tax_code it references, one of twelve such contradictions).
      // pg_constraint is read here, on this connection, because it is the
      // exact constraint set the statements below must satisfy and the only
      // view that sees the schema this transaction just built. One sort
      // serves both directions: inserts run top-down, deletes bottom-up.
      const foreignKeys = await readSchemaForeignKeys(client, schema);
      if (foreignKeys.length === 0) {
        throw new RestoreError(
          `The catalog reports no foreign keys at all in ${schema}. This schema always has ` +
            `them, so the catalog was misread — and loading in an unchecked order could corrupt ` +
            `the copy, so the restore stops here.`,
        );
      }
      const planByTable = new Map(plans.map((plan) => [plan.table, plan]));
      const { order, suspended } = restoreOrder(
        plans.map((plan) => plan.table),
        foreignKeys,
      );
      const orderedPlans = order.map((table) => planByTable.get(table)!);
      const primaryKeys =
        suspended.length > 0 ? await readPrimaryKeyColumns(client, schema) : new Map();
      const suspendedColumnsByTable = new Map<string, Set<string>>();
      for (const constraint of suspended) {
        const set = suspendedColumnsByTable.get(constraint.fromTable) ?? new Set<string>();
        for (const column of constraint.columns) set.add(column);
        suspendedColumnsByTable.set(constraint.fromTable, set);
      }

      // Clearing a restored table can reach outside the restore set: a table
      // the snapshot does not carry may reference a restored one with
      // `on delete cascade`, and the delete would then sweep away rows
      // provisioning just seeded. acc_number_source — the registry document
      // numbering reads — cascades from acc_sequence exactly this way, and a
      // copy without it cannot number an invoice. Such tables' rows are
      // captured before the clear and put back after the load, where their
      // own foreign keys check them against the snapshot's rows (loudly, if
      // an old snapshot lacks a key today's seed refers to). A `set null` or
      // `set default` edge would rewrite such a table silently instead of
      // emptying it; none exists today, and one appearing must be a loud
      // stop, not a quiet mutation.
      const planTables = new Set(plans.map((plan) => plan.table));
      const outsideEdges = foreignKeys.filter(
        (fk) => !planTables.has(fk.fromTable) && planTables.has(fk.toTable),
      );
      const mutating = outsideEdges.filter((fk) => fk.onDelete === "n" || fk.onDelete === "d");
      if (mutating.length > 0) {
        throw new RestoreError(
          `Clearing the restored tables would silently rewrite rows in tables the snapshot does ` +
            `not carry: ${mutating
              .map((fk) => `${fk.fromTable} (${fk.constraintName})`)
              .join(", ")}. The restore refuses rather than mutate what it does not manage.`,
        );
      }
      const preservedTables = [
        ...new Set(outsideEdges.filter((fk) => fk.onDelete === "c").map((fk) => fk.fromTable)),
      ];

      // The reverse direction: a foreign key from a table this restore *is*
      // loading to one it never will — an old snapshot missing a table added
      // since (acc_import_batch, added after this snapshot was taken), or a
      // table the export never carries at all by design (acc_saved_report's
      // files live in a deployment-wide bucket the company archive does not
      // carry). Checked against the parent's *actual* rows in the copy, read
      // here after provisioning ran — not against plan membership alone: a
      // lookup table provisioning always seeds identically (acc_us_state,
      // acc_tax_code.state_code) resolves every one of these edges without
      // any help, and nulling a reference that already resolves would throw
      // away real data over a table that merely was not restored. A NOT NULL
      // edge here cannot be satisfied by nulling, and the archive itself
      // cannot vouch for a substitute, so the restore is refused rather than
      // guessing.
      const outOfPlanEdges = foreignKeys.filter(
        (fk) => planTables.has(fk.fromTable) && !planTables.has(fk.toTable),
      );
      const mustRefuse = outOfPlanEdges.filter((fk) => !fk.allNullable);
      if (mustRefuse.length > 0) {
        throw new RestoreError(
          `This snapshot has rows that reference a table this restore cannot load, through a column ` +
            `that must not be null: ${mustRefuse
              .map((fk) => `${fk.fromTable}.${fk.columns.join(", ")} -> ${fk.toTable}`)
              .join("; ")}. The archive cannot produce a faithful copy of these rows, so the restore ` +
            `is refused rather than inventing a value.`,
        );
      }
      for (const fk of outOfPlanEdges) {
        const plan = planByTable.get(fk.fromTable);
        if (!plan) continue;
        const indices = fk.columns.map((column) => plan.columns.indexOf(column));
        // The archive never carried this column at all — an even older
        // snapshot, predating the column itself. Nothing to null: the
        // column is simply absent from the INSERT and the schema default
        // (null, for every such column today) applies, the same as any
        // column added since the snapshot was taken.
        if (indices.some((index) => index === -1)) continue;
        const refSelect = fk.referencedColumns
          .map((column, i) => `${ident(column)}::text as ${ident(`r${i}`)}`)
          .join(", ");
        const { rows: parentRows } = await client.query(
          `select ${refSelect} from ${ident(schema)}.${ident(fk.toTable)}`,
        );
        const existing = new Set(
          parentRows.map((row) =>
            fk.referencedColumns.map((_, i) => row[`r${i}`] as string | null).join("|"),
          ),
        );
        let rowsAffected = 0;
        for (const row of plan.rows) {
          if (indices.every((index) => row[index] === null)) continue;
          const key = indices.map((index) => row[index]).join("|");
          if (existing.has(key)) continue;
          for (const index of indices) row[index] = null;
          rowsAffected += 1;
        }
        if (rowsAffected === 0) continue;
        nulledReferences.push({
          table: fk.fromTable,
          column: fk.columns.join(", "),
          referencedTable: fk.toTable,
          rowsAffected,
          reason: restorable.includes(fk.toTable)
            ? `this snapshot predates ${fk.toTable} being included in the export`
            : `${fk.toTable} is not part of the company export`,
        });
      }

      // The schema's own triggers — closed-period guards, actor stamps, audit
      // writers — are all correct for bookkeeping and all wrong for a
      // byte-faithful restore: they would refuse entries in closed periods,
      // stamp the restorer over every historical actor, and bury the restored
      // audit log under fabricated rows. Foreign keys are system triggers and
      // stay on. Owner privilege makes this possible; the DDL is transactional,
      // so a failure re-enables everything by rollback. The preserved cascade
      // tables sit inside the same window: putting their rows back is part of
      // the byte-faithful load, not bookkeeping.
      for (const table of [...planTables, ...preservedTables]) {
        await client.query(`alter table ${ident(schema)}.${ident(table)} disable trigger user`);
      }
      const preserved: TablePlan[] = [];
      for (const table of preservedTables) {
        const columns = [...(nullability.get(table)?.keys() ?? [])];
        if (columns.length === 0) continue;
        const selectList = columns
          .map((column) => `${ident(column)}::text as ${ident(column)}`)
          .join(", ");
        const { rows: keptRows } = await client.query(
          `select ${selectList} from ${ident(schema)}.${ident(table)}`,
        );
        preserved.push({
          table,
          columns,
          rows: keptRows.map((kept) =>
            columns.map((column) => (kept[column] === null ? null : String(kept[column]))),
          ),
        });
      }
      // A suspended constraint's columns are nulled before the clear as well:
      // a delete inside a reference cycle is as stuck as an insert, and these
      // rows are about to be emptied anyway.
      for (const constraint of suspended) {
        await client.query(
          `update ${ident(schema)}.${ident(constraint.fromTable)} set ${constraint.columns
            .map((column) => `${ident(column)} = null`)
            .join(", ")}`,
        );
      }
      // Provisioning seeds reference rows (currencies, sequences, approval
      // policies…). The copy's books must be exactly the snapshot's, so every
      // restored table is emptied first — dependents before what they
      // reference, the catalog-derived order read backwards.
      for (const plan of [...orderedPlans].reverse()) {
        await client.query(`delete from ${ident(schema)}.${ident(plan.table)}`);
      }
      for (const plan of orderedPlans) {
        if (plan.rows.length === 0) continue;
        await client.query(
          insertStatement(
            schema,
            plan,
            nullability.get(plan.table)!,
            suspendedColumnsByTable.get(plan.table),
          ),
        );
      }
      // Write back what the suspended constraints were loaded without; their
      // referenced rows all exist now, and the constraints check every value.
      for (const constraint of suspended) {
        const writeBack = suspendedWriteBack(
          schema,
          planByTable.get(constraint.fromTable)!,
          primaryKeys.get(constraint.fromTable),
          constraint.columns,
        );
        if (writeBack !== null) await client.query(writeBack);
      }
      // Put back what the cascade took from the tables the restore does not
      // manage, now that the rows they reference are loaded.
      for (const plan of preserved) {
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
            nulled_references: nulledReferences,
          }),
        ],
      );
      for (const table of [...planTables, ...preservedTables]) {
        await client.query(`alter table ${ident(schema)}.${ident(table)} enable trigger user`);
      }
      await client.query("commit");
    } catch (cause) {
      try {
        await client.query("rollback");
      } catch {
        // A rollback can only reject here because the connection itself has
        // died — and a dead connection's transaction never commits, the
        // server aborts it on its own. The error worth surfacing is `cause`
        // below, the statement that actually failed; letting the rollback's
        // rejection replace it would report "connection closed" and bury the
        // real failure.
      }
      throw cause;
    }

    // Everything past this point runs after the commit: the company exists
    // and is fully loaded, whatever happens below. A failure here must never
    // be reported as the restore not finishing — the natural response to that
    // message is to retry, which builds a second copy — so it is carried on
    // the outcome instead of thrown.
    try {
      actual = await readTotals(provisioned.schema, comparedAsOf);
      const comparison = compareControlTotals(expected, actual);
      verdict = comparison.controlTotalsMatch ? "matched" : "mismatched";
      differences = comparison.differences;
    } catch (cause) {
      // Not swallowed: the reason travels on the outcome, into the alert the
      // restorer reads, and into the verdict row written below.
      unverifiedReason = `Reading the restored company's control totals failed: ${
        cause instanceof Error ? cause.message : String(cause)
      }`;
    }

    // The verdict must outlive the browser tab. Without this row, showing a
    // mismatch once and closing the tab would leave no record anywhere that
    // distinguishes that copy from a clean one — so the conclusion, whichever
    // it is, goes into the copy's own audit log, right after the provenance
    // row that says where the books came from. Written with the triggers live
    // again, deliberately: this is an ordinary post-restore write, not part of
    // the byte-faithful load.
    try {
      await client.query(
        `insert into ${ident(provisioned.schema)}.${ident("acc_audit_log")}
           (table_name, record_id, action, actor_id, after_json)
         values ('acc_backup', $1, 'company.restore.verify', $2, $3::jsonb)`,
        [
          row.id,
          user.id,
          JSON.stringify({
            verdict,
            compared_as_of: comparedAsOf,
            expected,
            actual,
            differences,
            unverified_reason: unverifiedReason,
          }),
        ],
      );
      verdictRecorded = true;
    } catch (cause) {
      // Post-commit again: reported on the outcome, never thrown as a restore
      // failure and never claimed as recorded.
      verdictRecordError = cause instanceof Error ? cause.message : String(cause);
    }
  } finally {
    await client.end();
  }

  return {
    companyId: provisioned.companyId,
    slug,
    legalName,
    comparedAsOf,
    expected,
    actual,
    verdict,
    differences,
    unverifiedReason,
    verdictRecorded,
    verdictRecordError,
    nulledReferences,
  };
}
