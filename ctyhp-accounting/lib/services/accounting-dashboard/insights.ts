import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildInsights,
  type AccountingInsight,
  type OverdueParty,
} from "@/lib/domain/accounting-dashboard/insight-rules";
import { sleepingRules, type WorkPolicy } from "@/lib/domain/accounting-dashboard/policy";
import type { AccountingControl } from "@/lib/domain/accounting-dashboard/types";
import { previousPeriodRange } from "@/lib/domain/reports";
import { getArAging, getApAging } from "@/lib/services/aging";
import { listRecurringRuns } from "@/lib/services/recurring";
import { getLedgerBalances } from "@/lib/services/reports";
import type { AccountingDashboardContext } from "./context";

export interface InsightSection {
  insights: AccountingInsight[];
  /** Rules that cannot fire because nobody has set the policy they need. */
  sleeping: string[];
}

/**
 * Gathering what the rules need, and then getting out of the way.
 *
 * Everything decided lives in `insight-rules.ts`, where it is pure and tested.
 * This file's only job is to fetch honestly — and the one place that takes
 * care is the comparison, where the obvious source is the wrong one. See the
 * note on `InsightFacts.receivables`.
 */
export async function getAccountingInsights(
  sb: SupabaseClient,
  context: AccountingDashboardContext,
  policy: WorkPolicy,
  controls: readonly AccountingControl[],
): Promise<InsightSection> {
  const generatedAsOf = new Date().toISOString();
  const { asOf } = context;
  const prior = previousPeriodRange(monthStart(asOf), asOf);

  const [arAging, apAging, ledgerNow, ledgerPrior, approvals, unmatched, runs] =
    await Promise.allSettled([
      getArAging(sb, asOf),
      getApAging(sb, asOf),
      getLedgerBalances(sb, null, asOf),
      getLedgerBalances(sb, null, prior.to),
      sb
        .from("acc_approval_request")
        .select("requested_at", { count: "exact" })
        .eq("status", "pending")
        .order("requested_at", { ascending: true })
        .limit(1),
      sb
        .from("acc_bank_transaction")
        .select("txn_date", { count: "exact" })
        .eq("status", "unmatched")
        .eq("pending", false)
        .is("provider_removed_at", null)
        .lte("txn_date", asOf)
        .order("txn_date", { ascending: true })
        .limit(1),
      listRecurringRuns(sb, 50),
    ]);

  const control = (result: PromiseSettledResult<unknown>, type: string, sign: 1 | -1) => {
    if (result.status !== "fulfilled") return 0;
    const rows = result.value as { accountType: string; debitBase: number; creditBase: number }[];
    return (
      sign *
      rows
        .filter((row) => row.accountType === type)
        .reduce((sum, row) => sum + row.debitBase - row.creditBase, 0)
    );
  };

  const parties = (result: PromiseSettledResult<unknown>): OverdueParty[] => {
    if (result.status !== "fulfilled") return [];
    const report = result.value as {
      rows: { entityId: string; entityName: string; balanceMinor: number; bucket: string }[];
    };
    // Concentration is about who is *overdue*, so the current bucket is left
    // out: money not yet due is not a problem anybody has.
    const byParty = new Map<string, OverdueParty>();
    for (const row of report.rows.filter((r) => r.bucket !== "current")) {
      const existing = byParty.get(row.entityId);
      if (existing) existing.balanceMinor += row.balanceMinor;
      else
        byParty.set(row.entityId, {
          entityId: row.entityId,
          entityName: row.entityName,
          balanceMinor: row.balanceMinor,
        });
    }
    return [...byParty.values()];
  };

  const countAndOldest = (
    result: PromiseSettledResult<unknown>,
    field: "requested_at" | "txn_date",
  ) => {
    if (result.status !== "fulfilled") return { count: 0, oldestAgeDays: null };
    const answer = result.value as {
      count: number | null;
      data: Record<string, unknown>[] | null;
      error: unknown;
    };
    if (answer.error) return { count: 0, oldestAgeDays: null };
    const oldest = answer.data?.[0]?.[field];
    return {
      count: answer.count ?? 0,
      oldestAgeDays: oldest ? daysBetween(asOf, String(oldest).slice(0, 10)) : null,
    };
  };

  const approvalFacts = countAndOldest(approvals, "requested_at");

  const insights = buildInsights({
    asOf,
    generatedAsOf,
    policy,
    controls,
    overduePeriods: context.overduePeriods.map((period) => ({
      id: period.id,
      label: period.label,
      periodEnd: period.periodEnd,
    })),
    approvals: { pendingCount: approvalFacts.count, oldestAgeDays: approvalFacts.oldestAgeDays },
    unmatchedBank: countAndOldest(unmatched, "txn_date"),
    failedRecurringRuns:
      runs.status === "fulfilled"
        ? runs.value
            .filter((run) => run.status === "failed")
            .map((run) => ({
              id: run.id,
              templateName: run.template_name ?? "A recurring schedule",
              runDate: run.scheduled_date.slice(0, 10),
            }))
        : [],
    receivables: {
      nowMinor: control(ledgerNow, "accounts_receivable", 1),
      priorMinor: control(ledgerPrior, "accounts_receivable", 1),
      rows: parties(arAging),
    },
    payables: {
      // Payables sit credit-side, so the sign is flipped to make "grew" mean
      // "we owe more" rather than "the number went further negative".
      nowMinor: control(ledgerNow, "accounts_payable", -1),
      priorMinor: control(ledgerPrior, "accounts_payable", -1),
      rows: parties(apAging),
    },
    comparisonLabel: monthLabel(prior.to),
  });

  return { insights, sleeping: sleepingRules(policy) };
}

function monthStart(asOf: string): string {
  return `${asOf.slice(0, 7)}-01`;
}

function monthLabel(date: string): string {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(later: string, earlier: string): number {
  return Math.max(
    0,
    Math.round(
      (Date.parse(`${later}T00:00:00.000Z`) - Date.parse(`${earlier}T00:00:00.000Z`)) / DAY_MS,
    ),
  );
}
