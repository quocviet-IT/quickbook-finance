import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountType } from "@/lib/domain/accounts";
import { chartFigures, fiscalYearStartFor } from "@/lib/domain/chart-groups";
import { readAllPages } from "./paging";
import { getCurrentCompanySettings } from "./company";
import { getInventoryAccounts } from "./inventory-accounts";
import { getLedgerBalances } from "./reports";

export class ChartBalancesError extends Error {}

/** What the Chart of Accounts shows beside each account. Reads only. */
export interface ChartBalances {
  asOf: string;
  /** The first day of the fiscal year containing `asOf`: where profit and loss figures begin. */
  fiscalYearStart: string;
  /** Natural balance in base-currency minor units, by account id. */
  figures: Record<string, number>;
  /** The accounts the Inventory group is made of. */
  inventoryAccountIds: string[];
}

/**
 * Every account's figure at `asOf`: balance sheet accounts from the start of
 * the books, profit and loss accounts from the fiscal year start. Both ledger
 * reads and the account read page past PostgREST's 1,000-row cap.
 */
export async function getChartBalances(sb: SupabaseClient, asOf: string): Promise<ChartBalances> {
  const settings = await getCurrentCompanySettings(sb);
  const fiscalYearStart = fiscalYearStartFor(asOf, settings?.fiscal_year_start_month ?? 1);
  const [accounts, inventory, sheet, pnl] = await Promise.all([
    readAllPages<{ id: string; account_type: AccountType; is_contra: boolean }>(
      (from, to) => sb.from("acc_account").select("id,account_type,is_contra").order("id").range(from, to),
      (message) => new ChartBalancesError(message),
    ),
    getInventoryAccounts(sb),
    getLedgerBalances(sb, null, asOf),
    getLedgerBalances(sb, fiscalYearStart, asOf),
  ]);
  return {
    asOf,
    fiscalYearStart,
    figures: chartFigures(accounts, sheet, pnl),
    inventoryAccountIds: inventory.accountIds,
  };
}
