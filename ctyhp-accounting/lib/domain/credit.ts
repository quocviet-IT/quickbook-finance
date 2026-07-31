/**
 * Customer credit control.
 *
 * Pure. Given a customer's limit and what the ledger says they already owe,
 * this decides what the screens show and what the invoice screen warns about.
 * The database enforces the same rule at the moment of issue; this is what
 * lets someone see it coming.
 *
 * No balance is stored anywhere: `openBalanceMinor` always arrives from the
 * open invoices, so a credit decision can never be made against a stale copy.
 */

export interface CustomerCreditInput {
  /** Null means no limit has been set for this customer; nothing is enforced. */
  creditLimitMinor: number | null;
  creditHold: boolean;
  openBalanceMinor: number;
  overdueMinor: number;
  /** Total invoiced over the sales window, for days sales outstanding. */
  salesWindowMinor?: number;
  salesWindowDays?: number;
}

export type CreditState = "hold" | "over_limit" | "near_limit" | "within_limit" | "no_limit";

export interface CreditStatus {
  state: CreditState;
  label: string;
  /** Limit less what is already owed; null when no limit is set. */
  availableMinor: number | null;
  /** 0–1 of the limit already used; null when no limit is set. */
  utilization: number | null;
  overdueMinor: number;
  /** Days sales outstanding, null when nothing was invoiced in the window. */
  daysSalesOutstanding: number | null;
  /** Everything wrong with this account, worst first, in plain words. */
  reasons: string[];
}

/** Utilisation at which the screens start warning rather than reassuring. */
export const CREDIT_WARNING_THRESHOLD = 0.8;

const STATE_LABELS: Record<CreditState, string> = {
  hold: "On credit hold",
  over_limit: "Over limit",
  near_limit: "Near limit",
  within_limit: "Within limit",
  no_limit: "No limit set",
};

export function creditStateLabel(state: CreditState): string {
  return STATE_LABELS[state];
}

/** Ant Design tag colours, so every screen paints a state the same way. */
export function creditStateColor(state: CreditState): string {
  switch (state) {
    case "hold":
    case "over_limit":
      return "red";
    case "near_limit":
      return "orange";
    case "within_limit":
      return "green";
    default:
      return "default";
  }
}

function money(minor: number): string {
  return `$${(minor / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
}

/**
 * Days sales outstanding: the average number of days an invoice stays unpaid,
 * measured as the balance against what was invoiced over the window. Null when
 * nothing was invoiced — a ratio with no denominator is not a zero.
 */
export function daysSalesOutstanding(
  openBalanceMinor: number,
  salesWindowMinor: number,
  windowDays: number,
): number | null {
  if (salesWindowMinor <= 0 || windowDays <= 0) return null;
  return Math.round((openBalanceMinor / salesWindowMinor) * windowDays);
}

export function creditStatus(input: CustomerCreditInput): CreditStatus {
  const {
    creditLimitMinor,
    creditHold,
    openBalanceMinor,
    overdueMinor,
    salesWindowMinor = 0,
    salesWindowDays = 90,
  } = input;

  const available = creditLimitMinor === null ? null : creditLimitMinor - openBalanceMinor;
  const utilization =
    creditLimitMinor === null
      ? null
      : creditLimitMinor === 0
        ? openBalanceMinor > 0
          ? 1
          : 0
        : openBalanceMinor / creditLimitMinor;

  const reasons: string[] = [];
  if (creditHold) reasons.push("The account is on credit hold");
  if (available !== null && available < 0) {
    reasons.push(`${money(-available)} over the ${money(creditLimitMinor!)} limit`);
  }
  if (overdueMinor > 0) reasons.push(`${money(overdueMinor)} is past due`);

  let state: CreditState;
  if (creditHold) state = "hold";
  else if (creditLimitMinor === null) state = "no_limit";
  else if (openBalanceMinor > creditLimitMinor) state = "over_limit";
  else if ((utilization ?? 0) >= CREDIT_WARNING_THRESHOLD) state = "near_limit";
  else state = "within_limit";

  return {
    state,
    label: STATE_LABELS[state],
    availableMinor: available,
    utilization,
    overdueMinor,
    daysSalesOutstanding: daysSalesOutstanding(
      openBalanceMinor,
      salesWindowMinor,
      salesWindowDays,
    ),
    reasons,
  };
}

export interface InvoiceCreditCheck {
  /** True when the database will refuse this invoice without an override. */
  blocked: boolean;
  /** Worth saying out loud even though the invoice is allowed. */
  warning: boolean;
  projectedBalanceMinor: number;
  projectedAvailableMinor: number | null;
  message: string | null;
}

/**
 * What issuing this invoice would do to the account. Mirrors the guard inside
 * `acc_issue_invoice`: on hold, or pushing the balance past the limit, means
 * the issue is refused unless someone overrides it with a reason.
 */
export function checkInvoiceAgainstCredit(input: {
  status: CreditStatus;
  creditLimitMinor: number | null;
  creditHold: boolean;
  openBalanceMinor: number;
  invoiceTotalMinor: number;
  hasBillingAddress?: boolean;
}): InvoiceCreditCheck {
  const { creditLimitMinor, creditHold, openBalanceMinor, invoiceTotalMinor } = input;
  const projected = openBalanceMinor + invoiceTotalMinor;
  const projectedAvailable = creditLimitMinor === null ? null : creditLimitMinor - projected;

  const blocked = creditHold || (creditLimitMinor !== null && projected > creditLimitMinor);

  const notes: string[] = [];
  if (creditHold) {
    notes.push("This customer is on credit hold.");
  } else if (blocked) {
    notes.push(
      `This invoice takes the balance to ${money(projected)}, past the ${money(creditLimitMinor!)} limit.`,
    );
  } else if (
    creditLimitMinor !== null &&
    creditLimitMinor > 0 &&
    projected / creditLimitMinor >= CREDIT_WARNING_THRESHOLD
  ) {
    notes.push(
      `This invoice uses ${Math.round((projected / creditLimitMinor) * 100)}% of the ${money(creditLimitMinor)} limit.`,
    );
  }
  if (input.status.overdueMinor > 0) {
    notes.push(`${money(input.status.overdueMinor)} is already past due.`);
  }
  if (input.hasBillingAddress === false) {
    // Not an accounting problem — the invoice simply prints without a Bill to.
    notes.push("No billing address on file; the printed invoice will have no Bill to block.");
  }

  return {
    blocked,
    warning: notes.length > 0 && !blocked,
    projectedBalanceMinor: projected,
    projectedAvailableMinor: projectedAvailable,
    message: notes.length ? notes.join(" ") : null,
  };
}

export interface CreditExposureRow {
  customerId: string;
  name: string;
  status: CreditStatus;
  creditLimitMinor: number | null;
  openBalanceMinor: number;
}

/** The accounts a collections review opens with: hold, then over, then near. */
export function sortByCreditRisk<T extends { status: CreditStatus; openBalanceMinor: number }>(
  rows: readonly T[],
): T[] {
  const rank: Record<CreditState, number> = {
    hold: 0,
    over_limit: 1,
    near_limit: 2,
    within_limit: 3,
    no_limit: 4,
  };
  return [...rows].sort((a, b) => {
    const byState = rank[a.status.state] - rank[b.status.state];
    if (byState !== 0) return byState;
    return b.openBalanceMinor - a.openBalanceMinor;
  });
}
