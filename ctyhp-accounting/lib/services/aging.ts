// lib/services/aging.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeAging, bucketOf, type AgingItem } from "@/lib/domain/aging";

export class AgingError extends Error {}

export interface AgingReportRow {
  entityId: string; entityName: string; docType: string; docNumber: string | null;
  docDate: string; dueDate: string; balanceMinor: number; bucket: string;
}
export interface AgingReport {
  rows: AgingReportRow[];
  buckets: Record<string, number>;
  total: number;
  controlBalanceMinor: number;
  reconciled: boolean;
}

async function controlBalance(sb: SupabaseClient, accountType: string, asOf: string): Promise<number> {
  // Net (debit - credit) of the control account(s) of the given type, base currency.
  const { data, error } = await sb.rpc("acc_ledger_balances", { p_from: null, p_to: asOf });
  if (error) throw new AgingError(error.message);
  return (data ?? [])
    .filter((r: Record<string, unknown>) => r.account_type === accountType)
    .reduce((s: number, r: Record<string, unknown>) => s + (Number(r.debit_base) - Number(r.credit_base)), 0);
}

async function aging(sb: SupabaseClient, rpc: string, asOf: string, idKey: string, nameKey: string, accountType: string): Promise<AgingReport> {
  const { data, error } = await sb.rpc(rpc, { p_as_of: asOf });
  if (error) throw new AgingError(error.message);
  const rows: AgingReportRow[] = (data ?? []).map((r: Record<string, unknown>) => ({
    entityId: r[idKey] as string, entityName: r[nameKey] as string, docType: r.doc_type as string,
    docNumber: (r.doc_number as string) ?? null, docDate: r.doc_date as string, dueDate: r.due_date as string,
    balanceMinor: Number(r.balance_minor), bucket: bucketOf(r.due_date as string, asOf),
  }));
  const items: AgingItem[] = rows.map((r) => ({ dueDate: r.dueDate, balanceMinor: r.balanceMinor }));
  const { buckets, total } = computeAging(items, asOf);
  // The aging total is the CURRENT (base-currency) open position; `asOf` only
  // drives bucket assignment, so reconcile against the control account as of
  // today, not as of the (possibly past) as-of date.
  const today = new Date().toISOString().slice(0, 10);
  const control = await controlBalance(sb, accountType, today);
  // AR control net is debit-positive; AP control net is credit-positive (so negate).
  const controlBalanceMinor = accountType === "accounts_receivable" ? control : -control;
  return { rows, buckets, total, controlBalanceMinor, reconciled: total === controlBalanceMinor };
}

export function getArAging(sb: SupabaseClient, asOf: string): Promise<AgingReport> {
  return aging(sb, "acc_ar_ageing", asOf, "customer_id", "customer_name", "accounts_receivable");
}
export function getApAging(sb: SupabaseClient, asOf: string): Promise<AgingReport> {
  return aging(sb, "acc_ap_ageing", asOf, "vendor_id", "vendor_name", "accounts_payable");
}

export interface StatementRow { txnDate: string; docType: string; docNumber: string | null; amountMinor: number; runningMinor: number; }
export interface StatementReport { openingMinor: number; rows: StatementRow[]; closingMinor: number; }

async function statement(sb: SupabaseClient, rpc: string, idParam: string, entityId: string, from: string, to: string, agingRpc: string, asOfIdField: string): Promise<StatementReport> {
  // Opening balance = the entity's open balance strictly before `from`, derived by
  // running the aging RPC as of the day before `from` and summing this entity's items.
  const dayBefore = shiftBack(from);
  const openRes = await sb.rpc(agingRpc, { p_as_of: dayBefore });
  if (openRes.error) throw new AgingError(openRes.error.message);
  const openingMinor = (openRes.data ?? [])
    .filter((r: Record<string, unknown>) => r[asOfIdField] === entityId)
    .reduce((s: number, r: Record<string, unknown>) => s + Number(r.balance_minor), 0);

  const { data, error } = await sb.rpc(rpc, { [idParam]: entityId, p_from: from, p_to: to } as Record<string, unknown>);
  if (error) throw new AgingError(error.message);
  let running = openingMinor;
  const rows: StatementRow[] = (data ?? []).map((r: Record<string, unknown>) => {
    running += Number(r.amount_minor);
    return { txnDate: r.txn_date as string, docType: r.doc_type as string, docNumber: (r.doc_number as string) ?? null, amountMinor: Number(r.amount_minor), runningMinor: running };
  });
  return { openingMinor, rows, closingMinor: running };
}

export function getCustomerStatement(sb: SupabaseClient, customerId: string, from: string, to: string): Promise<StatementReport> {
  return statement(sb, "acc_customer_statement", "p_customer_id", customerId, from, to, "acc_ar_ageing", "customer_id");
}
export function getVendorStatement(sb: SupabaseClient, vendorId: string, from: string, to: string): Promise<StatementReport> {
  return statement(sb, "acc_vendor_statement", "p_vendor_id", vendorId, from, to, "acc_ap_ageing", "vendor_id");
}

function shiftBack(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}
