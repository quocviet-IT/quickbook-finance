import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listReconciliations } from "@/lib/services/bankrec";
import { getBankStandingWithChanges } from "@/lib/services/bank-standing";
import type { BankStanding } from "@/lib/domain/bank-standing";
import type { StatementReconciliationRow } from "@/lib/db/types";
import { settled, type ViewResult } from "../banking-view";

/** One bank account on the Reconcile start screen: its reconciliations and its standing card. */
export interface ReconcileAccountView {
  bankAccountId: string;
  reconciliations: ViewResult<StatementReconciliationRow[]>;
  /** Null when the standing read has no row for the account. */
  standing: ViewResult<BankStanding | null>;
}

/**
 * Both reads the Reconcile list draws one account with, side by side on one
 * client, each keeping its own error.
 *
 * They were two Server Actions sent after the statement alerts' own, and Next
 * runs a page's Server Actions one after another: on every switch of account
 * the list waited for the alerts, which read the whole ledger, then for the
 * standing (1.7 to 2.9 seconds on production, 30/10). Read by the page for the
 * account it opens on (2.91), and by `reconcileAccountAction` after a switch,
 * sent ahead of the alerts.
 */
export async function readReconcileAccount(
  sb: SupabaseClient,
  bankAccountId: string,
  asOf: string,
): Promise<ReconcileAccountView> {
  const [reconciliations, standing] = await Promise.all([
    settled(() => listReconciliations(sb, bankAccountId)),
    settled(async () => (await getBankStandingWithChanges(sb, asOf)).find((s) => s.bankAccountId === bankAccountId) ?? null),
  ]);
  return { bankAccountId, reconciliations, standing };
}
