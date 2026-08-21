import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WaveLedgerEntry } from "@/lib/domain/wave-ledger";

export class LedgerImportError extends Error {}

export interface ImportBatchRow {
  id: string;
  source: string;
  mode: "history" | "balances";
  file_name: string;
  sha256: string;
  entry_count: number;
  line_count: number;
  from_date: string | null;
  to_date: string | null;
  total_minor: number;
  saved_report_id: string | null;
  status: "active" | "voided";
  imported_by: string | null;
  /** Resolved for the screen: a uuid tells a reader nothing about who ran it. */
  imported_by_name: string | null;
  imported_at: string;
  voided_at: string | null;
  void_reason: string | null;
}

const COLUMNS =
  "id,source,mode,file_name,sha256,entry_count,line_count,from_date,to_date,total_minor," +
  "saved_report_id,status,imported_by,imported_at,voided_at,void_reason";

export async function importLedgerBatch(
  sb: SupabaseClient,
  input: {
    mode: "history" | "balances";
    fileName: string;
    sha256: string;
    entries: WaveLedgerEntry[];
  },
): Promise<{ batchId: string; entries: number; lines: number }> {
  if (input.entries.length === 0) {
    throw new LedgerImportError("There is nothing in this file to import");
  }
  const { data, error } = await sb.rpc("acc_import_ledger_entries", {
    p_source: "wave_ledger",
    p_mode: input.mode,
    p_file_name: input.fileName,
    p_sha256: input.sha256,
    // The function reads snake_case keys. Converting here keeps the domain
    // module in the language the rest of the TypeScript speaks.
    p_entries: input.entries.map((entry) => ({
      date: entry.date,
      lines: entry.lines.map((line) => ({
        account: line.account,
        signed_minor: line.signedMinor,
        description: line.description,
      })),
    })),
  });
  if (error) throw new LedgerImportError(error.message);
  const result = data as { batch_id: string; entries: number; lines: number };
  return { batchId: result.batch_id, entries: result.entries, lines: result.lines };
}

/**
 * The account names in this file that the chart does not have.
 *
 * Asked before the import runs so the screen can list every one of them at
 * once. `acc_import_ledger_entries` refuses on the first it meets, which is the
 * right behaviour for a write and a poor way to tell somebody what to fix.
 */
export async function unresolvedAccountRefs(
  sb: SupabaseClient,
  refs: string[],
): Promise<string[]> {
  if (refs.length === 0) return [];
  const { data, error } = await sb.rpc("acc_unresolved_account_refs", { p_refs: refs });
  if (error) throw new LedgerImportError(error.message);
  return (data ?? []) as string[];
}

export async function listImportBatches(sb: SupabaseClient): Promise<ImportBatchRow[]> {
  // The directory is read alongside rather than joined: acc_import_batch
  // references auth.users, which an application session cannot select from, and
  // acc_actor_directory is the one place allowed to answer "who is this id".
  const [batches, actors] = await Promise.all([
    sb.from("acc_import_batch").select(COLUMNS).order("imported_at", { ascending: false }).limit(20),
    sb.rpc("acc_actor_directory"),
  ]);
  if (batches.error) throw new LedgerImportError(batches.error.message);

  const names = new Map<string, string>();
  if (!actors.error) {
    for (const row of (actors.data ?? []) as Record<string, unknown>[]) {
      const name = String(row.full_name ?? "").trim() || String(row.email ?? "").trim();
      if (name) names.set(String(row.id), name);
    }
  }

  return ((batches.data ?? []) as unknown as ImportBatchRow[]).map((batch) => ({
    ...batch,
    imported_by_name: batch.imported_by ? (names.get(batch.imported_by) ?? null) : null,
  }));
}

export interface UndoOutcome {
  /** Journal entries voided, or draft documents deleted. */
  removed: number;
  /** Documents left where they are because they had moved on. */
  kept: number;
}

/**
 * Take an import back out, the way its own kind of import can be taken back.
 *
 * A ledger or transaction import posted entries, so undoing it voids them and
 * the trail stays. An invoice import raised drafts, so undoing it deletes them
 * — that is the only thing that clears the data a reader is looking at. The
 * source is read here rather than passed in: a screen that picked the wrong
 * undo would void a ledger it meant to delete drafts from.
 */
export async function voidImportBatch(
  sb: SupabaseClient,
  batchId: string,
  reason: string,
): Promise<UndoOutcome> {
  const { data: batch, error: lookupError } = await sb
    .from("acc_import_batch")
    .select("source")
    .eq("id", batchId)
    .maybeSingle();
  if (lookupError) throw new LedgerImportError(lookupError.message);
  if (!batch) throw new LedgerImportError("Import not found, or already undone");

  if (String(batch.source) === "invoices") {
    const { data, error } = await sb.rpc("acc_undo_invoice_import", {
      p_batch_id: batchId,
      p_reason: reason,
    });
    if (error) throw new LedgerImportError(error.message);
    const row = (Array.isArray(data) ? data[0] : data) as
      | { removed?: number; kept?: number }
      | null;
    return { removed: Number(row?.removed ?? 0), kept: Number(row?.kept ?? 0) };
  }

  const { data, error } = await sb.rpc("acc_void_import_batch", {
    p_batch_id: batchId,
    p_reason: reason,
  });
  if (error) throw new LedgerImportError(error.message);
  return { removed: Number(data ?? 0), kept: 0 };
}

export async function linkImportBatchReport(
  sb: SupabaseClient,
  batchId: string,
  reportId: string,
): Promise<void> {
  const { error } = await sb.rpc("acc_link_import_batch_report", {
    p_batch_id: batchId,
    p_report_id: reportId,
  });
  if (error) throw new LedgerImportError(error.message);
}
