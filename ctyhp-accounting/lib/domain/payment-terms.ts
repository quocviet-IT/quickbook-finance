/**
 * Vendor payment terms, and deciding which bill to pay next.
 *
 * Pure. Two jobs live here:
 *
 * 1. Reading terms a person wrote — "Net 30", "1/10 net 30" — into numbers the
 *    system can compute a due date and a discount from.
 * 2. Ranking open bills, because a list sorted by date does not say *why* one
 *    bill should be paid before another, and that is the whole question.
 */

export interface PaymentTerms {
  /** Days from the bill date until the full amount is due. */
  netDays: number;
  /** Percentage off for paying early; 0 when the vendor offers none. */
  discountPercent: number;
  /** Days from the bill date within which the discount can be taken. */
  discountDays: number;
}

export const DEFAULT_TERMS: PaymentTerms = { netDays: 30, discountPercent: 0, discountDays: 0 };

/**
 * Read terms written as a person writes them.
 *
 * Understands `Net 30`, `net30`, `Due on receipt`, `COD`, and the discount
 * shorthand every US supplier uses — `1/10 net 30`, `2/10, n/30`. Anything it
 * cannot read comes back null rather than guessing, because a guessed due date
 * is worse than an empty one.
 */
export function parsePaymentTerms(raw: string | null | undefined): PaymentTerms | null {
  const text = (raw ?? "").trim().toLowerCase();
  if (text === "") return null;

  // "1/10 net 30" or "2/10, n/30" — discount, its window, then the net days.
  const discount = text.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+)\s*,?\s*(?:net|n)\s*\/?\s*(\d+)/);
  if (discount) {
    return {
      netDays: Number(discount[3]),
      discountPercent: Number(discount[1]),
      discountDays: Number(discount[2]),
    };
  }

  if (/due on receipt|on receipt|^cod$|cash on delivery|immediate/.test(text)) {
    return { netDays: 0, discountPercent: 0, discountDays: 0 };
  }

  const net = text.match(/(?:net|n)\s*\/?\s*(\d+)/);
  if (net) return { netDays: Number(net[1]), discountPercent: 0, discountDays: 0 };

  const bare = text.match(/^(\d+)\s*days?$/);
  if (bare) return { netDays: Number(bare[1]), discountPercent: 0, discountDays: 0 };

  return null;
}

