import type { DerivedWorkItem, Severity } from "@/lib/domain/work-surface/types";
import type { KindFilter, SurfaceNouns } from "@/lib/domain/work-surface/lifecycle";

/**
 * The work Sales has: who to chase, what to apply, what to send out.
 *
 * As on Banking, there is no control-failure builder. All three of this
 * surface's checks summarise work the queue itemises — overdue receivables *are*
 * the overdue invoices — so a control row would be the same work twice. Nothing
 * here blocks, and everything can be dismissed with a reason; dismissing a chase
 * hides the row while the control goes on counting the debt.
 */

export type SalesSourceKind = "overdue-invoice" | "unapplied-receipt" | "stale-draft";

export const SALES_NOUNS: SurfaceNouns = {
  blocking: "a collection",
  records: "the invoices",
};

export const SALES_KIND_FILTERS: readonly KindFilter[] = [
  { id: "chasing", label: "To chase", kinds: ["overdue-invoice"] },
  { id: "applying", label: "To apply", kinds: ["unapplied-receipt"] },
  { id: "billing", label: "To bill", kinds: ["stale-draft"] },
];

/** How many overdue invoices reach the queue. The control carries the true total. */
export const QUEUE_OVERDUE_LIMIT = 50;

/** A draft older than this is worth asking about. */
export const DRAFT_STALE_AFTER_DAYS = 7;

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * How urgent an overdue invoice is.
 *
 * Days past due decide the tier; the company's materiality threshold can raise
 * one. **Money never lowers a severity** — a small debt three months late is
 * still three months late, and quietly demoting it would hide exactly the
 * long-tail cases nobody chases.
 *
 * With no threshold set, amount plays no part at all rather than falling back to
 * a number nobody chose.
 */
export function overdueSeverity(
  daysPastDue: number,
  balanceMinor: number,
  materialityMinor: number | null,
): Severity {
  const byAge: Severity =
    daysPastDue > 90 ? "critical" : daysPastDue > 60 ? "high" : daysPastDue > 30 ? "medium" : "low";
  if (materialityMinor === null || Math.abs(balanceMinor) < materialityMinor) return byAge;
  // Material and late: one tier up, never down.
  const raised: Record<Severity, Severity> = {
    low: "medium",
    medium: "high",
    high: "critical",
    critical: "critical",
  };
  return raised[byAge];
}

/**
 * One overdue document.
 *
 * Identified by its own number rather than a row id, because that is what an
 * ageing row carries — it names a customer and a document, never an invoice id.
 * A document number is write-once and never reused (migration 0066), so it makes
 * a more stable work key than an id would: the same debt keeps the same key
 * across every read, which is what lets somebody's decision about it survive.
 */
export function overdueInvoiceItem(
  invoice: {
    docType: string;
    docNumber: string | null;
    customerName: string;
    dueDate: string;
    balanceMinor: number;
  },
  input: { daysPastDue: number; materialityMinor: number | null; confirmedAt: string },
): DerivedWorkItem {
  // An unnumbered overdue document should not exist — a document is numbered
  // when it is issued, and only an issued one can be overdue. Falling back to
  // the customer and due date keeps the key stable if one ever appears, rather
  // than giving every such row the same key.
  const identity = invoice.docNumber ?? `${invoice.customerName}:${invoice.dueDate}`;
  return {
    key: `ar-overdue:${invoice.docType}:${identity}`,
    sourceKind: "overdue-invoice",
    sourceId: invoice.docNumber,
    title: invoice.docNumber ? `Invoice ${invoice.docNumber}` : "Unnumbered invoice",
    reason: `${invoice.customerName} · due ${invoice.dueDate} · ${plural(input.daysPastDue, "day")} past due`,
    severity: overdueSeverity(input.daysPastDue, invoice.balanceMinor, input.materialityMinor),
    amountMinor: Math.abs(invoice.balanceMinor),
    ageDays: input.daysPastDue,
    href: "/invoices",
    actionLabel: "Chase",
    confirmedAt: input.confirmedAt,
    blocking: false,
  };
}

export function unappliedReceiptItem(
  payment: {
    id: string;
    number: string | null;
    customerName: string;
    paymentDate: string;
    unappliedMinor: number;
  },
  input: { ageDays: number; confirmedAt: string },
): DerivedWorkItem {
  return {
    key: `ar-unapplied:${payment.id}`,
    sourceKind: "unapplied-receipt",
    sourceId: payment.id,
    title: payment.number ? `Payment ${payment.number}` : "Customer payment",
    reason: `${payment.customerName} · received ${payment.paymentDate} · not applied to any invoice`,
    // Applying a receipt is quick and it stops a wrong chase, so it outranks
    // most debts by age alone.
    severity: input.ageDays > 30 ? "high" : "medium",
    amountMinor: Math.abs(payment.unappliedMinor),
    ageDays: input.ageDays,
    href: "/payments",
    actionLabel: "Apply",
    confirmedAt: input.confirmedAt,
    blocking: false,
  };
}

export function staleDraftItem(
  invoice: { id: string; customerName: string; issueDate: string; totalMinor: number },
  input: { ageDays: number; confirmedAt: string },
): DerivedWorkItem {
  return {
    key: `ar-draft:${invoice.id}`,
    sourceKind: "stale-draft",
    sourceId: invoice.id,
    title: `Draft invoice for ${invoice.customerName}`,
    reason: `Dated ${invoice.issueDate} · ${plural(input.ageDays, "day")} in draft · nobody has been asked to pay it`,
    severity: input.ageDays > 30 ? "high" : "medium",
    amountMinor: Math.abs(invoice.totalMinor),
    ageDays: input.ageDays,
    href: "/invoices?status=draft",
    actionLabel: "Issue",
    confirmedAt: input.confirmedAt,
    blocking: false,
  };
}
