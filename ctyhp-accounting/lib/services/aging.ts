// lib/services/aging.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import { NO_MEMO, type RequestMemo } from "./request-memo";
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

async function controlBalance(
  sb: SupabaseClient,
  accountType: string,
  asOf: string,
  memo: RequestMemo,
): Promise<number> {
  // Net (debit - credit) of the control account(s) of the given type, base currency.
  //
  // This reads the whole ledger balance table to net one account type, and a
  // caller asking for both ageing reports asks for the identical read twice.
  // The memo is how a caller that knows it is doing that says so; on its own
  // this function still behaves exactly as it did.
  const data = await memo(`ledger:null:${asOf}`, async () => {
    const answer = await sb.rpc("acc_ledger_balances", { p_from: null, p_to: asOf });
    if (answer.error) throw new AgingError(answer.error.message);
    return (answer.data ?? []) as Record<string, unknown>[];
  });
  return (data ?? [])
    .filter((r: Record<string, unknown>) => r.account_type === accountType)
    .reduce((s: number, r: Record<string, unknown>) => s + (Number(r.debit_base) - Number(r.credit_base)), 0);
}

export interface AgingOptions {
  /**
   * Collapses the repeated control-account read when one caller asks for both
   * reports in the same request. Omitted, nothing is shared and behaviour is
   * exactly what it was.
   */
  memo?: RequestMemo;
  /**
   * The day the control account is netted at.
   *
   * Defaults to the server's UTC date, which is what every caller got before
   * this existed. That default is subtly wrong for a company that is not on
   * UTC: for America/New_York it rolls over at 8pm local, so an evening reader
   * reconciles against a balance dated tomorrow in their own terms. It survived
   * because the two figures are equal unless somebody post-dated an entry.
   *
   * A caller that knows which day it is speaking for should say so — the
   * accounting dashboard passes its own `asOf`, which is the company's today in
   * the company's timezone, so every figure on that page shares one date.
   */
  reconcileAsOf?: string;
}

async function aging(sb: SupabaseClient, rpc: string, asOf: string, idKey: string, nameKey: string, accountType: string, options: AgingOptions): Promise<AgingReport> {
  const memo = options.memo ?? NO_MEMO;
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
  const today = options.reconcileAsOf ?? new Date().toISOString().slice(0, 10);
  const control = await controlBalance(sb, accountType, today, memo);
  // AR control net is debit-positive; AP control net is credit-positive (so negate).
  const controlBalanceMinor = accountType === "accounts_receivable" ? control : -control;
  return { rows, buckets, total, controlBalanceMinor, reconciled: total === controlBalanceMinor };
}

export function getArAging(sb: SupabaseClient, asOf: string, options: AgingOptions = {}): Promise<AgingReport> {
  return aging(sb, "acc_ar_ageing", asOf, "customer_id", "customer_name", "accounts_receivable", options);
}
export function getApAging(sb: SupabaseClient, asOf: string, options: AgingOptions = {}): Promise<AgingReport> {
  return aging(sb, "acc_ap_ageing", asOf, "vendor_id", "vendor_name", "accounts_payable", options);
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

// --- Allowance for doubtful accounts -----------------------------------------

export interface AfdaBucket {
  bucketKey: string;
  balanceMinor: number;
  rateBps: number;
  requiredMinor: number;
}

export interface AfdaEvaluation {
  asOf: string;
  buckets: AfdaBucket[];
  /** What the aging says the reserve should be. */
  requiredMinor: number;
  /** What is already carried in 1190. */
  carriedMinor: number;
  /** The entry that would post: positive tops up, negative releases. */
  adjustmentMinor: number;
}

/**
 * The reserve the aging implies, beside the reserve already carried.
 *
 * Both numbers come from the database — the buckets from `acc_afda_evaluation`,
 * which cuts them exactly as this report does, and the carried balance from the
 * ledger — so the screen cannot quote a figure the posting would disagree with.
 */
export async function getAfdaEvaluation(sb: SupabaseClient, asOf: string): Promise<AfdaEvaluation> {
  const [{ data: rows, error }, { data: carried, error: carriedError }] = await Promise.all([
    sb.rpc("acc_afda_evaluation", { p_as_of: asOf }),
    sb.rpc("acc_afda_balance", { p_as_of: asOf }),
  ]);
  if (error) throw new AgingError(error.message);
  if (carriedError) throw new AgingError(carriedError.message);

  const buckets: AfdaBucket[] = ((rows ?? []) as Record<string, unknown>[]).map((r) => ({
    bucketKey: r.bucket_key as string,
    balanceMinor: Number(r.balance_minor),
    rateBps: Number(r.rate_bps),
    requiredMinor: Number(r.required_minor),
  }));
  const requiredMinor = buckets.reduce((sum, b) => sum + b.requiredMinor, 0);
  const carriedMinor = Number(carried ?? 0);
  return { asOf, buckets, requiredMinor, carriedMinor, adjustmentMinor: requiredMinor - carriedMinor };
}

/** Post the difference between the carried allowance and the computed one. */
export async function postAfdaAdjustment(
  sb: SupabaseClient,
  asOf: string,
  memo: string | null,
): Promise<{ entryId: string; requiredMinor: number; adjustmentMinor: number }> {
  const { data, error } = await sb.rpc("acc_post_afda_adjustment", { p_as_of: asOf, p_memo: memo });
  if (error) throw new AgingError(error.message);
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown>;
  return {
    entryId: row.journal_entry_id as string,
    requiredMinor: Number(row.required_minor),
    adjustmentMinor: Number(row.adjustment_minor),
  };
}
