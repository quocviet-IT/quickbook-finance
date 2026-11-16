/**
 * The Dashboard's figures (3.0.38), as the page receives them.
 *
 * Every amount is an integer in minor units of the base currency unless a
 * field says otherwise. A figure the books cannot give exactly is left out
 * (null, or a section marked unavailable), never estimated.
 */

/** One calendar month on the dashboard's charts. */
export interface HomeMonth {
  /** "2026-11" */
  key: string;
  /** "Nov" */
  label: string;
  year: number;
  /**
   * False for a month that starts after the month of the last posted entry and
   * has no ledger activity: not entered yet, which a chart must not draw as zero.
   */
  posted: boolean;
}

/** How far the books are kept: the note above the four figures. */
export interface HomeStatus {
  asOf: string;
  /** The latest posted entry date on or before asOf; null when nothing is posted by then. */
  postedThrough: string | null;
  /** The latest bank line date over every bank and card account, on or before asOf; null when there are none. */
  bankLinesThrough: string | null;
  /** The latest closed period: "September 2026" and its last day. */
  lastClosed: { label: string; periodEnd: string } | null;
  /** postedThrough is before the first day of the previous month. */
  behind: boolean;
  /** Long month names after postedThrough's month through asOf's, oldest first; the latest six at most. */
  missingMonths: string[];
  /** No posted entry at all, on any date. */
  firstUse: boolean;
}

/** The four figures above the tabs. Series are six values, aligned with `months`. */
export interface HomeFigures {
  /** Six months, oldest first; the last is the month to date. */
  months: HomeMonth[];
  cash: { valueMinor: number; series: number[]; changeThisMonthMinor: number };
  netIncome: {
    valueMinor: number;
    series: number[];
    /** Net income over the same days of the previous month; null when that read failed or nothing was posted then. */
    priorSameDaysMinor: number | null;
    /** "vs same days in Oct" */
    compareLabel: string;
  };
  /**
   * valueMinor is the A/R aging total; series are ledger month-end balances (debit positive).
   * ledgerMinor is the Accounts Receivable control balance as of asOf: it differs from
   * valueMinor when the open documents do not add up to the ledger (entries posted
   * straight to the account, or today's exchange rate).
   */
  receivables: { valueMinor: number; ledgerMinor: number; series: number[]; overdueMinor: number; overdueInvoices: number };
  /** valueMinor is the A/P aging total; series are ledger month-end balances, shown positive (credit minus debit). */
  payables: {
    valueMinor: number;
    /** The Accounts Payable control balance as of asOf, shown positive; differs from valueMinor when the open documents do not add up to the ledger. */
    ledgerMinor: number;
    series: number[];
    overdueMinor: number;
    overdueBills: number;
    dueSoonMinor: number;
    dueSoonBills: number;
  };
}

export interface HomeProjection {
  /** asOf + 30 days. */
  through: string;
  /** Open invoices due from asOf through `through`; credits and overdue invoices are not in it. */
  invoicesDueMinor: number;
  /** Open bills due from asOf through `through`; credits and overdue bills are not in it. */
  billsDueMinor: number;
  /** Cash today + invoicesDueMinor - billsDueMinor. */
  projectedMinor: number;
  /** Open invoices already past due: left out of the projection. */
  overdueLeftOutMinor: number;
  /** Open bills already past due: also left out of the projection. */
  overdueBillsLeftOutMinor: number;
}

export interface HomeCash {
  months: HomeMonth[];
  /** Month-end cash (bank-type accounts); the last is today's. */
  balanceMinor: number[];
  /** Debits to bank-type accounts per month, less transfers between them when `transfersExcluded`. */
  inMinor: number[];
  /** Credits to bank-type accounts per month, less transfers between them when `transfersExcluded`. */
  outMinor: number[];
  /**
   * True when a transfer between two of the company's own bank accounts is
   * left out of both money in and money out (3.0.40); false when the
   * transfers could not be read, and the gross figures count it on both sides.
   * Either way, money in minus money out is the month's change in cash.
   */
  transfersExcluded: boolean;
  /** Null while the books are behind (status.behind). */
  projection: HomeProjection | null;
}

export type HomePeriodKey = "month" | "lastMonth" | "quarter" | "year";

export interface HomeExpenseLine {
  /** Null for "Everything else". */
  accountId: string | null;
  name: string;
  amountMinor: number;
}

export interface HomePeriodFigures {
  /** Income and other income. */
  incomeMinor: number;
  /** Cost of goods sold, operating and other expenses. */
  expenseMinor: number;
  netMinor: number;
  /** Income alone, without other income: what the Sales widget shows. */
  salesMinor: number;
}

export interface HomePeriod extends HomePeriodFigures {
  key: HomePeriodKey;
  /** "This month" | "Last month" | "This quarter" | "This year" */
  label: string;
  from: string;
  to: string;
  /** "vs same days in Oct" | "vs Sep 2026" | "vs same days last quarter" | "vs same days last year" */
  compareLabel: string;
  /** Gross profit over income, ×100; null when there is no income. */
  grossMarginPercent: number | null;
  /** The comparable period; null when its read failed or nothing was posted in it. */
  prior: HomePeriodFigures | null;
  /** At most 5: the four largest accounts, largest first, then "Everything else" when anything is left. Sums to expenseMinor. */
  expenses: HomeExpenseLine[];
}

export interface HomeProfit {
  months: HomeMonth[];
  /** Income and other income per month. */
  incomeMinor: number[];
  expenseMinor: number[];
  /** Income alone per month (income.total, without other income). */
  salesMinor: number[];
  periods: Record<HomePeriodKey, HomePeriod>;
}

