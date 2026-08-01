/**
 * How a document's balance got to where it is.
 *
 * Pure. The database reports every settlement against a document — payments,
 * credits applied, write-offs — and this turns them into the history a person
 * reads: in date order, each with what the balance was after it.
 */

export type SettlementType = "payment" | "credit_memo" | "vendor_credit" | "write_off";

export interface SettlementEvent {
  settledOn: string;
  settlementType: SettlementType;
  documentNumber: string | null;
  method: string | null;
  reference: string | null;
  memo: string | null;
  amountMinor: number;
  /** The journal entry this settlement produced, when it has one. */
  entryNumber?: string | null;
}

export interface SettlementLine extends SettlementEvent {
  /** What the document still owed after this settlement landed. */
  balanceAfterMinor: number;
}

export interface SettlementHistory {
  lines: SettlementLine[];
  settledMinor: number;
  /** The document's own balance; it must equal total less what settled. */
  balanceDueMinor: number;
  /** True when the two disagree — the one thing this screen must not hide. */
  reconciles: boolean;
}

const TYPE_LABELS: Record<SettlementType, string> = {
  payment: "Payment",
  credit_memo: "Credit memo",
  vendor_credit: "Vendor credit",
  write_off: "Write-off",
};

export function settlementTypeLabel(type: SettlementType): string {
  return TYPE_LABELS[type] ?? type;
}

/**
 * The running balance of one document, oldest settlement first.
 *
 * `reconciles` compares the arithmetic against the balance the document itself
 * carries. They can only differ if something settled the document outside the
 * three paths the database reports, which is worth seeing rather than papering
 * over with a recomputed figure.
 */
export function buildSettlementHistory(input: {
  totalMinor: number;
  balanceDueMinor: number;
  events: readonly SettlementEvent[];
}): SettlementHistory {
  const events = [...input.events].sort((a, b) => {
    if (a.settledOn !== b.settledOn) return a.settledOn.localeCompare(b.settledOn);
    return (a.documentNumber ?? "").localeCompare(b.documentNumber ?? "");
  });

  let running = input.totalMinor;
  const lines = events.map((event) => {
    running -= event.amountMinor;
    return { ...event, balanceAfterMinor: running };
  });

  const settledMinor = events.reduce((sum, event) => sum + event.amountMinor, 0);
  return {
    lines,
    settledMinor,
    balanceDueMinor: input.balanceDueMinor,
    reconciles: input.totalMinor - settledMinor === input.balanceDueMinor,
  };
}

/** The last date money (or a credit) actually landed, or null if none has. */
export function lastSettlementDate(history: SettlementHistory): string | null {
  return history.lines.length ? history.lines[history.lines.length - 1].settledOn : null;
}

/**
 * Whole days between two ISO dates. Both are calendar dates, so this counts
 * days, not hours — a document issued yesterday is one day old regardless of
 * the time of day it was raised.
 */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}

export interface OutstandingAge {
  /** Days since the document was issued. */
  ageDays: number;
  /** Days past the due date; 0 when it is not yet due. */
  overdueDays: number;
  isOverdue: boolean;
}

/** How old an open document is, and how far past its due date. */
export function outstandingAge(input: {
  issueDate: string;
  dueDate: string | null;
  asOf: string;
}): OutstandingAge {
  const ageDays = Math.max(0, daysBetween(input.issueDate, input.asOf));
  const overdueDays = input.dueDate
    ? Math.max(0, daysBetween(input.dueDate, input.asOf))
    : 0;
  return { ageDays, overdueDays, isOverdue: overdueDays > 0 };
}
