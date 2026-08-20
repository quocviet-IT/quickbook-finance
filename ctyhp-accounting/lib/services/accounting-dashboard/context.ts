import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentCompanySettings } from "@/lib/services/company";
import { fiscalYearForDate } from "@/lib/domain/fiscal";
import { todayInTimeZone } from "@/lib/services/dashboard";

export class AccountingDashboardError extends Error {}

export interface AccountingPeriodRow {
  id: string;
  label: string;
  periodStart: string;
  periodEnd: string;
  status: string;
}

export interface AccountingDashboardContext {
  asOf: string;
  currencyCode: string;
  currencyDecimals: number;
  timeZone: string;
  accountingBasis: string;
  fiscalYear: number;
  periods: AccountingPeriodRow[];
  /** The period `asOf` falls inside, when one is defined. */
  currentPeriod: AccountingPeriodRow | null;
  /** Open periods whose last covered day has passed. */
  overduePeriods: AccountingPeriodRow[];
}

/**
 * The frame every other section hangs on: which day the dashboard speaks for,
 * in which currency, and which accounting periods exist around it.
 *
 * This is the one section that must succeed — without a date there is nothing
 * to compute anything else against — so it is deliberately cheap: company
 * settings and one period query, no ledger reads.
 */
export async function getAccountingContext(
  sb: SupabaseClient,
): Promise<AccountingDashboardContext> {
  const company = await getCurrentCompanySettings(sb);
  const timeZone = company?.time_zone ?? "America/New_York";
  const asOf = todayInTimeZone(timeZone);
  const fiscalYear = fiscalYearForDate(asOf, company?.fiscal_year_start_month ?? 1);

  const { data, error } = await sb
    .from("acc_accounting_period")
    .select("id,label,period_start,period_end,status")
    .eq("fiscal_year", fiscalYear)
    .order("period_month");
  if (error) throw new AccountingDashboardError(error.message);

  const periods: AccountingPeriodRow[] = (data ?? []).map((row) => ({
    id: String(row.id),
    label: String(row.label),
    periodStart: String(row.period_start),
    periodEnd: String(row.period_end),
    status: String(row.status),
  }));

  return {
    asOf,
    currencyCode: "USD",
    currencyDecimals: 2,
    timeZone,
    accountingBasis: "Accrual basis",
    fiscalYear,
    periods,
    currentPeriod:
      periods.find((p) => p.periodStart <= asOf && asOf <= p.periodEnd) ?? null,
    overduePeriods: periods.filter((p) => p.status === "open" && p.periodEnd < asOf),
  };
}
