import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CustomerRow,
  InvoiceRow,
  InvoiceLineRow,
  PaymentRow,
} from "@/lib/db/types";
import { computeInvoiceLine, sumInvoiceTotals } from "@/lib/domain/money";
import type {
  CustomerCreateInput,
  InvoiceCreateInput,
  PaymentCreateInput,
} from "@/lib/domain/schemas";
import { writeAudit } from "./audit";

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
  const row = data as unknown as CustomerRow;
  await writeAudit(sb, { table_name: "acc_customer", record_id: row.id, action: "insert", after: row });
  return row;
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
): Promise<InvoiceRow> {
  const taxCodeIds = [...new Set(input.lines.map((l) => l.tax_code_id).filter(Boolean))] as string[];
  const rates = new Map<string, number>();
  if (taxCodeIds.length) {
    const { data, error } = await sb
      .from("acc_tax_code")
      .select("id,rate_percent")
      .in("id", taxCodeIds);
    if (error) throw new InvoicingError(error.message);
    for (const t of data ?? []) rates.set(t.id as string, Number(t.rate_percent));
  }

  const computed = input.lines.map((l) => {
    const amounts = computeInvoiceLine({
      quantity: l.quantity,
      unitPriceMinor: l.unit_price_minor,
      taxRatePercent: l.tax_code_id ? rates.get(l.tax_code_id) ?? 0 : 0,
    });
    return { line: l, amounts };
  });
  const totals = sumInvoiceTotals(computed.map((c) => c.amounts));

  const { data: inv, error: e1 } = await sb
    .from("acc_invoice")
    .insert({
      customer_id: input.customer_id,
      currency_code: input.currency_code,
      issue_date: input.issue_date || undefined,
      due_date: input.due_date || null,
      memo: input.memo || null,
      subtotal_minor: totals.subtotalMinor,
      tax_total_minor: totals.taxTotalMinor,
      total_minor: totals.totalMinor,
      balance_due_minor: totals.totalMinor,
    })
    .select("*")
    .single();
  if (e1) throw new InvoicingError(e1.message);
  const invoice = inv as unknown as InvoiceRow;

  const { error: e2 } = await sb.from("acc_invoice_line").insert(
    computed.map((c, i) => ({
      invoice_id: invoice.id,
      line_order: i,
      description: c.line.description,
      quantity: c.line.quantity,
      unit_price_minor: c.line.unit_price_minor,
      income_account_id: c.line.income_account_id,
      tax_code_id: c.line.tax_code_id || null,
      item_id: c.line.item_id || null,
      line_subtotal_minor: c.amounts.subtotalMinor,
      line_tax_minor: c.amounts.taxMinor,
      line_total_minor: c.amounts.totalMinor,
    })),
  );
  if (e2) {
    // Roll back the orphaned draft header (best effort).
    await sb.from("acc_invoice").delete().eq("id", invoice.id);
    throw new InvoicingError(e2.message);
  }

  await writeAudit(sb, { table_name: "acc_invoice", record_id: invoice.id, action: "insert", after: invoice });
  return invoice;
}

export async function issueInvoice(sb: SupabaseClient, invoiceId: string): Promise<void> {
  const { error } = await sb.rpc("acc_issue_invoice", { p_invoice_id: invoiceId });
  if (error) throw new InvoicingError(error.message);
  await writeAudit(sb, { table_name: "acc_invoice", record_id: invoiceId, action: "post" });
}

export async function voidInvoice(sb: SupabaseClient, invoiceId: string): Promise<void> {
  const { error } = await sb.rpc("acc_void_invoice", { p_invoice_id: invoiceId });
  if (error) throw new InvoicingError(error.message);
  await writeAudit(sb, { table_name: "acc_invoice", record_id: invoiceId, action: "void" });
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
  await writeAudit(sb, { table_name: "acc_payment", record_id: (data as string) ?? null, action: "post" });
  return data as string;
}
