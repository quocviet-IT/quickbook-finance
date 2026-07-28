import type { SupabaseClient } from "@supabase/supabase-js";
import type { CreditMemoRow, VendorCreditRow } from "@/lib/db/types";
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
  const { data, error } = await sb.rpc("acc_create_and_issue_credit_memo", {
    p_customer_id: input.customer_id,
    p_memo_date: input.memo_date || null,
    p_currency: input.currency_code,
    p_reason: input.reason || null,
    p_memo: input.memo || null,
    p_lines: input.lines,
  });
  if (error) throw new CreditsError(error.message);
  return data as string;
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
  const { data, error } = await sb.rpc("acc_create_and_issue_vendor_credit", {
    p_vendor_id: input.vendor_id,
    p_credit_date: input.credit_date || null,
    p_currency: input.currency_code,
    p_vendor_ref: input.vendor_ref || null,
    p_reason: input.reason || null,
    p_memo: input.memo || null,
    p_lines: input.lines,
  });
  if (error) throw new CreditsError(error.message);
  return data as string;
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
