import type { SupabaseClient } from "@supabase/supabase-js";
import { getLedgerBalances } from "./reports";
import { getArAgeing, getApAgeing, type AgeingReport } from "./ageing";
import { buildProfitAndLoss } from "@/lib/domain/reports";

export class DashboardError extends Error {}

export interface DashboardMetrics {
  cashMinor: number;
  overdueArMinor: number;
  overdueApMinor: number;
  unreconciledCount: number;
  unreconciledMinor: number;
  openPastPeriods: number;
  mtdNetIncomeMinor: number;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function monthStart(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

export async function getDashboardMetrics(sb: SupabaseClient): Promise<DashboardMetrics> {
  const asOf = today();
  const [bal, ar, ap, unrecon, periods, mtdRows] = await Promise.all([
    getLedgerBalances(sb, null, asOf),
    getArAgeing(sb, asOf),
    getApAgeing(sb, asOf),
    sb.rpc("acc_unreconciled_bank", { p_as_of: asOf }),
    sb.from("acc_accounting_period").select("id", { count: "exact", head: true }).eq("status", "open").lt("period_end", asOf),
    getLedgerBalances(sb, monthStart(), asOf),
  ]);
  if (unrecon.error) throw new DashboardError(unrecon.error.message);
  if (periods.error) throw new DashboardError(periods.error.message);

  const cashMinor = bal.filter((r) => r.accountType === "bank").reduce((s, r) => s + (r.debitBase - r.creditBase), 0);
  // Overdue = total minus the "current" bucket (current = not yet overdue).
  const overdue = (rep: AgeingReport) =>
    Object.entries(rep.buckets).filter(([k]) => k !== "current").reduce((s, [, v]) => s + v, 0);
  const u = (unrecon.data ?? [])[0] as { item_count: number; amount_minor: number } | undefined;
  const pnl = buildProfitAndLoss(mtdRows);

  return {
    cashMinor,
    overdueArMinor: overdue(ar),
    overdueApMinor: overdue(ap),
    unreconciledCount: Number(u?.item_count ?? 0),
    unreconciledMinor: Number(u?.amount_minor ?? 0),
    openPastPeriods: periods.count ?? 0,
    mtdNetIncomeMinor: pnl.netIncome,
  };
}
