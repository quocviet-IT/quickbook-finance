import type { SupabaseClient } from "@supabase/supabase-js";
import { strToU8, zipSync } from "fflate";
import {
  archivePathFor,
  buildManifest,
  EXPORT_TABLES,
  orderColumnsFor,
  sha256Hex,
  SENSITIVE_TABLE,
  toCsv,
  type ExportControlTotals,
  type ExportDataset,
} from "@/lib/domain/company-export";

export class CompanyExportError extends Error {}

const PAGE = 1000;

async function readTable(
  sb: SupabaseClient,
  table: string,
): Promise<Array<Record<string, unknown>>> {
  const rows: Array<Record<string, unknown>> = [];
  const orderBy = orderColumnsFor(table);
  for (let from = 0; ; from += PAGE) {
    // Postgres makes no promise about order without one, so an unordered paged
    // read can hand back page 2 with rows page 1 already had and drop others
    // in their place. Every exported table has a declared order column (see
    // ORDER_COLUMNS) so two reads of unchanged books agree.
    let query = sb.from(table).select("*");
    for (const column of orderBy) query = query.order(column);
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) throw new CompanyExportError(`Reading ${table} failed: ${error.message}`);
    rows.push(...((data ?? []) as Array<Record<string, unknown>>));
    if (!data || data.length < PAGE) return rows;
  }
}

function columnsOf(rows: Array<Record<string, unknown>>): string[] {
  const seen = new Set<string>();
  for (const row of rows) for (const key of Object.keys(row)) seen.add(key);
  return [...seen];
}

/** Every exported table, read with the caller's own client so RLS still applies. */
export async function collectExportDatasets(sb: SupabaseClient): Promise<ExportDataset[]> {
  const datasets: ExportDataset[] = [];
  for (const table of [...EXPORT_TABLES, SENSITIVE_TABLE]) {
    const rows = await readTable(sb, table);
    datasets.push({
      table,
      columns: columnsOf(rows),
      rows,
      sensitive: table === SENSITIVE_TABLE,
    });
  }
  return datasets;
}

export async function readControlTotals(
  sb: SupabaseClient,
  asOf: string,
): Promise<ExportControlTotals> {
  const balances = await sb.rpc("acc_ledger_balances", { p_from: "1900-01-01", p_to: asOf });
  if (balances.error) {
    throw new CompanyExportError(`Trial balance failed: ${balances.error.message}`);
  }
  const ar = await sb.rpc("acc_ar_ageing", { p_as_of: asOf });
  if (ar.error) throw new CompanyExportError(`AR aging failed: ${ar.error.message}`);
  const ap = await sb.rpc("acc_ap_ageing", { p_as_of: asOf });
  if (ap.error) throw new CompanyExportError(`AP aging failed: ${ap.error.message}`);

  const { count, error } = await sb
    .from("acc_journal_line")
    .select("id", { count: "exact", head: true });
  if (error) throw new CompanyExportError(`Counting journal lines failed: ${error.message}`);

  const sumBalances = (
    rows: Array<{ debit_base: number; credit_base: number }> | null,
    side: "debit_base" | "credit_base",
  ) => (rows ?? []).reduce((total, row) => total + Number(row[side]), 0);
  const sumAging = (rows: Array<{ balance_minor: number }> | null) =>
    (rows ?? []).reduce((total, row) => total + Number(row.balance_minor), 0);

  return {
    trialBalanceDebitMinor: sumBalances(balances.data, "debit_base"),
    trialBalanceCreditMinor: sumBalances(balances.data, "credit_base"),
    arTotalMinor: sumAging(ar.data),
    apTotalMinor: sumAging(ap.data),
    journalLineCount: count ?? 0,
  };
}

export async function readSchemaVersion(sb: SupabaseClient): Promise<string> {
  const { data, error } = await sb
    .from("acc_schema_migrations")
    .select("filename")
    .order("filename", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new CompanyExportError(`Reading the schema version failed: ${error.message}`);
  return data?.filename ?? "unknown";
}

/**
 * The parsed shape of `manifest.json`, kept as an object rather than only the
 * string that ends up inside the ZIP. A caller that needs to compare two
 * archives (the scheduled backup) works from `.files`; a caller that only
 * needs to report on this one (the export action) can read `generatedAt`
 * back out of it instead of keeping a second clock of its own that could
 * disagree with what actually shipped inside the archive.
 */
export interface ExportManifest {
  format: string;
  formatVersion: number;
  generatedAt: string;
  generatedBy: string;
  schemaVersion: string;
  containsSensitiveData: boolean;
  excludedTables: readonly string[];
  controlTotals: ExportControlTotals;
  controlTotalsAsOf: string;
  files: Array<{ path: string; sha256: string; rowCount: number }>;
  tables: Array<{ table: string; rowCount: number; columns: string[]; sensitive: boolean }>;
}

export interface ExportArchive {
  bytes: Uint8Array;
  manifest: ExportManifest;
  manifestSha256: string;
  totalRows: number;
}

/**
 * Builds the portable ZIP — one CSV per table, a manifest, a README — the
 * same bytes the export button hands the browser. A scheduled backup calls
 * this too, so the button and the unattended job cannot drift into packaging
 * things differently. `actorEmail` is optional because a cron tick has no
 * signed-in user to name; it defaults to the same label the audit trail
 * already uses for actions nobody personally took (see `formatActor`).
 */
export async function buildExportArchive(input: {
  datasets: ExportDataset[];
  controlTotals: ExportControlTotals;
  schemaVersion: string;
  asOf: string;
  actorEmail?: string;
}): Promise<ExportArchive> {
  const generatedAt = new Date().toISOString();
  const entries: Record<string, Uint8Array> = {};
  const files: Array<{ path: string; sha256: string; rowCount: number }> = [];
  let totalRows = 0;

  for (const dataset of input.datasets) {
    const path = archivePathFor(dataset.table);
    const csv = toCsv(dataset.rows, dataset.columns);
    entries[path] = strToU8(csv);
    files.push({ path, sha256: await sha256Hex(csv), rowCount: dataset.rows.length });
    totalRows += dataset.rows.length;
  }

  const manifestJson = buildManifest({
    datasets: input.datasets,
    files,
    totals: input.controlTotals,
    controlTotalsAsOf: input.asOf,
    schemaVersion: input.schemaVersion,
    generatedAt,
    actorEmail: input.actorEmail ?? "system",
  });
  entries["manifest.json"] = strToU8(manifestJson);
  entries["README.txt"] = strToU8(
    [
      "One Book — company data export",
      "",
      `Generated ${generatedAt} under schema ${input.schemaVersion}.`,
      "",
      "data/        one CSV per table, header row = column names",
      "sensitive/   vendor tax profiles, including taxpayer identification numbers",
      "attachments.csv  the attachment inventory — file bytes are NOT included;",
      "             each row carries the storage path, size, sha256 and scan status",
      "             so a restore of object storage can be verified against it",
      "manifest.json carries row counts, per-file sha256 and the control totals",
      "             a restored database must reproduce.",
      "",
      "Restore procedure: docs/operations/backup-and-restore.md",
    ].join("\n"),
  );

  return {
    bytes: zipSync(entries, { level: 6 }),
    // Parsed back out of the exact bytes just written into manifest.json,
    // rather than a second object assembled from the same inputs by hand —
    // so this can never disagree with what the archive itself says.
    manifest: JSON.parse(manifestJson) as ExportManifest,
    manifestSha256: await sha256Hex(manifestJson),
    totalRows,
  };
}
