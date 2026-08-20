import type { SupabaseClient } from "@supabase/supabase-js";
import {
  composeAccountingDashboard,
  type AccountingDashboardData,
  type AccountingDashboardSections,
} from "./compose";
import { getAccountingContext } from "./context";
import { getAccountingControls } from "./controls";
import { getAccountingWorkQueue } from "./work-queue";
import { getSecondaryAnalysis } from "./secondary-analysis";

export type {
  AccountingDashboardData,
  AccountingDashboardSections,
} from "./compose";
export type { AccountingDashboardContext, AccountingPeriodRow } from "./context";
export type { SecondaryAnalysis } from "./secondary-analysis";

/** Which service fills each slot. The rule for surviving a failure is in compose.ts. */
export const DEFAULT_SECTIONS: AccountingDashboardSections = {
  context: getAccountingContext,
  controls: getAccountingControls,
  queue: getAccountingWorkQueue,
  secondary: getSecondaryAnalysis,
};

export function getAccountingDashboard(
  sb: SupabaseClient,
  sections: AccountingDashboardSections = DEFAULT_SECTIONS,
): Promise<AccountingDashboardData> {
  return composeAccountingDashboard(sb, sections);
}
