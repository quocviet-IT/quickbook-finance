"use server";
import { createSupabaseServerClient } from "@/lib/db/server";
import { checkWhen, reportFailure, type ReportRunResult, type ReportWhen } from "@/lib/domain/report-run";
import type { VoidedEntriesReport } from "@/lib/domain/voided-entries";
import { hasPermission } from "@/lib/services/access";
import { companyClock } from "@/lib/services/report-context";
import { getVoidedEntries } from "@/lib/services/review-reports";

/**
 * Voided and Reversed Entries: read-only. Who voided a document comes from the
 * audit log, so it is asked for only when the reader may read that log.
 */
export async function voidedEntriesAction(when: ReportWhen): Promise<ReportRunResult<VoidedEntriesReport>> {
  try {
    const checked = checkWhen(when, "range");
    const sb = await createSupabaseServerClient();
    const [{ timeZone }, canReadAudit] = await Promise.all([companyClock(sb), hasPermission(sb, "audit.read")]);
    return {
      ok: true,
      data: await getVoidedEntries(sb, { from: checked.from!, to: checked.to }, timeZone, canReadAudit),
    };
  } catch (e) {
    return { ok: false, error: reportFailure(e) };
  }
}
