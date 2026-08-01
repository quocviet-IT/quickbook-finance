import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildControlReconciliation,
  buildPostingReport,
  type ControlReconciliation,
  type ControlRow,
  type PostingReport,
  type PostingRow,
} from "@/lib/domain/gl-posting";

export class GlPostingError extends Error {}

/**
 * Every document in a date range beside the journal entry it produced.
 *
 * The database returns the raw pairing; the verdict on each row — posted,
 * missing, mismatched — is decided in lib/domain/gl-posting.ts so the rule has
 * one implementation and unit tests can hold it.
 */
export async function getPostingReport(
  sb: SupabaseClient,
  from: string,
  to: string,
): Promise<PostingReport> {
  const { data, error } = await sb.rpc("acc_gl_posting_report", { p_from: from, p_to: to });
  if (error) throw new GlPostingError(error.message);

  const rows: PostingRow[] = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    sourceType: r.source_type as string,
    documentId: r.document_id as string,
    documentNumber: (r.document_number as string | null) ?? null,
    documentDate: r.document_date as string,
    partyName: (r.party_name as string | null) ?? "",
    documentStatus: r.document_status as string,
    amountMinor: Number(r.amount_minor),
    journalEntryId: (r.journal_entry_id as string | null) ?? null,
    entryNumber: (r.entry_number as string | null) ?? null,
    entryDate: (r.entry_date as string | null) ?? null,
    entryStatus: (r.entry_status as string | null) ?? null,
    entryTotalMinor: Number(r.entry_total_minor ?? 0),
  }));

  return buildPostingReport(rows);
}

/**
 * Every control account against whatever stands behind it, as of a date.
 *
 * This is the check a month-end close depends on, so it is also what
 * `acc_close_period` runs before it will close anything.
 */
export async function getControlReconciliation(
  sb: SupabaseClient,
  asOf: string,
): Promise<ControlReconciliation> {
  const { data, error } = await sb.rpc("acc_control_reconciliation", { p_as_of: asOf });
  if (error) throw new GlPostingError(error.message);

  const rows: ControlRow[] = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    controlKey: r.control_key as string,
    label: r.label as string,
    accountCodes: (r.account_codes as string | null) ?? null,
    hasSubledger: Boolean(r.has_subledger),
    subledgerMinor: Number(r.subledger_minor ?? 0),
    controlMinor: Number(r.control_minor ?? 0),
  }));

  return buildControlReconciliation(asOf, rows);
}
