import type { SupabaseClient } from "@supabase/supabase-js";
import { listJournalEntries } from "@/lib/services/journal";
import { getDashboardAnalytics } from "@/lib/services/dashboard";
import { trailingMonthWindows } from "@/lib/domain/work-area-overview";
import type { AccountingDashboardContext } from "./context";

/**
 * The analysis an accountant reaches for *after* the work — trends, where the
 * journals came from, what happened lately.
 *
 * This section is the expensive one: twelve months of journal entries and the
 * whole dashboard analytics bundle. That is exactly why it is a section of its
 * own. It is fetched last, rendered collapsed, and when it fails the queue and
 * the controls above it do not even notice.
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

export async function getSecondaryAnalysis(
  sb: SupabaseClient,
  context: AccountingDashboardContext,
): Promise<SecondaryAnalysis> {
  const { asOf } = context;
  const [analytics, journals] = await Promise.all([
    getDashboardAnalytics(sb, asOf),
    listJournalEntries(sb, { from: trailingMonthWindows(asOf, 12)[0].from, to: asOf }),
  ]);

  const counts = new Map<string, number>();
  for (const journal of journals) {
    counts.set(journal.sourceType, (counts.get(journal.sourceType) ?? 0) + 1);
  }

  return {
    trend: analytics.monthlyPerformance.map((point) => ({
      key: point.key,
      label: point.label,
      incomeMinor: point.incomeMinor,
      expenseMinor: point.expenseMinor,
    })),
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

function humanise(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}
