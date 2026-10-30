import type { SupabaseClient } from "@supabase/supabase-js";
import {
  approvalsStep,
  bankReconciledStep,
  blockingFirst,
  cardsReconciledStep,
  closeHistoryEntry,
  closeProgress,
  controlAccountStep,
  depreciationStep,
  draftDocumentsStep,
  duplicatesStep,
  futureDatedStep,
  holdingAccountsStep,
  medianDaysToClose,
  reconciliationsAgreeStep,
  recurringDueStep,
  trialBalanceStep,
  type CloseHistoryEntry,
  type CloseProgress,
  type CloseStep,
} from "@/lib/domain/accounting-dashboard/close-checklist";
import { buildTrialBalance } from "@/lib/domain/reports";
import { getControlReconciliation } from "@/lib/services/gl-posting";
import { getLedgerBalances } from "@/lib/services/reports";
import { getExceptionReport } from "@/lib/services/exceptions";
import type { CheckKey } from "@/lib/domain/exceptions";
import { listFixedAssets } from "@/lib/services/fixed-assets";
import type { AccountingDashboardContext, AccountingPeriodRow } from "./context";
import { formatDate } from "@/lib/format";

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
/** One row of `acc_bank_close_standing` (0160). */
interface BankCloseStandingRow {
  bank_account_id: string;
  account_code: string;
  account_name: string;
  is_card: boolean;
  last_completed_on: string | null;
  /** A bigint, so it may arrive as a string. */
  unmatched_count: number | string;
}

export function targetPeriod(context: AccountingDashboardContext): AccountingPeriodRow | null {
  if (context.overduePeriods.length > 0) {
    return [...context.overduePeriods].sort((a, b) => a.periodEnd.localeCompare(b.periodEnd))[0];
  }
  return context.currentPeriod;
}

export async function getCloseReadiness(
  sb: SupabaseClient,
  context: AccountingDashboardContext,
  /** The period being closed, when it is not the one the screen would pick (2.84). */
  chosen?: AccountingPeriodRow,
): Promise<CloseReadiness | null> {
  const period = chosen ?? targetPeriod(context);
  if (!period) return null;
  const { periodStart, periodEnd } = period;

  const [
    ledger, reconciliation, blockers, drafts, bankStanding, approvals, history,
    exceptions, assets, activeSchedules, dueSchedules,
  ] =
    await Promise.allSettled([
      getLedgerBalances(sb, null, periodEnd),
      getControlReconciliation(sb, periodEnd),
      sb.rpc("acc_period_close_blockers", { p_period_id: period.id }),
      draftCount(sb, periodStart, periodEnd),
      // Every bank account record, bank or card, with its latest completed
      // reconciliation and its unmatched lines to the period end (0160): one
      // read for both steps, so a card is checked as a card and never counts
      // towards the bank.
      sb.rpc("acc_bank_close_standing", { p_as_of: periodEnd }),
      sb
        .from("acc_approval_request")
        .select("id", { count: "exact", head: true })
        .eq("status", "pending")
        .lte("requested_at", `${periodEnd}T23:59:59.999Z`),
      sb.rpc("acc_period_close_history", { p_limit: 6 }),
      // The rest of the design's month-end list (2.42). The Exception Report's
      // own reading of the period, so the checklist and the report cannot
      // disagree about duplicates, holding accounts or a changed reconciliation.
      getExceptionReport(sb, periodStart, periodEnd, context.asOf),
      // What the register says was due by the period end, not by today.
      listFixedAssets(sb, periodEnd),
      sb.from("acc_recurring_template").select("id", { count: "exact", head: true }).eq("status", "active"),
      sb
        .from("acc_recurring_template")
        .select("name")
        .eq("status", "active")
        .lte("next_run_date", periodEnd)
        .order("next_run_date"),
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
      passCondition: `Every subledger equals its control account at ${formatDate(periodEnd)}.`,
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

  const standing =
    bankStanding.status === "fulfilled" && !bankStanding.value.error
      ? ((bankStanding.value.data ?? []) as BankCloseStandingRow[])
      : null;
  const banks = standing?.filter((r) => !r.is_card) ?? null;
  const cards = standing?.filter((r) => r.is_card) ?? null;
  const latestBank = banks
    ?.map((r) => r.last_completed_on)
    .filter((d): d is string => d !== null)
    .sort()
    .at(-1);
  steps.push(
    bankReconciledStep({
      periodEnd,
      hasBankAccount: banks ? banks.length > 0 : null,
      lastCompletedOn: latestBank ?? null,
      unmatchedCount: banks ? banks.reduce((sum, r) => sum + Number(r.unmatched_count), 0) : null,
    }),
  );
  steps.push(
    cardsReconciledStep({
      periodEnd,
      cards:
        cards?.map((r) => ({
          label: `${r.account_code} ${r.account_name}`,
          lastCompletedOn: r.last_completed_on,
          unmatchedCount: Number(r.unmatched_count),
        })) ?? null,
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

  // A check the Exception Report could not run is unavailable here too, never "nothing found".
  const report = exceptions.status === "fulfilled" ? exceptions.value : null;
  const ran = (check: CheckKey) => report !== null && !report.unavailable.includes(check);
  steps.push(
    holdingAccountsStep({
      periodEnd,
      holding: ran("holding") ? report!.holding.map((row) => ({ name: row.name, balanceMinor: row.balanceMinor })) : null,
    }),
  );
  const schedulesOk =
    activeSchedules.status === "fulfilled" && !activeSchedules.value.error &&
    dueSchedules.status === "fulfilled" && !dueSchedules.value.error;
  steps.push(
    recurringDueStep({
      periodEnd,
      activeCount: schedulesOk ? (activeSchedules.value.count ?? 0) : null,
      due: schedulesOk ? ((dueSchedules.value.data ?? []) as { name: string }[]) : null,
    }),
  );
  const due = assets.status === "fulfilled" ? assets.value.filter((asset) => Number(asset.due_depreciation_minor) > 0) : [];
  steps.push(
    depreciationStep({
      periodEnd,
      assetCount: assets.status === "fulfilled" ? assets.value.length : null,
      dueCount: due.length,
      dueMinor: due.reduce((sum, asset) => sum + Number(asset.due_depreciation_minor), 0),
    }),
  );
  steps.push(
    reconciliationsAgreeStep({
      periodEnd,
      changed: ran("noLongerAgree")
        ? report!.noLongerAgree.filter((row) => row.statementEndingDate <= periodEnd)
        : null,
    }),
  );
  steps.push(duplicatesStep({ periodStart, periodEnd, groups: ran("duplicates") ? report!.duplicates.length : null }));
  steps.push(futureDatedStep({ today: context.asOf, count: ran("futureDated") ? report!.futureDated.length : null }));

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
