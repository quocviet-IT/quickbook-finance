"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/db/server";
import {
  listGapNotes,
  listSequenceCatalog,
  listSequenceDocuments,
  recordGapNote,
  SequenceError,
} from "@/lib/services/sequence";
import { auditSequence, type SequenceAudit } from "@/lib/domain/sequence";

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

function msg(err: unknown): string {
  if (err instanceof SequenceError || err instanceof Error) return err.message;
  return "An unexpected error occurred";
}

/** The whole number line of one document type, breaks and their notes included. */
export async function sequenceAuditAction(sequenceKey: string): Promise<ActionResult<SequenceAudit>> {
  try {
    const sb = await createSupabaseServerClient();
    const [catalog, documents, notes] = await Promise.all([
      listSequenceCatalog(sb),
      listSequenceDocuments(sb, sequenceKey),
      listGapNotes(sb, sequenceKey),
    ]);
    const definition = catalog.find((row) => row.sequence_key === sequenceKey);
    if (!definition) return { ok: false, error: `Unknown document type: ${sequenceKey}` };
    return { ok: true, data: auditSequence({ definition, documents, notes }) };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

/** Every document type at once — the summary an auditor opens the report on. */
export async function sequenceOverviewAction(): Promise<ActionResult<SequenceAudit[]>> {
  try {
    const sb = await createSupabaseServerClient();
    const catalog = await listSequenceCatalog(sb);
    const audits = await Promise.all(
      catalog.map(async (definition) => {
        const [documents, notes] = await Promise.all([
          listSequenceDocuments(sb, definition.sequence_key),
          listGapNotes(sb, definition.sequence_key),
        ]);
        return auditSequence({ definition, documents, notes });
      }),
    );
    return { ok: true, data: audits };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}

export async function recordGapNoteAction(raw: {
  sequenceKey: string;
  numberValue: number;
  reason: string;
}): Promise<ActionResult> {
  const reason = raw.reason?.trim() ?? "";
  if (reason.length < 10) {
    return { ok: false, error: "Explain the gap in at least ten characters" };
  }
  try {
    const sb = await createSupabaseServerClient();
    await recordGapNote(sb, {
      sequenceKey: raw.sequenceKey,
      numberValue: raw.numberValue,
      reason,
    });
    revalidatePath("/reports/number-sequence");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: msg(err) };
  }
}
