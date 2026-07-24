import type { SupabaseClient } from "@supabase/supabase-js";
import { assembleCashFlow, type CashFlowAssembled, type CashFlowCategory } from "@/lib/domain/cashflow";
import { getLedgerBalances } from "./reports";

export class CashFlowError extends Error {}
export type CashFlowReport = CashFlowAssembled;

/** Net cash (bank accounts) as of a date, base minor. bank is debit-normal. */
async function cashAsOf(sb: SupabaseClient, asOf: string): Promise<number> {
  const rows = await getLedgerBalances(sb, null, asOf);
  return rows.filter((r) => r.accountType === "bank").reduce((s, r) => s + (r.debitBase - r.creditBase), 0);
}

function dayBefore(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

export async function getCashFlow(sb: SupabaseClient, from: string, to: string): Promise<CashFlowReport> {
  const { data, error } = await sb.rpc("acc_cash_flow", { p_from: from, p_to: to });
  if (error) throw new CashFlowError(error.message);
  const categories = (data ?? []).map((r: Record<string, unknown>) => ({
    category: r.category as CashFlowCategory,
    amountMinor: Number(r.amount_minor),
  }));
  const [opening, closing] = await Promise.all([cashAsOf(sb, dayBefore(from)), cashAsOf(sb, to)]);
  return assembleCashFlow(categories, opening, closing);
}