/** How the terms should read back to a person. */
export function describeTerms(terms: PaymentTerms): string {
  const net = terms.netDays === 0 ? "Due on receipt" : `Net ${terms.netDays}`;
  if (terms.discountPercent <= 0) return net;
  return `${trimNumber(terms.discountPercent)}/${terms.discountDays} ${net.toLowerCase()}`;
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function dueDateFrom(billDate: string, terms: PaymentTerms): string {
  return addDays(billDate, terms.netDays);
}

export function discountDueDateFrom(billDate: string, terms: PaymentTerms): string | null {
  return terms.discountPercent > 0 ? addDays(billDate, terms.discountDays) : null;
}

/** Half-up to the cent, the way the database rounds it. */
export function discountAmountMinor(totalMinor: number, terms: PaymentTerms): number {
  if (terms.discountPercent <= 0) return 0;
  return Math.floor((totalMinor * terms.discountPercent) / 100 + 0.5);
}

/**
 * What taking the discount is worth, expressed as an annual rate.
 *
 * This is the number that settles the argument. 1/10 net 30 means paying 20
 * days early for 1% — about 18% a year, which beats anything the cash would
 * earn sitting in the bank. Returns null when there is no discount, or when
 * the discount window is the whole term and there is nothing to give up.
 */
export function discountAnnualisedRate(terms: PaymentTerms): number | null {
  if (terms.discountPercent <= 0) return null;
  const daysEarly = terms.netDays - terms.discountDays;
  if (daysEarly <= 0) return null;
  return (terms.discountPercent / (100 - terms.discountPercent)) * (365 / daysEarly);
}

// --- Which bill to pay next -------------------------------------------------

export interface PayableBill {
  billId: string;
  billNumber: string | null;
  vendorId: string;
  vendorName: string;
  billDate: string;
  dueDate: string | null;
  termsLabel: string | null;
  currencyCode: string;
  totalMinor: number;
  balanceDueMinor: number;
  discountDueDate: string | null;
  discountAmountMinor: number;
  discountTakenMinor: number;
  status: string;
}

/**
 * Why this bill is where it is in the list. The order of the union is the order
 * of the list, and it is the whole argument of the screen.
 */
export type PayPriority = "overdue" | "discount_expiring" | "due_soon" | "scheduled";

export const PRIORITY_LABEL: Record<PayPriority, string> = {
  overdue: "Overdue",
  discount_expiring: "Discount expiring",
  due_soon: "Due soon",
  scheduled: "Scheduled",
};

const PRIORITY_ORDER: PayPriority[] = ["overdue", "discount_expiring", "due_soon", "scheduled"];

/** Bills falling due inside this many days are worth looking at now. */
export const DUE_SOON_DAYS = 14;
/** A discount worth chasing before it lapses. */
export const DISCOUNT_WARNING_DAYS = 7;

export interface RankedBill extends PayableBill {
  priority: PayPriority;
  /** Positive when the bill is late; negative while it still has time. */
  daysOverdue: number | null;
  /** Days until the discount lapses; null when there is none left to take. */
  daysToDiscount: number | null;
  /** What is still on the table if it is paid inside the window. */
  discountAvailableMinor: number;
  /** What the bank would actually pay today, discount included. */
  payTodayMinor: number;
  reason: string;
}

export function rankPayable(bill: PayableBill, today: string): RankedBill {
  const daysOverdue = bill.dueDate ? daysBetween(bill.dueDate, today) : null;

  const remaining = Math.max(0, bill.discountAmountMinor - bill.discountTakenMinor);
  const discountLive =
    remaining > 0 && bill.discountDueDate !== null && daysBetween(today, bill.discountDueDate) >= 0;
  const daysToDiscount = discountLive ? daysBetween(today, bill.discountDueDate!) : null;
  const discountAvailableMinor = discountLive ? Math.min(remaining, bill.balanceDueMinor) : 0;

  let priority: PayPriority;
  let reason: string;

  if (daysOverdue !== null && daysOverdue > 0) {
    priority = "overdue";
    reason = `${daysOverdue} day(s) overdue`;
  } else if (discountLive) {
    priority = daysToDiscount! <= DISCOUNT_WARNING_DAYS ? "discount_expiring" : "scheduled";
    reason =
      `Discount of ${(discountAvailableMinor / 100).toFixed(2)} ` +
      `until ${bill.discountDueDate}${daysToDiscount === 0 ? " — today" : ` (${daysToDiscount} day(s))`}`;
  } else if (daysOverdue !== null && daysOverdue >= -DUE_SOON_DAYS) {
    priority = "due_soon";
    reason = daysOverdue === 0 ? "Due today" : `Due in ${-daysOverdue} day(s)`;
  } else if (daysOverdue === null) {
    // No due date at all: it cannot be scheduled, so it needs a person.
    priority = "due_soon";
    reason = "No due date on this bill";
  } else {
    priority = "scheduled";
    reason = `Due ${bill.dueDate}`;
  }

  return {
    ...bill,
    priority,
    daysOverdue,
    daysToDiscount,
    discountAvailableMinor,
    payTodayMinor: bill.balanceDueMinor - discountAvailableMinor,
    reason,
  };
}

export interface PayRunTotals {
  overdueMinor: number;
  dueSoonMinor: number;
  scheduledMinor: number;
  /** Money still on the table in unexpired discounts. */
  discountAvailableMinor: number;
  totalMinor: number;
}

export interface PayRun {
  asOf: string;
  rows: RankedBill[];
  totals: PayRunTotals;
}

/**
 * The pay run: every open bill, worst first.
 *
 * Within a band the order is by urgency — the most overdue, then the discount
 * about to lapse, then the nearest due date — and ties break on the larger
 * balance, because if two bills are equally late the bigger one moves the
 * relationship more.
 */
export function buildPayRun(bills: readonly PayableBill[], today: string): PayRun {
  const rows = bills
    .map((bill) => rankPayable(bill, today))
    .sort((a, b) => {
      const band = PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority);
      if (band !== 0) return band;
      if (a.priority === "discount_expiring") {
        const byDiscount = (a.daysToDiscount ?? 0) - (b.daysToDiscount ?? 0);
        if (byDiscount !== 0) return byDiscount;
      } else {
        const byDays = (b.daysOverdue ?? -9999) - (a.daysOverdue ?? -9999);
        if (byDays !== 0) return byDays;
      }
      return b.balanceDueMinor - a.balanceDueMinor;
    });

  const sum = (predicate: (row: RankedBill) => boolean) =>
    rows.filter(predicate).reduce((total, row) => total + row.balanceDueMinor, 0);

  return {
    asOf: today,
    rows,
    totals: {
      overdueMinor: sum((row) => row.priority === "overdue"),
      dueSoonMinor: sum((row) => row.priority === "due_soon" || row.priority === "discount_expiring"),
      scheduledMinor: sum((row) => row.priority === "scheduled"),
      discountAvailableMinor: rows.reduce((total, row) => total + row.discountAvailableMinor, 0),
      totalMinor: rows.reduce((total, row) => total + row.balanceDueMinor, 0),
    },
  };
}

/** The line that goes above the pay run. Null when there is nothing pressing. */
export function describePayRun(run: PayRun): string | null {
  const overdue = run.rows.filter((row) => row.priority === "overdue");
  const expiring = run.rows.filter((row) => row.priority === "discount_expiring");
  if (overdue.length === 0 && expiring.length === 0) return null;

  const parts: string[] = [];
  if (overdue.length > 0) {
    const worst = overdue[0];
    parts.push(
      `${overdue.length} bill(s) overdue, ${(run.totals.overdueMinor / 100).toFixed(2)} in total — ` +
        `the oldest is ${worst.vendorName} at ${worst.daysOverdue} days`,
    );
  }
  if (expiring.length > 0) {
    parts.push(
      `${(run.totals.discountAvailableMinor / 100).toFixed(2)} of early payment discount lapses within ` +
        `${DISCOUNT_WARNING_DAYS} days`,
    );
  }
  return `${parts.join(". ")}.`;
}
