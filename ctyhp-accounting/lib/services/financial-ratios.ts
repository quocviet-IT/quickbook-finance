import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildFinancialRatios,
  buildRatioWorkings,
  yearEarlierRange,
  type FinancialRatiosReport,
  type RatioWorkings,
} from "@/lib/domain/financial-ratios";
import { getInventoryAccounts } from "./inventory-accounts";
import { getLedgerBalances } from "./reports";

/** The workings for one period: balances cumulative to the To date, flows over From to To. */
async function workingsFor(
  sb: SupabaseClient,
  from: string,
  to: string,
  inventoryAccountIds: ReadonlySet<string>,
): Promise<RatioWorkings> {
  const [balances, flow] = await Promise.all([getLedgerBalances(sb, null, to), getLedgerBalances(sb, from, to)]);
  return buildRatioWorkings({ balances, flow, inventoryAccountIds, from, to });
}

/**
 * Financial Ratios for From to To and for the same dates a year earlier. Reads
 * the same ledger balances the Balance Sheet and the Profit and Loss read, so
 * the workings agree with both. Read-only.
 */
export async function getFinancialRatios(sb: SupabaseClient, from: string, to: string): Promise<FinancialRatiosReport> {
  const inventory = new Set((await getInventoryAccounts(sb)).accountIds);
  const earlierRange = yearEarlierRange(from, to);
  const [current, earlier] = await Promise.all([
    workingsFor(sb, from, to, inventory),
    workingsFor(sb, earlierRange.from, earlierRange.to, inventory),
  ]);
  return buildFinancialRatios({ from, to, current, earlier });
}
