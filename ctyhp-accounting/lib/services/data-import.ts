import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyMapping,
  fieldsFor,
  type ImportProblem,
  type ImportTarget,
} from "@/lib/domain/import-mapping";

export class DataImportError extends Error {}

export interface ImportPreviewRow {
  /** What the record will be matched on when it is imported. */
  key: string;
  name: string;
  /** Whether this row will create something or update something already here. */
  action: "create" | "update";
  openingBalanceMinor: number;
  values: Record<string, string | number | boolean | null>;
}

export interface ImportPreview {
  target: ImportTarget;
  rows: ImportPreviewRow[];
  problems: ImportProblem[];
  blankRows: number;
  creates: number;
  updates: number;
  /** Total opening balance carried by the file, if it carries any. */
  openingTotalMinor: number;
}

/** The column each target is matched on when deciding create versus update. */
function keyOf(target: ImportTarget, record: Record<string, unknown>): string {
  if (target === "chart_of_accounts") return String(record.account_code ?? "");
  if (target === "items") {
    const code = String(record.item_code ?? "");
    return code !== "" ? code : String(record.name ?? "").toLowerCase();
  }
  return String(record.name ?? "").toLowerCase();
}

/** What is already here, so the preview can say which rows are new. */
async function existingKeys(sb: SupabaseClient, target: ImportTarget): Promise<Set<string>> {
  const table =
    target === "chart_of_accounts"
      ? "acc_account"
      : target === "customers"
        ? "acc_customer"
        : target === "vendors"
          ? "acc_vendor"
          : "acc_item";
  const columns = target === "chart_of_accounts" ? "account_code" : target === "items" ? "item_code,name" : "name";

  const { data, error } = await sb.from(table).select(columns);
  if (error) throw new DataImportError(error.message);

  const keys = new Set<string>();
  for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
    if (target === "chart_of_accounts") keys.add(String(row.account_code ?? ""));
    else if (target === "items") {
      const code = String(row.item_code ?? "");
      keys.add(code !== "" ? code : String(row.name ?? "").toLowerCase());
    } else keys.add(String(row.name ?? "").toLowerCase());
  }
  return keys;
}

/**
 * What the import would do, without doing any of it.
 *
 * Nothing is written here. An import that posts on the first click is one
 * mis-mapped column away from a ledger nobody can unpick, so the answer to
 * "what will this do" has to be available before the answer to "do it".
 */
export async function previewImport(
  sb: SupabaseClient,
  target: ImportTarget,
  rows: readonly (readonly string[])[],
  mapping: Record<string, number | null>,
): Promise<ImportPreview> {
  const parsed = applyMapping(rows, mapping, target);
  const existing = await existingKeys(sb, target);

  const preview: ImportPreviewRow[] = parsed.records.map((record) => {
    const key = keyOf(target, record);
    return {
      key,
      name: String(record.name ?? ""),
      action: existing.has(key) ? "update" : "create",
      openingBalanceMinor: Number(record.opening_balance_minor ?? 0),
      values: record,
    };
  });

  return {
    target,
    rows: preview,
    problems: parsed.problems,
    blankRows: parsed.blankRows,
    creates: preview.filter((r) => r.action === "create").length,
    updates: preview.filter((r) => r.action === "update").length,
    openingTotalMinor: preview.reduce((sum, r) => sum + r.openingBalanceMinor, 0),
  };
}

export interface ImportOutcome {
  created: number;
  updated: number;
  skipped: number;
  /** Opening documents raised, when the file carried balances. */
  openingCreated?: number;
}

/**
 * Do it.
 *
 * The rows go to the database as they were previewed; the matching and the
 * posting both happen inside one RPC so a half-finished import cannot be left
 * behind. Opening balances are a second, explicit step — importing a list is
 * not the same act as putting figures on the ledger.
 */
export async function runImport(
  sb: SupabaseClient,
  target: ImportTarget,
  rows: readonly (readonly string[])[],
  mapping: Record<string, number | null>,
  options: { openingBalancesAsOf?: string | null } = {},
): Promise<ImportOutcome> {
  const parsed = applyMapping(rows, mapping, target);
  if (parsed.records.length === 0) {
    throw new DataImportError("Nothing in this file could be imported");
  }

  const payload = parsed.records;
  let outcome: ImportOutcome;

  if (target === "chart_of_accounts") {
    const { data, error } = await sb.rpc("acc_import_accounts", { p_rows: payload });
    if (error) throw new DataImportError(error.message);
    outcome = first(data);
  } else if (target === "items") {
    const { data, error } = await sb.rpc("acc_import_items", { p_rows: payload });
    if (error) throw new DataImportError(error.message);
    outcome = first(data);
  } else {
    const { data, error } = await sb.rpc("acc_import_contacts", {
      p_rows: payload,
      p_kind: target === "customers" ? "customer" : "vendor",
    });
    if (error) throw new DataImportError(error.message);
    outcome = first(data);
  }

  const asOf = options.openingBalancesAsOf;
  if (!asOf) return outcome;

  const balances = payload
    .map((record) => ({
      name: String(record.name ?? ""),
      account_code: String(record.account_code ?? ""),
      // What the file believed this account to be. The database refuses to post
      // a balance onto an account that turns out to be something else.
      account_type: String(record.account_type ?? ""),
      amount_minor: Number(record.opening_balance_minor ?? 0),
    }))
    .filter((row) => row.amount_minor !== 0);

  if (balances.length === 0) return outcome;

  if (target === "chart_of_accounts") {
    const { error } = await sb.rpc("acc_post_opening_balances", {
      p_as_of: asOf,
      p_rows: balances,
    });
    if (error) throw new DataImportError(error.message);
    return { ...outcome, openingCreated: balances.length };
  }

  if (target === "customers" || target === "vendors") {
    const rpc =
      target === "customers" ? "acc_import_opening_receivables" : "acc_import_opening_payables";
    const { data, error } = await sb.rpc(rpc, { p_as_of: asOf, p_rows: balances });
    if (error) throw new DataImportError(error.message);
    const result = (Array.isArray(data) ? data[0] : data) as { created?: number } | null;
    return { ...outcome, openingCreated: Number(result?.created ?? 0) };
  }

  return outcome;
}

function first(data: unknown): ImportOutcome {
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  return {
    created: Number(row?.created ?? 0),
    updated: Number(row?.updated ?? 0),
    skipped: Number(row?.skipped ?? 0),
  };
}

/** Whether this target can carry opening balances at all. */
export function supportsOpeningBalances(target: ImportTarget): boolean {
  return fieldsFor(target).some((field) => field.key === "opening_balance_minor");
}
