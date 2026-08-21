import type { SupabaseClient } from "@supabase/supabase-js";
import {
  approvalsStep,
  bankReconciledStep,
  blockingFirst,
  closeHistoryEntry,
  closeProgress,
  controlAccountStep,
  draftDocumentsStep,
  medianDaysToClose,
  trialBalanceStep,
  type CloseHistoryEntry,
  type CloseProgress,
  type CloseStep,
} from "@/lib/domain/accounting-dashboard/close-checklist";
import { buildTrialBalance } from "@/lib/domain/reports";
import { getControlReconciliation } from "@/lib/services/gl-posting";
import { getLedgerBalances } from "@/lib/services/reports";
import type { AccountingDashboardContext, AccountingPeriodRow } from "./context";

/**
 * How ready a period is to be closed — measured at the period's own end date.
 *
 * **Every read here is `periodEnd`, never `context.asOf`.** That is the whole
 * point of the section. The daily control strip answers "are the books safe
 * right now"; this answers "were the books safe on the thirty-first", and the
 * two come apart the moment anybody posts into April. A checklist built from
 * today's figures would be wrong about half the months and would look right
 * about all of them.
 *
 * Nothing here is stored, and there is no way to mark a step done. A step is
 * complete because the ledger, the reconciliation or the approval queue says
 * so at that date — which is why running this twice a minute apart gives the
 * same answer, and why posting a draft changes it without anybody clicking.
 */

export interface CloseReadiness {
  period: AccountingPeriodRow;
  steps: CloseStep[];
  progress: CloseProgress;
  /**
   * The database's own verdict, verbatim, from `acc_period_close_blockers`.
   * Null when nothing stands in the way. This is the sentence the close would
   * actually be refused with, so the screen and the gate cannot disagree.
   */
  gateBlockers: string | null;
  history: CloseHistoryEntry[];
  medianDaysToClose: number | null;
}

/**
 * Which period a close is about: the oldest one still open after the last day
 * it covers, or — when nothing is overdue — the one today falls inside.
 *
 * Oldest first, because closing April before March is not a thing an accountant
 * does, and offering it would be offering the wrong work.
 */
export function targetPeriod(context: AccountingDashboardContext): AccountingPeriodRow | null {
  if (context.overduePeriods.length > 0) {
    return [...context.overduePeriods].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd))[0];
  }
  return context.currentPeriod;
}

