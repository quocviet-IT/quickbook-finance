import "server-only";
import { onlyOpenInvoices } from "@/lib/domain/open-invoice";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CustomerRow, InvoiceRow } from "@/lib/db/types";
import type { InvoiceWithCustomer } from "@/lib/services/invoicing";
import { listCustomerCredit, type CustomerCreditRow } from "@/lib/services/credit";
import { companyToday } from "@/lib/services/company";
import { readAllPages } from "@/lib/services/paging";
import { mergeCustomerTransactions, type CustomerTransaction, type CustomerTransactionParts } from "@/lib/domain/customer-detail";

export class CustomerDetailError extends Error {}

export interface CustomerDetail {
  customer: CustomerRow;
  credit: CustomerCreditRow | null;
  creditError: string | null;
  /** Shaped as the Invoices list's rows, so the shared invoice dialog opens on them. */
  openInvoices: InvoiceWithCustomer[];
}

const OPEN_INVOICE_COLUMNS =
  "id,invoice_number,customer_id,issue_date,due_date,currency_code,subtotal_minor," +
  "tax_total_minor,total_minor,balance_due_minor,status,order_id,journal_entry_id," +
  "memo,created_by,updated_by,created_at,updated_at,acc_journal_entry(entry_number)";

/**
 * What this customer still owes, invoice by invoice: the filters
 * listOpenInvoicesForCustomer uses, with the journal entry each invoice
 * posted, as listInvoices reads it. Without it the invoice dialog says
 * "Not posted yet" for an invoice that was. Ordered by issue date then id, a
 * total order, so readAllPages cannot see a row twice.
 */
async function readOpenInvoices(
  sb: SupabaseClient,
  customer: Pick<CustomerRow, "id" | "name">,
): Promise<InvoiceWithCustomer[]> {
  const rows = await readAllPages<Record<string, unknown>>(
    (from, to) =>
      onlyOpenInvoices(sb.from("acc_invoice").select(OPEN_INVOICE_COLUMNS).eq("customer_id", customer.id))
        .order("issue_date")
        .order("id")
        .range(from, to),
    (message) => new CustomerDetailError(message),
  );
  return rows.map(({ acc_journal_entry: entry, ...row }) => ({
    ...(row as unknown as InvoiceRow),
    customer_name: customer.name,
    entry_number: (entry as { entry_number?: string } | null)?.entry_number ?? null,
  }));
}

/** One customer, with what the top of their page needs. Null when there is no such customer. */
export async function getCustomerDetail(sb: SupabaseClient, id: string): Promise<CustomerDetail | null> {
  const { data, error } = await sb.from("acc_customer").select("*").eq("id", id).maybeSingle();
  if (error) throw new CustomerDetailError(error.message);
  if (!data) return null;
  const customer = data as CustomerRow;
  const [openInvoices, credit] = await Promise.all([
    readOpenInvoices(sb, customer),
    // This customer's row only; a failure must not take the page down.
    companyToday(sb).then((asOf) => listCustomerCredit(sb, { asOf, customerId: id })).then(
      (rows) => ({ row: rows.find((r) => r.customerId === id) ?? null, error: null }),
      (error: unknown) => {
        console.error("Reading customer credit failed:", error instanceof Error ? error.message : error);
        return { row: null, error: "Credit status could not be read" };
      },
    ),
  ]);
  return { customer, credit: credit.row, creditError: credit.error, openInvoices };
}

/** Every invoice (once issued), payment, credit memo and sales receipt for this customer in the range. */
export async function listCustomerTransactions(
  sb: SupabaseClient,
  id: string,
  range: { from: string | null; to: string | null },
): Promise<CustomerTransaction[]> {
  const fail = (message: string) => new CustomerDetailError(message);
  const between = <Q extends { gte: (c: string, v: string) => Q; lte: (c: string, v: string) => Q }>(q: Q, column: string) => {
    let next = q;
    if (range.from) next = next.gte(column, range.from);
    if (range.to) next = next.lte(column, range.to);
    return next;
  };
  const [invoices, payments, creditMemos, salesReceipts] = await Promise.all([
    readAllPages<CustomerTransactionParts["invoices"][number]>((f, t) =>
      between(sb.from("acc_invoice").select("id,invoice_number,issue_date,total_minor,currency_code,status,memo").eq("customer_id", id).neq("status", "draft"), "issue_date").order("issue_date").order("id").range(f, t), fail),
    readAllPages<CustomerTransactionParts["payments"][number]>((f, t) =>
      between(sb.from("acc_payment").select("id,payment_number,payment_date,amount_minor,currency_code,status,reference,memo").eq("customer_id", id), "payment_date").order("payment_date").order("id").range(f, t), fail),
    readAllPages<CustomerTransactionParts["creditMemos"][number]>((f, t) =>
      between(sb.from("acc_credit_memo").select("id,credit_memo_number,memo_date,total_minor,currency_code,status,memo").eq("customer_id", id).neq("status", "draft"), "memo_date").order("memo_date").order("id").range(f, t), fail),
    readAllPages<CustomerTransactionParts["salesReceipts"][number]>((f, t) =>
      between(sb.from("acc_sales_receipt").select("id,receipt_number,receipt_date,total_minor,currency_code,status,reference").eq("customer_id", id), "receipt_date").order("receipt_date").order("id").range(f, t), fail),
  ]);
  return mergeCustomerTransactions({ invoices, payments, creditMemos, salesReceipts });
}
