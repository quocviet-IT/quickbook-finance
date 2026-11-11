/**
 * What an open invoice is, in one place (3.0.16): issued or partly paid, with
 * money still owed on it. The customer page, Receive payment, the credit
 * application list, bank matching, the statement review and the Invoices
 * overdue queue each wrote this out for themselves.
 *
 * The ageing RPC (acc_ar_ageing, 0024) says the same in SQL.
 */
import type { InvoiceStatus } from "@/lib/db/types";

/** The statuses an invoice can still be owed in. */
export const OPEN_INVOICE_STATUSES = ["issued", "partial"] as const satisfies readonly InvoiceStatus[];

/** An invoice the customer still owes money on. */
export function isOpenInvoice(invoice: { status: string; balance_due_minor: number }): boolean {
  return (OPEN_INVOICE_STATUSES as readonly string[]).includes(invoice.status) && invoice.balance_due_minor > 0;
}

/** The two filters a PostgREST read of acc_invoice needs to return open invoices only. */
interface OpenInvoiceFilters {
  in(column: string, values: readonly string[]): unknown;
  gt(column: string, value: number): unknown;
}

/**
 * Narrows a read of acc_invoice to open invoices, as {@link isOpenInvoice}
 * decides one, and hands back the same builder to keep chaining.
 *
 * Takes a PostgREST builder and nothing else. Its filters return the builder
 * itself, so the result is the query's own type. The type is not constrained
 * to one with `in` and `gt`: checking that against a select with an embedded
 * table and a count sent the compiler too deep (TS2589).
 */
export function onlyOpenInvoices<Q extends object>(query: Q): Q {
  const builder = query as unknown as OpenInvoiceFilters;
  const filtered = builder.in("status", OPEN_INVOICE_STATUSES) as OpenInvoiceFilters;
  return filtered.gt("balance_due_minor", 0) as Q;
}
