import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  CustomerRow,
  InvoiceRow,
  InvoiceLineRow,
  PaymentRow,
} from "@/lib/db/types";
import type {
  CustomerCreateInput,
  CustomerUpdateInput,
  InvoiceCreateInput,
  PaymentCreateInput,
} from "@/lib/domain/schemas";
import type { InvoiceDocumentSource } from "@/lib/domain/invoice-document";
import { getCurrentCompanySettings } from "@/lib/services/company";

export class InvoicingError extends Error {}

const CUSTOMER_COLS =
  "id,name,email,currency_code,is_active,contact_name,phone,address_line1," +
  "address_line2,city,region,postal_code,country,credit_limit_minor," +
  "credit_terms_days,credit_hold,credit_reviewed_at,credit_review_note," +
  "created_at,updated_at";

/** Empty strings from a form mean "not set", which the column stores as null. */
function contactFields(input: Omit<CustomerUpdateInput, "id">) {
  return {
    name: input.name,
    email: input.email || null,
    contact_name: input.contact_name || null,
    phone: input.phone || null,
    address_line1: input.address_line1 || null,
    address_line2: input.address_line2 || null,
    city: input.city || null,
    region: input.region || null,
    postal_code: input.postal_code || null,
    country: input.country || null,
    // undefined means "the form did not carry credit fields"; null means the
    // limit was cleared, and the two must not collapse into each other.
    credit_limit_minor: input.credit_limit_minor ?? null,
    credit_terms_days: input.credit_terms_days ?? null,
    credit_hold: input.credit_hold ?? false,
    credit_review_note: input.credit_review_note || null,
    credit_reviewed_at: new Date().toISOString(),
  };
}

// --- Customers ---
export async function listCustomers(sb: SupabaseClient): Promise<CustomerRow[]> {
  const { data, error } = await sb
    .from("acc_customer")
    .select(CUSTOMER_COLS)
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
      ...contactFields(input),
      currency_code: input.currency_code || null,
    })
    .select(CUSTOMER_COLS)
    .single();
  if (error) throw new InvoicingError(error.message);
  return data as unknown as CustomerRow;
}

/**
 * Update contact details. The currency is deliberately not updatable: it is
 * baked into every document already issued to this customer.
 */
export async function updateCustomer(
  sb: SupabaseClient,
  input: CustomerUpdateInput,
): Promise<CustomerRow> {
  const { id, ...fields } = input;
  const { data, error } = await sb
    .from("acc_customer")
    .update({ ...contactFields(fields), updated_at: new Date().toISOString() })
    .eq("id", id)
    .select(CUSTOMER_COLS)
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
        "memo,created_by,updated_by,created_at,updated_at,acc_customer(name)",
    )
    // Invoice number order, drafts first: a numbered document list that does
    // not run in sequence is the one thing a reviewer cannot scan for breaks.
    .order("invoice_number", { ascending: false, nullsFirst: true })
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

/** Everything a printable invoice needs, read in one place under the caller's RLS. */
export async function getInvoiceDocumentSource(
  sb: SupabaseClient,
  invoiceId: string,
): Promise<InvoiceDocumentSource> {
  const [invoice, lines, company] = await Promise.all([
    sb
      .from("acc_invoice")
      .select(
        "invoice_number,issue_date,due_date,currency_code,subtotal_minor,tax_total_minor," +
          "total_minor,balance_due_minor,status,memo,customer_id",
      )
      .eq("id", invoiceId)
      .single(),
    sb
      .from("acc_invoice_line")
      .select(
        "line_order,description,quantity,unit_price_minor,line_subtotal_minor," +
          "line_tax_minor,line_total_minor",
      )
      .eq("invoice_id", invoiceId)
      .order("line_order"),
    getCurrentCompanySettings(sb),
  ]);

  if (invoice.error) throw new InvoicingError(invoice.error.message);
  if (lines.error) throw new InvoicingError(lines.error.message);
  if (!company) {
    throw new InvoicingError(
      "Company settings are required before an invoice can be printed. Set them in Settings → Company.",
    );
  }

  const customer = await sb
    .from("acc_customer")
    .select(
      "name,email,contact_name,phone,address_line1,address_line2,city,region,postal_code,country",
    )
    .eq("id", (invoice.data as unknown as { customer_id: string }).customer_id)
    .single();
  if (customer.error) throw new InvoicingError(customer.error.message);

  return {
    invoice: invoice.data as unknown as InvoiceDocumentSource["invoice"],
    lines: (lines.data ?? []) as unknown as InvoiceDocumentSource["lines"],
    customer: customer.data as unknown as InvoiceDocumentSource["customer"],
    company: company as unknown as InvoiceDocumentSource["company"],
  };
}

/**
 * Issue and post. The database refuses an invoice that puts the customer past
 * their credit limit, or any invoice for an account on hold, unless the caller
 * holds `credit.override` and says why — the reason is written to the audit log
 * as its own `credit_override` action.
 */
export async function issueInvoice(
  sb: SupabaseClient,
  invoiceId: string,
  overrideReason?: string | null,
): Promise<void> {
  const { error } = await sb.rpc("acc_issue_invoice", {
    p_invoice_id: invoiceId,
    p_override_reason: overrideReason?.trim() || null,
  });
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
