/**
 * Which invoices need attention first, and what the list says about them.
 *
 * Pure. The invoice list used to open by number, newest first, so the invoice
 * 296 days past due sat at the bottom. It now opens with what needs doing:
 * overdue (oldest due date first), then due within a week, then drafts
 * waiting to be issued, then everything else, newest first (3.0.11).
 *
 * "Overdue" is isOverdueDocument's rule, the one the Overdue filter and the
 * dashboard's work queue use, so the three can never disagree.
 */
import { isOverdueDocument } from "@/lib/domain/document-filter";
import { daysBetween } from "@/lib/domain/payment-terms";
import type { StatusLook } from "@/lib/domain/status-label";
import type { InvoiceStatus } from "@/lib/db/types";

/** "Due soon" is due today or within this many days. */
export const DUE_SOON_DAYS = 7;

export interface AttentionInvoice {
  id: string;
  status: InvoiceStatus;
  invoice_number: string | null;
  due_date: string | null;
  total_minor: number;
  balance_due_minor: number;
  created_at: string;
}

export type InvoiceAttention =
  | { kind: "overdue"; days: number }
  /** `days` until due: 0 is today. */
  | { kind: "due-soon"; days: number }
  | { kind: "draft" }
  | { kind: "other" };

const GROUP: Record<InvoiceAttention["kind"], number> = { overdue: 0, "due-soon": 1, draft: 2, other: 3 };

export function invoiceAttention(invoice: AttentionInvoice, today: string): InvoiceAttention {
  if (invoice.status === "draft") return { kind: "draft" };
  const open = { status: invoice.status, dueDate: invoice.due_date, balanceDueMinor: invoice.balance_due_minor };
  if (isOverdueDocument(open, today)) return { kind: "overdue", days: daysBetween(invoice.due_date!, today) };
  if (invoice.status !== "void" && invoice.balance_due_minor > 0 && invoice.due_date) {
    const days = daysBetween(today, invoice.due_date);
    if (days >= 0 && days <= DUE_SOON_DAYS) return { kind: "due-soon", days };
  }
  return { kind: "other" };
}

/** A sorted copy: attention groups in order, each by the date that matters to it. */
export function sortInvoicesByAttention<T extends AttentionInvoice>(invoices: readonly T[], today: string): T[] {
  const keyed = invoices.map((invoice) => ({ invoice, attention: invoiceAttention(invoice, today) }));
  keyed.sort((a, b) => {
    const group = GROUP[a.attention.kind] - GROUP[b.attention.kind];
    if (group !== 0) return group;
    switch (a.attention.kind) {
      case "overdue":
      case "due-soon":
        return (a.invoice.due_date ?? "").localeCompare(b.invoice.due_date ?? "");
      case "draft":
        return b.invoice.created_at.localeCompare(a.invoice.created_at);
      default:
        return (b.invoice.invoice_number ?? "").localeCompare(a.invoice.invoice_number ?? "");
    }
  });
  return keyed.map((k) => k.invoice);
}

/**
 * What the status tag says for a row that needs attention; null leaves it to
 * the invoice's own status. Short enough for the list's status cell (124px):
 * "Overdue · 297 days" is 135px and was cut off before its number, while
 * "297 days late" is 103px, with the danger tone and the Overdue tab saying
 * the rest.
 */
export function invoiceAttentionLook(attention: InvoiceAttention): StatusLook | null {
  if (attention.kind === "overdue") {
    return { tone: "danger", label: `${attention.days} ${attention.days === 1 ? "day" : "days"} late` };
  }
  if (attention.kind === "due-soon") {
    const label =
      attention.days === 0 ? "Due today" : attention.days === 1 ? "Due tomorrow" : `Due in ${attention.days} days`;
    return { tone: "warning", label };
  }
  return null;
}

export type InvoiceStatusTab = "all" | "overdue" | InvoiceStatus;

/** How many invoices each status tab holds, by the rule its filter applies. */
export function invoiceStatusCounts(
  invoices: readonly AttentionInvoice[],
  today: string,
): Record<InvoiceStatusTab, number> {
  const counts: Record<InvoiceStatusTab, number> = {
    all: invoices.length,
    overdue: 0,
    draft: 0,
    issued: 0,
    partial: 0,
    paid: 0,
    void: 0,
  };
  for (const invoice of invoices) {
    counts[invoice.status] += 1;
    if (invoiceAttention(invoice, today).kind === "overdue") counts.overdue += 1;
  }
  return counts;
}
