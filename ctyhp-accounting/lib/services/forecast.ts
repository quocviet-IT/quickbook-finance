import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addDays,
  buildCashForecast,
  expandRecurring,
  FORECAST_WEEKS,
  type CashForecast,
  type CashSide,
  type OpenItem,
  type RecurringExpansion,
  type RecurringTemplateInput,
  type SettlementLagSample,
} from "@/lib/domain/forecast";
import { readAllPages } from "./paging";
import { getLedgerBalances } from "./reports";

export class ForecastError extends Error {}

/** How far back the collection behaviour is learned from. */
export const FORECAST_HISTORY_DAYS = 365;

export interface CashForecastData {
  today: string;
  /** Cash in the `bank` accounts today, base currency minor units. */
  openingMinor: number;
  /** By due date, and as they usually pay. Same inputs, one switch apart. */
  due: CashForecast;
  usual: CashForecast;
  /** Every open invoice and bill, for the drill-down under the table. */
  openItems: OpenItem[];
  recurring: RecurringExpansion;
}

const fail = (message: string) => new ForecastError(message);

function openItemFromRow(row: Record<string, unknown>): OpenItem {
  return {
    side: row.side as CashSide,
    documentId: row.document_id as string,
    documentNumber: (row.document_number as string | null) ?? null,
    partyName: (row.party_name as string | null) ?? "—",
    dueDate: String(row.due_date).slice(0, 10),
    balanceMinor: Number(row.balance_minor),
  };
}

/**
 * Every open invoice and bill on a day, past PostgREST's thousand-row cap.
 * Paged in (side, document_id) order, which is total: a document id is unique
 * within its side, so no row can straddle a page boundary and shift.
 */
export async function listOpenItems(sb: SupabaseClient, asOf: string): Promise<OpenItem[]> {
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) =>
      sb.rpc("acc_open_items", { p_as_of: asOf }).order("side").order("document_id").range(from, to),
    fail,
  );
  return rows.map(openItemFromRow);
}

async function listLagSamples(sb: SupabaseClient, asOf: string): Promise<SettlementLagSample[]> {
  const since = addDays(asOf, -FORECAST_HISTORY_DAYS);
  const rows = await readAllPages<Record<string, unknown>>(
    // The RPC has no id, so order by every column. Rows tied on all four are
    // identical, so a reorder among them across a page boundary changes nothing.
    (from, to) =>
      sb
        .rpc("acc_settlement_lag", { p_since: since })
        .order("side")
        .order("due_date")
        .order("settled_on")
        .order("amount_minor")
        .range(from, to),
    fail,
  );
  return rows.map((row) => ({
    side: row.side as CashSide,
    dueDate: String(row.due_date).slice(0, 10),
    settledOn: String(row.settled_on).slice(0, 10),
    amountMinor: Number(row.amount_minor),
  }));
}

/** The ids of every `bank` account: the cash the forecast starts from. */
async function listBankAccountIds(sb: SupabaseClient): Promise<Set<string>> {
  const rows = await readAllPages<{ id: string }>(
    (from, to) => sb.from("acc_account").select("id").eq("account_type", "bank").order("id").range(from, to),
    fail,
  );
  return new Set(rows.map((row) => row.id));
}

export async function listActiveRecurringTemplates(sb: SupabaseClient): Promise<RecurringTemplateInput[]> {
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) =>
      sb
        .from("acc_recurring_template")
        .select("id,name,document_type,frequency,interval_count,start_date,next_run_date,end_date,payload,total_minor,status")
        .eq("status", "active")
        .order("next_run_date")
        .order("name")
        .order("id")
        .range(from, to),
    fail,
  );
  return rows.map((row) => ({
    id: row.id as string,
    name: row.name as string,
    documentType: row.document_type as RecurringTemplateInput["documentType"],
    frequency: row.frequency as RecurringTemplateInput["frequency"],
    intervalCount: Number(row.interval_count) || 1,
    startDate: String(row.start_date).slice(0, 10),
    nextRunDate: String(row.next_run_date).slice(0, 10),
    endDate: row.end_date ? String(row.end_date).slice(0, 10) : null,
    status: row.status as RecurringTemplateInput["status"],
    totalMinor: Number(row.total_minor) || 0,
    payload: (row.payload as Record<string, unknown> | null) ?? {},
  }));
}

/**
 * The 13 Week Cash Forecast: cash in the bank accounts today, the open invoices
 * and bills, how late similar documents were settled, and the active recurring
 * templates. All reads; the arithmetic is in `lib/domain/forecast.ts`.
 */
export async function getCashForecast(
  sb: SupabaseClient,
  options: { today: string; baseCurrency: string; weeks?: number },
): Promise<CashForecastData> {
  const { today, baseCurrency } = options;
  const weeks = options.weeks ?? FORECAST_WEEKS;
  const [balances, bankIds, openItems, lagSamples, templates] = await Promise.all([
    getLedgerBalances(sb, null, today),
    listBankAccountIds(sb),
    listOpenItems(sb, today),
    listLagSamples(sb, today),
    listActiveRecurringTemplates(sb),
  ]);

  const openingMinor = balances
    .filter((row) => row.accountType === "bank")
    .reduce((sum, row) => sum + row.debitBase - row.creditBase, 0);
  const horizonEnd = addDays(today, weeks * 7 - 1);
  const recurring = expandRecurring({ templates, today, horizonEnd, bankAccountIds: bankIds, baseCurrency });

  const build = (mode: "due" | "usual") =>
    buildCashForecast({ today, mode, openingMinor, openItems, lagSamples, recurring, weeks });
  return { today, openingMinor, due: build("due"), usual: build("usual"), openItems, recurring };
}
