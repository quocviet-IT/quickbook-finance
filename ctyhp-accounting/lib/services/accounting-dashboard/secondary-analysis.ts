import type { SupabaseClient } from "@supabase/supabase-js";
import { buildProfitAndLoss } from "@/lib/domain/reports";
import { listJournalEntries } from "@/lib/services/journal";
import { trailingMonthRanges } from "@/lib/services/dashboard";
import { getMonthlyLedgerBalances } from "@/lib/services/reports";
import type { AccountingDashboardContext } from "./context";

/**
 * The analysis an accountant reaches for *after* the work — trends, where the
 * journals came from, what happened lately.
 *
 * This section is the expensive one, which is why it is a section of its own:
 * fetched last, rendered below the fold, and when it fails the queue and the
 * controls above it do not notice.
 *
 * It used to be far more expensive than it needed to be. It called
 * `getDashboardAnalytics` — the entire payload the *main* dashboard is built
 * from — and kept one field of it. Everything else was fetched and waited for
 * and discarded: the metrics, the period comparison, cash flow, inventory, the
 * operating pulse, the audit trail, and a second copy of the work queue this
 * page had already loaded. Behind that field, `getMonthlyPerformance` issued
 * one ledger query per month and awaited twelve round trips to draw one chart.
 *
 * Now: one aggregate call for the window (0121), and the same
 * `buildProfitAndLoss` that every other report uses, run over each month's rows
 * here rather than reimplemented in SQL.
 */

export interface TrendPoint {
  key: string;
  label: string;
  incomeMinor: number;
  expenseMinor: number;
}

export interface SourceMixPoint {
  key: string;
  label: string;
  count: number;
}

export interface RecentEntry {
  id: string;
  entryNumber: string;
  entryDate: string;
  description: string;
  sourceType: string;
  totalMinor: number;
  status: string;
}

export interface SecondaryAnalysis {
  trend: TrendPoint[];
  sourceMix: SourceMixPoint[];
  recentEntries: RecentEntry[];
}

const TREND_MONTHS = 12;

export async function getSecondaryAnalysis(
  sb: SupabaseClient,
  context: AccountingDashboardContext,
): Promise<SecondaryAnalysis> {
  const { asOf } = context;
  const ranges = trailingMonthRanges(asOf, TREND_MONTHS);
  const [byMonth, journals] = await Promise.all([
    getMonthlyLedgerBalances(sb, asOf, TREND_MONTHS),
    listJournalEntries(sb, { from: ranges[0].from, to: asOf }),
  ]);

  const counts = new Map<string, number>();
  for (const journal of journals) {
    counts.set(journal.sourceType, (counts.get(journal.sourceType) ?? 0) + 1);
  }

  return {
    trend: monthlyTrend(ranges, byMonth),
    sourceMix: [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([key, count]) => ({ key, label: humanise(key), count })),
    recentEntries: journals.slice(0, 8).map((journal) => ({
      id: journal.id,
      entryNumber: journal.entryNumber,
      entryDate: journal.entryDate,
      description: journal.description || "No description",
      sourceType: humanise(journal.sourceType),
      totalMinor: journal.lines.reduce((sum, line) => sum + Number(line.debitMinor), 0),
      status: journal.isReversal
        ? "Reversal"
        : journal.isReversed
          ? "Reversed"
          : humanise(journal.status),
    })),
  };
}

/**
 * The twelve months, in order, whether or not each one had any postings.
 *
 * The caller asked for a window and gets the whole window back: a quiet month
 * is a zero on the chart, not a gap that shifts every later bar one place to
 * the left. The database returns only months that have rows, deliberately —
 * teaching it which months were asked for would mean teaching it the calendar.
 */
export function monthlyTrend(
  ranges: readonly { key: string; label: string }[],
  byMonth: ReadonlyMap<string, Parameters<typeof buildProfitAndLoss>[0]>,
): TrendPoint[] {
  return ranges.map((range) => {
    const pnl = buildProfitAndLoss(byMonth.get(range.key) ?? []);
    return {
      key: range.key,
      label: range.label,
      incomeMinor: pnl.income.total + pnl.otherIncome.total,
      expenseMinor:
        pnl.costOfGoodsSold.total + pnl.operatingExpenses.total + pnl.otherExpenses.total,
    };
  });
}

function humanise(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}
