import type { SupabaseClient } from "@supabase/supabase-js";
import type { SalesReceiptCreateInput } from "@/lib/domain/schemas";
import type {
  SalesReceiptDocumentSource,
  SalesReceiptLineRow,
  SalesReceiptMethod,
  SalesReceiptRow,
  SalesReceiptStatus,
} from "@/lib/domain/sales-receipts";
import { getCurrentCompanySettings } from "@/lib/services/company";
import { readAllPages } from "@/lib/services/paging";

/**
 * Sales receipts (2.53): reads under the caller's RLS, and the two functions
 * of migration 0164 for every write. The tables are read-only to a signed-in
 * session; every refusal is the database's own words, passed through.
 */
export class SalesReceiptsError extends Error {}

function fail(message: string): SalesReceiptsError {
  return new SalesReceiptsError(message);
}

const RECEIPT_COLS =
  "id,receipt_number,receipt_date,customer_id,deposit_account_id,payment_method,reference,memo," +
  "subtotal_minor,tax_minor,total_minor,status,journal_entry_id,void_reason,voided_at," +
  "acc_customer(name),acc_account(account_code,name)";

const LINE_COLS =
  "id,receipt_id,line_order,item_id,description,quantity,unit_price_minor,income_account_id," +
  "tax_code_id,line_subtotal_minor,line_tax_minor,line_total_minor";

function toRow(raw: Record<string, unknown>): SalesReceiptRow {
  const customer = raw.acc_customer as { name?: string } | null;
  const deposit = raw.acc_account as { account_code?: string; name?: string } | null;
  return {
    id: String(raw.id),
    receipt_number: String(raw.receipt_number),
    receipt_date: String(raw.receipt_date),
    customer_id: String(raw.customer_id),
    customer_name: customer?.name ?? "",
    deposit_account_id: String(raw.deposit_account_id),
    deposit_account_label: deposit ? `${deposit.account_code} ${deposit.name}` : "",
    payment_method: (raw.payment_method as SalesReceiptMethod | null) ?? null,
    reference: (raw.reference as string | null) ?? null,
    memo: (raw.memo as string | null) ?? null,
    subtotal_minor: Number(raw.subtotal_minor),
    tax_minor: Number(raw.tax_minor),
    total_minor: Number(raw.total_minor),
    status: raw.status as SalesReceiptStatus,
    journal_entry_id: (raw.journal_entry_id as string | null) ?? null,
    void_reason: (raw.void_reason as string | null) ?? null,
    voided_at: (raw.voided_at as string | null) ?? null,
  };
}

/** The lines of one receipt, in their order, every page of them. */
function readLines(sb: SupabaseClient, receiptId: string): Promise<SalesReceiptLineRow[]> {
  return readAllPages<SalesReceiptLineRow>(
    (from, to) =>
      sb.from("acc_sales_receipt_line").select(LINE_COLS).eq("receipt_id", receiptId).order("line_order").range(from, to),
    fail,
  ).then((rows) =>
    rows.map((line) => ({
      ...line,
      quantity: Number(line.quantity),
      unit_price_minor: Number(line.unit_price_minor),
      line_subtotal_minor: Number(line.line_subtotal_minor),
      line_tax_minor: Number(line.line_tax_minor),
      line_total_minor: Number(line.line_total_minor),
    })),
  );
}

// --- Reads ---

/** Every receipt, newest first. Date then number is a total order, so no page skips or repeats a row. */
export async function listSalesReceipts(sb: SupabaseClient): Promise<SalesReceiptRow[]> {
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) =>
      sb
        .from("acc_sales_receipt")
        .select(RECEIPT_COLS)
        .order("receipt_date", { ascending: false })
        .order("receipt_number", { ascending: false })
        .range(from, to),
    fail,
  );
  return rows.map(toRow);
}

/** One receipt with its lines. */
export async function getSalesReceiptDetail(
  sb: SupabaseClient,
  id: string,
): Promise<{ receipt: SalesReceiptRow; lines: SalesReceiptLineRow[] }> {
  const [head, lines] = await Promise.all([
    sb.from("acc_sales_receipt").select(RECEIPT_COLS).eq("id", id).maybeSingle(),
    readLines(sb, id),
  ]);
  if (head.error) throw fail(head.error.message);
  if (!head.data) throw fail("Sales receipt not found");
  return { receipt: toRow(head.data as unknown as Record<string, unknown>), lines };
}

/** What the printed receipt is drawn from. */
export async function getSalesReceiptDocumentSource(
  sb: SupabaseClient,
  id: string,
): Promise<SalesReceiptDocumentSource> {
  const [head, lines, company] = await Promise.all([
    sb
      .from("acc_sales_receipt")
      .select(
        "receipt_number,receipt_date,currency_code,payment_method,reference,subtotal_minor,tax_minor," +
          "total_minor,memo,status,acc_customer(name,email,contact_name,phone,address_line1," +
          "address_line2,city,region,postal_code,country)",
      )
      .eq("id", id)
      .maybeSingle(),
    readLines(sb, id),
    getCurrentCompanySettings(sb),
  ]);
  if (head.error) throw fail(head.error.message);
  if (!head.data) throw fail("Sales receipt not found");
  if (!company) {
    throw fail("Company settings are required before a receipt can be printed. Set them in Settings → Company.");
  }
  const { acc_customer: customer, ...receipt } = head.data as unknown as Record<string, unknown>;
  if (!customer) throw fail("The receipt's customer was not found");
  return {
    receipt: {
      ...(receipt as unknown as SalesReceiptDocumentSource["receipt"]),
      subtotal_minor: Number(receipt.subtotal_minor),
      tax_minor: Number(receipt.tax_minor),
      total_minor: Number(receipt.total_minor),
    },
    lines,
    customer: customer as unknown as SalesReceiptDocumentSource["customer"],
    company: company as unknown as SalesReceiptDocumentSource["company"],
  };
}

// --- Writes (each an atomic SECURITY DEFINER function of migration 0164) ---

/**
 * Record and post a receipt; the database numbers it and works out every
 * amount. Returns the number it was given, for the screen to say.
 */
export async function createSalesReceipt(
  sb: SupabaseClient,
  input: SalesReceiptCreateInput,
): Promise<{ id: string; receipt_number: string; total_minor: number }> {
  const { data, error } = await sb.rpc("acc_create_sales_receipt", {
    p_customer_id: input.customer_id,
    p_receipt_date: input.receipt_date,
    p_deposit_account_id: input.deposit_account_id,
    p_payment_method: input.payment_method || null,
    p_reference: input.reference || null,
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
  const id = String(data);
  const saved = await sb.from("acc_sales_receipt").select("receipt_number,total_minor").eq("id", id).maybeSingle();
  if (saved.error) throw fail(saved.error.message);
  return { id, receipt_number: String(saved.data?.receipt_number ?? ""), total_minor: Number(saved.data?.total_minor ?? 0) };
}

/** Void a receipt, with the reason; refused inside a closed period. */
export async function voidSalesReceipt(sb: SupabaseClient, id: string, reason: string): Promise<void> {
  const { error } = await sb.rpc("acc_void_sales_receipt", { p_receipt_id: id, p_reason: reason });
  if (error) throw fail(error.message);
}
