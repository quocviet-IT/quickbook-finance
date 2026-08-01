import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  VendorRow,
  BillRow,
  BillLineRow,
  ExpenseRow,
  ExpenseLineRow,
  BillPaymentRow,
} from "@/lib/db/types";
import type {
  VendorCreateInput,
  BillCreateInput,
  ExpenseCreateInput,
  BillPaymentCreateInput,
} from "@/lib/domain/schemas";

export class PayablesError extends Error {}

// --- Vendors ---
export async function listVendors(sb: SupabaseClient): Promise<VendorRow[]> {
  const { data, error } = await sb
    .from("acc_vendor")
    .select(
      "id,name,email,phone,currency_code,ap_account_id,default_expense_account_id," +
        "payment_terms,is_active,created_at,updated_at",
    )
    .order("name");
  if (error) throw new PayablesError(error.message);
  return (data ?? []) as unknown as VendorRow[];
}

export async function createVendor(sb: SupabaseClient, input: VendorCreateInput): Promise<VendorRow> {
  const { data, error } = await sb
    .from("acc_vendor")
    .insert({
      name: input.name,
      email: input.email || null,
      phone: input.phone || null,
      currency_code: input.currency_code || null,
      ap_account_id: input.ap_account_id || null,
      default_expense_account_id: input.default_expense_account_id || null,
      payment_terms: input.payment_terms || null,
    })
    .select(
      "id,name,email,phone,currency_code,ap_account_id,default_expense_account_id," +
        "payment_terms,is_active,created_at,updated_at",
    )
    .single();
  if (error) throw new PayablesError(error.message);
  return data as unknown as VendorRow;
}

// --- Bills ---
export interface BillWithVendor extends BillRow {
  vendor_name: string;
  /** The journal entry this bill produced, so the list can point at it. */
  entry_number: string | null;
}

export async function listBills(sb: SupabaseClient): Promise<BillWithVendor[]> {
  const { data, error } = await sb
    .from("acc_bill")
    .select(
      "id,bill_number,vendor_ref,vendor_id,bill_date,due_date,currency_code,total_minor," +
        "balance_due_minor,status,journal_entry_id,memo,created_at,updated_at," +
        "acc_vendor(name),acc_journal_entry(entry_number)",
    )
    .order("created_at", { ascending: false });
  if (error) throw new PayablesError(error.message);
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as BillRow),
    vendor_name: (r.acc_vendor as { name?: string } | null)?.name ?? "—",
    entry_number: (r.acc_journal_entry as { entry_number?: string } | null)?.entry_number ?? null,
  }));
}

export async function getBillLines(sb: SupabaseClient, billId: string): Promise<BillLineRow[]> {
  const { data, error } = await sb
    .from("acc_bill_line")
    .select("*")
    .eq("bill_id", billId)
    .order("line_order");
  if (error) throw new PayablesError(error.message);
  return (data ?? []) as unknown as BillLineRow[];
}

/** Create a draft bill. Line amounts are already minor units and tax-inclusive. */
export async function createDraftBill(
  sb: SupabaseClient,
  input: BillCreateInput,
  options?: { recurringRunId?: string },
): Promise<BillRow> {
  const { data: id, error } = await sb.rpc("acc_create_draft_bill", {
    p_vendor_id: input.vendor_id,
    p_vendor_ref: input.vendor_ref || null,
    p_bill_date: input.bill_date || null,
    p_due_date: input.due_date || null,
    p_currency: input.currency_code,
    p_memo: input.memo || null,
    p_lines: input.lines,
    p_recurring_run_id: options?.recurringRunId ?? null,
  });
  if (error) throw new PayablesError(error.message);

  const { data: bill, error: readError } = await sb
    .from("acc_bill")
    .select("*")
    .eq("id", String(id))
    .single();
  if (readError) throw new PayablesError(readError.message);
  return bill as unknown as BillRow;
}

export async function postBill(sb: SupabaseClient, billId: string): Promise<void> {
  const { error } = await sb.rpc("acc_post_bill", { p_bill_id: billId });
  if (error) throw new PayablesError(error.message);
}

