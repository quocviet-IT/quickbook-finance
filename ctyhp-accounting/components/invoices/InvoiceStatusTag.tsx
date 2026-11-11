import StatusTag from "@/components/ui/StatusTag";
import { invoiceAttention, invoiceAttentionLook, type AttentionInvoice } from "@/lib/domain/invoice-attention";
import { PAID_LABELS } from "@/lib/domain/status-label";

interface Props {
  invoice: AttentionInvoice;
  /** The company's today, which "late" and "due in" count from. */
  today: string;
}

/**
 * How late or how soon an invoice is due, as a tag: "201 days late" in red,
 * "Due in 5 days" in amber (3.0.11). Nothing when neither applies.
 *
 * Invoices, the customer page and the invoice dialog each built this tag from
 * the same two calls; it lives here once (3.0.16).
 */
export function InvoiceAttentionTag({ invoice, today }: Props) {
  const look = invoiceAttentionLook(invoiceAttention(invoice, today));
  if (!look) return null;
  const code = look.tone === "danger" ? "overdue" : "due_soon";
  return <StatusTag status={code} looks={{ [code]: look }} />;
}

/**
 * A list's Status cell: how late or how soon, when that is the point, and
 * otherwise the invoice's own status (Draft, Paid, Void…).
 */
export function InvoiceStatusTag({ invoice, today }: Props) {
  // Decided here rather than by rendering InvoiceAttentionTag and falling back:
  // an element that renders nothing is still an element, never null.
  if (invoiceAttentionLook(invoiceAttention(invoice, today))) {
    return <InvoiceAttentionTag invoice={invoice} today={today} />;
  }
  return <StatusTag status={invoice.status} labels={PAID_LABELS} />;
}
