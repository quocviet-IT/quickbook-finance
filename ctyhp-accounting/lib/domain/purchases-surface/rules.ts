import type { DerivedWorkItem, Severity, SurfaceControl } from "@/lib/domain/work-surface/types";
import type { KindFilter, SurfaceNouns } from "@/lib/domain/work-surface/lifecycle";

/**
 * What Purchases checks, and what it hands somebody to do.
 *
 * The job the design document gives this screen is three questions at once —
 * *what must be paid, what has arrived, and what does not add up* — so it has
 * three checks and three kinds of work, one for each. That is the whole reason
 * this screen is not Sales with the direction reversed: money going out has a
 * receiving side, and a bill that does not match what arrived is a different
 * problem from a bill that is simply late.
 *
 * Pure by design: plain numbers in, a status and a sentence out.
 */

function money(minor: number): string {
  return (Math.abs(minor) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 });
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export const PURCHASES_NOUNS: SurfaceNouns = {
  blocking: "a payment run",
  records: "the bills",
};

export const PURCHASES_KIND_FILTERS: readonly KindFilter[] = [
  { id: "paying", label: "To pay", kinds: ["bill-due"] },
  { id: "receiving", label: "To bill", kinds: ["received-not-billed"] },
  { id: "applying", label: "To apply", kinds: ["unapplied-payment"] },
];

/** How many due bills reach the queue. The control carries the true total. */
export const QUEUE_BILL_LIMIT = 50;

/**
 * A bill inside this many days of its due date is worth showing.
 *
 * Not a policy field: this is what "due soon" means on a screen about paying
 * bills, and a company that wants a different rhythm changes its payment terms,
 * which is where that decision belongs.
 */
export const DUE_SOON_DAYS = 7;

// --- Controls --------------------------------------------------------------

/**
 * Nothing owed has gone past its due date, and what is due soon is known.
 *
 * Late here costs a supplier relationship and sometimes a discount, so an
 * overdue bill is `attention` even when nothing is due yet.
 */
export function billsDueControl(input: {
  /** Null when the payables could not be read. */
  overdueCount: number | null;
  overdueMinor: number;
  dueSoonCount: number;
  dueSoonMinor: number;
  evaluatedAt: string;
}): SurfaceControl {
  const base = {
    key: "bills-due",
    title: "Nothing owed is late",
    passCondition: "Every open bill is within its payment terms.",
    evaluatedAt: input.evaluatedAt,
    href: "/bills",
    blocking: false,
  };
  if (input.overdueCount === null) {
    return { ...base, status: "unavailable" as const, detail: "The payables could not be read." };
  }
  const soon =
    input.dueSoonCount === 0
      ? ""
      : ` ${plural(input.dueSoonCount, "bill")} due within ${DUE_SOON_DAYS} days, ${money(input.dueSoonMinor)}.`;
  if (input.overdueCount === 0) {
    return {
      ...base,
      status: "healthy" as const,
      detail: `Every open bill is within terms.${soon}`,
    };
  }
  return {
    ...base,
    status: "attention" as const,
    detail: `${plural(input.overdueCount, "bill")} overdue, ${money(input.overdueMinor)}.${soon}`,
    differenceMinor: Math.abs(input.overdueMinor),
  };
}

/**
 * Everything received has been billed.
 *
 * The check most worth having on this screen and the one no other screen runs.
 * Goods that arrived and were never billed are a liability the ledger carries in
 * a holding account and nobody is chasing — the supplier will, eventually, and
 * usually at the worst moment.
 */
export function receivedNotBilledControl(input: {
  /** Null when the receiving data could not be read. */
  lineCount: number | null;
  valueMinor: number;
  oldestAgeDays: number | null;
  evaluatedAt: string;
}): SurfaceControl {
  const base = {
    key: "received-not-billed",
    title: "What arrived has been billed",
    passCondition: "No purchase order line has been received without a bill against it.",
    evaluatedAt: input.evaluatedAt,
    href: "/purchase-orders",
    blocking: false,
  };
  if (input.lineCount === null) {
    return {
      ...base,
      status: "unavailable" as const,
      detail: "The receiving records could not be read.",
    };
  }
  if (input.lineCount === 0) {
    return {
      ...base,
      status: "healthy" as const,
      detail: "Everything received has a bill against it.",
    };
  }
  const oldest =
    input.oldestAgeDays === null
      ? ""
      : ` The oldest was ordered ${plural(input.oldestAgeDays, "day")} ago.`;
  return {
    ...base,
    status: "attention" as const,
    detail: `${plural(input.lineCount, "line")} received and not billed, ${money(input.valueMinor)} the supplier has not invoiced yet.${oldest}`,
    differenceMinor: Math.abs(input.valueMinor),
  };
}