export interface HomeOpenSide {
  /** What the aging report totals: credits and unapplied payments net it. */
  totalMinor: number;
  /** Open invoices (or bills); credits not counted. */
  documents: number;
  overdueMinor: number;
  overdueDocuments: number;
  /** Due from asOf through asOf + 7 days. */
  dueSoonMinor: number;
  dueSoonDocuments: number;
  laterMinor: number;
  laterDocuments: number;
  /** The negative rows (credits, unapplied payments) as a negative number; 0 when none. */
  creditsMinor: number;
  /** The aging report's buckets; they sum to totalMinor. */
  buckets: { current: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number };
}

export interface HomeOwesLongest {
  customerId: string;
  name: string;
  overdueMinor: number;
  oldestDueDate: string;
  daysLate: number;
}

export interface HomeReceivables extends HomeOpenSide {
  /** The Accounts Receivable control balance as of asOf; equals totalMinor when the aging report ties to the ledger. */
  ledgerMinor: number;
  /** Customer payments dated in the 30 days through asOf, not void. Only base-currency payments are summed. */
  receivedLast30: { baseMinor: number; count: number; otherCurrencyCount: number };
  /** Balance of the undeposited-funds accounts; null when there is none, or when the ledger could not be read. */
  undepositedMinor: number | null;
  /** At most 5, oldest overdue invoice first. */
  owesLongest: HomeOwesLongest[];
}

export interface HomeNextBill {
  vendorName: string;
  billNumber: string | null;
  dueDate: string;
  /** Negative when the bill is late. */
  daysUntilDue: number;
  balanceMinor: number;
}

export interface HomePayables extends HomeOpenSide {
  /** The Accounts Payable control balance as of asOf, shown positive; equals totalMinor when the aging report ties to the ledger. */
  ledgerMinor: number;
  /** Bill payments dated in the 30 days through asOf, not void. Only base-currency payments are summed. */
  paidLast30: { baseMinor: number; count: number; otherCurrencyCount: number };
  /** At most 5, soonest due first (late bills come first). */
  nextBills: HomeNextBill[];
}

/** A customer payment. amountMinor is in the payment's own currency, with that currency's decimals. */
export interface HomePayment {
  id: string;
  date: string;
  customerName: string;
  amountMinor: number;
  currencyCode: string;
  decimals: number;
}

export type HomeTone = "positive" | "warning" | "danger" | "neutral";

export interface HomeBankAccount {
  /** The bank account record's id. */
  id: string;
  name: string;
  masked: string | null;
  isCard: boolean;
  /** As the Banking screens show it: a card's balance owed is positive (`shown(…, "card")`). */
  bookMinor: number;
  /** The last completed statement's ending balance, shown the same way; null when never reconciled. */
  statementMinor: number | null;
  reconciledThrough: string | null;
  linesToCode: number;
  lastLineDate: string | null;
  tone: HomeTone;
  statusText: string;
  href: string;
}

export interface HomeBank {
  accounts: HomeBankAccount[];
  /**
   * Bank-type ledger accounts with no bank account record behind them (the
   * chart's "Cash on Hand"): how many and their balance. Null when there are none.
   */
  otherCash: { accounts: number; bookMinor: number } | null;
  /** Every bank-type ledger account: equals Cash on hand. Cards are not in it. */
  totalBookMinor: number;
}

export interface HomeCloseStep {
  key: string;
  title: string;
  status: "complete" | "outstanding" | "not-applicable" | "unavailable";
  href: string;
}

export interface HomeClose {
  /** "October 2026" */
  periodLabel: string;
  periodEnd: string;
  steps: HomeCloseStep[];
  complete: number;
  /** complete + outstanding: the steps this company has to do. */
  applicable: number;
  lastClosedLabel: string | null;
}

/** Months of earlier fiscal years that have ended and are still open. */
export interface HomeEarlierOpen {
  count: number;
  oldestPeriodEnd: string;
}

/**
 * Month-end close as the card shows it. The close checklist covers this fiscal
 * year only, as the period close screen does; months of earlier years still
 * open are closed in Accounting periods, so they are said apart.
 */
export interface HomeCloseReport {
  /** The checklist of the month a close is about; null when no month of this fiscal year has ended open and none covers today. */
  close: HomeClose | null;
  /** Null when every month of earlier years is closed, or when that could not be read. */
  earlierOpen: HomeEarlierOpen | null;
}

export interface HomeInsight {
  key: string;
  /** The small label over the sentence: "Books", "Profit", "Receivables", "Cash", "Margin". */
  kind: string;
  headline: string;
  detail: string;
  link: { label: string; href: string };
}

export type HomeTab = "overview" | "money-in" | "money-out" | "banking";

export interface HomeNeed {
  key: string;
  tab: HomeTab;
  count: number;
  tone: "warning" | "danger" | "info";
  title: string;
  detail: string;
  href: string;
  /** The button's word: "Review", "Pay", "Code", "Reconcile", "Approve", "Continue", "Post". */
  action: string;
}

/** Needs attention as the page draws it. */
export interface HomeNeedsReport {
  needs: HomeNeed[];
  /**
   * Shown when `needs` is empty: "Nothing is waiting. Every check came back
   * clear." or, when some checks could not run, "Nothing is waiting among the
   * checks that ran." Null when no check could run at all.
   */
  clear: string | null;
  /** Names the checks that could not run; null when every check ran. */
  note: string | null;
}
