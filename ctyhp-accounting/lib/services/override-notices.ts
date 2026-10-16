import type { SupabaseClient } from "@supabase/supabase-js";
import {
  overrideFacts,
  overridesForReconciliation,
  overridesSettledBy,
  reconciliationNotice,
  reconciliationReportLine,
} from "@/lib/domain/statement-overrides";
import { listReconciliations, type ReconStatementHeader } from "./bankrec";
import { getCurrentCompanySettings } from "./company";
import { listStatementOverrides } from "./statement-overrides";

/** What a reconciliation says about the statements imported out of balance (2.11). */
export interface ReconciliationOverrideSentences {
  /** Above the lines of a reconciliation in progress: each open override its completion will settle. */
  notices: string[];
  /** In the report of a completed reconciliation: each override it settled. */
  settles: string[];
}

/**
 * The sentences for one reconciliation. In progress, the open overrides of its
 * bank account whose last line falls after the previous completed
 * reconciliation and on or before this statement's end. Completed, the ones the
 * database says this reconciliation settled. Times are printed in the company's
 * time zone.
 */
export async function reconciliationOverrideSentences(
  sb: SupabaseClient,
  id: string,
  header: Pick<ReconStatementHeader, "bankAccountId" | "endingDate" | "status">,
  money: (minor: number) => string,
): Promise<ReconciliationOverrideSentences> {
  const [overrides, settings] = await Promise.all([listStatementOverrides(sb), getCurrentCompanySettings(sb)]);
  const timeZone = settings?.time_zone || "UTC";
  if (header.status === "completed") {
    return {
      notices: [],
      settles: overridesSettledBy(overrides, id).map((o) => reconciliationReportLine(overrideFacts(o, timeZone), money)),
    };
  }
  const sameAccount = overrides.filter((o) => o.bankAccountId === header.bankAccountId);
  if (sameAccount.length === 0) return { notices: [], settles: [] };
  const previous = (await listReconciliations(sb, header.bankAccountId))
    .filter((r) => r.status === "completed" && r.statement_ending_date < header.endingDate)
    .map((r) => r.statement_ending_date)
    .sort()
    .pop();
  return {
    notices: overridesForReconciliation(sameAccount, {
      bankAccountId: header.bankAccountId,
      endingDate: header.endingDate,
      previousEndingDate: previous ?? null,
    }).map((o) => reconciliationNotice(overrideFacts(o, timeZone), money)),
    settles: [],
  };
}
