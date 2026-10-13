import type { SupabaseClient } from "@supabase/supabase-js";
import type { EstimateLineRow, EstimateRow, InvoiceStatus } from "@/lib/db/types";
import type { EstimateSaveInput, InvoiceCreateInput } from "@/lib/domain/schemas";
import {
  estimateToInvoicePrefill,
  type EstimateInvoicePrefill,
} from "@/lib/domain/estimates";
import type { EstimateDocumentSource } from "@/lib/domain/estimate-document";
import { getCurrentCompanySettings } from "@/lib/services/company";
import { readAllPages } from "@/lib/services/paging";

/**
 * Estimates: reads under the caller's RLS, and the four functions of
 * migration 0141 for every write. The tables are read-only to a signed-in
 * session, so nothing here writes them directly; every refusal is the
 * database's own words, passed through unchanged.
 */
export class EstimatesError extends Error {}

const ESTIMATE_COLS =
  "id,estimate_number,customer_id,estimate_date,expiry_date,currency_code,memo," +
  "subtotal_minor,tax_minor,total_minor,declined_at,status,created_by,created_at," +
  "updated_by,updated_at";

const LINE_COLS =
  "id,estimate_id,line_order,item_id,description,quantity,unit_price_minor," +
  "income_account_id,tax_code_id,line_subtotal_minor,line_tax_minor,line_total_minor";

/** The customer's name and every invoice made from the estimate, void ones included. */
const LINKED = "acc_customer(name),acc_invoice(id,invoice_number,status,issue_date,created_at)";

/** An invoice made from an estimate. */
export interface EstimateLinkedInvoice {
  id: string;
  /** Null while it is a draft. */
  invoice_number: string | null;
  status: InvoiceStatus;
  issue_date: string;
  created_at: string;
}

export interface EstimateListRow extends EstimateRow {
  customer_name: string;
  /**
   * The invoice made from it that is not void, if any: what makes it
   * Converted. The database allows at most one.
   */
  live_invoice: EstimateLinkedInvoice | null;
}

export interface EstimateDetail {
  estimate: EstimateListRow;
  lines: EstimateLineRow[];
  /** Every invoice made from it, void ones included, oldest first. */
  invoices: EstimateLinkedInvoice[];
}

export interface SavedEstimate {
  id: string;
  estimate_number: string;
  subtotal_minor: number;
  tax_minor: number;
  total_minor: number;
}

function fail(message: string): EstimatesError {
  return new EstimatesError(message);
}

function linkedInvoices(raw: unknown): EstimateLinkedInvoice[] {
  return ((raw ?? []) as EstimateLinkedInvoice[])
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

/** The one invoice that is not void, if any. A void one keeps its link but converts nothing. */
export function liveInvoiceOf(invoices: readonly EstimateLinkedInvoice[]): EstimateLinkedInvoice | null {
  return invoices.find((invoice) => invoice.status !== "void") ?? null;
}

function toListRow(raw: Record<string, unknown>): { row: EstimateListRow; invoices: EstimateLinkedInvoice[] } {
  const { acc_customer: customer, acc_invoice: invoiceRows, ...rest } = raw;
  const invoices = linkedInvoices(invoiceRows);
  const head = rest as unknown as EstimateRow;
  return {
    row: {
      ...head,
      subtotal_minor: Number(head.subtotal_minor),
      tax_minor: Number(head.tax_minor),
      total_minor: Number(head.total_minor),
      customer_name: (customer as { name?: string } | null)?.name ?? "—",
      live_invoice: liveInvoiceOf(invoices),
    },
    invoices,
  };
}

/** The lines of one estimate, in their order (unique per estimate), every page of them. */
function readLines(sb: SupabaseClient, estimateId: string): Promise<EstimateLineRow[]> {
  return readAllPages<EstimateLineRow>(
    (from, to) =>
      sb
        .from("acc_estimate_line")
        .select(LINE_COLS)
        .eq("estimate_id", estimateId)
        .order("line_order")
        .range(from, to),
    fail,
  );
}

// --- Reads ---

/**
 * Every estimate, newest first, with its customer's name, its totals and the
 * invoice made from it that is not void. The number is unique, so date then
 * number is a total order and no page can skip or repeat a row.
 */
export async function listEstimates(sb: SupabaseClient): Promise<EstimateListRow[]> {
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) =>
      sb
        .from("acc_estimate")
        .select(`${ESTIMATE_COLS},${LINKED}`)
        .order("estimate_date", { ascending: false })
        .order("estimate_number", { ascending: false })
        .range(from, to),
    fail,
  );
  return rows.map((raw) => toListRow(raw).row);
}

/** One estimate: its header, its lines and every invoice made from it. */
export async function getEstimateDetail(sb: SupabaseClient, id: string): Promise<EstimateDetail> {
  const [head, lines] = await Promise.all([
    sb.from("acc_estimate").select(`${ESTIMATE_COLS},${LINKED}`).eq("id", id).maybeSingle(),
    readLines(sb, id),
  ]);
  if (head.error) throw fail(head.error.message);
  if (!head.data) throw fail("Estimate not found");
  const { row, invoices } = toListRow(head.data as unknown as Record<string, unknown>);
  return { estimate: row, lines, invoices };
}

/**
 * What the New invoice form opens with when it is opened from this estimate,
 * or null when there is no such estimate (or the reader may not see it).
 */
