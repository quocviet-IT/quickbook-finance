import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CustomerRow, InvoiceRow } from "@/lib/db/types";
import { listOpenInvoicesForCustomer } from "@/lib/services/invoicing";
import { listCustomerCredit, type CustomerCreditRow } from "@/lib/services/credit";
import { readAllPages } from "@/lib/services/paging";
import { mergeCustomerTransactions, type CustomerTransaction, type CustomerTransactionParts } from "@/lib/domain/customer-detail";

export class CustomerDetailError extends Error {}

export interface CustomerDetail {
  customer: CustomerRow;
  credit: CustomerCreditRow | null;
  creditError: string | null;
  openInvoices: InvoiceRow[];
}

/** One customer, with what the top of their page needs. Null when there is no such customer. */
export async function getCustomerDetail(sb: SupabaseClient, id: string): Promise<CustomerDetail | null> {
  const { data, error } = await sb.from("acc_customer").select("*").eq("id", id).maybeSingle();
  if (error) throw new CustomerDetailError(error.message);
  if (!data) return null;
  const [openInvoices, credit] = await Promise.all([
    listOpenInvoicesForCustomer(sb, id),
    // The credit read covers every customer (one RPC); a failure must not take the page down.
    listCustomerCredit(sb).then(
      (rows) => ({ row: rows.find((r) => r.customerId === id) ?? null, error: null }),
      () => ({ row: null, error: "Credit status could not be read" }),
    ),
  ]);
  return { customer: data as CustomerRow, credit: credit.row, creditError: credit.error, openInvoices };
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
      between(sb.from("acc_payment").select("id,payment_number,payment_date,amount_minor,currency_code,status,memo").eq("customer_id", id), "payment_date").order("payment_date").order("id").range(f, t), fail),
    readAllPages<CustomerTransactionParts["creditMemos"][number]>((f, t) =>
      between(sb.from("acc_credit_memo").select("id,credit_memo_number,memo_date,total_minor,currency_code,status,memo").eq("customer_id", id).neq("status", "draft"), "memo_date").order("memo_date").order("id").range(f, t), fail),
    readAllPages<CustomerTransactionParts["salesReceipts"][number]>((f, t) =>
      between(sb.from("acc_sales_receipt").select("id,receipt_number,receipt_date,total_minor,currency_code,status,reference").eq("customer_id", id), "receipt_date").order("receipt_date").order("id").range(f, t), fail),
  ]);
  return mergeCustomerTransactions({ invoices, payments, creditMemos, salesReceipts });
}
