import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_TIME_ZONE } from "@/lib/domain/default-time-zone";
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

/** One sentence, with the batch it is about so a list can key on it. */
export interface OverrideSentence {
  batchId: string;
  text: string;
}

/** What a reconciliation says about the statements imported out of balance (2.11). */
export interface ReconciliationOverrideSentences {
  /** Above the lines of a reconciliation in progress: each open override its completion will settle. */
  notices: OverrideSentence[];
  /** In the report of a completed reconciliation: each override it settled. */
  settles: OverrideSentence[];
  /** True when the overrides could not be read: the screen says so rather than staying silent. */
  unavailable: boolean;
}

type Header = Pick<ReconStatementHeader, "bankAccountId" | "endingDate" | "status">;

/**
 * The sentences for one reconciliation. In progress, the open overrides of its
 * bank account whose last line falls after the previous completed
 * reconciliation and on or before this statement's end. Completed, the ones the
 * database says this reconciliation settled. Times are printed in the company's
 * time zone. Throws when a read fails; screens call `readReconciliationOverrides`.
 */
export async function reconciliationOverrideSentences(
  sb: SupabaseClient,
  id: string,
  header: Header,
  money: (minor: number) => string,
): Promise<Omit<ReconciliationOverrideSentences, "unavailable">> {
  const [overrides, settings] = await Promise.all([listStatementOverrides(sb), getCurrentCompanySettings(sb)]);
  const timeZone = settings?.time_zone || DEFAULT_TIME_ZONE;
  if (header.status === "completed") {
    return {
      notices: [],
      settles: overridesSettledBy(overrides, id).map((o) => ({
        batchId: o.batchId,
        text: reconciliationReportLine(overrideFacts(o, timeZone), money),
      })),
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
    }).map((o) => ({ batchId: o.batchId, text: reconciliationNotice(overrideFacts(o, timeZone), money) })),
    settles: [],
  };
}

/**
 * The same, for a screen that must stay up when the overrides cannot be read:
 * the error is logged and the result says `unavailable`, so the screen can warn
 * instead of saying nothing.
 */
export async function readReconciliationOverrides(
  sb: SupabaseClient,
  id: string,
  header: Header,
  money: (minor: number) => string,
): Promise<ReconciliationOverrideSentences> {
  try {
    return { ...(await reconciliationOverrideSentences(sb, id, header, money)), unavailable: false };
  } catch (err) {
    console.error("Could not read the statements imported out of balance for this reconciliation", err);
    return { notices: [], settles: [], unavailable: true };
  }
}
