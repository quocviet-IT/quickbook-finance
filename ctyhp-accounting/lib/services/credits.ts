import type { SupabaseClient } from "@supabase/supabase-js";
import type { CreditMemoRow, VendorCreditRow } from "@/lib/db/types";
import { computeInvoiceLine } from "@/lib/domain/money";
import type {
  CreditMemoCreateInput,
  VendorCreditCreateInput,
  CreditAllocationInput,
  CustomerRefundInput,
  WriteOffInput,
} from "@/lib/domain/schemas";

export class CreditsError extends Error {}

// --- Credit memo (AR) ---
export async function createCreditMemo(sb: SupabaseClient, input: CreditMemoCreateInput): Promise<string> {
  // Tax rate is resolved from the tax code server-side (never trust the client),
  // then line + document totals are computed once from the resolved rates.
  const rates = await taxRates(sb, input.lines.map((l) => l.tax_code_id).filter(Boolean) as string[]);
  const memoRows = input.lines.map((l) => ({
    l,
    a: computeInvoiceLine({
      quantity: l.quantity,
      unitPriceMinor: l.unit_price_minor,
      taxRatePercent: l.tax_code_id ? (rates[l.tax_code_id] ?? 0) : 0,
    }),
  }));
  const subtotal = memoRows.reduce((s, r) => s + r.a.subtotalMinor, 0);
  const tax = memoRows.reduce((s, r) => s + r.a.taxMinor, 0);
  const total = subtotal + tax;

  const ins = await sb
    .from("acc_credit_memo")
    .insert({
      customer_id: input.customer_id,
      currency_code: input.currency_code,
      memo_date: input.memo_date || undefined,
      reason: input.reason || null,
      memo: input.memo || null,
      subtotal_minor: subtotal,
      tax_total_minor: tax,
      total_minor: total,
      balance_remaining_minor: 0,
      status: "draft",
    })
    .select("id")
    .single();
  if (ins.error) throw new CreditsError(ins.error.message);
  const id = (ins.data as { id: string }).id;

  const lineRows = memoRows.map((r, i) => ({
    credit_memo_id: id,
    line_order: i,
    description: r.l.description ?? "",
    quantity: r.l.quantity,
    unit_price_minor: r.l.unit_price_minor,
    income_account_id: r.l.income_account_id,
    tax_code_id: r.l.tax_code_id || null,
    line_subtotal_minor: r.a.subtotalMinor,
    line_tax_minor: r.a.taxMinor,
    line_total_minor: r.a.totalMinor,
  }));
  const lineIns = await sb.from("acc_credit_memo_line").insert(lineRows);
  if (lineIns.error) throw new CreditsError(lineIns.error.message);

  const rpc = await sb.rpc("acc_issue_credit_memo", { p_credit_memo_id: id });
  if (rpc.error) throw new CreditsError(rpc.error.message);
  return id;
}

async function taxRates(sb: SupabaseClient, ids: string[]): Promise<Record<string, number>> {
  if (ids.length === 0) return {};
  const { data, error } = await sb.from("acc_tax_code").select("id,rate_percent").in("id", ids);
  if (error) throw new CreditsError(error.message);
  const out: Record<string, number> = {};
  for (const r of data ?? []) out[(r as { id: string }).id] = Number((r as { rate_percent: number }).rate_percent);
  return out;
}

export async function applyCreditMemo(
  sb: SupabaseClient,
  creditMemoId: string,
  allocations: CreditAllocationInput[],
): Promise<void> {
  const { error } = await sb.rpc("acc_apply_credit_memo", {
    p_credit_memo_id: creditMemoId,
    p_allocations: allocations.map((a) => ({ invoice_id: a.target_id, amount_minor: a.amount_minor })),
  });
  if (error) throw new CreditsError(error.message);
}

export async function voidCreditMemo(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.rpc("acc_void_credit_memo", { p_credit_memo_id: id });
  if (error) throw new CreditsError(error.message);
}

export async function listCreditMemos(sb: SupabaseClient): Promise<CreditMemoRow[]> {
  const { data, error } = await sb
    .from("acc_credit_memo")
    .select(
      "id,credit_memo_number,customer_id,memo_date,currency_code,subtotal_minor,tax_total_minor,total_minor,balance_remaining_minor,status,reason,memo",
    )
    .order("created_at", { ascending: false });
  if (error) throw new CreditsError(error.message);
  return (data ?? []) as unknown as CreditMemoRow[];
}

export async function listOpenInvoices(sb: SupabaseClient, customerId: string, currency: string) {
  const { data, error } = await sb
    .from("acc_invoice")
    .select("id,invoice_number,balance_due_minor")
    .eq("customer_id", customerId)
    .eq("currency_code", currency)
    .in("status", ["issued", "partial"])
    .gt("balance_due_minor", 0)
    .order("issue_date");
  if (error) throw new CreditsError(error.message);
  return (data ?? []) as unknown as { id: string; invoice_number: string; balance_due_minor: number }[];
}