export async function voidBill(sb: SupabaseClient, billId: string): Promise<void> {
  const { error } = await sb.rpc("acc_void_bill", { p_bill_id: billId });
  if (error) throw new PayablesError(error.message);
}

// --- Expenses ---
export interface ExpenseWithVendor extends ExpenseRow {
  vendor_name: string;
}

export async function listExpenses(sb: SupabaseClient): Promise<ExpenseWithVendor[]> {
  const { data, error } = await sb
    .from("acc_expense")
    .select(
      "id,expense_number,vendor_id,payment_account_id,expense_date,currency_code,total_minor," +
        "status,journal_entry_id,memo,created_at,updated_at,acc_vendor(name)",
    )
    .order("created_at", { ascending: false });
  if (error) throw new PayablesError(error.message);
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as ExpenseRow),
    vendor_name: (r.acc_vendor as { name?: string } | null)?.name ?? "—",
  }));
}

export async function getExpenseLines(sb: SupabaseClient, expenseId: string): Promise<ExpenseLineRow[]> {
  const { data, error } = await sb
    .from("acc_expense_line")
    .select("*")
    .eq("expense_id", expenseId)
    .order("line_order");
  if (error) throw new PayablesError(error.message);
  return (data ?? []) as unknown as ExpenseLineRow[];
}

export async function recordExpense(sb: SupabaseClient, input: ExpenseCreateInput): Promise<string> {
  const { data, error } = await sb.rpc("acc_record_expense", {
    p_vendor_id: input.vendor_id || null,
    p_payment_account_id: input.payment_account_id,
    p_expense_date: input.expense_date || undefined,
    p_currency: input.currency_code,
    p_memo: input.memo || null,
    p_lines: input.lines,
  });
  if (error) throw new PayablesError(error.message);
  return data as string;
}

export async function voidExpense(sb: SupabaseClient, expenseId: string): Promise<void> {
  const { error } = await sb.rpc("acc_void_expense", { p_expense_id: expenseId });
  if (error) throw new PayablesError(error.message);
}

// --- Bill payments ---
export async function listBillPayments(
  sb: SupabaseClient,
): Promise<(BillPaymentRow & { vendor_name: string })[]> {
  const { data, error } = await sb
    .from("acc_bill_payment")
    .select(
      "id,payment_number,vendor_id,payment_date,currency_code,amount_minor,unapplied_minor," +
        "payment_account_id,method,status,journal_entry_id,memo,created_at,updated_at,acc_vendor(name)",
    )
    .order("created_at", { ascending: false });
  if (error) throw new PayablesError(error.message);
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as BillPaymentRow),
    vendor_name: (r.acc_vendor as { name?: string } | null)?.name ?? "—",
  }));
}

export async function listOpenBillsForVendor(sb: SupabaseClient, vendorId: string): Promise<BillRow[]> {
  const { data, error } = await sb
    .from("acc_bill")
    .select("*")
    .eq("vendor_id", vendorId)
    .in("status", ["open", "partial"])
    .gt("balance_due_minor", 0)
    .order("bill_date");
  if (error) throw new PayablesError(error.message);
  return (data ?? []) as unknown as BillRow[];
}

export async function payBills(sb: SupabaseClient, input: BillPaymentCreateInput): Promise<string> {
  const { data, error } = await sb.rpc("acc_pay_bills", {
    p_vendor_id: input.vendor_id,
    p_payment_date: input.payment_date || undefined,
    p_currency: input.currency_code,
    p_amount_minor: input.amount_minor,
    p_payment_account_id: input.payment_account_id,
    p_method: input.method || null,
    p_reference: input.reference || null,
    p_memo: input.memo || null,
    p_allocations: input.allocations,
  });
  if (error) throw new PayablesError(error.message);
  return data as string;
}

export async function voidBillPayment(sb: SupabaseClient, paymentId: string): Promise<void> {
  const { error } = await sb.rpc("acc_void_bill_payment", { p_payment_id: paymentId });
  if (error) throw new PayablesError(error.message);
}
