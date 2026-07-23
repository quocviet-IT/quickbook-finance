"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { listJournalEntries, JournalError, type JournalFilters, type JournalEntrySummary } from "@/lib/services/journal";

export interface ActionResult<T = undefined> { ok: boolean; error?: string; data?: T; }

export async function journalReportAction(filters: JournalFilters): Promise<ActionResult<JournalEntrySummary[]>> {
  try {
    const sb = await createSupabaseServerClient();
    return { ok: true, data: await listJournalEntries(sb, filters) };
  } catch (err) {
    return { ok: false, error: err instanceof JournalError || err instanceof Error ? err.message : "An unexpected error occurred" };
  }
}