// --- Vendor credit (AP) ---
export async function createVendorCredit(sb: SupabaseClient, input: VendorCreditCreateInput): Promise<string> {
  const total = input.lines.reduce((s, l) => s + l.amount_minor, 0);
  const ins = await sb
    .from("acc_vendor_credit")
    .insert({
      vendor_id: input.vendor_id,
      currency_code: input.currency_code,
      credit_date: input.credit_date || undefined,
      vendor_ref: input.vendor_ref || null,
      reason: input.reason || null,
      memo: input.memo || null,
      total_minor: total,
      balance_remaining_minor: 0,
      status: "draft",
    })
    .select("id")
    .single();
  if (ins.error) throw new CreditsError(ins.error.message);
  const id = (ins.data as { id: string }).id;
  const lineRows = input.lines.map((l, i) => ({
    vendor_credit_id: id,
    line_order: i,
    description: l.description ?? "",
    expense_account_id: l.expense_account_id,
    amount_minor: l.amount_minor,
  }));
  const lineIns = await sb.from("acc_vendor_credit_line").insert(lineRows);
  if (lineIns.error) throw new CreditsError(lineIns.error.message);
  const rpc = await sb.rpc("acc_issue_vendor_credit", { p_vendor_credit_id: id });
  if (rpc.error) throw new CreditsError(rpc.error.message);
  return id;
}

export async function applyVendorCredit(
  sb: SupabaseClient,
  vendorCreditId: string,
  allocations: CreditAllocationInput[],
): Promise<void> {
  const { error } = await sb.rpc("acc_apply_vendor_credit", {
    p_vendor_credit_id: vendorCreditId,
    p_allocations: allocations.map((a) => ({ bill_id: a.target_id, amount_minor: a.amount_minor })),
  });
  if (error) throw new CreditsError(error.message);
}

export async function voidVendorCredit(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.rpc("acc_void_vendor_credit", { p_vendor_credit_id: id });
  if (error) throw new CreditsError(error.message);
}

export async function listVendorCredits(sb: SupabaseClient): Promise<VendorCreditRow[]> {
  const { data, error } = await sb
    .from("acc_vendor_credit")
    .select(
      "id,vendor_credit_number,vendor_id,credit_date,currency_code,total_minor,balance_remaining_minor,status,vendor_ref,reason,memo",
    )
    .order("created_at", { ascending: false });
  if (error) throw new CreditsError(error.message);
  return (data ?? []) as unknown as VendorCreditRow[];
}

export async function listOpenBills(sb: SupabaseClient, vendorId: string, currency: string) {
  const { data, error } = await sb
    .from("acc_bill")
    .select("id,bill_number,balance_due_minor")
    .eq("vendor_id", vendorId)
    .eq("currency_code", currency)
    .in("status", ["open", "partial"])
    .gt("balance_due_minor", 0)
    .order("bill_date");
  if (error) throw new CreditsError(error.message);
  return (data ?? []) as unknown as { id: string; bill_number: string; balance_due_minor: number }[];
}

// --- Refund + write-off ---
export async function recordCustomerRefund(sb: SupabaseClient, input: CustomerRefundInput): Promise<string> {
  const { data, error } = await sb.rpc("acc_record_customer_refund", {
    p_customer_id: input.customer_id,
    p_refund_date: input.refund_date || undefined,
    p_currency: input.currency_code,
    p_amount_minor: input.amount_minor,
    p_source_type: input.source_type,
    p_payment_id: input.payment_id || null,
    p_credit_memo_id: input.credit_memo_id || null,
    p_bank_account_id: input.bank_account_id,
    p_memo: input.memo || null,
  });
  if (error) throw new CreditsError(error.message);
  return data as string;
}

export async function voidCustomerRefund(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.rpc("acc_void_customer_refund", { p_refund_id: id });
  if (error) throw new CreditsError(error.message);
}

export async function writeOff(sb: SupabaseClient, input: WriteOffInput): Promise<string> {
  const { data, error } = await sb.rpc("acc_write_off", {
    p_side: input.side,
    p_target_id: (input.invoice_id ?? input.bill_id) as string,
    p_offset_account_id: input.offset_account_id,
    p_amount_minor: input.amount_minor,
    p_date: input.write_off_date || undefined,
    p_reason: input.reason,
  });
  if (error) throw new CreditsError(error.message);
  return data as string;
}

export async function voidWriteOff(sb: SupabaseClient, id: string): Promise<void> {
  const { error } = await sb.rpc("acc_void_write_off", { p_write_off_id: id });
  if (error) throw new CreditsError(error.message);
}
