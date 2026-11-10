/**
 * When an invoice can be voided, and what the question says before it is.
 *
 * Pure. The rule is shared with bills (document-void.ts, after
 * acc_void_invoice in 0169); this file holds the invoice's own words.
 */
import type { InvoiceStatus } from "@/lib/db/types";
import { DRAFT_VOID_CONTENT, documentVoidOption, type VoidOption } from "@/lib/domain/document-void";

export interface VoidableInvoice {
  status: InvoiceStatus;
  invoice_number: string | null;
  customer_name: string;
  total_minor: number;
  balance_due_minor: number;
  /** The journal entry issuing posted; none on a draft. */
  entry_number: string | null;
}

export type InvoiceVoidOption = VoidOption;

export function invoiceVoidOption(invoice: VoidableInvoice): InvoiceVoidOption {
  return documentVoidOption(invoice);
}

/** The confirmation's title and body, naming the invoice and what voiding does to it. */
export function invoiceVoidConfirm(invoice: VoidableInvoice): { title: string; content: string } {
  if (invoice.status === "draft" || !invoice.invoice_number) {
    return {
      title: `Void the draft invoice for ${invoice.customer_name}?`,
      content: DRAFT_VOID_CONTENT,
    };
  }
  const entry = invoice.entry_number ? `journal entry ${invoice.entry_number}` : "its journal entry";
  return {
    title: `Void ${invoice.invoice_number}?`,
    content: `This reverses ${entry}, so the sale comes off the ledger. The number ${invoice.invoice_number} is not used again.`,
  };
}