export async function getEstimateInvoicePrefill(
  sb: SupabaseClient,
  id: string,
): Promise<EstimateInvoicePrefill | null> {
  const [head, lines] = await Promise.all([
    sb
      .from("acc_estimate")
      .select("id,estimate_number,customer_id,declined_at,acc_invoice(id,invoice_number,status,issue_date,created_at)")
      .eq("id", id)
      .maybeSingle(),
    readLines(sb, id),
  ]);
  if (head.error) throw fail(head.error.message);
  if (!head.data) return null;
  const row = head.data as unknown as {
    id: string;
    estimate_number: string;
    customer_id: string;
    declined_at: string | null;
    acc_invoice: unknown;
  };
  return estimateToInvoicePrefill(
    {
      id: row.id,
      estimate_number: row.estimate_number,
      customer_id: row.customer_id,
      declined_at: row.declined_at,
      live_invoice: liveInvoiceOf(linkedInvoices(row.acc_invoice)),
    },
    lines,
  );
}

/** Everything a printable estimate needs, read under the caller's RLS. */
export async function getEstimateDocumentSource(
  sb: SupabaseClient,
  id: string,
): Promise<EstimateDocumentSource> {
  const [head, lines, company] = await Promise.all([
    sb
      .from("acc_estimate")
      .select(
        "estimate_number,estimate_date,expiry_date,currency_code,subtotal_minor,tax_minor," +
          "total_minor,memo,acc_customer(name,email,contact_name,phone,address_line1," +
          "address_line2,city,region,postal_code,country)",
      )
      .eq("id", id)
      .maybeSingle(),
    readLines(sb, id),
    getCurrentCompanySettings(sb),
  ]);
  if (head.error) throw fail(head.error.message);
  if (!head.data) throw fail("Estimate not found");
  if (!company) {
    throw fail(
      "Company settings are required before an estimate can be printed. Set them in Settings → Company.",
    );
  }
  const { acc_customer: customer, ...estimate } = head.data as unknown as Record<string, unknown>;
  if (!customer) throw fail("The estimate's customer was not found");
  return {
    estimate: estimate as unknown as EstimateDocumentSource["estimate"],
    lines,
    customer: customer as unknown as EstimateDocumentSource["customer"],
    company: company as unknown as EstimateDocumentSource["company"],
  };
}

// --- Writes (each an atomic SECURITY DEFINER function of migration 0141) ---

/**
 * Create (`id` null) or edit an estimate with all its lines. The database
 * numbers a new one, works out every amount, and refuses a Converted one.
 */
export async function saveEstimate(
  sb: SupabaseClient,
  id: string | null,
  input: EstimateSaveInput,
): Promise<SavedEstimate> {
  const { data, error } = await sb.rpc("acc_save_estimate", {
    p_estimate_id: id,
    p_customer_id: input.customer_id,
    p_estimate_date: input.estimate_date,
    p_expiry_date: input.expiry_date || null,
    p_currency: input.currency_code,
    p_memo: input.memo || null,
    p_lines: input.lines.map((line) => ({
      description: line.description ?? "",
      quantity: line.quantity,
      unit_price_minor: line.unit_price_minor,
      income_account_id: line.income_account_id,
      tax_code_id: line.tax_code_id || null,
      item_id: line.item_id || null,
    })),
  });
  if (error) throw fail(error.message);
  const saved = data as Record<string, unknown>;
  return {
    id: String(saved.id),
    estimate_number: String(saved.estimate_number),
    subtotal_minor: Number(saved.subtotal_minor),
    tax_minor: Number(saved.tax_minor),
    total_minor: Number(saved.total_minor),
  };
}

/** Mark declined (`declined` true) or reopen (false). Refused once it is Converted. */
export async function setEstimateDeclined(
  sb: SupabaseClient,
  id: string,
  declined: boolean,
): Promise<{ id: string; estimate_number: string; declined_at: string | null }> {
  const { data, error } = await sb.rpc("acc_set_estimate_declined", {
    p_estimate_id: id,
    p_declined: declined,
  });
  if (error) throw fail(error.message);
  const result = data as Record<string, unknown>;
  return {
    id: String(result.id),
    estimate_number: String(result.estimate_number),
    declined_at: (result.declined_at as string | null) ?? null,
  };
}

/**
 * Delete an estimate and its lines. Refused when any invoice, void or not,
 * has been made from it; the refusal says to mark it declined instead.
 */
export async function deleteEstimate(
  sb: SupabaseClient,
  id: string,
): Promise<{ id: string; estimate_number: string }> {
  const { data, error } = await sb.rpc("acc_delete_estimate", { p_estimate_id: id });
  if (error) throw fail(error.message);
  const result = data as Record<string, unknown>;
  return { id: String(result.id), estimate_number: String(result.estimate_number) };
}

/**
 * The draft invoice made from an estimate, linked to it, in one transaction.
 * The fields and lines are the New invoice form's, passed exactly as
 * createDraftInvoice passes them; the database makes the draft through the
 * same function, and refuses a declined estimate, one already turned into an
 * invoice, or a different customer. Returns the new invoice's id.
 */
export async function createInvoiceFromEstimate(
  sb: SupabaseClient,
  estimateId: string,
  input: InvoiceCreateInput,
): Promise<string> {
  const { data, error } = await sb.rpc("acc_create_invoice_from_estimate", {
    p_estimate_id: estimateId,
    p_customer_id: input.customer_id,
    p_issue_date: input.issue_date || null,
    p_due_date: input.due_date || null,
    p_currency: input.currency_code,
    p_memo: input.memo || null,
    p_lines: input.lines,
  });
  if (error) throw fail(error.message);
  return String(data);
}
