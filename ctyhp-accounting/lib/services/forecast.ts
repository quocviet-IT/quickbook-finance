import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildCashFlowForecast,
  type CashFlowForecast,
  type CashSide,
  type OpenItem,
  type SettlementLagSample,
} from "@/lib/domain/forecast";

export class ForecastError extends Error {}

/** How far back the collection behaviour is learned from. */
export const FORECAST_HISTORY_DAYS = 365;
export const FORECAST_WEEKS = 13;

export interface ForecastOptions {
  asOf?: string;
  weeks?: number;
  historyDays?: number;
}

function isoDaysAgo(asOf: string, days: number): string {
  const date = new Date(`${asOf}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

/**
 * The projection, built from two raw reads: what is still open, and how late
 * settled documents actually were. Both come straight from the ledger, and the
 * arithmetic happens in `lib/domain/forecast.ts`, where it is unit tested.
 */
export async function getCashFlowForecast(
  sb: SupabaseClient,
  options: ForecastOptions = {},
): Promise<CashFlowForecast> {
  const asOf = options.asOf ?? new Date().toISOString().slice(0, 10);
  const historyDays = options.historyDays ?? FORECAST_HISTORY_DAYS;

  const [openRes, lagRes] = await Promise.all([
    sb.rpc("acc_open_items", { p_as_of: asOf }),
    sb.rpc("acc_settlement_lag", { p_since: isoDaysAgo(asOf, historyDays) }),
  ]);
  if (openRes.error) throw new ForecastError(openRes.error.message);
  if (lagRes.error) throw new ForecastError(lagRes.error.message);

  const openItems: OpenItem[] = ((openRes.data ?? []) as Record<string, unknown>[]).map((row) => ({
    side: row.side as CashSide,
    documentId: row.document_id as string,
    documentNumber: (row.document_number as string | null) ?? null,
    partyName: (row.party_name as string | null) ?? "—",
    dueDate: row.due_date as string,
    balanceMinor: Number(row.balance_minor),
  }));

  const lagSamples: SettlementLagSample[] = ((lagRes.data ?? []) as Record<string, unknown>[]).map(
    (row) => ({
      side: row.side as CashSide,
      dueDate: row.due_date as string,
      settledOn: row.settled_on as string,
      amountMinor: Number(row.amount_minor),
    }),
  );

  return buildCashFlowForecast({
    asOf,
    weeks: options.weeks ?? FORECAST_WEEKS,
    openItems,
    lagSamples,
  });
}

/** The open items behind the projection, for the drill-down under the chart. */
export async function listOpenItems(
  sb: SupabaseClient,
  asOf?: string,
): Promise<OpenItem[]> {
  const { data, error } = await sb.rpc("acc_open_items", { p_as_of: asOf ?? null });
  if (error) throw new ForecastError(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    side: row.side as CashSide,
    documentId: row.document_id as string,
    documentNumber: (row.document_number as string | null) ?? null,
    partyName: (row.party_name as string | null) ?? "—",
    dueDate: row.due_date as string,
    balanceMinor: Number(row.balance_minor),
  }));
}