/** Money paid out has been applied to a bill. */
export function unappliedPaymentsControl(input: {
  count: number | null;
  amountMinor: number;
  evaluatedAt: string;
}): SurfaceControl {
  const base = {
    key: "unapplied-payments",
    title: "Payments are applied to bills",
    passCondition: "No payment to a supplier is sitting unapplied.",
    evaluatedAt: input.evaluatedAt,
    href: "/bill-payments",
    blocking: false,
  };
  if (input.count === null) {
    return {
      ...base,
      status: "unavailable" as const,
      detail: "The supplier payments could not be read.",
    };
  }
  if (input.count === 0) {
    return { ...base, status: "healthy" as const, detail: "Every payment is applied." };
  }
  return {
    ...base,
    status: "attention" as const,
    detail: `${plural(input.count, "payment")} holding ${money(input.amountMinor)} not applied to any bill — those suppliers look unpaid when they have been paid.`,
    differenceMinor: Math.abs(input.amountMinor),
  };
}

// --- Work items ------------------------------------------------------------

/**
 * How urgent a bill is.
 *
 * Overdue outranks due-soon, and materiality can raise a tier but never lower
 * one. A small bill two months late is still two months late.
 */
export function billSeverity(
  daysPastDue: number,
  balanceMinor: number,
  materialityMinor: number | null,
): Severity {
  const byAge: Severity =
    daysPastDue > 60 ? "critical" : daysPastDue > 30 ? "high" : daysPastDue > 0 ? "medium" : "low";
  if (materialityMinor === null || Math.abs(balanceMinor) < materialityMinor) return byAge;
  const raised: Record<Severity, Severity> = {
    low: "medium",
    medium: "high",
    high: "critical",
    critical: "critical",
  };
  return raised[byAge];
}

export function billDueItem(
  bill: {
    id: string;
    number: string | null;
    vendorName: string;
    dueDate: string;
    balanceMinor: number;
  },
  input: { daysPastDue: number; materialityMinor: number | null; confirmedAt: string },
): DerivedWorkItem {
  const when =
    input.daysPastDue > 0
      ? `${plural(input.daysPastDue, "day")} past due`
      : `due ${bill.dueDate}`;
  return {
    key: `ap-bill:${bill.id}`,
    sourceKind: "bill-due",
    sourceId: bill.id,
    title: bill.number ? `Bill ${bill.number}` : "Unnumbered bill",
    reason: `${bill.vendorName} · ${when}`,
    severity: billSeverity(input.daysPastDue, bill.balanceMinor, input.materialityMinor),
    amountMinor: Math.abs(bill.balanceMinor),
    ageDays: Math.max(0, input.daysPastDue),
    href: "/bills",
    actionLabel: "Pay",
    confirmedAt: input.confirmedAt,
    blocking: false,
  };
}

export function receivedNotBilledItem(
  line: {
    lineId: string;
    poNumber: string | null;
    vendorName: string;
    description: string;
    qtyOutstanding: number;
    valueMinor: number;
    orderDate: string;
  },
  input: { ageDays: number; confirmedAt: string },
): DerivedWorkItem {
  return {
    key: `ap-rnb:${line.lineId}`,
    sourceKind: "received-not-billed",
    sourceId: line.lineId,
    title: line.description.trim() || "Received goods",
    reason: `${line.vendorName} · ${line.poNumber ? `PO ${line.poNumber}` : "unnumbered order"} · ${line.qtyOutstanding} received and not billed since ${line.orderDate}`,
    severity: input.ageDays > 60 ? "high" : "medium",
    amountMinor: Math.abs(line.valueMinor),
    ageDays: input.ageDays,
    href: "/purchase-orders",
    actionLabel: "Bill",
    confirmedAt: input.confirmedAt,
    blocking: false,
  };
}

export function unappliedPaymentItem(
  payment: {
    id: string;
    number: string | null;
    vendorName: string;
    paymentDate: string;
    unappliedMinor: number;
  },
  input: { ageDays: number; confirmedAt: string },
): DerivedWorkItem {
  return {
    key: `ap-unapplied:${payment.id}`,
    sourceKind: "unapplied-payment",
    sourceId: payment.id,
    title: payment.number ? `Payment ${payment.number}` : "Supplier payment",
    reason: `${payment.vendorName} · paid ${payment.paymentDate} · not applied to any bill`,
    severity: input.ageDays > 30 ? "high" : "medium",
    amountMinor: Math.abs(payment.unappliedMinor),
    ageDays: input.ageDays,
    href: "/bill-payments",
    actionLabel: "Apply",
    confirmedAt: input.confirmedAt,
    blocking: false,
  };
}
