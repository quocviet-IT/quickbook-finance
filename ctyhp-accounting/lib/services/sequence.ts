import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  SequenceDefinition,
  SequenceDocument,
  SequenceGapNote,
} from "@/lib/domain/sequence";

export class SequenceError extends Error {}

/** Every numbered document type, with the counter's current position. */
export async function listSequenceCatalog(sb: SupabaseClient): Promise<SequenceDefinition[]> {
  const { data, error } = await sb.rpc("acc_sequence_catalog");
  if (error) throw new SequenceError(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    sequence_key: row.sequence_key as string,
    label: row.label as string,
    prefix: row.prefix as string,
    next_value: Number(row.next_value),
  }));
}

/** The documents one sequence's numbers are attached to, in number order. */
export async function listSequenceDocuments(
  sb: SupabaseClient,
  sequenceKey: string,
): Promise<SequenceDocument[]> {
  const { data, error } = await sb.rpc("acc_sequence_documents", {
    p_sequence_key: sequenceKey,
  });
  if (error) throw new SequenceError(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    number_value: Number(row.number_value),
    document_id: row.document_id as string,
    document_date: (row.document_date as string | null) ?? null,
    document_status: (row.document_status as string | null) ?? null,
  }));
}

export async function listGapNotes(
  sb: SupabaseClient,
  sequenceKey: string,
): Promise<SequenceGapNote[]> {
  const { data, error } = await sb
    .from("acc_number_gap_note")
    .select("number_value, reason, noted_at")
    .eq("sequence_key", sequenceKey)
    .order("number_value");
  if (error) throw new SequenceError(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    number_value: Number(row.number_value),
    reason: row.reason as string,
    noted_at: row.noted_at as string,
  }));
}

/**
 * Document why a number is missing. Refused by the database for anyone without
 * `settings.manage` — explaining away a break in the sequence is governance.
 */
export async function recordGapNote(
  sb: SupabaseClient,
  input: { sequenceKey: string; numberValue: number; reason: string },
): Promise<void> {
  const { error } = await sb.rpc("acc_record_number_gap_note", {
    p_sequence_key: input.sequenceKey,
    p_number_value: input.numberValue,
    p_reason: input.reason,
  });
  if (error) throw new SequenceError(error.message);
}
