/**
 * When an invoice can be voided, and what the question says before it is.
 *
 * Pure. The rule is acc_void_invoice's (0169): a draft is marked void with
 * nothing to reverse; an issued invoice has its journal entry voided; and any
 * invoice whose balance due differs from its total — a payment, a credit or a
 * write-off applied — is refused. The menu follows the same rule, so nobody
 * confirms a void only to be told no.
 */
import type { InvoiceStatus } from "@/lib/db/types";

export interface VoidableInvoice {
  status: InvoiceStatus;
  invoice_number: string | null;
  customer_name: string;
  total_minor: number;
  balance_due_minor: number;
  /** The journal entry issuing posted; none on a draft. */
  entry_number: string | null;
}

export type InvoiceVoidOption =
  | { offered: false }
  /** Offered; when `blockedReason` is set, shown disabled with that reason. */
  | { offered: true; blockedReason: string | null };

export const VOID_BLOCKED_BY_SETTLEMENT = "Payments or credits are applied to it, so it cannot be voided";

export function invoiceVoidOption(invoice: VoidableInvoice): InvoiceVoidOption {
  if (invoice.status === "void" || invoice.status === "paid") return { offered: false };
  if (invoice.status !== "draft" && invoice.balance_due_minor !== invoice.total_minor) {
    return { offered: true, blockedReason: VOID_BLOCKED_BY_SETTLEMENT };
  }
  return { offered: true, blockedReason: null };
}

/** The confirmation's title and body, naming the invoice and what voiding does to it. */
export function invoiceVoidConfirm(invoice: VoidableInvoice): { title: string; content: string } {
  if (invoice.status === "draft" || !invoice.invoice_number) {
    return {
      title: `Void the draft invoice for ${invoice.customer_name}?`,
      content:
        "Nothing has been posted for a draft, so the ledger does not change. The draft stays in the list, marked Void.",
    };
  }
  const entry = invoice.entry_number ? `journal entry ${invoice.entry_number}` : "its journal entry";
  return {
    title: `Void ${invoice.invoice_number}?`,
    content: `This reverses ${entry}, so the sale comes off the ledger. The number ${invoice.invoice_number} is not used again.`,
  };
}
