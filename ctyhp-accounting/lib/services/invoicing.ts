import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CustomerRow,
  InvoiceRow,
  InvoiceLineRow,
  PaymentRow,
} from "@/lib/db/types";
import type {
  CustomerCreateInput,
  InvoiceCreateInput,
  PaymentCreateInput,
} from "@/lib/domain/schemas";

export class InvoicingError extends Error {}

// --- Customers ---
export async function listCustomers(sb: SupabaseClient): Promise<CustomerRow[]> {
  const { data, error } = await sb
    .from("acc_customer")
    .select("id,name,email,currency_code,is_active,created_at,updated_at")
    .order("name");
  if (error) throw new InvoicingError(error.message);
  return (data ?? []) as unknown as CustomerRow[];
}

export async function createCustomer(
  sb: SupabaseClient,
  input: CustomerCreateInput,
): Promise<CustomerRow> {
  const { data, error } = await sb
    .from("acc_customer")
    .insert({
      name: input.name,
      email: input.email || null,
      currency_code: input.currency_code || null,
    })
    .select("id,name,email,currency_code,is_active,created_at,updated_at")
    .single();
  if (error) throw new InvoicingError(error.message);
  return data as unknown as CustomerRow;
}

// --- Invoices ---
export interface InvoiceWithCustomer extends InvoiceRow {
  customer_name: string;
}

export async function listInvoices(sb: SupabaseClient): Promise<InvoiceWithCustomer[]> {
  const { data, error } = await sb
    .from("acc_invoice")
    .select(
      "id,invoice_number,customer_id,issue_date,due_date,currency_code,subtotal_minor," +
        "tax_total_minor,total_minor,balance_due_minor,status,order_id,journal_entry_id," +
        "memo,created_at,updated_at,acc_customer(name)",
    )
    .order("created_at", { ascending: false });
  if (error) throw new InvoicingError(error.message);
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as InvoiceRow),
    customer_name: (r.acc_customer as { name?: string } | null)?.name ?? "—",
  }));
}

export async function getInvoiceLines(sb: SupabaseClient, invoiceId: string): Promise<InvoiceLineRow[]> {
  const { data, error } = await sb
    .from("acc_invoice_line")
    .select("*")
    .eq("invoice_id", invoiceId)
    .order("line_order");
  if (error) throw new InvoicingError(error.message);
  return (data ?? []) as unknown as InvoiceLineRow[];
}

/**
 * Create a draft invoice with computed line and total amounts. Amounts are
 * computed server-side from quantity, unit price, and the tax code's rate —
 * never trusted from the client.
 */
export async function createDraftInvoice(
  sb: SupabaseClient,
  input: InvoiceCreateInput,
  options?: { recurringRunId?: string },
): Promise<InvoiceRow> {
  const { data: id, error } = await sb.rpc("acc_create_draft_invoice", {
    p_customer_id: input.customer_id,
    p_issue_date: input.issue_date || null,
    p_due_date: input.due_date || null,
    p_currency: input.currency_code,
    p_memo: input.memo || null,
    p_lines: input.lines,
    p_recurring_run_id: options?.recurringRunId ?? null,
  });
  if (error) throw new InvoicingError(error.message);

  const { data: invoice, error: readError } = await sb
    .from("acc_invoice")
    .select("*")
    .eq("id", String(id))
    .single();
  if (readError) throw new InvoicingError(readError.message);
  return invoice as unknown as InvoiceRow;
}

export async function issueInvoice(sb: SupabaseClient, invoiceId: string): Promise<void> {
  const { error } = await sb.rpc("acc_issue_invoice", { p_invoice_id: invoiceId });
  if (error) throw new InvoicingError(error.message);
}

export async function voidInvoice(sb: SupabaseClient, invoiceId: string): Promise<void> {
  const { error } = await sb.rpc("acc_void_invoice", { p_invoice_id: invoiceId });
  if (error) throw new InvoicingError(error.message);
}

// --- Payments ---
export async function listPayments(sb: SupabaseClient): Promise<(PaymentRow & { customer_name: string })[]> {
  const { data, error } = await sb
    .from("acc_payment")
    .select(
      "id,payment_number,customer_id,payment_date,currency_code,amount_minor,unapplied_minor," +
        "method,deposit_account_id,status,journal_entry_id,memo,created_at,updated_at,acc_customer(name)",
    )
    .order("created_at", { ascending: false });
  if (error) throw new InvoicingError(error.message);
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as PaymentRow),
    customer_name: (r.acc_customer as { name?: string } | null)?.name ?? "—",
  }));
}

export async function listOpenInvoicesForCustomer(
  sb: SupabaseClient,
  customerId: string,
): Promise<InvoiceRow[]> {
  const { data, error } = await sb
    .from("acc_invoice")
    .select("*")
    .eq("customer_id", customerId)
    .in("status", ["issued", "partial"])
    .gt("balance_due_minor", 0)
    .order("issue_date");
  if (error) throw new InvoicingError(error.message);
  return (data ?? []) as unknown as InvoiceRow[];
}

export async function recordPayment(sb: SupabaseClient, input: PaymentCreateInput): Promise<string> {
  const { data, error } = await sb.rpc("acc_record_payment", {
    p_customer_id: input.customer_id,
    p_payment_date: input.payment_date || undefined,
    p_currency: input.currency_code,
    p_amount_minor: input.amount_minor,
    p_deposit_account_id: input.deposit_account_id,
    p_method: input.method || null,
    p_memo: input.memo || null,
    p_allocations: input.allocations,
  });
  if (error) throw new InvoicingError(error.message);
  return data as string;
}