export async function getCloseReadiness(
  sb: SupabaseClient,
  context: AccountingDashboardContext,
): Promise<CloseReadiness | null> {
  const period = targetPeriod(context);
  if (!period) return null;
  const { periodStart, periodEnd } = period;

  const [ledger, reconciliation, blockers, drafts, bankAccounts, lastRecon, unmatched, approvals, history] =
    await Promise.allSettled([
      getLedgerBalances(sb, null, periodEnd),
      getControlReconciliation(sb, periodEnd),
      sb.rpc("acc_period_close_blockers", { p_period_id: period.id }),
      draftCount(sb, periodStart, periodEnd),
      sb.from("acc_bank_account").select("id", { count: "exact", head: true }),
      sb
        .from("acc_statement_reconciliation")
        .select("statement_ending_date")
        .eq("status", "completed")
        .order("statement_ending_date", { ascending: false })
        .limit(1),
      sb
        .from("acc_bank_transaction")
        .select("id", { count: "exact", head: true })
        .eq("status", "unmatched")
        .eq("pending", false)
        .is("provider_removed_at", null)
        .lte("txn_date", periodEnd),
      sb
        .from("acc_approval_request")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .lte("requested_at", `${periodEnd}T23:59:59.999Z`),
      sb.rpc("acc_period_close_history", { p_limit: 6 }),
    ]);

  const steps: CloseStep[] = [];

  steps.push(
    trialBalanceStep({
      periodEnd,
      differenceMinor:
        ledger.status === "fulfilled"
          ? (() => {
              const tb = buildTrialBalance(ledger.value);
              return tb.totalDebit - tb.totalCredit;
            })()
          : null,
    }),
  );

  if (reconciliation.status === "fulfilled") {
    for (const row of reconciliation.value.rows) {
      steps.push(
        controlAccountStep({
          controlKey: row.controlKey,
          label: row.label,
          hasSubledger: row.hasSubledger,
          subledgerMinor: row.subledgerMinor,
          controlMinor: row.controlMinor,
          periodEnd,
        }),
      );
    }
  } else {
    // One unavailable step rather than three invented ones: without the
    // reconciliation we do not know which control accounts this company even
    // has, so naming three would be making up the list as well as the answer.
    steps.push({
      key: "control:unavailable",
      title: "The control accounts tie to the ledger",
      status: "unavailable",
      passCondition: `Every subledger equals its control account at ${periodEnd}.`,
      evidence: "The control reconciliation did not answer, so nothing here is proven.",
      blocksClose: true,
      href: "/reports/gl-posting",
      workKey: null,
    });
  }

  steps.push(
    draftDocumentsStep({
      periodStart,
      periodEnd,
      draftCount: drafts.status === "fulfilled" ? drafts.value : null,
    }),
  );

  const bankOk =
    bankAccounts.status === "fulfilled" &&
    !bankAccounts.value.error &&
    lastRecon.status === "fulfilled" &&
    !lastRecon.value.error;
  const unmatchedOk = unmatched.status === "fulfilled" && !unmatched.value.error;
  steps.push(
    bankReconciledStep({
      periodEnd,
      hasBankAccount: bankOk ? (bankAccounts.value.count ?? 0) > 0 : null,
      lastCompletedOn: bankOk
        ? ((lastRecon.value.data?.[0]?.statement_ending_date as string | undefined) ?? null)
        : null,
      unmatchedCount: unmatchedOk ? (unmatched.value.count ?? 0) : null,
    }),
  );

  steps.push(
    approvalsStep({
      periodEnd,
      pendingCount:
        approvals.status === "fulfilled" && !approvals.value.error
          ? (approvals.value.count ?? 0)
          : null,
    }),
  );

  const entries: CloseHistoryEntry[] = [];
  if (history.status === "fulfilled" && !history.value.error) {
    for (const row of (history.value.data ?? []) as Record<string, unknown>[]) {
      const entry = closeHistoryEntry({
        periodLabel: String(row.period_label ?? ""),
        periodEnd: String(row.period_end ?? "").slice(0, 10),
        closedAt: String(row.closed_at ?? ""),
      });
      if (entry) entries.push(entry);
    }
  }

  const ordered = blockingFirst(steps);
  return {
    period,
    steps: ordered,
    progress: closeProgress(ordered),
    gateBlockers:
      blockers.status === "fulfilled" && !blockers.value.error
        ? ((blockers.value.data as string | null) ?? null)
        : null,
    history: entries,
    medianDaysToClose: medianDaysToClose(entries),
  };
}

/**
 * Invoices and bills still in draft with a document date inside the period.
 *
 * Both counts or neither: a total that silently omitted the bills would read as
 * "two documents outstanding" when there were five, which is worse than saying
 * the count could not be taken.
 */
async function draftCount(
  sb: SupabaseClient,
  periodStart: string,
  periodEnd: string,
): Promise<number> {
  const [invoices, bills] = await Promise.all([
    sb
      .from("acc_invoice")
      .select("id", { count: "exact", head: true })
      .eq("status", "draft")
      .gte("issue_date", periodStart)
      .lte("issue_date", periodEnd),
    sb
      .from("acc_bill")
      .select("id", { count: "exact", head: true })
      .eq("status", "draft")
      .gte("bill_date", periodStart)
      .lte("bill_date", periodEnd),
  ]);
  if (invoices.error) throw new Error(invoices.error.message);
  if (bills.error) throw new Error(bills.error.message);
  return (invoices.count ?? 0) + (bills.count ?? 0);
}
