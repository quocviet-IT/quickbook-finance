"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getUserRole, isAdmin, canWrite } from "@/lib/auth";
import {
  previewImport,
  runImport,
  DataImportError,
  type ImportOutcome,
  type ImportPreview,
} from "@/lib/services/data-import";
import type { ImportTarget } from "@/lib/domain/import-mapping";
import type { WaveLedgerEntry } from "@/lib/domain/wave-ledger";
import {
  importLedgerBatch,
  linkImportBatchReport,
  listImportBatches,
  unresolvedAccountRefs,
  voidImportBatch,
  type ImportBatchRow,
} from "@/lib/services/ledger-import";
import { suggestMapping } from "@/lib/ai/suggest-mapping";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

function msg(err: unknown): string {
  return err instanceof DataImportError || err instanceof Error
    ? err.message
    : "An unexpected error occurred";
}

/**
 * The chart of accounts is an administrator's to change; the rest is ordinary
 * bookkeeping. Both are checked again in the database, which is where the rule
 * actually lives.
 */
async function guard(target: ImportTarget): Promise<string | null> {
  const role = await getUserRole();
  if (target === "chart_of_accounts") {
    return isAdmin(role) ? null : "Only an administrator can import a chart of accounts";
  }
  return canWrite(role) ? null : "You do not have permission to import data";
}

/** What the import would do. Writes nothing. */
export async function previewImportAction(
  target: ImportTarget,
  rows: string[][],
  mapping: Record<string, number | null>,
  bankAccountId: string | null = null,
): Promise<ActionResult<ImportPreview>> {
  const denied = await guard(target);
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await previewImport(sb, target, rows, mapping, { bankAccountId }) };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/** Do it, into whichever company is currently open. */
export async function runImportAction(
  target: ImportTarget,
  rows: string[][],
  mapping: Record<string, number | null>,
  openingBalancesAsOf: string | null,
  bankAccountId: string | null = null,
): Promise<ActionResult<ImportOutcome>> {
  const denied = await guard(target);
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    const outcome = await runImport(sb, target, rows, mapping, {
      openingBalancesAsOf,
      bankAccountId,
    });
    // Transactions post to the ledger, so the screens that read it move too.
    for (const path of ["/accounts", "/customers", "/vendors", "/items", "/reports", "/banking"]) {
      revalidatePath(path);
    }
    return { ok: true, data: outcome };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export interface MappingSuggestion {
  columns: Record<string, number | null>;
  unmapped: string[];
  missingRequired: string[];
  /** Fields the model filled that name-matching had left empty. */
  aiFields: string[];
  note: string | null;
}

/**
 * Which column is which. Reads nothing from the database and writes nothing.
 *
 * Only the headers are sent to the model — never a row of the file — and its
 * answer is filtered and merged under the deterministic match before it comes
 * back. A model that is unconfigured or unreachable yields exactly the mapping
 * this screen has always produced.
 */
export async function suggestMappingAction(
  headers: string[],
  target: ImportTarget,
): Promise<ActionResult<MappingSuggestion>> {
  const denied = await guard(target);
  if (denied) return { ok: false, error: denied };
  try {
    return { ok: true, data: await suggestMapping(headers, target) };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

// --- The general ledger tab -------------------------------------------------
//
// A ledger export has no columns to agree on, so these actions carry a parsed
// file rather than a mapping. `guard("general_ledger")` lands on the same
// canWrite check the rest of the import uses, and the RPC checks again.

export async function importLedgerAction(
  mode: "history" | "balances",
  fileName: string,
  sha256: string,
  entries: WaveLedgerEntry[],
): Promise<ActionResult<{ batchId: string; entries: number; lines: number }>> {
  const denied = await guard("general_ledger");
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    const result = await importLedgerBatch(sb, { mode, fileName, sha256, entries });
    revalidatePath("/reports");
    revalidatePath("/journal");
    return { ok: true, data: result };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/** Reads only, so it carries no role guard beyond the session's own RLS. */
export async function unresolvedAccountRefsAction(
  refs: string[],
): Promise<ActionResult<{ missing: string[] }>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: { missing: await unresolvedAccountRefs(sb, refs) } };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function listImportBatchesAction(): Promise<ActionResult<ImportBatchRow[]>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await listImportBatches(sb) };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function voidImportBatchAction(
  batchId: string,
  reason: string,
): Promise<ActionResult<{ voided: number }>> {
  const denied = await guard("general_ledger");
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    const voided = await voidImportBatch(sb, batchId, reason);
    revalidatePath("/reports");
    revalidatePath("/journal");
    return { ok: true, data: { voided } };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function linkImportBatchReportAction(
  batchId: string,
  reportId: string,
): Promise<ActionResult> {
  const denied = await guard("general_ledger");
  if (denied) return { ok: false, error: denied };
  try {
    const sb = await createSupabaseServerClient();
    await linkImportBatchReport(sb, batchId, reportId);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}
