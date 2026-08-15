import type { SupabaseClient } from "@supabase/supabase-js";
import {
  EXPORT_TABLES,
  orderColumnsFor,
  SENSITIVE_TABLE,
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
