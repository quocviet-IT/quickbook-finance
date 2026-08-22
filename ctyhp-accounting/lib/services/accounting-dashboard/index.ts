import type { SupabaseClient } from "@supabase/supabase-js";
import {
  composeAccountingDashboard,
  type AccountingDashboardData,
  type AccountingDashboardSections,
  type DashboardMode,
} from "./compose";
import { getAccountingContext } from "./context";
import { getAccountingControls } from "./controls";
import { getAccountingWorkQueue } from "./work-queue";
import { getSecondaryAnalysis } from "./secondary-analysis";
import { listWorkItemState, retireWorkItems } from "./work-item-state";
import { getWorkPolicy } from "@/lib/services/work-policy";
import { getAccountingInsights } from "./insights";
import { getCloseReadiness } from "./close-readiness";

export type {
  AccountingDashboardData,
  AccountingDashboardSections,
  DashboardMode,
} from "./compose";
export type { AccountingDashboardContext, AccountingPeriodRow } from "./context";
export type { SecondaryAnalysis } from "./secondary-analysis";
export type { InsightSection } from "./insights";
export type { CloseReadiness } from "./close-readiness";

/** Which service fills each slot. The rule for surviving a failure is in compose.ts. */
export const DEFAULT_SECTIONS: AccountingDashboardSections = {
  context: getAccountingContext,
  controls: getAccountingControls,
  queue: getAccountingWorkQueue,
  secondary: getSecondaryAnalysis,
  workState: listWorkItemState,
  retire: retireWorkItems,
  policy: getWorkPolicy,
  insights: getAccountingInsights,
  close: getCloseReadiness,
};

export function getAccountingDashboard(
  sb: SupabaseClient,
  mode: DashboardMode = "daily",
  sections: AccountingDashboardSections = DEFAULT_SECTIONS,
): Promise<AccountingDashboardData> {
  return composeAccountingDashboard(sb, sections, mode);
}
